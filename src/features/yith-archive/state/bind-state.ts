/**
 * Necronomicon binding state — the durable, resumable state machine
 * that `oh-my-claudecode bind` reads on every invocation to figure
 * out what's left to do.
 *
 * Stored under KV.bindState → "current". Every phase transition goes
 * through `markPhase()` (pure function — returns a new state object).
 * Callers persist the result to KV after each transition so a crash
 * mid-phase resumes cleanly on the next run.
 *
 * Six phases in strict order:
 *   1. embedding_download    - pre-fetch the local nomic model (~137 MB)
 *   2. claude_transcripts    - scan ~/.claude/projects/ subdirs and ingest raw obs
 *   3. opencode_import       - read ~/.local/share/opencode/opencode.db
 *   4. sisyphus_migrate      - walk .sisyphus/ dirs into .elder-gods/
 *   5. preliminary_seed      - scan each project's code tree for base memories
 *   6. pending_compression_trigger - record marker for /cthulhu preflight
 *
 * Each phase independently reports pending / in_progress / completed /
 * failed. `firstPendingPhase` returns the next phase to run, treating
 * failed phases as retryable (they come back as pending on the next
 * run so resume works without operator intervention).
 */

export type BindPhase =
  | "embedding_download"
  | "claude_transcripts"
  | "opencode_import"
  | "sisyphus_migrate"
  | "preliminary_seed"
  | "pending_compression_trigger"

/** Strict execution order. `firstPendingPhase` walks this array. */
export const BIND_PHASE_ORDER: readonly BindPhase[] = [
  "embedding_download",
  "claude_transcripts",
  "opencode_import",
  "sisyphus_migrate",
  "preliminary_seed",
  "pending_compression_trigger",
] as const

export type PhaseStatus = "pending" | "in_progress" | "completed" | "failed"

export interface PhaseState {
  status: PhaseStatus
  /** Set when status first transitions out of "pending". */
  startedAt?: string
  /** Set when status transitions to "completed". */
  completedAt?: string
  /** Updated every time markPhase is called for this phase. */
  lastAttemptedAt?: string
  /** Number of times this phase has been started (including retries). */
  attempts: number
  /** Error message from the most recent failure, or undefined on success. */
  error?: string
  /**
   * Phase-specific opaque payload. Each phase's runner owns the shape
   * and writes cursor data, counters, or progress markers here. The
   * state machine itself never inspects this.
   */
  details?: Record<string, unknown>
}

export interface BindState {
  /** Schema version — bump when the shape changes incompatibly. */
  version: 1
  phases: Record<BindPhase, PhaseState>
  startedAt: string
  lastUpdatedAt: string
}

/** Build a fresh BindState with every phase pending and zero attempts. */
export function initialBindState(): BindState {
  const now = new Date().toISOString()
  const phases = {} as Record<BindPhase, PhaseState>
  for (const phase of BIND_PHASE_ORDER) {
    phases[phase] = { status: "pending", attempts: 0 }
  }
  return {
    version: 1,
    phases,
    startedAt: now,
    lastUpdatedAt: now,
  }
}

/**
 * Transition a single phase through its state machine. Pure —
 * returns a new BindState, never mutates input. Callers must
 * persist the result to KV after calling.
 *
 * Semantic rules:
 * - Any transition TO "in_progress" sets `startedAt` (if not already)
 *   and increments `attempts`.
 * - Transition to "completed" sets `completedAt` and clears `error`.
 * - Transition to "failed" sets `error` and increments `attempts`
 *   even if the phase was never in_progress — a crash before the
 *   runner could flip the flag counts as one attempt.
 * - Details payload is shallow-merged, not replaced, so phase
 *   runners can update cursor data without clobbering other keys.
 */
export function markPhase(
  state: BindState,
  phase: BindPhase,
  update: Partial<Pick<PhaseState, "status" | "error" | "details">>,
): BindState {
  const now = new Date().toISOString()
  const prev = state.phases[phase]
  const nextPhase: PhaseState = {
    ...prev,
    lastAttemptedAt: now,
  }

  if (update.status !== undefined) {
    nextPhase.status = update.status
    if (update.status === "in_progress") {
      if (!prev.startedAt) nextPhase.startedAt = now
      nextPhase.attempts = prev.attempts + 1
    }
    if (update.status === "completed") {
      nextPhase.completedAt = now
      nextPhase.error = undefined
    }
    if (update.status === "failed") {
      nextPhase.attempts = prev.attempts + 1
    }
  }

  if (update.error !== undefined) nextPhase.error = update.error

  if (update.details !== undefined) {
    nextPhase.details = { ...(prev.details ?? {}), ...update.details }
  }

  return {
    ...state,
    lastUpdatedAt: now,
    phases: { ...state.phases, [phase]: nextPhase },
  }
}

/**
 * Return the first phase that still needs work, or null if the bind
 * is fully complete. Failed phases are considered pending so a crash
 * during phase N causes the next `bind` invocation to retry phase N
 * from its cursor — no manual intervention needed.
 *
 * Execution order is fixed by BIND_PHASE_ORDER. Phases don't run in
 * parallel.
 */
export function firstPendingPhase(state: BindState): BindPhase | null {
  for (const phase of BIND_PHASE_ORDER) {
    const st = state.phases[phase].status
    if (st !== "completed") return phase
  }
  return null
}

/** True if every phase has reached "completed". */
export function isBindComplete(state: BindState): boolean {
  for (const phase of BIND_PHASE_ORDER) {
    if (state.phases[phase].status !== "completed") return false
  }
  return true
}
