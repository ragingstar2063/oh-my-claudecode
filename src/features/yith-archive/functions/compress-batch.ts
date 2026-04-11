import type { FakeSdk } from "../state/fake-sdk.js"
import type { StateKV } from "../state/kv.js"
import { logger } from "../state/logger.js"
import { KV } from "../state/schema.js"
import type {
  CompressedObservation,
  RawObservation,
  Session,
} from "../types.js"
import {
  createWorkPacket,
  planLoopBatches,
  type StepInput,
  type StepResult,
  type WorkPacket,
} from "../state/work-packets.js"
import {
  COMPRESSION_SYSTEM,
  buildCompressionPrompt,
} from "../prompts/compression.js"
import { parseCompressionXml } from "./compress.js"

/**
 * mem::compress-batch-step — the loop-style state machine that walks
 * every raw observation in the archive, emits compression work packets
 * in planLoopBatches-sized chunks, and consumes completions into
 * CompressedObservations.
 *
 * This is the "compression half" of the bind pipeline. Phase 1 of
 * `oh-my-claudecode bind` writes raw observations (fast, no LLM);
 * Phase 2 — either via a live Claude Code session's `/necronomicon-bind`
 * command or via cron + `claude -p` — calls this function in the
 * work-packet loop to distill the raw queue into searchable memories.
 *
 * Distinct from `mem::compress-step` (which compresses ONE observation
 * at a time). The `-batch` variant exists so a single invocation can
 * drain hundreds of pending raws over multiple round-trips without the
 * caller having to loop manually.
 *
 * Detection of "raw" observations: we treat any observation missing a
 * `title` field as raw. RawObservation has userPrompt/toolName/toolInput
 * but no title; CompressedObservation has a title. This heuristic works
 * because every compression path goes through parseCompressionXml which
 * sets title, and the backfill function's output is the only path that
 * produces untitled observations.
 */

// ============================================================================
// Types
// ============================================================================

interface CompressBatchArgs {
  /** Max raw observations to process per `bind` invocation. Default 200.
   *  A run with 500 raws and limit=200 compresses the oldest 200,
   *  leaving 300 for the next run — resumable by design. */
  limit?: number
  /** Explicit project filter (absolute cwd). Default: all sessions. */
  projectCwd?: string
}

interface CompressBatchTask {
  obsId: string
  sessionId: string
  /** The packet's system+user prompts for this task. Stored so the
   *  state machine can reference them at commit time without rebuilding. */
  packetId: string
  /** Raw obs data carried through — needed to reconstruct the
   *  CompressedObservation at commit (timestamp, session, etc.). */
  rawTimestamp: string
}

interface CompressBatchState {
  originalArgs: CompressBatchArgs
  /** Full queue of raw observations to process, ordered oldest-first. */
  queue: Array<{ obsId: string; sessionId: string; timestamp: string }>
  batchSize: number
  totalBatches: number
  /** Index of the first task in the CURRENT (in-flight) batch. */
  batchStart: number
  /** Packet IDs for the current batch, indexed by batchStart+offset. */
  currentBatch: CompressBatchTask[]
  compressed: number
  failed: number
  batchNum: number
}

// ============================================================================
// Raw-observation detection + queue building
// ============================================================================

/**
 * Walk every session and collect the IDs of observations that don't
 * look compressed yet. "Raw" = missing `title` (CompressedObservation
 * always has one). Returns oldest-first so users see progress on
 * historical data before new arrivals.
 *
 * This is an O(sessions * obs_per_session) scan. Acceptable for
 * bind-time — the alternative (a separate raw-queue KV scope) means
 * two sources of truth and drift risk.
 */
async function collectRawObservations(
  kv: StateKV,
  limit: number,
  projectFilter?: string,
): Promise<Array<{ obsId: string; sessionId: string; timestamp: string }>> {
  const sessions = await kv.list<Session>(KV.sessions).catch(() => [])
  const results: Array<{
    obsId: string
    sessionId: string
    timestamp: string
  }> = []

  for (const session of sessions) {
    if (projectFilter && session.project !== projectFilter) continue

    const obs = await kv
      .list<Partial<CompressedObservation> & Partial<RawObservation>>(
        KV.observations(session.id),
      )
      .catch(() => [])
    for (const o of obs) {
      // Raw observations have hookType + userPrompt/toolName, but
      // no `title` field. CompressedObservation always has title.
      const isRaw = !("title" in o) || !o.title
      if (!isRaw) continue
      if (!o.id || !o.timestamp) continue
      results.push({
        obsId: o.id,
        sessionId: session.id,
        timestamp: o.timestamp,
      })
    }
  }

  // Oldest first. Clamp to limit.
  results.sort(
    (a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  )
  return results.slice(0, limit)
}

/**
 * Decrement the pending-compression counter after a successful
 * compression write. Mirrors the helper in backfill.ts — kept inline
 * here to avoid cross-module import churn.
 */
async function decrementPending(kv: StateKV, delta = 1): Promise<void> {
  const existing = (await kv
    .get<{ count: number; updatedAt: string }>(KV.pendingCompression, "state")
    .catch(() => null)) ?? { count: 0, updatedAt: "" }
  await kv.set(KV.pendingCompression, "state", {
    count: Math.max(0, existing.count - delta),
    updatedAt: new Date().toISOString(),
  })
}

/**
 * Build a WorkPacket for a single raw observation. The packet's user
 * prompt is whatever compression context we can reconstruct from the
 * raw obs — for the bind-path raws that means the original user prompt
 * or tool invocation, fed through the same buildCompressionPrompt
 * helper the direct compress path uses.
 */
function packetForRawObs(
  raw: Partial<RawObservation>,
): WorkPacket {
  const userPrompt = buildCompressionPrompt({
    hookType: (raw.hookType as string) ?? "conversation",
    toolName: raw.toolName,
    toolInput: raw.toolInput,
    toolOutput: raw.toolOutput,
    userPrompt: raw.userPrompt,
    timestamp: raw.timestamp ?? new Date().toISOString(),
  })
  return createWorkPacket({
    kind: "compress",
    systemPrompt: COMPRESSION_SYSTEM,
    userPrompt,
    purpose: `compress raw observation ${raw.id ?? "(unknown)"}`,
  })
}

// ============================================================================
// Batch construction
// ============================================================================

/**
 * Build the next batch of packets by dequeuing from the state's queue
 * starting at batchStart and advancing by batchSize. Loads each raw
 * obs fresh from KV so we have its prompt data, constructs a packet,
 * records a task binding packet→obs for the consume pass.
 *
 * Tasks whose obs can't be loaded (deleted between enqueue and this
 * call) are logged and skipped; they don't break the whole batch.
 */
async function buildCompressBatch(
  kv: StateKV,
  state: CompressBatchState,
): Promise<WorkPacket[]> {
  const end = Math.min(
    state.batchStart + state.batchSize,
    state.queue.length,
  )
  const packets: WorkPacket[] = []
  state.currentBatch = []

  for (let i = state.batchStart; i < end; i++) {
    const q = state.queue[i]
    const raw = await kv
      .get<Partial<RawObservation>>(KV.observations(q.sessionId), q.obsId)
      .catch(() => null)
    if (!raw) {
      logger.warn("compress-batch: raw obs vanished mid-run", {
        obsId: q.obsId,
      })
      state.failed++
      continue
    }
    const packet = packetForRawObs(raw)
    packets.push(packet)
    state.currentBatch.push({
      obsId: q.obsId,
      sessionId: q.sessionId,
      packetId: packet.id,
      rawTimestamp: q.timestamp,
    })
  }

  return packets
}

/**
 * Parse a compression completion and overwrite the raw observation
 * with a CompressedObservation. Returns true on success so the caller
 * can bump its counter.
 */
async function writeCompressedFromCompletion(
  kv: StateKV,
  task: CompressBatchTask,
  completion: string,
): Promise<boolean> {
  const parsed = parseCompressionXml(completion)
  if (!parsed) return false

  const qualityScore = Math.min(100, Math.max(0, (parsed.importance ?? 5) * 10))
  const compressed: CompressedObservation = {
    id: task.obsId,
    sessionId: task.sessionId,
    timestamp: task.rawTimestamp,
    ...parsed,
    confidence: qualityScore / 100,
  }

  await kv.set(KV.observations(task.sessionId), task.obsId, compressed)
  await decrementPending(kv, 1)
  return true
}

// ============================================================================
// State machine registration
// ============================================================================

export function registerCompressBatchFunction(
  sdk: FakeSdk,
  kv: StateKV,
): void {
  sdk.registerFunction(
    {
      id: "mem::compress-batch-step",
      description:
        "Loop-style state machine that compresses every pending raw " +
        "observation in the archive via the work-packet protocol.",
    },
    async (
      input: StepInput<CompressBatchArgs, CompressBatchState>,
    ): Promise<StepResult> => {
      const { step, originalArgs, intermediateState, completions } = input

      // --------------------- State 0: entry ---------------------
      if (step === 0) {
        const limit = originalArgs.limit ?? 200
        const queue = await collectRawObservations(
          kv,
          limit,
          originalArgs.projectCwd,
        )

        if (queue.length === 0) {
          return {
            done: true,
            result: {
              success: true,
              compressed: 0,
              failed: 0,
              reason: "no raw observations pending",
            },
          }
        }

        // Rough total-bytes estimate for planLoopBatches. We don't
        // have exact prompt sizes yet (they get built per-packet) so
        // assume ~2 KB per raw prompt on average. planLoopBatches
        // uses this only to pick a batch size.
        const plan = planLoopBatches(queue.length, queue.length * 2048)

        const state: CompressBatchState = {
          originalArgs,
          queue,
          batchSize: plan.batchSize,
          totalBatches: plan.totalBatches,
          batchStart: 0,
          currentBatch: [],
          compressed: 0,
          failed: 0,
          batchNum: 1,
        }
        const firstBatch = await buildCompressBatch(kv, state)

        if (firstBatch.length === 0) {
          // Every candidate vanished between enqueue and batch build.
          return {
            done: true,
            result: {
              success: true,
              compressed: 0,
              failed: state.failed,
              reason: "raw queue drained before first batch",
            },
          }
        }

        return {
          done: false,
          nextStep: 1,
          intermediateState: state,
          workPackets: firstBatch,
          instructions:
            `Compress-batch — batch ${state.batchNum} of ${state.totalBatches}. ` +
            `Run each of these ${firstBatch.length} compression prompts and ` +
            "commit all completions together. The next response is either " +
            "the next batch or terminal.",
        }
      }

      // --------------------- State 1: consume + maybe emit next ---
      if (step === 1) {
        if (!intermediateState) {
          return {
            done: true,
            result: {
              success: false,
              error: "compress-batch-step: missing intermediate state at step 1",
            },
          }
        }

        for (const task of intermediateState.currentBatch) {
          const completion = completions?.[task.packetId]
          if (!completion) {
            intermediateState.failed++
            continue
          }
          try {
            const ok = await writeCompressedFromCompletion(
              kv,
              task,
              completion,
            )
            if (ok) intermediateState.compressed++
            else intermediateState.failed++
          } catch (err) {
            logger.warn("compress-batch: write failed", {
              obsId: task.obsId,
              error: err instanceof Error ? err.message : String(err),
            })
            intermediateState.failed++
          }
        }

        // Advance cursor past the consumed batch.
        intermediateState.batchStart += intermediateState.batchSize
        intermediateState.currentBatch = []

        if (intermediateState.batchStart >= intermediateState.queue.length) {
          logger.info("compress-batch complete", {
            compressed: intermediateState.compressed,
            failed: intermediateState.failed,
          })
          return {
            done: true,
            result: {
              success: true,
              compressed: intermediateState.compressed,
              failed: intermediateState.failed,
            },
          }
        }

        // More batches to emit.
        intermediateState.batchNum++
        const nextBatch = await buildCompressBatch(kv, intermediateState)
        if (nextBatch.length === 0) {
          return {
            done: true,
            result: {
              success: true,
              compressed: intermediateState.compressed,
              failed: intermediateState.failed,
              reason: "queue drained mid-run",
            },
          }
        }
        return {
          done: false,
          nextStep: 1,
          intermediateState,
          workPackets: nextBatch,
          instructions:
            `Compress-batch — batch ${intermediateState.batchNum} of ${intermediateState.totalBatches}. ` +
            `Run these ${nextBatch.length} compression prompts.`,
        }
      }

      return {
        done: true,
        result: {
          success: false,
          error: `compress-batch-step: unknown step ${step}`,
        },
      }
    },
  )
}
