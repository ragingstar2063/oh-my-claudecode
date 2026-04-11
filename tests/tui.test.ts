import { test } from "node:test"
import assert from "node:assert/strict"

import {
  renderProgressBar,
  renderSectionHeader,
  renderStatusLine,
  formatBytes,
  formatDuration,
  stripAnsi,
  TuiWriter,
} from "../src/cli/tui.js"

/**
 * Tests for the TUI primitive. Everything's a pure function or
 * operates on an injectable writer, so we don't need a real TTY.
 */

test("renderProgressBar produces a 20-cell bar with percent + label", () => {
  const bar = renderProgressBar({ current: 5, total: 10, label: "items" })
  const plain = stripAnsi(bar)
  assert.match(plain, /\[.{20}\]/, "expected 20-cell bar inside brackets")
  assert.match(plain, /50%/, "50% label")
  assert.match(plain, /5\/10/, "5/10 counter")
  assert.match(plain, /items/, "label present")
})

test("renderProgressBar handles 0% and 100% without crashing", () => {
  const zero = stripAnsi(renderProgressBar({ current: 0, total: 10, label: "x" }))
  assert.match(zero, /0%/)
  const full = stripAnsi(renderProgressBar({ current: 10, total: 10, label: "x" }))
  assert.match(full, /100%/)
})

test("renderProgressBar clamps over-full values to 100%", () => {
  // Shouldn't blow up if cursor overshoots.
  const bar = stripAnsi(renderProgressBar({ current: 15, total: 10, label: "x" }))
  assert.match(bar, /100%/)
})

test("renderProgressBar returns an empty-total bar for zero items", () => {
  const bar = stripAnsi(
    renderProgressBar({ current: 0, total: 0, label: "nothing to do" }),
  )
  assert.match(bar, /0\/0/)
  assert.match(bar, /nothing to do/)
})

test("renderSectionHeader produces a titled divider", () => {
  const h = stripAnsi(renderSectionHeader("Phase I: Embedding"))
  assert.match(h, /Phase I: Embedding/)
  // Should have some form of horizontal rule.
  assert.ok(h.length > "Phase I: Embedding".length, "header is padded")
})

test("renderStatusLine prefixes with the right glyph per status", () => {
  assert.match(stripAnsi(renderStatusLine("ok", "done")), /✓/)
  assert.match(stripAnsi(renderStatusLine("warn", "check this")), /⚠/)
  assert.match(stripAnsi(renderStatusLine("error", "broken")), /✗/)
  assert.match(stripAnsi(renderStatusLine("pending", "waiting")), /…|·/)
})

test("formatBytes produces human-readable sizes", () => {
  assert.equal(formatBytes(0), "0 B")
  assert.equal(formatBytes(512), "512 B")
  assert.equal(formatBytes(1024), "1.0 KB")
  assert.equal(formatBytes(1536), "1.5 KB")
  assert.equal(formatBytes(1024 * 1024), "1.0 MB")
  assert.equal(formatBytes(137 * 1024 * 1024), "137.0 MB")
  assert.equal(formatBytes(1024 * 1024 * 1024), "1.0 GB")
})

test("formatDuration produces human-readable elapsed time", () => {
  assert.equal(formatDuration(500), "0.5s")
  assert.equal(formatDuration(1500), "1.5s")
  assert.equal(formatDuration(65_000), "1m5s")
  assert.equal(formatDuration(3_725_000), "1h2m")
})

test("TuiWriter captures output and supports in-place redraw", () => {
  // Inject a fake stdout so we can inspect what the writer emits.
  const chunks: string[] = []
  const writer = new TuiWriter({
    write: (chunk: string) => chunks.push(chunk),
    isTTY: true,
  })

  writer.line("first")
  writer.line("second")
  writer.replaceLastLine("second!")

  // All three writes should end up in the chunk buffer. When isTTY,
  // replaceLastLine emits ANSI to move up + clear line. When not
  // a TTY, replaceLastLine just prints a new line.
  const all = chunks.join("")
  assert.match(all, /first/)
  assert.match(all, /second!/)
})

test("TuiWriter non-TTY mode skips ANSI redraw codes", () => {
  const chunks: string[] = []
  const writer = new TuiWriter({
    write: (chunk: string) => chunks.push(chunk),
    isTTY: false,
  })
  writer.line("a")
  writer.replaceLastLine("a!")
  const all = chunks.join("")
  // No escape sequences in the output.
  assert.ok(
    !all.includes("\x1b["),
    "non-TTY writer should not emit escape codes",
  )
})
