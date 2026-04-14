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
 * `nomic-ai/nomic-embed-text-v1.5` — chosen for its 8192-token context (critical for
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
      getEnvVar("LOCAL_EMBEDDING_MODEL") ?? "nomic-ai/nomic-embed-text-v1.5";
    const dimsEnv = getEnvVar("LOCAL_EMBEDDING_DIMS");
    this.dimensions = dimsEnv ? parseInt(dimsEnv, 10) : 768;
    this.name = `local:${this.model.replace(/^(Xenova|nomic-ai)\//, "")}`;
  }

  /**
   * Force the model to load (and download if necessary) with optional
   * progress reporting. Called by `oh-my-claudecode bind` at the start
   * of the binding ritual so the user sees a real download progress
   * bar instead of a silent multi-minute wait on their first memory
   * write. Idempotent: re-running against an already-loaded provider
   * just re-emits loading/ready events synchronously.
   *
   * The onProgress callback receives events with `phase` ∈
   * `{loading, downloading, ready, error}`. The `downloading` phase
   * carries byte counts when @xenova/transformers surfaces them via
   * its internal progress_callback hook; the others are lifecycle
   * markers. Callers should render the stream as a TUI bar.
   */
  async warmUp(opts?: {
    onProgress?: (event: {
      phase: "loading" | "downloading" | "ready" | "error"
      message?: string
      loaded?: number
      total?: number
    }) => void
  }): Promise<void> {
    const onProgress = opts?.onProgress
    onProgress?.({
      phase: "loading",
      message: `Loading embedding model ${this.model}`,
    })
    try {
      await this.getExtractor(onProgress)
      onProgress?.({ phase: "ready", message: "Model loaded and cached" })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      onProgress?.({ phase: "error", message })
      throw err
    }
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

  private async getExtractor(
    onProgress?: (event: {
      phase: "loading" | "downloading" | "ready" | "error"
      message?: string
      loaded?: number
      total?: number
    }) => void,
  ) {
    if (this.extractor) return this.extractor;

    let transformers: {
      pipeline: (
        task: string,
        model: string,
        opts?: { progress_callback?: (data: unknown) => void },
      ) => Promise<Awaited<ReturnType<Pipeline>>>
    };
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
      {
        // Forward xenova's internal progress events to our caller's
        // callback. Xenova emits per-file download events with
        // {status, name, file, progress, loaded, total} — we map the
        // ones we understand into our simpler phase vocabulary.
        progress_callback: (data: unknown) => {
          if (!onProgress) return
          const ev = data as {
            status?: string
            file?: string
            progress?: number
            loaded?: number
            total?: number
          }
          if (ev.status === "progress" || ev.status === "download") {
            onProgress({
              phase: "downloading",
              message: ev.file,
              loaded: ev.loaded,
              total: ev.total,
            })
          } else if (ev.status === "ready" || ev.status === "done") {
            onProgress({
              phase: "ready",
              message: ev.file,
            })
          }
        },
      },
    );
    logger.info(
      `Local embedding model loaded in ${Date.now() - started}ms`,
    )
    return this.extractor;
  }
}
