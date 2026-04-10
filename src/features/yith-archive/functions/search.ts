import type { FakeSdk } from "../state/fake-sdk.js"
import { logger } from "../state/logger.js"
import type {
  CompressedObservation,
  SearchResult,
  Session,
  Memory,
  EmbeddingProvider,
} from '../types.js'
import { KV } from '../state/schema.js'
import { StateKV } from '../state/kv.js'
import { SearchIndex, MEMORY_SENTINEL_SESSION_ID } from '../state/search-index.js'
import { VectorIndex } from '../state/vector-index.js'

let index: SearchIndex | null = null

/**
 * Module-level references to the vector index and embedding provider,
 * wired in from createYithArchive() at boot. Writes from arbitrary
 * functions (putMemory, rebuildIndex) need to touch the vector index
 * without taking it as a parameter — otherwise the plumbing ripples
 * across every KV.memories caller. The singletons mirror the pattern
 * already used for the BM25 SearchIndex via getSearchIndex().
 *
 * If either is null (no embedding provider configured), vector-index
 * operations are silently skipped — memories still land in BM25.
 */
let vectorIndexRef: VectorIndex | null = null
let embeddingProviderRef: EmbeddingProvider | null = null

export function getSearchIndex(): SearchIndex {
  if (!index) index = new SearchIndex()
  return index
}

/**
 * Wire the vector index and embedding provider into this module so
 * putMemory() / deleteMemory() / rebuildIndex() can keep the vector
 * side of hybrid search in sync with the KV. Called once from
 * createYithArchive() during boot.
 *
 * Either or both may be null — the write paths defensively check and
 * skip vector operations when the embedding provider isn't configured.
 *
 * **Single-instance-per-process contract.** Yith Archive is designed
 * to run as a single instance per Node process (one MCP server, one
 * archive). Creating a second YithArchive in the same process
 * overwrites these module-level refs, and memory writes against the
 * first archive's KV will flow into the SECOND archive's vector index.
 * Test harnesses that spin up multiple fixture archives must either
 * run them in separate processes/workers OR accept that the vector
 * index only tracks the most recently-constructed archive. A warning
 * is logged on re-registration so the collision is visible.
 */
export function registerVectorIndex(
  vi: VectorIndex | null,
  ep: EmbeddingProvider | null,
): void {
  if (vectorIndexRef && vi && vectorIndexRef !== vi) {
    logger.warn(
      "registerVectorIndex: overwriting existing vector index singleton — " +
        "multiple YithArchive instances in the same process will share this " +
        "slot. Memory writes will route to whichever archive called register last.",
    )
  }
  vectorIndexRef = vi
  embeddingProviderRef = ep
}

/**
 * Fire-and-forget: embed a memory's content and add it to the vector
 * index. Failures are logged but never thrown — vector indexing is a
 * best-effort enhancement over BM25.
 */
function indexMemoryVector(memory: Memory): void {
  const vi = vectorIndexRef
  const ep = embeddingProviderRef
  if (!vi || !ep) return
  // Build a compact embedding text — title + content. Concepts and
  // files are lexical signals that BM25 handles better anyway.
  const text = `${memory.title}\n\n${memory.content}`
  void ep
    .embed(text)
    .then((embedding) => {
      vi.add(memory.id, MEMORY_SENTINEL_SESSION_ID, embedding)
    })
    .catch((err) => {
      logger.warn("vector index embed failed for memory", {
        memId: memory.id,
        error: err instanceof Error ? err.message : String(err),
      })
    })
}

export async function rebuildIndex(kv: StateKV): Promise<number> {
  const idx = getSearchIndex()
  idx.clear()

  const sessions = await kv.list<Session>(KV.sessions)
  let count = 0

  // Index observations (session-scoped).
  if (sessions.length) {
    const obsPerSession: CompressedObservation[][] = []
    const failedSessions: string[] = []
    for (let batch = 0; batch < sessions.length; batch += 10) {
      const chunk = sessions.slice(batch, batch + 10)
      const results = await Promise.all(
        chunk.map(async (s) => {
          try {
            return await kv.list<CompressedObservation>(KV.observations(s.id))
          } catch {
            failedSessions.push(s.id)
            return [] as CompressedObservation[]
          }
        })
      )
      obsPerSession.push(...results)
    }
    if (failedSessions.length > 0) {
      logger.warn('rebuildIndex: failed to load observations for sessions', { failedSessions })
    }
    for (const observations of obsPerSession) {
      for (const obs of observations) {
        if (obs.title && obs.narrative) {
          idx.add(obs)
          count++
        }
      }
    }
  }

  // Index memories (global scope). Skip superseded versions so the
  // index only surfaces the current copy of each logical memory.
  try {
    const memories = await kv.list<Memory>(KV.memories)
    for (const mem of memories) {
      if (mem.isLatest === false) continue
      if (!mem.title || !mem.content) continue
      idx.addMemory(mem)
      count++
    }
    // Populate the vector index too, if an embedding provider is wired.
    // Sequential rather than parallel to keep memory pressure low for
    // large archives; embeddings are cheap with the local nomic model.
    if (vectorIndexRef && embeddingProviderRef) {
      const ep = embeddingProviderRef
      const vi = vectorIndexRef
      for (const mem of memories) {
        if (mem.isLatest === false) continue
        if (!mem.title || !mem.content) continue
        try {
          const text = `${mem.title}\n\n${mem.content}`
          const embedding = await ep.embed(text)
          vi.add(mem.id, MEMORY_SENTINEL_SESSION_ID, embedding)
        } catch (err) {
          logger.warn('rebuildIndex: vector embed failed for memory', {
            memId: mem.id,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }
  } catch (err) {
    logger.warn('rebuildIndex: failed to load memories', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return count
}

export function registerSearchFunction(sdk: FakeSdk, kv: StateKV): void {
  sdk.registerFunction(
    { id: 'mem::search', description: 'Search observations by keyword' },
    async (data: { query: string; limit?: number; project?: string; cwd?: string }) => {
      const idx = getSearchIndex()

      // Input validation / normalization.
      if (typeof data?.query !== 'string' || !data.query.trim()) {
        throw new Error('mem::search: query must be a non-empty string')
      }
      const query = data.query.trim()
      const MAX_LIMIT = 100
      let effectiveLimit = 20
      if (data.limit !== undefined) {
        if (!Number.isInteger(data.limit) || data.limit < 1) {
          throw new Error('mem::search: limit must be a positive integer')
        }
        effectiveLimit = Math.min(data.limit, MAX_LIMIT)
      }
      const projectFilter = typeof data.project === 'string' && data.project.length > 0 ? data.project : undefined
      const cwdFilter = typeof data.cwd === 'string' && data.cwd.length > 0 ? data.cwd : undefined

      if (idx.size === 0) {
        const count = await rebuildIndex(kv)
        logger.info('Search index rebuilt', { entries: count })
      }

      // When filtering by project/cwd, over-fetch from the index so the
      // post-filter still has a chance of returning `effectiveLimit` results.
      const filtering = !!(projectFilter || cwdFilter)
      const fetchLimit = filtering ? Math.max(effectiveLimit * 10, 100) : effectiveLimit
      const results = idx.search(query, fetchLimit)

      // Resolve session -> project/cwd once per sessionId we touch.
      const sessionCache = new Map<string, Session | null>()
      const loadSession = async (sessionId: string): Promise<Session | null> => {
        if (sessionCache.has(sessionId)) return sessionCache.get(sessionId)!
        const s = await kv.get<Session>(KV.sessions, sessionId)
        sessionCache.set(sessionId, s ?? null)
        return s ?? null
      }

      // First pass: filter by session (sequential — benefits from session cache).
      // Memories (sessionId === MEMORY_SENTINEL_SESSION_ID) bypass
      // session-based filters — project filtering for memories would
      // need its own mechanism (Memory has no project field on the
      // base type). With filtering active, memories are dropped.
      const candidates: typeof results = []
      for (const r of results) {
        if (candidates.length >= effectiveLimit) break
        if (r.kind === "mem") {
          if (filtering) continue
          candidates.push(r)
          continue
        }
        if (filtering) {
          const s = await loadSession(r.sessionId)
          if (!s) continue
          if (projectFilter && s.project !== projectFilter) continue
          if (cwdFilter && s.cwd !== cwdFilter) continue
        }
        candidates.push(r)
      }

      // Second pass: hydrate observations from their session scope and
      // memories from the global KV.memories scope, then wrap memories
      // in an observation-shaped envelope so SearchResult stays uniform.
      const hydrated = await Promise.all(
        candidates.map(async (r) => {
          if (r.kind === "mem") {
            const mem = await kv
              .get<Memory>(KV.memories, r.obsId)
              .catch(() => null)
            return mem ? memoryToObservation(mem) : null
          }
          return kv
            .get<CompressedObservation>(KV.observations(r.sessionId), r.obsId)
            .catch(() => null)
        }),
      )
      const enriched: SearchResult[] = []
      for (let i = 0; i < candidates.length; i++) {
        const obs = hydrated[i]
        if (obs) {
          enriched.push({
            observation: obs,
            score: candidates[i].score,
            sessionId: candidates[i].sessionId,
          })
        }
      }

      // Avoid logging raw cwd/project (host paths). Log only that filters were active.
      logger.info('Search completed', {
        query,
        results: enriched.length,
        hasProjectFilter: !!projectFilter,
        hasCwdFilter: !!cwdFilter,
      })
      return { results: enriched }
    }
  )
}

/**
 * Wrap a Memory in a CompressedObservation-shaped envelope so memory
 * hits can flow through the same SearchResult/HybridSearchResult
 * typing as observation hits. The sentinel sessionId lets callers
 * detect "this is actually a memory" after the fact if they need to
 * treat it specially.
 *
 * Exported so hybrid-search.ts can reuse the same shape — both
 * hydration paths must agree on the envelope format or downstream
 * consumers will see inconsistent fields.
 */
/**
 * Centralized write path for memories. Every call site that persists a
 * Memory record MUST go through this helper so the search index stays
 * in sync with the KV — otherwise the "memories are invisible to search"
 * bug (the one the unification fix targets) silently reappears.
 *
 * Handles supersede correctly: if `memory.isLatest === false`, the entry
 * is removed from the index instead of added, so old versions don't
 * compete with the current one in search results.
 */
export async function putMemory(
  kv: StateKV,
  memory: Memory,
): Promise<void> {
  await kv.set(KV.memories, memory.id, memory)
  const idx = getSearchIndex()
  if (memory.isLatest === false) {
    idx.remove(memory.id)
    vectorIndexRef?.remove(memory.id)
  } else {
    idx.addMemory(memory)
    // Fire-and-forget vector embed so lexical search isn't blocked.
    indexMemoryVector(memory)
  }
}

/**
 * Centralized delete path for memories. Keeps the search index in sync
 * with the KV. Every eviction / forget / auto-forget call site MUST go
 * through this helper — raw `kv.delete(KV.memories, ...)` will leak
 * phantom hits in search until the next rebuild.
 */
export async function deleteMemory(
  kv: StateKV,
  memoryId: string,
): Promise<void> {
  await kv.delete(KV.memories, memoryId)
  getSearchIndex().remove(memoryId)
  vectorIndexRef?.remove(memoryId)
}

/**
 * Map a Memory.type to the closest ObservationType for display/
 * filtering purposes. Memories have their own type vocabulary
 * (pattern/preference/architecture/bug/workflow/fact) that doesn't
 * exist in ObservationType, so we pick the best analogue per value.
 *
 * Callers that need the original Memory.type can still check the
 * sentinel sessionId to detect a memory hit and fetch the underlying
 * Memory record from KV.memories directly.
 */
function memoryTypeToObservationType(
  memType: Memory["type"],
): CompressedObservation["type"] {
  switch (memType) {
    case "bug":
      return "error"
    case "pattern":
    case "workflow":
      return "discovery"
    case "architecture":
    case "preference":
      return "decision"
    case "fact":
    default:
      return "other"
  }
}

export function memoryToObservation(mem: Memory): CompressedObservation {
  return {
    id: mem.id,
    sessionId: MEMORY_SENTINEL_SESSION_ID,
    timestamp: mem.createdAt,
    type: memoryTypeToObservationType(mem.type),
    title: mem.title,
    narrative: mem.content,
    facts: [],
    concepts: mem.concepts ?? [],
    files: mem.files ?? [],
    importance: Math.max(1, Math.min(10, Math.round(mem.strength))),
    confidence: 1,
  }
}
