import { test } from "node:test"
import assert from "node:assert/strict"

import {
  YITH_CAPTURE_HOOK_SCRIPT,
  getYithCaptureHookConfig,
} from "../src/hooks/yith-capture.js"
import { ALL_HOOK_DEFINITIONS } from "../src/hooks/index.js"

/**
 * Tests for the yith-capture Stop hook — the glue that turns Yith
 * from a "bind once, forget" system into a continuously-updating
 * archive. This hook fires after every assistant turn and spawns a
 * background `oh-my-claudecode bind --resume --claude-only` to
 * ingest any new transcript lines, with a sentinel-file debounce
 * to avoid spamming the filesystem on rapid-fire responses.
 *
 * The shell script is plain bash, so these tests mostly verify
 * structural properties (the pieces we need are present) rather
 * than execute the script end-to-end.
 */

test("YITH_CAPTURE_HOOK_SCRIPT has a bash shebang and set -euo pipefail", () => {
  assert.match(
    YITH_CAPTURE_HOOK_SCRIPT,
    /^#!\/usr\/bin\/env bash/,
    "expected bash shebang",
  )
  assert.match(
    YITH_CAPTURE_HOOK_SCRIPT,
    /set -euo pipefail/,
    "expected strict-mode shell",
  )
})

test("YITH_CAPTURE_HOOK_SCRIPT has a sentinel-based debounce", () => {
  assert.match(YITH_CAPTURE_HOOK_SCRIPT, /\.last-captured/)
  // Some kind of numeric comparison to enforce a cool-down window.
  assert.match(
    YITH_CAPTURE_HOOK_SCRIPT,
    /DEBOUNCE|cool|interval/i,
    "expected debounce variable or comment",
  )
})

test("YITH_CAPTURE_HOOK_SCRIPT spawns bind --resume --claude-only in background", () => {
  // The transcript-capture tick must be non-blocking and narrow.
  assert.match(
    YITH_CAPTURE_HOOK_SCRIPT,
    /--claude-only/,
    "script should invoke --claude-only",
  )
  assert.match(
    YITH_CAPTURE_HOOK_SCRIPT,
    /--resume/,
    "script should invoke --resume",
  )
  // Background fork — either via `&`, `--background`, or `nohup`.
  assert.ok(
    /--background|& *$|nohup/m.test(YITH_CAPTURE_HOOK_SCRIPT),
    "script should fork to background so assistant responses don't block",
  )
})

test("YITH_CAPTURE_HOOK_SCRIPT conditionally fires compression when pending count crosses threshold", () => {
  // Must at least reference the pending-compression count path and
  // the compress-only flag, gated by some threshold check.
  assert.match(
    YITH_CAPTURE_HOOK_SCRIPT,
    /mem:pending-compression|pending-compression/,
  )
  assert.match(YITH_CAPTURE_HOOK_SCRIPT, /--compress-only/)
  // Should have a separate sentinel so compression is debounced more
  // loosely than the capture tick (compression is expensive).
  assert.match(YITH_CAPTURE_HOOK_SCRIPT, /\.last-compressed/)
})

test("YITH_CAPTURE_HOOK_SCRIPT exits 0 on any failure (never blocks Claude)", () => {
  // Background hook must be fail-safe — any error should exit 0 so
  // a broken yith install can't break the user's session.
  assert.match(
    YITH_CAPTURE_HOOK_SCRIPT,
    /exit 0/,
    "script should have explicit exit 0 paths",
  )
})

test("getYithCaptureHookConfig returns a Stop hook pointing at the script", () => {
  const cfg = getYithCaptureHookConfig() as {
    matcher?: string
    hooks?: Array<{ type?: string; command?: string }>
  }
  assert.ok(cfg.hooks)
  assert.ok(cfg.hooks.length >= 1)
  const hook = cfg.hooks[0]
  assert.equal(hook.type, "command")
  assert.match(hook.command ?? "", /yith-capture\.sh/)
})

test("ALL_HOOK_DEFINITIONS includes yith-capture as a Stop hook", () => {
  const yith = ALL_HOOK_DEFINITIONS.find((h) => h.name === "yith-capture")
  assert.ok(yith, "yith-capture must be registered in ALL_HOOK_DEFINITIONS")
  assert.equal(yith.event, "Stop")
  assert.match(yith.scriptPath, /yith-capture\.sh/)
  assert.equal(yith.scriptContent, YITH_CAPTURE_HOOK_SCRIPT)
})
