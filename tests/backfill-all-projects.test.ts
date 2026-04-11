import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  createFixtureHome,
  seedTranscript,
  buildUserLine,
  buildAssistantLine,
} from "./helpers/fixture-home.js"
import {
  unsanitizeClaudeCodeDirName,
  enumerateTranscriptProjects,
} from "../src/features/yith-archive/functions/backfill.js"

/**
 * Unit tests for the all-projects backfill helpers. Pure functions
 * that don't touch the Yith KV — they just map filesystem state to
 * project descriptors.
 */

test("unsanitizeClaudeCodeDirName converts dashes back to slashes", () => {
  // Round-trip a few realistic cwds through the sanitize/unsanitize pair.
  // Claude Code's own directory naming: replace every `/` with `-`, so
  // `/home/alice/foo` becomes `-home-alice-foo`. Reversing has some
  // ambiguity when the original path contained a literal dash, which
  // is why this function returns a best-effort absolute path.
  assert.equal(
    unsanitizeClaudeCodeDirName("-home-alice-foo"),
    "/home/alice/foo",
  )
  assert.equal(unsanitizeClaudeCodeDirName("-tmp-test-proj"), "/tmp/test/proj")
  assert.equal(unsanitizeClaudeCodeDirName("-home-ragingstar"), "/home/ragingstar")
})

test("enumerateTranscriptProjects finds every project subdir", () => {
  const f = createFixtureHome("backfill-enum")
  try {
    // Three projects, varied transcript counts.
    seedTranscript(
      f,
      "-home-alice-foo",
      "11111111-1111-1111-1111-111111111111",
      [
        buildUserLine({
          uuid: "u1",
          sessionId: "11111111-1111-1111-1111-111111111111",
          cwd: "/home/alice/foo",
          content: "hello foo",
        }),
      ],
    )
    seedTranscript(
      f,
      "-home-alice-bar",
      "22222222-2222-2222-2222-222222222222",
      [
        buildUserLine({
          uuid: "u2",
          sessionId: "22222222-2222-2222-2222-222222222222",
          cwd: "/home/alice/bar",
          content: "hello bar",
        }),
      ],
    )
    seedTranscript(
      f,
      "-home-alice-bar",
      "33333333-3333-3333-3333-333333333333",
      [
        buildUserLine({
          uuid: "u3",
          sessionId: "33333333-3333-3333-3333-333333333333",
          cwd: "/home/alice/bar",
          content: "another bar session",
        }),
      ],
    )

    // Non-jsonl files in the projects dir should be ignored.
    mkdirSync(join(f.claudeProjectsDir, "-home-alice-baz"))
    writeFileSync(
      join(f.claudeProjectsDir, "-home-alice-baz", "notes.md"),
      "not a transcript",
    )

    const projects = enumerateTranscriptProjects(f.claudeProjectsDir)
    const byCwd = new Map(projects.map((p) => [p.projectCwd, p]))

    assert.equal(projects.length, 3, `expected 3 projects, got ${projects.length}`)
    assert.equal(byCwd.get("/home/alice/foo")?.transcriptCount, 1)
    assert.equal(byCwd.get("/home/alice/bar")?.transcriptCount, 2)
    assert.equal(byCwd.get("/home/alice/baz")?.transcriptCount, 0)
  } finally {
    f.cleanup()
  }
})

test("enumerateTranscriptProjects returns empty array when base dir missing", () => {
  // No ~/.claude/projects/ yet — fresh machine. Should not throw.
  const out = enumerateTranscriptProjects("/nonexistent/path/to/projects")
  assert.deepEqual(out, [])
})
