import type { EmbeddingProvider } from "../../types.js";
import { getEnvVar } from "../../config.js";
import { logger } from "../../state/logger.js";

type Pipeline = (
  task: string,
  model: string,
) => Promise<
  (
    texts: string[],
    options: { pooling: string; normalize: boolean },
  ) => Promise<{ tolist: () => number[][] }>
>;

/**
 * Local CPU embeddings via @xenova/transformers. The default model is
 * `nomic-embed-text-v1.5` — chosen for its 8192-token context (critical for
 * session backfill where interaction chunks routinely exceed 512 tokens) and
 * Matryoshka representation learning (lets us truncate the 768-dim vectors
 * to 512/256/128 later without re-embedding).
 *
 * Model selection can be overridden via LOCAL_EMBEDDING_MODEL env var, and
 * the dimensions via LOCAL_EMBEDDING_DIMS. Defaults match nomic.
 *
 * Task prefixes: nomic requires `search_query: ` on queries and
 * `search_document: ` on stored content. We apply them here so callers of
 * embed()/embedBatch() never see the quirk — query embeddings go through
 * embed(), document embeddings through embedBatch(). Note that the other
 * hosted providers forward embed() → embedBatch([text]); we intentionally
 * do NOT do that here so we can prefix the two paths differently.
 *
 * First-use behavior: the model (~137 MB for nomic) is downloaded on the
 * FIRST embedding call, then cached by xenova's default cache dir
 * (~/.cache/huggingface or platform equivalent). Server boot is fast —
 * no network IO happens until an actual embed() or embedBatch() is made.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  private readonly model: string;
  private extractor: Awaited<ReturnType<Pipeline>> | null = null;

  constructor() {
    this.model =
      getEnvVar("LOCAL_EMBEDDING_MODEL") ?? "Xenova/nomic-embed-text-v1.5";
    const dimsEnv = getEnvVar("LOCAL_EMBEDDING_DIMS");
    this.dimensions = dimsEnv ? parseInt(dimsEnv, 10) : 768;
    this.name = `local:${this.model.replace(/^Xenova\//, "")}`;
  }

  async embed(text: string): Promise<Float32Array> {
    const extractor = await this.getExtractor();
    const prefixed = this.isNomic() ? `search_query: ${text}` : text;
    const output = await extractor([prefixed], {
      pooling: "mean",
      normalize: true,
    });
    return new Float32Array(output.tolist()[0]);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const extractor = await this.getExtractor();
    const prefixed = this.isNomic()
      ? texts.map((t) => `search_document: ${t}`)
      : texts;
    const output = await extractor(prefixed, {
      pooling: "mean",
      normalize: true,
    });
    const vectors = output.tolist();
    return vectors.map((v: number[]) => new Float32Array(v));
  }

  /** Nomic's task-prefix scheme isn't used by other xenova models. */
  private isNomic(): boolean {
    return this.model.toLowerCase().includes("nomic");
  }

  private async getExtractor() {
    if (this.extractor) return this.extractor;

    let transformers: { pipeline: Pipeline };
    try {
      // @ts-ignore - optional peer dependency
      transformers = await import("@xenova/transformers");
    } catch {
      throw new Error(
        "@xenova/transformers not installed. Install with " +
          "`npm install @xenova/transformers` for local embeddings, or " +
          "set EMBEDDING_PROVIDER=gemini|openai|voyage|cohere|openrouter " +
          "and the matching API key to use a hosted provider.",
      );
    }

    logger.info(
      `Loading local embedding model ${this.model} (first use — may download ~100-150 MB)`,
    );
    const started = Date.now()
    this.extractor = await transformers.pipeline(
      "feature-extraction",
      this.model,
    );
    logger.info(
      `Local embedding model loaded in ${Date.now() - started}ms`,
    )
    return this.extractor;
  }
}
