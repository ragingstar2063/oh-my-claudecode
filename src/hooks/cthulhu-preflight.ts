/**
 * Cthulhu preflight text generator.
 *
 * Called from the cthulhu-auto hook shell script (indirectly — the
 * shell script reads bindState from necronomicon.json via jq and
 * passes the extracted flags to this helper to produce the prompt
 * fragment to inject into the session). Also called directly from
 * the /cthulhu slash command docs.
 *
 * The function is pure: no file I/O, no process.env reads. Callers
 * provide a snapshot of the relevant state and get back a markdown
 * block to drop into the activation prompt.
 *
 * The generated block is split into three concerns, in priority order:
 *   1. Hard block: Necronomicon not bound at all → tell user to run
 *      /necronomicon-bind before doing anything else.
 *   2. Soft alert: bind partially done or phases failed → offer retry.
 *   3. Nag: compression queue has entries → offer to drain via WP loop.
 *
 * If none of the above apply (everything bound, no pending work), the
 * output is a short one-liner confirming the archive is ready — NOT
 * an empty string, so the injected prompt always has a visible status.
 */

export type BindPhaseName =
  | "embedding_download"
  | "claude_transcripts"
  | "opencode_import"
  | "sisyphus_migrate"
  | "preliminary_seed"
  | "pending_compression_trigger"

export interface PreflightInput {
  /** True if `KV.bindState → "current"` exists on disk. */
  bindStateExists: boolean
  /** True if every phase has status "completed". */
  allPhasesComplete: boolean
  /** Current raw-observation count pending compression. */
  pendingCompressionCount: number
  /** Phases in the "failed" status, in execution order. */
  failedPhases: BindPhaseName[]
  /** Phases in "pending" or "in_progress" (not counting failed).
   *  Used to display a hint when the bind is partially done. */
  pendingPhases?: BindPhaseName[]
}

/**
 * Build the preflight markdown block. Always returns non-empty text —
 * the calling hook injects whatever this returns into the session's
 * activation prompt, and an empty injection would make the hook's
 * behavior indistinguishable from "no hook ran."
 */
export function buildPreflightSection(input: PreflightInput): string {
  const lines: string[] = []
  lines.push("[Necronomicon preflight]")

  // Priority 1: hard block.
  if (!input.bindStateExists) {
    lines.push("")
    lines.push(
      "The Necronomicon has not been bound on this machine yet. The Yith " +
        "Archive is empty and no past Claude Code sessions have been ingested.",
    )
    lines.push("")
    lines.push(
      "**Action required**: ask the user to run `oh-my-claudecode bind` in " +
        "their terminal OR `/necronomicon-bind` inside this session before " +
        "proceeding with any memory-dependent work.",
    )
    return lines.join("\n")
  }

  // Priority 2: failures.
  if (input.failedPhases.length > 0) {
    lines.push("")
    lines.push(
      `The binding ritual has ${input.failedPhases.length} failed ` +
        `phase(s): ${input.failedPhases.join(", ")}.`,
    )
    lines.push(
      "Re-run `/necronomicon-bind` (or `oh-my-claudecode bind --resume` in a " +
        "terminal) to retry from the failed phase — the state machine resumes " +
        "automatically without redoing completed work.",
    )
    return lines.join("\n")
  }

  // Priority 3: partial bind.
  const pendingPhases = input.pendingPhases ?? []
  if (!input.allPhasesComplete) {
    lines.push("")
    lines.push(
      `The Necronomicon is partially bound. Pending phases: ` +
        (pendingPhases.length > 0
          ? pendingPhases.join(", ")
          : "(unknown — check bindState)") +
        ".",
    )
    lines.push(
      "Run `/necronomicon-bind` to continue the ritual from where it stopped.",
    )
    if (input.pendingCompressionCount > 0) {
      lines.push("")
      lines.push(
        `${input.pendingCompressionCount} raw observations are already ` +
          "ingested and waiting for compression. See pending-compression note below.",
      )
    }
    return lines.join("\n")
  }

  // Priority 4: nag for pending compression (bind complete, queue non-empty).
  if (input.pendingCompressionCount > 0) {
    lines.push("")
    lines.push(
      `✓ Necronomicon bound. ${input.pendingCompressionCount} raw ` +
        "observations are queued for compression into searchable memories.",
    )
    lines.push("")
    lines.push(
      "**Offer the user**: \"Process pending compression now (runs via the " +
        "work-packet loop using this session's LLM)? It takes one commit " +
        "round per batch.\" If they accept, call " +
        "`yith_trigger({ name: 'mem::compress-batch-step', args: { limit: 100 } })` " +
        "and drive the `needs_llm_work` → `yith_commit_work` loop until terminal. " +
        "Render an ASCII progress bar per round so the user sees forward motion.",
    )
    return lines.join("\n")
  }

  // All clear.
  lines.push("")
  lines.push("✓ Necronomicon is bound and every phase is complete. The Great " +
    "Race of Yith answers. Nothing pending.")
  return lines.join("\n")
}
