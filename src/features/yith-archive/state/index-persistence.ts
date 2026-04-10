import { SearchIndex } from "./search-index.js";
import { VectorIndex } from "./vector-index.js";
import type { StateKV } from "./kv.js";
import { KV } from "./schema.js";
import { logger } from "./logger.js";

const DEBOUNCE_MS = 5000;

/**
 * Schema version of the index-meta record. Bump whenever the on-disk shape
 * of the persisted BM25 or vector index changes incompatibly. On bump,
 * existing archives will fail the compatibility check below and rebuild
 * their indexes from observations on next load.
 */
const INDEX_SCHEMA_VERSION = 1;

/**
 * Persisted compatibility header for the on-disk index. Lives in the
 * `mem:index:meta` scope of the KV (same store.json file as everything
 * else, so it rides the same atomic write). On load, we compare the
 * stored header against the current runtime embedding provider — if
 * any field mismatches, the persisted vector index is discarded and
 * rebuilt. This protects against:
 *
 *   - Schema drift (bumping INDEX_SCHEMA_VERSION)
 *   - User swapping EMBEDDING_PROVIDER env vars
 *   - User upgrading LOCAL_EMBEDDING_MODEL (e.g. MiniLM → nomic)
 *   - Dimension changes that would make old vectors arithmetically
 *     incompatible with new ones (384 → 768)
 */
interface IndexMeta {
  schemaVersion: number;
  embeddingProvider: string; // e.g. "local:nomic-embed-text-v1.5"
  dimensions: number;
  entries: number;
  generation: number;
  lastFlushedAt: string; // ISO 8601
}

/** Info about the currently-active embedding provider, used for meta checks. */
export interface EmbeddingProviderInfo {
  name: string;
  dimensions: number;
}

export class IndexPersistence {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;

  constructor(
    private kv: StateKV,
    private bm25: SearchIndex,
    private vector: VectorIndex | null,
    /**
     * Info about the currently-configured embedding provider. Used to
     * validate the persisted vector index on load. If null, no vector
     * index is active (BM25-only mode) and meta validation is skipped.
     */
    private embeddingInfo: EmbeddingProviderInfo | null = null,
  ) {}

  scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), DEBOUNCE_MS);
  }

  async save(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.kv.set(KV.bm25Index, "data", this.bm25.serialize());
    if (this.vector && this.vector.size > 0) {
      await this.kv.set(KV.bm25Index, "vectors", this.vector.serialize());
    }
    // Update the meta header every time we flush so `entries` and
    // `lastFlushedAt` reflect reality. The provider/dimensions fields
    // are locked by the current runtime config.
    this.generation += 1;
    const meta: IndexMeta = {
      schemaVersion: INDEX_SCHEMA_VERSION,
      embeddingProvider: this.embeddingInfo?.name ?? "none",
      dimensions: this.embeddingInfo?.dimensions ?? 0,
      entries: this.vector?.size ?? 0,
      generation: this.generation,
      lastFlushedAt: new Date().toISOString(),
    };
    await this.kv.set(KV.indexMeta, "current", meta);
  }

  /**
   * Load persisted indexes. Validates the meta header against the current
   * embedding provider before restoring — on mismatch, the persisted vector
   * index is dropped and the caller will rebuild from observations. The
   * BM25 index is always safe to restore regardless of embedding config.
   */
  async load(): Promise<{
    bm25: SearchIndex | null;
    vector: VectorIndex | null;
  }> {
    let bm25: SearchIndex | null = null;
    let vector: VectorIndex | null = null;

    // Always attempt BM25 restore — it's independent of embedding config.
    const bm25Data = await this.kv
      .get<string>(KV.bm25Index, "data")
      .catch(() => null);
    if (bm25Data && typeof bm25Data === "string") {
      bm25 = SearchIndex.deserialize(bm25Data);
    }

    // Validate vector index compatibility before restoring. If any field
    // has drifted from what the persisted index was built against, we
    // discard the old vector data and let it rebuild.
    const meta = await this.kv
      .get<IndexMeta>(KV.indexMeta, "current")
      .catch(() => null);
    const vectorsCompatible = this.checkCompatibility(meta);

    if (vectorsCompatible) {
      const vecData = await this.kv
        .get<string>(KV.bm25Index, "vectors")
        .catch(() => null);
      if (vecData && typeof vecData === "string") {
        vector = VectorIndex.deserialize(vecData);
      }
      if (meta) {
        // Adopt the stored generation counter so our next save() increments
        // monotonically across process restarts.
        this.generation = meta.generation;
      }
    }

    return { bm25, vector };
  }

  /**
   * Returns true if the persisted meta header matches the current runtime
   * config and the vector index can be safely restored. Logs a warning on
   * any mismatch so users understand why their index is being rebuilt.
   */
  private checkCompatibility(meta: IndexMeta | null): boolean {
    // No meta at all — first boot after an upgrade, or legacy archive.
    // Safe to attempt restore; if the vector data is incompatible it'll
    // surface as a dimension mismatch at query time. On next flush the
    // meta will be written and future boots will have a proper header.
    if (!meta) {
      return true;
    }

    if (meta.schemaVersion !== INDEX_SCHEMA_VERSION) {
      logger.warn(
        `Index schema version changed (${meta.schemaVersion} → ${INDEX_SCHEMA_VERSION}) — rebuilding vector index`,
      );
      return false;
    }

    // If we have no active embedding provider, any persisted vectors are
    // moot — there's nothing to compare queries against. Drop them.
    if (!this.embeddingInfo) {
      if (meta.dimensions > 0) {
        logger.warn(
          `Persisted vector index (${meta.embeddingProvider}, ${meta.dimensions} dims) but no embedding provider is currently active — clearing`,
        );
        return false;
      }
      return true;
    }

    if (meta.embeddingProvider !== this.embeddingInfo.name) {
      logger.warn(
        `Embedding provider changed (${meta.embeddingProvider} → ${this.embeddingInfo.name}) — rebuilding vector index`,
      );
      return false;
    }

    if (meta.dimensions !== this.embeddingInfo.dimensions) {
      logger.warn(
        `Embedding dimensions changed (${meta.dimensions} → ${this.embeddingInfo.dimensions}) — rebuilding vector index`,
      );
      return false;
    }

    return true;
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
