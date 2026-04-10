/**
 * Yith work-packet protocol — the shapes and persistence layer that lets
 * LLM-requiring memory functions run in sessions that have no LLM
 * credentials of their own.
 *
 * Architecture recap (see .elder-gods/plans/yith-work-packet-protocol.md
 * for the full writeup):
 *
 * When a function that needs an LLM is invoked via yith_trigger and the
 * LazyLLMProvider has no API keys to resolve against, we can't run the
 * call server-side. Instead each LLM-needing function is modeled as a
 * state machine: step 0 does all the pre-LLM work and returns a
 * WorkPacket describing the prompt that would have been sent; the parent
 * Claude session executes that prompt with its own subscription auth
 * (either inline or via a Task subagent); and yith_commit_work feeds the
 * completion back to step 1, which plugs it in and either finishes the
 * operation or emits the next WorkPacket for another round.
 *
 * Single-LLM-call functions are 2-state state machines. Multi-call
 * functions (e.g. consolidate-pipeline) are N+1-state machines where
 * each state emits a packet whose prompt may depend on previous
 * completions. Loop functions use the batching helpers at the bottom of
 * this file to decide whether to emit all iterations at once (small
 * loops) or round-trip in chunks (large loops).
 *
 * State between steps is stored in the KV under the `mem:work-packets`
 * scope, keyed by an opaque continuation token. This means the flow
 * survives server restarts: if Claude Code disconnects mid-commit, the
 * next session can pick up with the same continuation token.
 */

import type { StateKV } from "./kv.js"
import { KV, generateId } from "./schema.js"
import { logger } from "./logger.js"

/** Default TTL for pending work-packet state: 24 hours. */
export const WORK_PACKET_TTL_MS = 24 * 60 * 60 * 1000

/** Default cap on packets emitted per round in loop functions. */
export const DEFAULT_BATCH_MAX = 10

/** Default cap on total prompt bytes per round in loop functions. */
export const DEFAULT_SIZE_MAX_BYTES = 50 * 1024

/**
 * A single unit of LLM work. Both compress() and summarize() collapse
 * into this shape since both take (systemPrompt, userPrompt) and return
 * a string. The parent agent treats both kinds identically — the `kind`
 * field is informational only, useful for UX and telemetry.
 */
export interface WorkPacket {
  /** Server-generated unique ID. Opaque to clients. */
  id: string
  /** Which provider method would have been called. Informational. */
  kind: "compress" | "summarize"
  /** System prompt — who the LLM should be and how to behave. */
  systemPrompt: string
  /** User prompt — the actual task payload. */
  userPrompt: string
  /** Optional token budget. Defaults to the provider's maxTokens. */
  maxTokens?: number
  /** Human-readable intent, e.g. "crystallize 5 observations into one memory". */
  purpose: string
}

/**
 * Standard input for every state-machine `-step` function. The dispatcher
 * constructs this; function authors just read from it. `step` is the
 * current state (0 for initial entry); `intermediateState` and
 * `completions` are absent on step 0 and populated on subsequent steps.
 */
export interface StepInput<Args = unknown, State = unknown> {
  step: number
  originalArgs: Args
  intermediateState?: State
  /** Map of WorkPacket.id → completion text, from the previous round. */
  completions?: Record<string, string>
}

/**
 * Return type for every state-machine `-step` function. Either terminal
 * (with a final result) or a request for more LLM work (with the next
 * step number, updated intermediate state, and the packets to execute).
 */
export type StepResult<Result = unknown, State = unknown> =
  | { done: true; result: Result }
  | {
      done: false
      nextStep: number
      intermediateState: State
      workPackets: WorkPacket[]
      /**
       * Optional hint for the parent agent on how to execute this round —
       * e.g. "run these 5 packets in parallel via Task subagents".
       * Falls back to a generic instruction if omitted.
       */
      instructions?: string
    }

/**
 * The persisted state of a pending work-packet flow. Written to the
 * `mem:work-packets` KV scope by the dispatcher after every round that
 * isn't terminal, and deleted after a successful commit that ends the
 * flow. Survives process restart because it's in the same atomically
 * written store.json as everything else.
 */
export interface PendingWork {
  continuation: string
  /**
   * The `-step` function ID to dispatch when the next commit comes in.
   * Stable across all rounds of a single flow.
   */
  functionId: string
  /** Current step number. The next commit will invoke step = currentStep + 1. */
  currentStep: number
  /** The original args the caller passed to yith_trigger. */
  originalArgs: unknown
  /** Opaque per-function state carried forward between rounds. */
  intermediateState: unknown
  /** The packets currently waiting for completions. */
  workPackets: WorkPacket[]
  createdAt: string
  /** After this time the entry is swept on next server boot. */
  expiresAt: string
}

/**
 * MCP tool response shape when a yith_trigger call needs LLM work.
 * Matches the structure defined in the plan doc — the `instructions`
 * field makes the protocol self-documenting so parent agents don't
 * need to read external docs to know what to do with the response.
 */
export interface NeedsWorkResponse {
  status: "needs_llm_work"
  workPackets: WorkPacket[]
  continuation: string
  commitTool: "yith_commit_work"
  instructions: string
}

/** Terminal response for yith_trigger / yith_commit_work. */
export interface SuccessResponse {
  status: "success"
  result: unknown
}

/** Union of possible responses from a yith_trigger or yith_commit_work call. */
export type WorkFlowResponse = NeedsWorkResponse | SuccessResponse

/**
 * KV-backed store for pending work-packet state. Every method is async
 * to match the KV API — internally, YithKV is in-memory and these are
 * all synchronous-fast, but keeping the signature async lets us swap
 * in a different backend later without touching callers.
 */
export class WorkPacketStore {
  constructor(private kv: StateKV) {}

  /**
   * Persist a new or updated PendingWork entry. If `continuation` is
   * already set on `data`, that token is reused (for updating an
   * existing entry after an intermediate round). Otherwise a fresh
   * token is generated and the entry is created with createdAt/expiresAt.
   */
  async save(
    data: Omit<PendingWork, "continuation" | "createdAt" | "expiresAt"> & {
      continuation?: string
    },
  ): Promise<PendingWork> {
    const now = new Date()
    const continuation = data.continuation ?? generateId("wp")

    let createdAt = now.toISOString()
    if (data.continuation) {
      const existing = await this.kv
        .get<PendingWork>(KV.workPackets, data.continuation)
        .catch(() => null)
      if (existing) createdAt = existing.createdAt
    }

    const full: PendingWork = {
      continuation,
      functionId: data.functionId,
      currentStep: data.currentStep,
      originalArgs: data.originalArgs,
      intermediateState: data.intermediateState,
      workPackets: data.workPackets,
      createdAt,
      expiresAt: new Date(now.getTime() + WORK_PACKET_TTL_MS).toISOString(),
    }
    await this.kv.set(KV.workPackets, continuation, full)
    return full
  }

  /**
   * Load a pending entry by continuation token. Returns null if missing
   * OR if the entry has already expired — in the expired case, the
   * entry is also removed as a side effect so we don't keep returning
   * stale tokens to retried commits.
   */
  async load(continuation: string): Promise<PendingWork | null> {
    const entry = await this.kv
      .get<PendingWork>(KV.workPackets, continuation)
      .catch(() => null)
    if (!entry) return null
    if (new Date(entry.expiresAt) < new Date()) {
      await this.delete(continuation)
      return null
    }
    return entry
  }

  /** Remove a pending entry. Called after successful terminal commit. */
  async delete(continuation: string): Promise<void> {
    await this.kv.delete(KV.workPackets, continuation)
  }

  /**
   * Sweep expired entries. Called on server boot so orphaned work
   * packets — from users who abandon a commit — don't accumulate
   * across sessions. Returns the number of entries removed.
   */
  async sweepExpired(): Promise<number> {
    const all = await this.kv.list<PendingWork>(KV.workPackets)
    const now = new Date()
    let deleted = 0
    for (const entry of all) {
      // list() may return undefined for entries the KV has no data for;
      // defensively skip malformed rows.
      if (!entry || typeof entry.expiresAt !== "string") continue
      if (new Date(entry.expiresAt) < now) {
        await this.delete(entry.continuation)
        deleted++
      }
    }
    if (deleted > 0) {
      logger.info(`Swept ${deleted} expired work-packet entries`)
    }
    return deleted
  }
}

/**
 * Runtime knob: max number of packets emitted per round for a loop
 * function, honored by planLoopBatches(). Pulled from env on every
 * call so operators can tune without restarting.
 */
export function getBatchMax(): number {
  const env = process.env["YITH_WORK_BATCH_MAX"]
  if (!env) return DEFAULT_BATCH_MAX
  const n = parseInt(env, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BATCH_MAX
}

/**
 * Runtime knob: max total prompt bytes per round. If a loop's total
 * prompt payload exceeds this, planLoopBatches forces batched mode
 * even if item count is under the batch cap.
 */
export function getSizeMaxBytes(): number {
  const env = process.env["YITH_WORK_SIZE_MAX"]
  if (!env) return DEFAULT_SIZE_MAX_BYTES
  const n = parseInt(env, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SIZE_MAX_BYTES
}

/**
 * Batching plan for a loop-style function. Loop functions (like
 * sliding-window enrichment that processes N chunks) call this once
 * with their item count and estimated total prompt size, then
 * follow the returned strategy:
 *
 *   - "all-at-once" → emit all N packets in one round. Parent agent
 *     completes them in parallel, single commit finishes the flow.
 *     Used when the loop is small AND the total prompt fits.
 *
 *   - "batched" → emit packets in chunks of `batchSize` per round.
 *     Multiple commits required; each round processes one batch.
 *     Used for large loops that would otherwise bloat the tool
 *     response or blow past the size cap.
 */
export interface LoopBatchPlan {
  strategy: "all-at-once" | "batched"
  /** Packets per round. Equals total item count in "all-at-once" mode. */
  batchSize: number
  /** Total rounds the flow will need. 1 in "all-at-once" mode. */
  totalBatches: number
}

export function planLoopBatches(
  itemCount: number,
  totalPromptBytes: number,
): LoopBatchPlan {
  // Guard: callers should short-circuit to a terminal StepResult BEFORE
  // reaching the planner when they have no work. Letting a zero-plan
  // through leads to confusing downstream behavior (emitting an empty
  // workPackets array still triggers a needs_llm_work round with
  // nothing to do). Throw so the bug surfaces at its source.
  if (itemCount <= 0) {
    throw new Error(
      `planLoopBatches: itemCount must be > 0 (got ${itemCount}) — ` +
        "short-circuit to terminal before calling the planner when " +
        "there's no loop work to do",
    )
  }
  const batchMax = getBatchMax()
  const sizeMax = getSizeMaxBytes()

  // Fast path: everything fits in one round.
  if (itemCount <= batchMax && totalPromptBytes <= sizeMax) {
    return {
      strategy: "all-at-once",
      batchSize: itemCount,
      totalBatches: 1,
    }
  }

  // Need batching. Compute two independent caps and take the tighter:
  //
  //   itemCap = batchMax                    (user/env preference)
  //   sizeCap = floor(sizeMax / avgBytes)   (how many items fit per round
  //                                          if we spread evenly by size)
  //
  // The size-based cap is what handles the "few items, each huge" case
  // the naive batchMax-only cap misses. Example: 5 items totaling 100 KB
  // with a 50 KB cap yields avgBytes=20 KB, sizeCap=2, batchSize=2,
  // totalBatches=3 — which actually splits the work, unlike "batched in
  // 1 batch of 10" which would just re-emit all 5 items at once.
  const avgBytesPerItem = totalPromptBytes / itemCount
  const sizeCap =
    avgBytesPerItem > 0
      ? Math.max(1, Math.floor(sizeMax / avgBytesPerItem))
      : itemCount
  const batchSize = Math.max(1, Math.min(batchMax, sizeCap))
  return {
    strategy: "batched",
    batchSize,
    totalBatches: Math.ceil(itemCount / batchSize),
  }
}

/** Build a fresh WorkPacket with a server-generated ID. */
export function createWorkPacket(
  fields: Omit<WorkPacket, "id">,
): WorkPacket {
  return {
    id: generateId("pkt"),
    ...fields,
  }
}
