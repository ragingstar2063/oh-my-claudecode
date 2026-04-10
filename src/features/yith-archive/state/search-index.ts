import type { CompressedObservation, Memory } from "../types.js";
import { stem } from "./stemmer.js";
import { getSynonyms } from "./synonyms.js";

/**
 * Sentinel sessionId used for memory documents in the BM25 index.
 * Hydration callers in hybrid-search.ts and search.ts branch on this
 * value to fetch from KV.memories instead of KV.observations(sessionId).
 * Exposed so those callers can reference the constant rather than
 * duplicating the literal.
 */
export const MEMORY_SENTINEL_SESSION_ID = "__mem__"

/** What kind of document an index entry represents. Optional on the
 *  stored entry (absent = "obs") so existing serialized indexes stay
 *  backward-compatible without a format bump. */
export type DocumentKind = "obs" | "mem"

interface IndexEntry {
  obsId: string;
  sessionId: string;
  termCount: number;
  /** Omitted for backward-compat on serialized indexes built before
   *  memories were indexable. Treat absence as "obs". */
  kind?: DocumentKind;
}

export class SearchIndex {
  private entries: Map<string, IndexEntry> = new Map();
  private invertedIndex: Map<string, Set<string>> = new Map();
  private docTermCounts: Map<string, Map<string, number>> = new Map();
  private totalDocLength = 0;
  private sortedTerms: string[] | null = null;

  private readonly k1 = 1.2;
  private readonly b = 0.75;

  add(obs: CompressedObservation): void {
    this.addDocument(obs.id, obs.sessionId, "obs", this.extractTerms(obs));
  }

  /**
   * Index a Memory document for retrieval. Memories get a sentinel
   * sessionId so hydration callers know to fetch from KV.memories
   * instead of the per-session observations scope.
   *
   * The extracted terms mirror what a CompressedObservation would
   * contribute: title, narrative/content, concepts, files, and the
   * memory's type tag. Memories have no `facts` or `subtitle`, so
   * those slots are empty.
   */
  addMemory(memory: Memory): void {
    this.addDocument(
      memory.id,
      MEMORY_SENTINEL_SESSION_ID,
      "mem",
      this.extractMemoryTerms(memory),
    );
  }

  /** Remove a document from the index. Safe to call for unknown IDs
   *  (no-op). Used on memory delete and on supersede (when an older
   *  memory version should no longer surface in search). */
  remove(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    const termFreq = this.docTermCounts.get(id)
    if (termFreq) {
      for (const term of termFreq.keys()) {
        const bucket = this.invertedIndex.get(term)
        if (bucket) {
          bucket.delete(id)
          if (bucket.size === 0) this.invertedIndex.delete(term)
        }
      }
    }
    this.entries.delete(id)
    this.docTermCounts.delete(id)
    this.totalDocLength -= entry.termCount
    if (this.totalDocLength < 0) this.totalDocLength = 0
    this.sortedTerms = null
  }

  /** Private: shared body of add() and addMemory(). */
  private addDocument(
    id: string,
    sessionId: string,
    kind: DocumentKind,
    terms: string[],
  ): void {
    // If this ID is already indexed, remove its old entry so we don't
    // double-count (e.g., re-indexing a memory after supersede).
    if (this.entries.has(id)) {
      this.remove(id)
    }

    const termFreq = new Map<string, number>()
    let termCount = 0
    for (const term of terms) {
      termFreq.set(term, (termFreq.get(term) || 0) + 1)
      termCount++
    }

    this.entries.set(id, {
      obsId: id,
      sessionId,
      termCount,
      kind,
    })
    this.docTermCounts.set(id, termFreq)
    this.totalDocLength += termCount

    for (const term of termFreq.keys()) {
      if (!this.invertedIndex.has(term)) {
        this.invertedIndex.set(term, new Set())
      }
      this.invertedIndex.get(term)!.add(id)
    }

    this.sortedTerms = null
  }

  search(
    query: string,
    limit = 20,
  ): Array<{ obsId: string; sessionId: string; score: number; kind: DocumentKind }> {
    const rawTerms = this.tokenize(query.toLowerCase());
    if (rawTerms.length === 0) return [];

    const N = this.entries.size;
    if (N === 0) return [];
    const avgDocLen = this.totalDocLength / N;

    const queryTerms: Array<{ term: string; weight: number }> = [];
    const seen = new Set<string>();
    for (const term of rawTerms) {
      if (!seen.has(term)) {
        seen.add(term);
        queryTerms.push({ term, weight: 1.0 });
      }
      for (const syn of getSynonyms(term)) {
        if (!seen.has(syn)) {
          seen.add(syn);
          queryTerms.push({ term: syn, weight: 0.7 });
        }
      }
    }

    const scores = new Map<string, number>();
    const sorted = this.getSortedTerms();

    for (const { term, weight } of queryTerms) {
      const matchingDocs = this.invertedIndex.get(term);
      if (matchingDocs) {
        const df = matchingDocs.size;
        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

        for (const obsId of matchingDocs) {
          const entry = this.entries.get(obsId)!;
          const docTerms = this.docTermCounts.get(obsId);
          const tf = docTerms?.get(term) || 0;
          const docLen = entry.termCount;

          const numerator = tf * (this.k1 + 1);
          const denominator =
            tf + this.k1 * (1 - this.b + this.b * (docLen / avgDocLen));
          const bm25Score = idf * (numerator / denominator) * weight;

          scores.set(obsId, (scores.get(obsId) || 0) + bm25Score);
        }
      }

      const startIdx = this.lowerBound(sorted, term);
      for (let si = startIdx; si < sorted.length; si++) {
        const indexTerm = sorted[si];
        if (!indexTerm.startsWith(term)) break;
        if (indexTerm === term) continue;

        const obsIds = this.invertedIndex.get(indexTerm)!;
        const prefixDf = obsIds.size;
        const prefixIdf =
          Math.log((N - prefixDf + 0.5) / (prefixDf + 0.5) + 1) * 0.5;
        for (const obsId of obsIds) {
          const entry = this.entries.get(obsId)!;
          const docTerms = this.docTermCounts.get(obsId);
          const tf = docTerms?.get(indexTerm) || 0;
          const docLen = entry.termCount;
          const numerator = tf * (this.k1 + 1);
          const denominator =
            tf + this.k1 * (1 - this.b + this.b * (docLen / avgDocLen));
          scores.set(
            obsId,
            (scores.get(obsId) || 0) + prefixIdf * (numerator / denominator) * weight,
          );
        }
      }
    }

    return Array.from(scores.entries())
      .map(([obsId, score]) => {
        const entry = this.entries.get(obsId)!;
        return {
          obsId,
          sessionId: entry.sessionId,
          score,
          kind: entry.kind ?? ("obs" as DocumentKind),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.invertedIndex.clear();
    this.docTermCounts.clear();
    this.totalDocLength = 0;
    this.sortedTerms = null;
  }

  restoreFrom(other: SearchIndex): void {
    this.entries = new Map(
      Array.from(other.entries.entries()).map(([k, v]) => [k, { ...v }]),
    );
    this.invertedIndex = new Map(
      Array.from(other.invertedIndex.entries()).map(([k, v]) => [
        k,
        new Set(v),
      ]),
    );
    this.docTermCounts = new Map(
      Array.from(other.docTermCounts.entries()).map(([k, v]) => [
        k,
        new Map(v),
      ]),
    );
    this.totalDocLength = other.totalDocLength;
    this.sortedTerms = null;
  }

  serialize(): string {
    const entries = Array.from(this.entries.entries());
    const inverted = Array.from(this.invertedIndex.entries()).map(
      ([term, ids]) => [term, Array.from(ids)] as [string, string[]],
    );
    const docTerms = Array.from(this.docTermCounts.entries()).map(
      ([id, counts]) =>
        [id, Array.from(counts.entries())] as [string, [string, number][]],
    );
    return JSON.stringify({
      v: 2,
      entries,
      inverted,
      docTerms,
      totalDocLength: this.totalDocLength,
    });
  }

  static deserialize(json: string): SearchIndex {
    try {
      const idx = new SearchIndex();
      const data = JSON.parse(json);
      if (!data?.entries || !data?.inverted || !data?.docTerms) return idx;
      for (const [key, val] of data.entries) {
        idx.entries.set(key, val);
      }
      for (const [term, ids] of data.inverted) {
        idx.invertedIndex.set(term, new Set(ids));
      }
      for (const [id, counts] of data.docTerms) {
        idx.docTermCounts.set(id, new Map(counts));
      }
      const rawLen = Number(data.totalDocLength);
      idx.totalDocLength =
        Number.isFinite(rawLen) && rawLen >= 0 ? Math.floor(rawLen) : 0;
      return idx;
    } catch {
      return new SearchIndex();
    }
  }

  private extractTerms(obs: CompressedObservation): string[] {
    const parts = [
      obs.title,
      obs.subtitle || "",
      obs.narrative,
      ...obs.facts,
      ...obs.concepts,
      ...obs.files,
      obs.type,
    ];
    return this.tokenize(parts.join(" ").toLowerCase());
  }

  private extractMemoryTerms(mem: Memory): string[] {
    const parts = [
      mem.title,
      mem.content,
      ...(mem.concepts ?? []),
      ...(mem.files ?? []),
      mem.type,
    ];
    return this.tokenize(parts.join(" ").toLowerCase());
  }

  private tokenize(text: string): string[] {
    return text
      .replace(/[^\w\s/.\-_]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1)
      .map((t) => stem(t));
  }

  private getSortedTerms(): string[] {
    if (!this.sortedTerms) {
      this.sortedTerms = Array.from(this.invertedIndex.keys()).sort();
    }
    return this.sortedTerms;
  }

  private lowerBound(arr: string[], target: string): number {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (arr[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}
