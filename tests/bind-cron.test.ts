import { test } from "node:test"
import assert from "node:assert/strict"

import {
  buildClaudePSpawnCommand,
  buildCrontabLine,
  installCrontabEntry,
  parseIntervalSpec,
  BIND_CRON_MARKER,
} from "../src/cli/bind-cron.js"

/**
 * Tests for the cron installer + claude -p spawn assembly. Everything
 * here is a pure function — no cron modification, no process spawning.
 * Integration with the real system crontab is handled by the CLI
 * entry point and not exercised in unit tests.
 */

test("parseIntervalSpec accepts minute / hour suffixes", () => {
  assert.equal(parseIntervalSpec("15m"), "*/15 * * * *")
  assert.equal(parseIntervalSpec("30m"), "*/30 * * * *")
  assert.equal(parseIntervalSpec("1h"), "0 * * * *")
  assert.equal(parseIntervalSpec("2h"), "0 */2 * * *")
  assert.equal(parseIntervalSpec("6h"), "0 */6 * * *")
  assert.equal(parseIntervalSpec("1d"), "0 0 * * *")
})

test("parseIntervalSpec accepts bare numbers as minutes", () => {
  assert.equal(parseIntervalSpec("10"), "*/10 * * * *")
  assert.equal(parseIntervalSpec("60"), "0 * * * *")
})

test("parseIntervalSpec rejects malformed input", () => {
  assert.throws(() => parseIntervalSpec("abc"))
  assert.throws(() => parseIntervalSpec(""))
  assert.throws(() => parseIntervalSpec("0m"))
})

test("buildClaudePSpawnCommand assembles safe non-interactive argv", () => {
  const cmd = buildClaudePSpawnCommand({
    limit: 100,
    maxBudgetUsd: 2.0,
    model: "sonnet",
  })
  // Must be -p / --print mode.
  assert.ok(cmd.includes("--print") || cmd.includes(" -p "))
  // Must restrict tools to the yith MCP namespace so a runaway prompt
  // can't run Bash / Edit / etc.
  assert.match(cmd, /allowedTools/i)
  assert.match(cmd, /mcp__yith-archive/)
  // Must pass the budget cap.
  assert.match(cmd, /max-budget-usd 2/)
  // Must pick a model.
  assert.match(cmd, /--model sonnet/)
  // Must auto-accept permissions — this is unattended.
  assert.match(cmd, /permission-mode auto|bypassPermissions/)
  // Must embed the compress-batch-step loop prompt.
  assert.match(cmd, /compress-batch-step|yith_trigger/)
  // Must pass the limit into the prompt.
  assert.match(cmd, /100/)
})

test("buildCrontabLine assembles a full crontab entry with marker", () => {
  const line = buildCrontabLine({
    schedule: "0 */1 * * *",
    command: "/usr/bin/env oh-my-claudecode bind --resume",
  })
  assert.match(line, /^0 \*\/1 \* \* \*/)
  assert.match(line, /oh-my-claudecode bind --resume/)
  assert.ok(
    line.includes(BIND_CRON_MARKER),
    `line should contain marker ${BIND_CRON_MARKER}`,
  )
})

test("installCrontabEntry appends a new line when none exists", () => {
  const current = "# existing crontab\n0 0 * * * /some/other/job\n"
  const newLine = buildCrontabLine({
    schedule: "0 */1 * * *",
    command: "oh-my-claudecode bind --resume",
  })
  const updated = installCrontabEntry(current, newLine)
  assert.match(updated, /existing crontab/)
  assert.match(updated, /\/some\/other\/job/)
  assert.ok(updated.includes(BIND_CRON_MARKER))
  assert.ok(updated.includes("oh-my-claudecode bind --resume"))
})

test("installCrontabEntry replaces an existing marker line in place", () => {
  const existing =
    `# existing crontab\n` +
    `0 0 * * * /some/other/job\n` +
    `0 */6 * * * oh-my-claudecode bind --resume ${BIND_CRON_MARKER}\n` +
    `0 0 * * * /another/job\n`
  const newLine = buildCrontabLine({
    schedule: "0 */1 * * *",
    command: "oh-my-claudecode bind --resume",
  })
  const updated = installCrontabEntry(existing, newLine)
  // Old 6-hour schedule should be gone.
  assert.ok(!updated.includes("0 */6 * * *"))
  // New 1-hour schedule should be present.
  assert.ok(updated.includes("0 */1 * * *"))
  // Other unrelated lines should survive.
  assert.match(updated, /\/some\/other\/job/)
  assert.match(updated, /\/another\/job/)
  // Only ONE bind entry (no duplicates).
  const bindCount = updated.split("\n").filter((l) => l.includes(BIND_CRON_MARKER)).length
  assert.equal(bindCount, 1, "should have exactly one bind cron entry")
})

test("installCrontabEntry is idempotent when run twice with the same line", () => {
  const empty = ""
  const newLine = buildCrontabLine({
    schedule: "0 * * * *",
    command: "oh-my-claudecode bind --resume",
  })
  const once = installCrontabEntry(empty, newLine)
  const twice = installCrontabEntry(once, newLine)
  assert.equal(
    once.split("\n").filter((l) => l.includes(BIND_CRON_MARKER)).length,
    1,
  )
  assert.equal(
    twice.split("\n").filter((l) => l.includes(BIND_CRON_MARKER)).length,
    1,
  )
})
