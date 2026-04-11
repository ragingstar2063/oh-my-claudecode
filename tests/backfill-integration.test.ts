import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"

import {
  createFixtureHome,
  seedTranscript,
  buildUserLine,
  buildAssistantLine,
} from "./helpers/fixture-home.js"
import { createYithArchive } from "../src/features/yith-archive/index.js"
import { KV } from "../src/features/yith-archive/state/schema.js"

/**
 * Integration tests for `mem::backfill-sessions` with the new
 * all-projects mode. These tests point `HOME` at a fixture directory,
 * seed a handful of fake transcripts across multiple projects, run
 * backfill, and assert that observations land with the right metadata
 * and the pending-compression counter gets bumped.
 */

interface AggregateResult {
  success?: boolean
  perProject?: Array<{
    projectCwd: string
    transcriptsScanned: number
    observationsCreated: number
  }>
  totalObservationsCreated?: number
  totalTranscriptsScanned?: number
  totalProjects?: number
}

async function withFixture<T>(
  label: string,
  body: (fixture: ReturnType<typeof createFixtureHome>) => Promise<T>,
): Promise<T> {
  const f = createFixtureHome(label)
  const prevHome = process.env.HOME
  process.env.HOME = f.home
  try {
    return await body(f)
  } finally {
    if (prevHome !== undefined) process.env.HOME = prevHome
    else delete process.env.HOME
    f.cleanup()
  }
}

test("allProjects: true scans every project subdir under ~/.claude/projects/", async () => {
  await withFixture("bf-all-projects", async (f) => {
    // Seed three projects with distinct cwds.
    seedTranscript(f, "-home-alice-foo", "aaaaaaaa-0000-0000-0000-000000000001", [
      buildUserLine({
        uuid: "u-foo-1",
        sessionId: "aaaaaaaa-0000-0000-0000-000000000001",
        cwd: "/home/alice/foo",
        content: "hello from foo",
      }),
      buildAssistantLine({
        uuid: "a-foo-1",
        sessionId: "aaaaaaaa-0000-0000-0000-000000000001",
        text: "sure thing",
      }),
    ])
    seedTranscript(f, "-home-alice-bar", "bbbbbbbb-0000-0000-0000-000000000002", [
      buildUserLine({
        uuid: "u-bar-1",
        sessionId: "bbbbbbbb-0000-0000-0000-000000000002",
        cwd: "/home/alice/bar",
        content: "hello from bar",
      }),
    ])
    seedTranscript(f, "-home-alice-baz", "cccccccc-0000-0000-0000-000000000003", [
      buildUserLine({
        uuid: "u-baz-1",
        sessionId: "cccccccc-0000-0000-0000-000000000003",
        cwd: "/home/alice/baz",
        content: "hello from baz",
      }),
      buildAssistantLine({
        uuid: "a-baz-1",
        sessionId: "cccccccc-0000-0000-0000-000000000003",
        text: "baz response",
        toolUses: [{ name: "Read", input: { path: "/tmp/x" } }],
      }),
    ])

    const archive = createYithArchive({ dataDir: f.yithDataDir })
    try {
      const result = (await archive.sdk.trigger("mem::backfill-sessions", {
        allProjects: true,
        dryRun: false,
      })) as AggregateResult

      assert.equal(result.success, true)
      assert.equal(result.totalProjects, 3, `totalProjects should be 3, got ${result.totalProjects}`)

      // Each project should have its observations in the right session scope.
      const fooObs = await archive.kv.list(
        KV.observations("aaaaaaaa-0000-0000-0000-000000000001"),
      )
      const barObs = await archive.kv.list(
        KV.observations("bbbbbbbb-0000-0000-0000-000000000002"),
      )
      const bazObs = await archive.kv.list(
        KV.observations("cccccccc-0000-0000-0000-000000000003"),
      )

      assert.ok(fooObs.length >= 2, `foo should have >=2 obs, got ${fooObs.length}`)
      assert.ok(barObs.length >= 1, `bar should have >=1 obs, got ${barObs.length}`)
      assert.ok(bazObs.length >= 3, `baz should have >=3 obs (user+text+tool), got ${bazObs.length}`)
    } finally {
      await archive.shutdown()
    }
  })
})

test("allProjects backfill writes Session records with the unsanitized project path", async () => {
  await withFixture("bf-session-project", async (f) => {
    seedTranscript(f, "-tmp-test", "dddddddd-0000-0000-0000-000000000004", [
      buildUserLine({
        uuid: "u1",
        sessionId: "dddddddd-0000-0000-0000-000000000004",
        cwd: "/tmp/test",
        content: "testing project path",
      }),
    ])

    const archive = createYithArchive({ dataDir: f.yithDataDir })
    try {
      await archive.sdk.trigger("mem::backfill-sessions", {
        allProjects: true,
      })
      const session = await archive.kv.get<{
        id: string
        project: string
      }>(KV.sessions, "dddddddd-0000-0000-0000-000000000004")
      assert.ok(session, "Session record should exist")
      assert.equal(
        session.project,
        "/tmp/test",
        "Session.project should be the unsanitized cwd",
      )
    } finally {
      await archive.shutdown()
    }
  })
})

test("pending-compression counter increments as raw observations are written", async () => {
  await withFixture("bf-pending-counter", async (f) => {
    seedTranscript(f, "-home-alice-foo", "eeeeeeee-0000-0000-0000-000000000005", [
      buildUserLine({
        uuid: "u1",
        sessionId: "eeeeeeee-0000-0000-0000-000000000005",
        cwd: "/home/alice/foo",
        content: "msg 1",
      }),
      buildUserLine({
        uuid: "u2",
        sessionId: "eeeeeeee-0000-0000-0000-000000000005",
        cwd: "/home/alice/foo",
        content: "msg 2",
      }),
      buildAssistantLine({
        uuid: "a1",
        sessionId: "eeeeeeee-0000-0000-0000-000000000005",
        text: "reply",
      }),
    ])

    const archive = createYithArchive({ dataDir: f.yithDataDir })
    try {
      const before = (await archive.kv.get<{ count: number }>(
        KV.pendingCompression,
        "state",
      )) ?? { count: 0 }
      assert.equal(before.count, 0, "pending counter starts at 0")

      await archive.sdk.trigger("mem::backfill-sessions", {
        allProjects: true,
      })

      const after = await archive.kv.get<{ count: number }>(
        KV.pendingCompression,
        "state",
      )
      assert.ok(after, "pending counter should be set after backfill")
      assert.equal(
        after.count,
        3,
        `expected 3 raw observations pending, got ${after.count}`,
      )
    } finally {
      await archive.shutdown()
    }
  })
})

test("backfill is idempotent: re-running produces zero new observations", async () => {
  await withFixture("bf-idempotent", async (f) => {
    seedTranscript(f, "-home-alice-idem", "ffffffff-0000-0000-0000-000000000006", [
      buildUserLine({
        uuid: "u1",
        sessionId: "ffffffff-0000-0000-0000-000000000006",
        cwd: "/home/alice/idem",
        content: "idempotent test",
      }),
    ])

    const archive = createYithArchive({ dataDir: f.yithDataDir })
    try {
      const first = (await archive.sdk.trigger("mem::backfill-sessions", {
        allProjects: true,
      })) as AggregateResult
      assert.equal(first.totalObservationsCreated, 1)

      const second = (await archive.sdk.trigger("mem::backfill-sessions", {
        allProjects: true,
      })) as AggregateResult
      assert.equal(
        second.totalObservationsCreated,
        0,
        "second run should write 0 new observations (cursor advanced)",
      )

      // Pending counter should still be 1, not 2 (not double-counted).
      const pending = await archive.kv.get<{ count: number }>(
        KV.pendingCompression,
        "state",
      )
      assert.equal(pending?.count, 1, "pending counter should not double-count")
    } finally {
      await archive.shutdown()
    }
  })
})
