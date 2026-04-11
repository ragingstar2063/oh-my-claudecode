import { test } from "node:test"
import assert from "node:assert/strict"

import { YithKV } from "../src/features/yith-archive/state/kv.js"
import { KV } from "../src/features/yith-archive/state/schema.js"
import {
  initialBindState,
  markPhase,
  firstPendingPhase,
  isBindComplete,
  type BindState,
} from "../src/features/yith-archive/state/bind-state.js"

import { createFixtureHome } from "./helpers/fixture-home.js"
import { join } from "node:path"

/**
 * Unit tests for the bind-state machine helpers. These exercise only
 * the pure-function surface (initial state, phase transitions,
 * completion detection). The KV integration test is separate and
 * verifies a full round-trip through YithKV.persist().
 */

test("initialBindState produces all phases in `pending` status", () => {
  const s = initialBindState()
  assert.equal(s.version, 1)
  const phases = Object.keys(s.phases)
  assert.ok(phases.length >= 6, `expected >=6 phases, got ${phases.length}`)
  for (const phase of phases) {
    assert.equal(
      s.phases[phase as keyof typeof s.phases].status,
      "pending",
      `phase ${phase} should start pending`,
    )
    assert.equal(s.phases[phase as keyof typeof s.phases].attempts, 0)
  }
})

test("markPhase transitions a phase through pending → in_progress → completed", () => {
  let s = initialBindState()
  s = markPhase(s, "embedding_download", { status: "in_progress" })
  assert.equal(s.phases.embedding_download.status, "in_progress")
  assert.ok(s.phases.embedding_download.startedAt, "startedAt set on in_progress")

  s = markPhase(s, "embedding_download", { status: "completed" })
  assert.equal(s.phases.embedding_download.status, "completed")
  assert.ok(s.phases.embedding_download.completedAt, "completedAt set on completed")
})

test("markPhase failure records error and bumps attempts", () => {
  let s = initialBindState()
  s = markPhase(s, "claude_transcripts", {
    status: "failed",
    error: "disk full",
  })
  assert.equal(s.phases.claude_transcripts.status, "failed")
  assert.equal(s.phases.claude_transcripts.error, "disk full")
  assert.equal(s.phases.claude_transcripts.attempts, 1)

  s = markPhase(s, "claude_transcripts", {
    status: "failed",
    error: "disk full again",
  })
  assert.equal(s.phases.claude_transcripts.attempts, 2)
})

test("firstPendingPhase returns the next incomplete phase in execution order", () => {
  let s = initialBindState()
  // All pending → first is embedding_download
  assert.equal(firstPendingPhase(s), "embedding_download")

  s = markPhase(s, "embedding_download", { status: "completed" })
  assert.equal(firstPendingPhase(s), "claude_transcripts")

  s = markPhase(s, "claude_transcripts", { status: "completed" })
  s = markPhase(s, "opencode_import", { status: "completed" })
  s = markPhase(s, "sisyphus_migrate", { status: "completed" })
  s = markPhase(s, "preliminary_seed", { status: "completed" })
  s = markPhase(s, "pending_compression_trigger", { status: "completed" })
  assert.equal(firstPendingPhase(s), null, "no phases pending → null")
})

test("firstPendingPhase retries failed phases (they count as pending)", () => {
  let s = initialBindState()
  s = markPhase(s, "embedding_download", { status: "completed" })
  s = markPhase(s, "claude_transcripts", {
    status: "failed",
    error: "test",
  })
  assert.equal(
    firstPendingPhase(s),
    "claude_transcripts",
    "failed phase should be returned as next-to-run so retries resume from it",
  )
})

test("isBindComplete is false until every phase is completed", () => {
  let s = initialBindState()
  assert.equal(isBindComplete(s), false)

  s = markPhase(s, "embedding_download", { status: "completed" })
  assert.equal(isBindComplete(s), false)

  s = markPhase(s, "claude_transcripts", { status: "completed" })
  s = markPhase(s, "opencode_import", { status: "completed" })
  s = markPhase(s, "sisyphus_migrate", { status: "completed" })
  s = markPhase(s, "preliminary_seed", { status: "completed" })
  s = markPhase(s, "pending_compression_trigger", { status: "completed" })
  assert.equal(isBindComplete(s), true)
})

test("BindState round-trips through YithKV persist/reload", async () => {
  const f = createFixtureHome("bind-state-kv")
  const persistPath = join(f.yithDataDir, "necronomicon.json")
  try {
    // Write
    const kv1 = new YithKV(persistPath)
    let s = initialBindState()
    s = markPhase(s, "embedding_download", { status: "completed" })
    s = markPhase(s, "claude_transcripts", {
      status: "in_progress",
      details: { projectsSeen: 7 },
    })
    await kv1.set(KV.bindState, "current", s)
    await kv1.persist()

    // Read back in a fresh instance
    const kv2 = new YithKV(persistPath)
    const reloaded = await kv2.get<BindState>(KV.bindState, "current")
    assert.ok(reloaded, "bind state should reload from disk")
    assert.equal(reloaded.phases.embedding_download.status, "completed")
    assert.equal(reloaded.phases.claude_transcripts.status, "in_progress")
    assert.deepEqual(reloaded.phases.claude_transcripts.details, {
      projectsSeen: 7,
    })
  } finally {
    f.cleanup()
  }
})
