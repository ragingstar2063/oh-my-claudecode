import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { writeFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createFixtureHome } from "./helpers/fixture-home.js"
import { createYithArchive } from "../src/features/yith-archive/index.js"
import { KV } from "../src/features/yith-archive/state/schema.js"
import {
  opencodePartToRawObservation,
  isSqlite3Available,
} from "../src/features/yith-archive/functions/opencode-import.js"

/**
 * Tests for the opencode SQLite importer.
 *
 * The mapper tests are pure-function — they pass a part.data JSON
 * object to `opencodePartToRawObservation` and verify the shape of
 * the result. No sqlite required.
 *
 * The integration test creates a tiny fixture SQLite DB via the
 * `sqlite3` CLI, seeds it with a project + session + messages +
 * parts, then runs `mem::import-opencode` against it and verifies
 * observations land in the archive. Skipped if sqlite3 is not
 * installed on the test machine (CI always has it; local dev
 * usually does too).
 */

test("opencodePartToRawObservation maps text parts to prompt_submit obs", () => {
  const obs = opencodePartToRawObservation({
    partId: "p_abc",
    messageId: "m_xyz",
    sessionId: "s_1",
    partData: { type: "text", text: "hello world" },
    messageRole: "assistant",
    timestamp: "2026-04-01T00:00:00Z",
  })
  assert.ok(obs, "expected an obs for text part")
  assert.equal(obs.id, "oc:s_1:p_abc")
  assert.equal(obs.sessionId, "s_1")
  assert.equal(obs.userPrompt, "hello world")
  assert.equal(obs.hookType, "prompt_submit")
})

test("opencodePartToRawObservation maps tool parts to pre_tool_use obs", () => {
  const obs = opencodePartToRawObservation({
    partId: "p_tool_1",
    messageId: "m_1",
    sessionId: "s_1",
    partData: {
      type: "tool",
      callID: "call_123",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "ls -la" },
        output: "total 42\n-rw...",
      },
    },
    messageRole: "assistant",
    timestamp: "2026-04-01T00:00:00Z",
  })
  assert.ok(obs)
  assert.equal(obs.id, "oc:s_1:p_tool_1")
  assert.equal(obs.hookType, "pre_tool_use")
  assert.equal(obs.toolName, "bash")
  assert.deepEqual(obs.toolInput, { command: "ls -la" })
})

test("opencodePartToRawObservation skips step-start / step-finish / reasoning / patch", () => {
  const cases = ["step-start", "step-finish", "reasoning", "patch", "compaction"]
  for (const type of cases) {
    const obs = opencodePartToRawObservation({
      partId: "p",
      messageId: "m",
      sessionId: "s",
      partData: { type },
      messageRole: "assistant",
      timestamp: "2026-04-01T00:00:00Z",
    })
    assert.equal(obs, null, `type ${type} should be skipped`)
  }
})

test("opencodePartToRawObservation uses stable IDs for idempotency", () => {
  const a = opencodePartToRawObservation({
    partId: "p_abc",
    messageId: "m",
    sessionId: "s_1",
    partData: { type: "text", text: "x" },
    messageRole: "assistant",
    timestamp: "2026-04-01T00:00:00Z",
  })
  const b = opencodePartToRawObservation({
    partId: "p_abc",
    messageId: "m",
    sessionId: "s_1",
    partData: { type: "text", text: "x" },
    messageRole: "assistant",
    timestamp: "2026-04-02T00:00:00Z",
  })
  assert.ok(a && b)
  assert.equal(a.id, b.id, "ID should depend only on sessionId + partId")
})

/**
 * Helper — create a throwaway opencode.db using the `sqlite3` CLI,
 * seed it with a minimal project/session/message/part graph, and
 * return its path. The caller must delete it.
 */
function buildFixtureDb(): string {
  const dir = join(tmpdir(), `opencode-fixture-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  const dbPath = join(dir, "opencode.db")
  const seed = `
    CREATE TABLE project (
      id TEXT PRIMARY KEY,
      worktree TEXT NOT NULL,
      name TEXT,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );

    INSERT INTO project VALUES
      ('proj_1', '/home/alice/foo', 'foo', 1769000000000, 1769000000000);

    INSERT INTO session VALUES
      ('sess_1', 'proj_1', '/home/alice/foo', 'Test session', 1769000100000, 1769000100000);

    INSERT INTO message VALUES
      ('msg_1', 'sess_1', 1769000110000, 1769000110000,
       '{"role":"user","time":{"created":1769000110000}}'),
      ('msg_2', 'sess_1', 1769000120000, 1769000120000,
       '{"role":"assistant","time":{"created":1769000120000}}');

    INSERT INTO part VALUES
      ('part_text_1', 'msg_1', 'sess_1', 1769000110000, 1769000110000,
       '{"type":"text","text":"user greeting"}'),
      ('part_text_2', 'msg_2', 'sess_1', 1769000120000, 1769000120000,
       '{"type":"text","text":"assistant response"}'),
      ('part_tool_1', 'msg_2', 'sess_1', 1769000121000, 1769000121000,
       '{"type":"tool","callID":"c1","tool":"bash","state":{"status":"completed","input":{"command":"echo hi"},"output":"hi"}}'),
      ('part_skip_1', 'msg_2', 'sess_1', 1769000122000, 1769000122000,
       '{"type":"step-start"}'),
      ('part_skip_2', 'msg_2', 'sess_1', 1769000123000, 1769000123000,
       '{"type":"reasoning","text":"thinking..."}');
  `
  execFileSync("sqlite3", [dbPath], { input: seed })
  return dbPath
}

test("mem::import-opencode reads a fixture DB and writes raw observations", { skip: !isSqlite3Available() }, async () => {
  const f = createFixtureHome("oc-import")
  const dbPath = buildFixtureDb()
  try {
    const archive = createYithArchive({ dataDir: f.yithDataDir })
    try {
      const result = (await archive.sdk.trigger("mem::import-opencode", {
        dbPath,
      })) as {
        success: boolean
        observationsCreated: number
        sessionsScanned: number
        projectsScanned: number
      }

      assert.equal(result.success, true)
      assert.equal(result.projectsScanned, 1)
      assert.equal(result.sessionsScanned, 1)
      // 2 text parts + 1 tool part = 3 observations. step-start and
      // reasoning are skipped.
      assert.equal(result.observationsCreated, 3)

      // Verify observations landed under the opencode session id.
      const obs = await archive.kv.list(KV.observations("sess_1"))
      assert.equal(obs.length, 3)
      const ids = obs.map((o: any) => o.id).sort()
      assert.deepEqual(ids, [
        "oc:sess_1:part_text_1",
        "oc:sess_1:part_text_2",
        "oc:sess_1:part_tool_1",
      ])

      // Session should be registered with the worktree as project.
      const session = await archive.kv.get<{ project: string }>(
        KV.sessions,
        "sess_1",
      )
      assert.ok(session)
      assert.equal(session.project, "/home/alice/foo")

      // Pending-compression counter bumped.
      const pending = await archive.kv.get<{ count: number }>(
        KV.pendingCompression,
        "state",
      )
      assert.equal(pending?.count, 3)
    } finally {
      await archive.shutdown()
    }
  } finally {
    if (existsSync(dbPath)) unlinkSync(dbPath)
    f.cleanup()
  }
})

/**
 * Build a fixture DB with `count` text parts so we cross the
 * SCAN_CHUNK_SIZE (1000) boundary and exercise the paginated fetch
 * path. Regression guard against the `spawnSync sqlite3 ENOBUFS`
 * error that hit real users with 90k+ parts.
 */
function buildLargeFixtureDb(count: number): string {
  const dir = join(tmpdir(), `opencode-large-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  const dbPath = join(dir, "opencode.db")
  const rows: string[] = []
  for (let i = 0; i < count; i++) {
    const t = 1769000000000 + i
    rows.push(
      `('part_${i}', 'msg_1', 'sess_1', ${t}, ${t}, '{"type":"text","text":"row ${i}"}')`,
    )
  }
  const seed = `
    CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL, name TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL);
    CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, directory TEXT NOT NULL, title TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
    INSERT INTO project VALUES ('proj_1', '/home/alice/big', 'big', 1769000000000, 1769000000000);
    INSERT INTO session VALUES ('sess_1', 'proj_1', '/home/alice/big', 'Big session', 1769000000000, 1769000000000);
    INSERT INTO message VALUES ('msg_1', 'sess_1', 1769000000000, 1769000000000, '{"role":"user"}');
    INSERT INTO part VALUES ${rows.join(",\n")};
  `
  execFileSync("sqlite3", [dbPath], { input: seed })
  return dbPath
}

test("mem::import-opencode paginates past the chunk boundary", { skip: !isSqlite3Available() }, async () => {
  const f = createFixtureHome("oc-import-large")
  // 2500 parts crosses two 1000-row chunk boundaries and rules out
  // the single-shot `spawnSync ENOBUFS` failure mode.
  const dbPath = buildLargeFixtureDb(2500)
  try {
    const archive = createYithArchive({ dataDir: f.yithDataDir })
    try {
      const result = (await archive.sdk.trigger("mem::import-opencode", {
        dbPath,
        limit: 5000,
      })) as { success: boolean; observationsCreated: number }
      assert.equal(result.success, true)
      assert.equal(result.observationsCreated, 2500)

      const obs = await archive.kv.list(KV.observations("sess_1"))
      assert.equal(obs.length, 2500)
    } finally {
      await archive.shutdown()
    }
  } finally {
    if (existsSync(dbPath)) unlinkSync(dbPath)
    f.cleanup()
  }
})

test("mem::import-opencode is idempotent — second run creates zero new obs", { skip: !isSqlite3Available() }, async () => {
  const f = createFixtureHome("oc-import-idem")
  const dbPath = buildFixtureDb()
  try {
    const archive = createYithArchive({ dataDir: f.yithDataDir })
    try {
      const first = (await archive.sdk.trigger("mem::import-opencode", {
        dbPath,
      })) as { observationsCreated: number }
      assert.equal(first.observationsCreated, 3)

      const second = (await archive.sdk.trigger("mem::import-opencode", {
        dbPath,
      })) as { observationsCreated: number; observationsSkipped: number }
      assert.equal(second.observationsCreated, 0)
      assert.ok((second.observationsSkipped ?? 0) >= 3)
    } finally {
      await archive.shutdown()
    }
  } finally {
    if (existsSync(dbPath)) unlinkSync(dbPath)
    f.cleanup()
  }
})
