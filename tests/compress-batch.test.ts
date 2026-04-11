import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"

import { createFixtureHome } from "./helpers/fixture-home.js"
import { createYithArchive } from "../src/features/yith-archive/index.js"
import { KV } from "../src/features/yith-archive/state/schema.js"
import type {
  StepInput,
  StepResult,
} from "../src/features/yith-archive/state/work-packets.js"

/**
 * Integration tests for `mem::compress-batch-step` — the loop-style
 * state machine that walks raw observations across all sessions,
 * emits compression work packets in planLoopBatches-sized chunks,
 * and consumes fake completions to produce CompressedObservations.
 *
 * These tests fake out the LLM side (since there's no LLM in the test
 * environment) by manually driving the state machine: step 0 emits
 * packets, we synthesize compliant compression XML for each packet,
 * step 1+ consumes them via the standard commit path.
 */

interface Session {
  id: string
  project: string
  cwd: string
  startedAt: string
  status: string
  observationCount: number
}

interface RawObs {
  id: string
  sessionId: string
  timestamp: string
  hookType: string
  userPrompt?: string
  toolName?: string
  toolInput?: unknown
  raw: unknown
}

const FAKE_COMPRESSION_XML =
  "<compressed>" +
  "<type>conversation</type>" +
  "<title>Test compression output</title>" +
  "<narrative>This is a fake compressed narrative written by the test harness.</narrative>" +
  "<facts><fact>fact one</fact><fact>fact two</fact></facts>" +
  "<concepts><concept>test</concept></concepts>" +
  "<files><file>/tmp/fake.ts</file></files>" +
  "<importance>5</importance>" +
  "</compressed>"

async function seedRawObservations(
  archive: Awaited<ReturnType<typeof createYithArchive>>,
  count: number,
  sessionId = "test-session-1",
): Promise<void> {
  const session: Session = {
    id: sessionId,
    project: "/tmp/test-proj",
    cwd: "/tmp/test-proj",
    startedAt: new Date().toISOString(),
    status: "completed",
    observationCount: count,
  }
  await archive.kv.set(KV.sessions, sessionId, session)
  for (let i = 0; i < count; i++) {
    const obs: RawObs = {
      id: `sess:${sessionId}:raw-${i}`,
      sessionId,
      timestamp: new Date(Date.now() - (count - i) * 1000).toISOString(),
      hookType: "prompt_submit",
      userPrompt: `Test prompt number ${i} — do something interesting`,
      raw: { type: "user", content: `prompt ${i}` },
    }
    await archive.kv.set(KV.observations(sessionId), obs.id, obs)
  }
}

test("compress-batch-step at state 0 emits packets for pending raw obs", async () => {
  const f = createFixtureHome("cb-step0")
  try {
    const archive = createYithArchive({ dataDir: f.yithDataDir })
    try {
      await seedRawObservations(archive, 5)

      const input: StepInput = { step: 0, originalArgs: { limit: 10 } }
      const result = (await archive.sdk.trigger(
        "mem::compress-batch-step",
        input,
      )) as StepResult

      assert.equal(result.done, false, "state 0 should be non-terminal")
      if (result.done) return // narrow type
      assert.ok(result.workPackets.length > 0, "should emit at least 1 packet")
      assert.ok(
        result.workPackets.length <= 5,
        `should emit at most 5 packets (one per raw obs), got ${result.workPackets.length}`,
      )
      // Each packet carries the compression system prompt + the obs data.
      for (const pkt of result.workPackets) {
        assert.equal(pkt.kind, "compress")
        assert.ok(
          pkt.systemPrompt.length > 0,
          "packet should carry a system prompt",
        )
        assert.ok(pkt.userPrompt.length > 0, "packet should carry a user prompt")
      }
    } finally {
      await archive.shutdown()
    }
  } finally {
    f.cleanup()
  }
})

test("compress-batch-step at state 1 consumes completions and writes compressed obs", async () => {
  const f = createFixtureHome("cb-step1")
  try {
    const archive = createYithArchive({ dataDir: f.yithDataDir })
    try {
      await seedRawObservations(archive, 3)

      // Step 0
      const r0 = (await archive.sdk.trigger("mem::compress-batch-step", {
        step: 0,
        originalArgs: { limit: 10 },
      })) as StepResult
      assert.equal(r0.done, false)
      if (r0.done) return
      assert.equal(r0.workPackets.length, 3)

      const completions: Record<string, string> = {}
      for (const pkt of r0.workPackets) completions[pkt.id] = FAKE_COMPRESSION_XML

      // Step 1
      const r1 = (await archive.sdk.trigger("mem::compress-batch-step", {
        step: r0.nextStep,
        originalArgs: { limit: 10 },
        intermediateState: r0.intermediateState,
        completions,
      })) as StepResult

      assert.equal(r1.done, true, "state 1 should be terminal for 3 obs in one batch")
      if (!r1.done) return
      const rr = r1.result as {
        success: boolean
        compressed: number
        failed: number
      }
      assert.equal(rr.success, true)
      assert.equal(rr.compressed, 3, "all 3 obs should be compressed")
      assert.equal(rr.failed, 0)

      // Verify obs now have `title` field (i.e. they're CompressedObservation-shaped).
      const obs = await archive.kv.list<{ title?: string; narrative?: string }>(
        KV.observations("test-session-1"),
      )
      assert.equal(obs.length, 3)
      for (const o of obs) {
        assert.equal(o.title, "Test compression output")
        assert.ok(o.narrative && o.narrative.length > 0)
      }
    } finally {
      await archive.shutdown()
    }
  } finally {
    f.cleanup()
  }
})

test("compress-batch-step decrements pending-compression counter per write", async () => {
  const f = createFixtureHome("cb-counter")
  try {
    const archive = createYithArchive({ dataDir: f.yithDataDir })
    try {
      await seedRawObservations(archive, 2)
      // Prime the counter as if backfill had just run.
      await archive.kv.set(KV.pendingCompression, "state", {
        count: 2,
        updatedAt: new Date().toISOString(),
      })

      const r0 = (await archive.sdk.trigger("mem::compress-batch-step", {
        step: 0,
        originalArgs: { limit: 10 },
      })) as StepResult
      if (r0.done) throw new Error("unexpected terminal at step 0")

      const completions: Record<string, string> = {}
      for (const pkt of r0.workPackets) completions[pkt.id] = FAKE_COMPRESSION_XML

      await archive.sdk.trigger("mem::compress-batch-step", {
        step: r0.nextStep,
        originalArgs: { limit: 10 },
        intermediateState: r0.intermediateState,
        completions,
      })

      const counter = await archive.kv.get<{ count: number }>(
        KV.pendingCompression,
        "state",
      )
      assert.equal(counter?.count, 0, "pending counter should drain to 0")
    } finally {
      await archive.shutdown()
    }
  } finally {
    f.cleanup()
  }
})

test("compress-batch-step terminates cleanly when zero raw obs exist", async () => {
  const f = createFixtureHome("cb-empty")
  try {
    const archive = createYithArchive({ dataDir: f.yithDataDir })
    try {
      const r = (await archive.sdk.trigger("mem::compress-batch-step", {
        step: 0,
        originalArgs: { limit: 10 },
      })) as StepResult
      assert.equal(r.done, true)
      if (!r.done) return
      const rr = r.result as { success: boolean; compressed: number }
      assert.equal(rr.success, true)
      assert.equal(rr.compressed, 0)
    } finally {
      await archive.shutdown()
    }
  } finally {
    f.cleanup()
  }
})
