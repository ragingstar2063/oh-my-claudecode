/**
 * Cron installer + `claude -p` spawn-command assembly for unattended
 * Necronomicon bind / compression.
 *
 * Everything here is a pure function over strings — no process
 * spawning, no crontab mutation, no fs writes. The CLI entry point
 * orchestrates the actual `crontab -l` / `crontab -` dance; this
 * module only handles the string-level logic so tests can verify
 * every edge case without side effects.
 *
 * The cron entry calls `oh-my-claudecode bind --resume`, which:
 *   1. Runs any pending Phase 1 work (filesystem ingestion — no LLM).
 *   2. For Phase 2 (compression), if an ANTHROPIC_API_KEY is
 *      configured, routes directly through the in-process LLM
 *      provider. Otherwise spawns `claude -p` with the command
 *      produced by `buildClaudePSpawnCommand` below, so Claude Code's
 *      own subscription auth drives the work-packet loop.
 */

/** Suffix appended to every bind-installed crontab entry so the
 *  installer can find + replace its own line without clobbering
 *  unrelated entries. */
export const BIND_CRON_MARKER = "# oh-my-claudecode bind"

// ============================================================================
// Interval spec parser
// ============================================================================

/**
 * Convert a short interval spec like `"1h"`, `"30m"`, `"1d"` into a
 * cron schedule string. Accepts:
 *
 *   `Nm`  — every N minutes (N > 0)
 *   `Nh`  — every N hours   (N > 0)
 *   `Nd`  — every N days    (currently supports 1d; multi-day uses
 *           "at midnight every day" since cron doesn't natively
 *           express "every 2 days" without a workaround)
 *   `N`   — bare number, interpreted as minutes
 *
 * Throws on malformed input or zero/negative intervals so the CLI
 * can surface a clear error.
 */
export function parseIntervalSpec(spec: string): string {
  if (!spec) throw new Error("parseIntervalSpec: empty interval")
  const m = spec.match(/^(\d+)([mhd])?$/)
  if (!m) {
    throw new Error(
      `parseIntervalSpec: invalid interval "${spec}" — use Nm / Nh / Nd`,
    )
  }
  const n = parseInt(m[1], 10)
  const unit = m[2] ?? "m"
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`parseIntervalSpec: interval must be > 0 (got ${n})`)
  }

  if (unit === "m") {
    // Every N minutes. If N divides 60 evenly, use step syntax.
    if (n >= 60 && n % 60 === 0) {
      const hours = n / 60
      return hours === 1 ? "0 * * * *" : `0 */${hours} * * *`
    }
    return `*/${n} * * * *`
  }

  if (unit === "h") {
    return n === 1 ? "0 * * * *" : `0 */${n} * * *`
  }

  // Days: run at midnight every N days. Cron doesn't natively support
  // "every 2 days" so we emit the 1d form only.
  if (n === 1) return "0 0 * * *"
  // Fall back to "every N-th day of month" — not perfect but better
  // than refusing the input.
  return `0 0 */${n} * *`
}

// ============================================================================
// claude -p spawn command
// ============================================================================

export interface ClaudePSpawnOptions {
  /** Observations per compress-batch-step call. Default 100. */
  limit?: number
  /** Dollar cap on the claude -p invocation. Default 2.00. */
  maxBudgetUsd?: number
  /** Model alias. Default "sonnet" — fast and cheap for compression. */
  model?: string
  /** Where to write the claude -p log. Default /dev/null. */
  logPath?: string
}

/**
 * Assemble the shell command that a cron tick runs to drive Phase 2
 * compression via `claude -p`. The command is a single string suitable
 * for a crontab line or a shell -c invocation.
 *
 * Security contract: --allowedTools restricts the spawn to the yith
 * MCP tools only, so a runaway prompt can't shell out / edit files /
 * read arbitrary code. --max-budget-usd caps the total API spend per
 * tick. --permission-mode auto skips interactive prompts.
 *
 * The embedded prompt tells the spawned Claude to call
 * mem::compress-batch-step in a loop via the work-packet protocol,
 * terminating when the response is {status: "success"} or after 20
 * rounds (safety cap).
 */
export function buildClaudePSpawnCommand(
  opts: ClaudePSpawnOptions = {},
): string {
  const limit = opts.limit ?? 100
  const maxBudgetUsd = opts.maxBudgetUsd ?? 2.0
  const model = opts.model ?? "sonnet"
  const logPath = opts.logPath ?? "/dev/null"

  const prompt =
    `Call yith_trigger with name "mem::compress-batch-step" and args {"limit": ${limit}}. ` +
    `If the response has status "needs_llm_work", execute each packet's prompts ` +
    `(read the systemPrompt + userPrompt, produce the compression XML the system ` +
    `prompt asks for), then call yith_commit_work with the continuation token and ` +
    `an array of {id, completion} results. Repeat this loop until the response is ` +
    `{status: "success"} or you've processed 20 batches total. Output a single-line ` +
    `JSON summary {"compressed": N, "failed": N, "errors": []} and exit.`

  return [
    `claude`,
    `--print`,
    `--permission-mode auto`,
    `--max-budget-usd ${maxBudgetUsd}`,
    `--model ${model}`,
    `--allowedTools "mcp__yith-archive__yith_trigger,mcp__yith-archive__yith_commit_work"`,
    `--output-format json`,
    `${shellEscapeSingle(prompt)}`,
    `>> ${logPath} 2>&1`,
  ].join(" ")
}

function shellEscapeSingle(s: string): string {
  // Wrap in single quotes and escape any literal single quote the
  // shell-safe way: '...''...'...
  return `'${s.replace(/'/g, `'\\''`)}'`
}

// ============================================================================
// Crontab entry construction + installation
// ============================================================================

export interface CrontabLineOptions {
  /** 5-field cron schedule string, e.g. `0 * * * *`. */
  schedule: string
  /** Command to run on each tick. */
  command: string
}

/**
 * Build a full crontab line including the installer marker. The marker
 * is a trailing comment so the line looks like a normal cron entry to
 * operators who inspect their crontab.
 */
export function buildCrontabLine(opts: CrontabLineOptions): string {
  return `${opts.schedule} ${opts.command} ${BIND_CRON_MARKER}`
}

/**
 * Merge `newLine` into an existing crontab file body, replacing any
 * previous bind entry (identified by BIND_CRON_MARKER) in place. If
 * no previous entry exists, appends. Preserves all other lines
 * unchanged — including comments, whitespace, and unrelated jobs.
 *
 * Returns the updated crontab body as a string. Callers pipe this
 * to `crontab -` to commit.
 */
export function installCrontabEntry(
  existing: string,
  newLine: string,
): string {
  const lines = existing.split("\n")
  const out: string[] = []
  let replaced = false

  for (const line of lines) {
    if (line.includes(BIND_CRON_MARKER)) {
      if (!replaced) {
        out.push(newLine)
        replaced = true
      }
      // Drop duplicate bind entries.
      continue
    }
    out.push(line)
  }

  if (!replaced) {
    // Make sure we don't leave a trailing empty line + the new entry
    // mashed together. Trim trailing blank lines before appending.
    while (out.length > 0 && out[out.length - 1] === "") {
      out.pop()
    }
    out.push(newLine)
  }

  // Ensure trailing newline — crontabs want it.
  let body = out.join("\n")
  if (!body.endsWith("\n")) body += "\n"
  return body
}
