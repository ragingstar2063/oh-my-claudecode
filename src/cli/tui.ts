/**
 * Hand-rolled TUI primitive for `oh-my-claudecode bind`.
 *
 * No external deps. Everything is a pure function (returns a string)
 * or operates on an injectable writer so tests can run without a real
 * TTY. When stdout is a TTY, `TuiWriter.replaceLastLine` uses ANSI
 * escape codes to redraw the last line in place — real animated
 * progress. When not a TTY (piped, redirected, CI log), it falls
 * back to plain sequential lines so the output still makes sense in
 * a log file.
 *
 * Intentionally minimal: progress bar, section header, status line,
 * byte/duration formatters, and a writer with one redraw method.
 * Anything fancier (panes, tables, multi-line redraw) is overkill for
 * the bind ritual's progress reporting.
 */

// ============================================================================
// ANSI escape helpers
// ============================================================================

const ESC = "\x1b["

/** Move cursor up N lines. */
const cursorUp = (n: number) => `${ESC}${n}A`

/** Erase the entire current line (cursor stays). */
const eraseLine = `${ESC}2K`

/** Return to start of line. */
const cr = "\r"

/** Colour wrappers — only used when stdout is a TTY. */
const dim = (s: string) => `${ESC}2m${s}${ESC}0m`
const bold = (s: string) => `${ESC}1m${s}${ESC}0m`
const green = (s: string) => `${ESC}32m${s}${ESC}0m`
const yellow = (s: string) => `${ESC}33m${s}${ESC}0m`
const red = (s: string) => `${ESC}31m${s}${ESC}0m`
const cyan = (s: string) => `${ESC}36m${s}${ESC}0m`
const magenta = (s: string) => `${ESC}35m${s}${ESC}0m`

/**
 * Strip ANSI escape sequences from a string. Used by tests to assert
 * on content without caring about colour codes, and by non-TTY fallback
 * to produce log-friendly plain output.
 */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "")
}

// ============================================================================
// Progress bar
// ============================================================================

export interface ProgressBarOptions {
  current: number
  total: number
  label: string
  /** Bar width in cells. Default 20 — fits in a chat UI line. */
  width?: number
}

/**
 * Render a monospace progress bar as a single string. The bar is
 * 20 cells by default, using ▓ for filled and ░ for empty so it
 * renders cleanly in any terminal with a reasonable font.
 *
 * Handles 0/0 (renders as empty bar), overshoot (clamps to 100%),
 * and negative values (clamps to 0%).
 */
export function renderProgressBar(opts: ProgressBarOptions): string {
  const width = opts.width ?? 20
  const { current, total, label } = opts
  const pct =
    total > 0 ? Math.max(0, Math.min(1, current / total)) : 0
  const filled = Math.round(pct * width)
  const empty = width - filled
  const bar = "▓".repeat(filled) + "░".repeat(empty)
  const pctStr = `${Math.round(pct * 100)}%`.padStart(4)
  const counter = `${current}/${total}`
  return `${cyan(`[${bar}]`)} ${bold(pctStr)} ${dim(`— ${counter} ${label}`)}`
}

// ============================================================================
// Section header
// ============================================================================

/**
 * Render a titled divider line — the header printed at the start of
 * each bind phase so the user sees structure: "Phase I: Embedding"
 * with a horizontal rule above and below.
 */
export function renderSectionHeader(title: string, width = 60): string {
  const padded = ` ${title} `
  const sideLen = Math.max(0, Math.floor((width - padded.length) / 2))
  const side = "═".repeat(sideLen)
  const line = `${side}${padded}${side}`
  return `\n${magenta(line)}\n`
}

// ============================================================================
// Status line with glyph
// ============================================================================

export type StatusKind = "ok" | "warn" | "error" | "pending" | "info"

/**
 * Render a status line with a coloured glyph prefix. Used by the
 * bind runner to report the outcome of each phase:
 *   ✓ green — success
 *   ⚠ yellow — warning
 *   ✗ red   — failure
 *   … dim  — pending / in-progress
 *   ℹ cyan — info / context
 */
export function renderStatusLine(kind: StatusKind, message: string): string {
  switch (kind) {
    case "ok":
      return `  ${green("✓")} ${message}`
    case "warn":
      return `  ${yellow("⚠")} ${message}`
    case "error":
      return `  ${red("✗")} ${message}`
    case "pending":
      return `  ${dim("…")} ${message}`
    case "info":
      return `  ${cyan("ℹ")} ${message}`
  }
}

// ============================================================================
// Formatters
// ============================================================================

/**
 * Format a byte count as a human-readable string. Uses 1024-based
 * units (B, KB, MB, GB) with one decimal place once we're over 1 KB.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  const gb = mb / 1024
  return `${gb.toFixed(1)} GB`
}

/**
 * Format a duration in milliseconds as a compact string. Prefers
 * "1.5s", "1m5s", "1h2m" over "0h0m1.5s".
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`
  const totalSec = Math.floor(ms / 1000)
  if (totalSec < 60) {
    const sec = ms / 1000
    return `${sec.toFixed(1)}s`
  }
  const totalMin = Math.floor(totalSec / 60)
  if (totalMin < 60) {
    const sec = totalSec % 60
    return `${totalMin}m${sec}s`
  }
  const totalHr = Math.floor(totalMin / 60)
  const min = totalMin % 60
  return `${totalHr}h${min}m`
}

// ============================================================================
// TuiWriter — writes lines, supports in-place redraw when TTY
// ============================================================================

export interface WriterBackend {
  write(chunk: string): void
  isTTY: boolean
}

/**
 * Stateful writer that prints lines and can redraw the last one in
 * place — used to animate a progress bar without spamming the chat
 * log with dozens of copies. Construct with a backend (stdout by
 * default); tests pass a fake backend with a capture buffer.
 *
 * Non-TTY semantics: `replaceLastLine` just prints a new line. This
 * keeps log files readable and CI output sensible.
 */
export class TuiWriter {
  private lastLinePrinted = false

  constructor(private backend: WriterBackend) {}

  /** Print a line of text with trailing newline. */
  line(text: string): void {
    const out = this.backend.isTTY ? text : stripAnsi(text)
    this.backend.write(out + "\n")
    this.lastLinePrinted = true
  }

  /**
   * Redraw the most recently printed line with new content. On TTY,
   * moves the cursor up one line, erases it, and rewrites. On
   * non-TTY, just prints a new line (no escape codes).
   */
  replaceLastLine(text: string): void {
    if (!this.lastLinePrinted || !this.backend.isTTY) {
      this.line(text)
      return
    }
    // Move up, erase, carriage return, write, newline.
    this.backend.write(`${cursorUp(1)}${eraseLine}${cr}${text}\n`)
  }

  /** Print a raw string with no newline handling. Useful for spinners. */
  write(text: string): void {
    this.backend.write(this.backend.isTTY ? text : stripAnsi(text))
  }
}
