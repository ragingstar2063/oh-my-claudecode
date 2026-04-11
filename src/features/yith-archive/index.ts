/**
 * Yith Archive — persistent cross-session memory for oh-my-claudecode.
 *
 * Public API. Call `createYithArchive()` to get an initialized archive handle,
 * then use `archive.trigger("mem::<name>", args)` to dispatch to any registered
 * memory function. A small set of top-level convenience wrappers (`remember`,
 * `recall`, `search`, etc.) is exposed for common operations.
 *
 * The archive runs entirely in-process. There is no background server, no
 * network I/O, and no external runtime dependency beyond the npm package graph.
 */

import { join } from "node:path"
import { homedir } from "node:os"
import { existsSync, mkdirSync, renameSync } from "node:fs"

import {
  loadConfig,
  getEnvVar,
  loadEmbeddingConfig,
  loadFallbackConfig,
  loadSnapshotConfig,
  isGraphExtractionEnabled,
  isConsolidationEnabled,
} from "./config.js"
import {
  createProvider,
  createFallbackProvider,
  createEmbeddingProvider,
  hasLLMCredentials,
  LazyLLMProvider,
} from "./providers/index.js"
import { YithKV } from "./state/kv.js"
import { createFakeSdk, type FakeSdk } from "./state/fake-sdk.js"
import { VectorIndex } from "./state/vector-index.js"
import { HybridSearch } from "./state/hybrid-search.js"
import { IndexPersistence } from "./state/index-persistence.js"
import { logger } from "./state/logger.js"
import { VERSION } from "./version.js"

import { registerPrivacyFunction } from "./functions/privacy.js"
import { registerObserveFunction } from "./functions/observe.js"
import {
  registerCompressFunction,
  registerCompressStepFunction,
} from "./functions/compress.js"
import {
  registerSearchFunction,
  rebuildIndex,
  getSearchIndex,
  registerVectorIndex,
} from "./functions/search.js"
import { registerContextFunction } from "./functions/context.js"
import {
  registerSummarizeFunction,
  registerSummarizeStepFunction,
} from "./functions/summarize.js"
import { registerMigrateFunction } from "./functions/migrate.js"
import { registerFileIndexFunction } from "./functions/file-index.js"
import {
  registerConsolidateFunction,
  registerConsolidateStepFunction,
} from "./functions/consolidate.js"
import { registerPatternsFunction } from "./functions/patterns.js"
import { registerRememberFunction } from "./functions/remember.js"
import { registerEvictFunction } from "./functions/evict.js"
import { registerRelationsFunction } from "./functions/relations.js"
import { registerTimelineFunction } from "./functions/timeline.js"
import { registerSmartSearchFunction } from "./functions/smart-search.js"
import { registerProfileFunction } from "./functions/profile.js"
import { registerAutoForgetFunction } from "./functions/auto-forget.js"
import { registerExportImportFunction } from "./functions/export-import.js"
import { registerEnrichFunction } from "./functions/enrich.js"
import {
  registerGraphFunction,
  registerGraphStepFunction,
} from "./functions/graph.js"
import {
  registerConsolidationPipelineFunction,
  registerConsolidationPipelineStepFunction,
} from "./functions/consolidation-pipeline.js"
import { registerBackfillFunction } from "./functions/backfill.js"
import { registerCompressBatchFunction } from "./functions/compress-batch.js"
import { registerOpencodeImportFunction } from "./functions/opencode-import.js"
import { registerSnapshotFunction } from "./functions/snapshot.js"
import { registerActionsFunction } from "./functions/actions.js"
import { registerFrontierFunction } from "./functions/frontier.js"
import { registerLeasesFunction } from "./functions/leases.js"
import { registerSignalsFunction } from "./functions/signals.js"
import { registerCheckpointsFunction } from "./functions/checkpoints.js"
import {
  registerFlowCompressFunction,
  registerFlowCompressStepFunction,
} from "./functions/flow-compress.js"
import { registerSketchesFunction } from "./functions/sketches.js"
import {
  registerCrystallizeFunction,
  registerCrystallizeStepFunction,
} from "./functions/crystallize.js"
import { registerDiagnosticsFunction } from "./functions/diagnostics.js"
import { registerFacetsFunction } from "./functions/facets.js"
import { registerVerifyFunction } from "./functions/verify.js"
import { registerCascadeFunction } from "./functions/cascade.js"
import { registerLessonsFunctions } from "./functions/lessons.js"
import {
  registerReflectFunctions,
  registerReflectStepFunction,
} from "./functions/reflect.js"
import { registerWorkingMemoryFunctions } from "./functions/working-memory.js"
import {
  registerSkillExtractFunctions,
  registerSkillExtractStepFunction,
} from "./functions/skill-extract.js"
import {
  registerSlidingWindowFunction,
  registerSlidingWindowStepFunction,
  registerEnrichSessionStepFunction,
} from "./functions/sliding-window.js"
import {
  registerQueryExpansionFunction,
  registerQueryExpansionStepFunction,
} from "./functions/query-expansion.js"
import {
  registerTemporalGraphFunctions,
  registerTemporalGraphStepFunction,
} from "./functions/temporal-graph.js"
import { registerRetentionFunctions } from "./functions/retention.js"
import { registerEventTriggers } from "./triggers/events.js"
import { DedupMap } from "./functions/dedup.js"
import { MetricsStore } from "./eval/metrics-store.js"
import { WorkPacketStore } from "./state/work-packets.js"

/** Options accepted by createYithArchive(). */
export interface YithArchiveOptions {
  /** Override the on-disk directory. Defaults to ~/.oh-my-claudecode/yith. */
  dataDir?: string
}

/** Handle returned by createYithArchive(). */
export interface YithArchiveHandle {
  /** Underlying in-process dispatcher — use `sdk.trigger(name, args)` for any registered function. */
  sdk: FakeSdk
  /** Key/value store backing the archive. Exposed for advanced inspection. */
  kv: YithKV
  /** Archive version. */
  version: string
  /**
   * Whether the configured LLM provider has credentials available. Tools
   * consult this to decide whether to route LLM-requiring functions
   * through the direct path (`true`) or the work-packet state-machine
   * path (`false`). Snapshot at boot — if a user adds an API key mid-
   * session, they need to restart for the direct path to kick in.
   */
  hasLLMProvider: boolean
  /**
   * Persistent store for work-packet continuations. Used by yith_trigger
   * and yith_commit_work in the MCP layer to pause and resume state-
   * machine functions across tool calls.
   */
  workPacketStore: WorkPacketStore
  /** Persist all pending state to disk and release timers. */
  shutdown(): Promise<void>

  // Convenience wrappers for the most common operations.
  remember(data: RememberArgs): Promise<unknown>
  recall(data: SearchArgs): Promise<unknown>
  search(data: SearchArgs): Promise<unknown>
  context(data: ContextArgs): Promise<unknown>
  observe(data: ObserveArgs): Promise<unknown>
}

export interface RememberArgs {
  content: string
  type?: string
  concepts?: string[]
  files?: string[]
  ttlDays?: number
  sourceObservationIds?: string[]
}

export interface SearchArgs {
  query: string
  limit?: number
  [key: string]: unknown
}

export interface ContextArgs {
  sessionId?: string
  project: string
  [key: string]: unknown
}

export interface ObserveArgs {
  sessionId: string
  project: string
  cwd: string
  timestamp: string
  data: unknown
  [key: string]: unknown
}

/**
 * Initialize the Yith Archive. Registers all memory functions against an
 * in-process dispatcher and returns a handle for calling them.
 */
export function createYithArchive(
  options: YithArchiveOptions = {},
): YithArchiveHandle {
  const dataDir = options.dataDir ?? join(homedir(), ".oh-my-claudecode", "yith")
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  const config = loadConfig()
  const embeddingConfig = loadEmbeddingConfig()
  const fallbackConfig = loadFallbackConfig()

  const llmAvailable = hasLLMCredentials(config.provider)
  const provider = new LazyLLMProvider(() => {
    if (!llmAvailable) return null
    return fallbackConfig.providers.length > 0
      ? createFallbackProvider(config.provider, fallbackConfig)
      : createProvider(config.provider)
  })

  const embeddingProvider = createEmbeddingProvider()

  logger.info(`Starting Yith Archive v${VERSION}`)
  logger.info(`Data dir: ${dataDir}`)
  if (llmAvailable) {
    logger.info(
      `LLM provider: ${config.provider.provider} (${config.provider.model}) — deferred, constructs on first use`,
    )
  } else {
    logger.info(
      `LLM provider: none configured — work-packet mode (advanced ops will return work descriptors for the session agent to execute)`,
    )
  }
  if (embeddingProvider) {
    logger.info(
      `Embedding provider: ${embeddingProvider.name} (${embeddingProvider.dimensions} dims)`,
    )
  } else {
    logger.info(`Embedding provider: none (BM25-only mode)`)
  }

  const sdk = createFakeSdk()
  // The archive's canonical on-disk file is `necronomicon.json` —
  // the Mad Arab's tome that the Great Race of Yith maintains. Older
  // installs wrote to `store.json`; if we find one without a
  // necronomicon.json sibling we transparently migrate it on boot
  // (rename + re-read) so users who upgrade in-place don't lose data.
  const necronomiconPath = join(dataDir, "necronomicon.json")
  const legacyStorePath = join(dataDir, "store.json")
  if (!existsSync(necronomiconPath) && existsSync(legacyStorePath)) {
    try {
      // Atomic migration: rename so concurrent readers never see both.
      // If the rename fails (permissions, cross-device), fall back to
      // reading store.json directly — we don't want to block startup.
      renameSync(legacyStorePath, necronomiconPath)
      logger.info(
        `Migrated legacy store.json → necronomicon.json in ${dataDir}`,
      )
    } catch (err) {
      logger.warn(
        `Legacy store.json migration failed — reading from store.json: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  const kv = new YithKV(
    existsSync(necronomiconPath) ? necronomiconPath : legacyStorePath,
  )
  const metricsStore = new MetricsStore(kv)
  const dedupMap = new DedupMap()
  const vectorIndex = embeddingProvider ? new VectorIndex() : null
  // Wire the vector index + embedder into search.ts so putMemory /
  // deleteMemory / rebuildIndex can keep hybrid search in sync with
  // memory writes. No-ops if the embedding provider isn't configured.
  registerVectorIndex(vectorIndex, embeddingProvider)

  registerPrivacyFunction(sdk)
  registerObserveFunction(sdk, kv, dedupMap, config.maxObservationsPerSession)
  registerCompressFunction(sdk, kv, provider, metricsStore)
  registerCompressStepFunction(sdk, kv, metricsStore)
  registerSearchFunction(sdk, kv)
  registerContextFunction(sdk, kv, config.tokenBudget)
  registerSummarizeFunction(sdk, kv, provider, metricsStore)
  registerSummarizeStepFunction(sdk, kv, metricsStore)
  registerMigrateFunction(sdk, kv)
  registerFileIndexFunction(sdk, kv)
  registerConsolidateFunction(sdk, kv, provider)
  registerConsolidateStepFunction(sdk, kv)
  registerPatternsFunction(sdk, kv)
  registerRememberFunction(sdk, kv)
  registerEvictFunction(sdk, kv)
  registerRelationsFunction(sdk, kv)
  registerTimelineFunction(sdk, kv)
  registerProfileFunction(sdk, kv)
  registerAutoForgetFunction(sdk, kv)
  registerExportImportFunction(sdk, kv)
  registerEnrichFunction(sdk, kv)

  if (isGraphExtractionEnabled()) {
    registerGraphFunction(sdk, kv, provider)
    registerGraphStepFunction(sdk, kv)
    logger.info(`Knowledge graph: extraction enabled`)
  }

  registerConsolidationPipelineFunction(sdk, kv, provider)
  registerConsolidationPipelineStepFunction(sdk, kv)
  registerBackfillFunction(sdk, kv)
  registerCompressBatchFunction(sdk, kv)
  registerOpencodeImportFunction(sdk, kv)
  registerActionsFunction(sdk, kv)
  registerFrontierFunction(sdk, kv)
  registerLeasesFunction(sdk, kv)
  registerSignalsFunction(sdk, kv)
  registerCheckpointsFunction(sdk, kv)
  registerFlowCompressFunction(sdk, kv, provider)
  registerFlowCompressStepFunction(sdk, kv)
  registerSketchesFunction(sdk, kv)
  registerCrystallizeFunction(sdk, kv, provider)
  registerCrystallizeStepFunction(sdk, kv)
  registerDiagnosticsFunction(sdk, kv)
  registerFacetsFunction(sdk, kv)
  registerVerifyFunction(sdk, kv)
  registerLessonsFunctions(sdk, kv)
  registerReflectFunctions(sdk, kv, provider)
  registerReflectStepFunction(sdk, kv)
  registerWorkingMemoryFunctions(sdk, kv, config.tokenBudget)
  registerSkillExtractFunctions(sdk, kv, provider)
  registerSkillExtractStepFunction(sdk, kv)
  registerCascadeFunction(sdk, kv)
  registerSlidingWindowFunction(sdk, kv, provider)
  registerSlidingWindowStepFunction(sdk, kv)
  registerEnrichSessionStepFunction(sdk, kv)
  registerQueryExpansionFunction(sdk, provider)
  registerQueryExpansionStepFunction(sdk)
  registerTemporalGraphFunctions(sdk, kv, provider)
  registerTemporalGraphStepFunction(sdk, kv)
  registerRetentionFunctions(sdk, kv)

  const snapshotConfig = loadSnapshotConfig()
  if (snapshotConfig.enabled) {
    registerSnapshotFunction(sdk, kv, snapshotConfig.dir)
  }

  const bm25Index = getSearchIndex()
  const graphWeight = parseFloat(getEnvVar("YITH_GRAPH_WEIGHT") || "0.3")
  const hybridSearch = new HybridSearch(
    bm25Index,
    vectorIndex,
    embeddingProvider,
    kv,
    embeddingConfig.bm25Weight,
    embeddingConfig.vectorWeight,
    graphWeight,
  )

  registerSmartSearchFunction(sdk, kv, (query, limit) =>
    hybridSearch.search(query, limit),
  )
  registerEventTriggers(sdk, kv)

  const indexPersistence = new IndexPersistence(
    kv,
    bm25Index,
    vectorIndex,
    embeddingProvider
      ? {
          name: embeddingProvider.name,
          dimensions: embeddingProvider.dimensions,
        }
      : null,
  )

  // Fire-and-forget background index restore. Real usage of the archive
  // works before this completes — new writes just skip the index until ready.
  indexPersistence
    .load()
    .then((loaded) => {
      if (loaded?.bm25 && loaded.bm25.size > 0) {
        bm25Index.restoreFrom(loaded.bm25)
        logger.info(`Loaded persisted BM25 index (${bm25Index.size} docs)`)
      }
      if (loaded?.vector && vectorIndex && loaded.vector.size > 0) {
        vectorIndex.restoreFrom(loaded.vector)
        logger.info(
          `Loaded persisted vector index (${vectorIndex.size} vectors)`,
        )
      }
      if (bm25Index.size === 0) {
        return rebuildIndex(kv).then((n) => {
          if (n > 0) {
            logger.info(`Search index rebuilt: ${n} observations`)
            indexPersistence.scheduleSave()
          }
        })
      }
      return undefined
    })
    .catch((err) => {
      logger.warn(`Failed to load persisted index:`, err)
    })

  // Optional background maintenance timers. Unrefed so they don't block exit.
  const autoForgetMs = parseInt(
    process.env["AUTO_FORGET_INTERVAL_MS"] || "3600000",
    10,
  )
  const consolidationMs = parseInt(
    process.env["CONSOLIDATION_INTERVAL_MS"] || "7200000",
    10,
  )

  const timers: NodeJS.Timeout[] = []

  if (process.env["AUTO_FORGET_ENABLED"] !== "false") {
    const t = setInterval(() => {
      sdk.triggerVoid("mem::auto-forget", { dryRun: false })
    }, autoForgetMs)
    t.unref()
    timers.push(t)
  }

  if (isConsolidationEnabled()) {
    const t = setInterval(() => {
      sdk.triggerVoid("mem::consolidate-pipeline", {})
    }, consolidationMs)
    t.unref()
    timers.push(t)
  }

  const workPacketStore = new WorkPacketStore(kv)
  // Fire-and-forget: clear any pending work-packet continuations that
  // expired since the last boot. Logs a count if >0.
  void workPacketStore.sweepExpired().catch((err) => {
    logger.warn("Work-packet sweep failed:", err)
  })

  return {
    sdk,
    kv,
    version: VERSION,
    hasLLMProvider: llmAvailable,
    workPacketStore,
    remember: (data) => sdk.trigger("mem::remember", data),
    recall: (data) => sdk.trigger("mem::smart-search", data),
    search: (data) => sdk.trigger("mem::smart-search", data),
    context: (data) => sdk.trigger("mem::context", data),
    observe: (data) => sdk.trigger("mem::observe", data),
    async shutdown() {
      for (const t of timers) clearInterval(t)
      indexPersistence.stop()
      dedupMap.stop()
      await indexPersistence.save().catch(() => {})
      kv.persist()
      await sdk.shutdown()
    },
  }
}

export { YithKV } from "./state/kv.js"
export { VERSION } from "./version.js"
export type { FakeSdk } from "./state/fake-sdk.js"
