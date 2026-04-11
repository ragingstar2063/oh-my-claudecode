import { test } from "node:test"
import assert from "node:assert/strict"

import { createFixtureHome } from "./helpers/fixture-home.js"
import { createYithArchive } from "../src/features/yith-archive/index.js"
import { runBind, type PhaseRunner, type BindContext } from "../src/cli/bind.js"
import {
  BIND_PHASE_ORDER,
  type BindPhase,
} from "../src/features/yith-archive/state/bind-state.js"
import { TuiWriter } from "../src/cli/tui.js"

/**
 * Tests for `onlyPhases` filtering + `projectCwd` scoping on runBind.
 *
 * These options power the Stop-hook capture path:
 *
 *   oh-my-claudecode bind --resume --claude-only --project "$CLAUDE_PROJECT_DIR"
 *
 * `--claude-only` sets `onlyPhases: ["claude_transcripts"]` so the hook
 * doesn't waste time re-downloading the embedding model or re-scanning
 * opencode on every assistant Stop event. `--project` sets `projectCwd`
 * so the transcript scan only touches the current session's project
 * instead of the entire `~/.claude/projects/` tree.
 *
 * The tests verify the runner honors both options without re-running
 * unrelated phases and without blowing up when the set of "only" phases
 * is narrow.
 */

function silentTui(): TuiWriter {
  return new TuiWriter({
    write: () => {},
    isTTY: false,
  })
}

function fakePhase(
  name: BindPhase,
  calls: BindPhase[],
): PhaseRunner {
  return {
    name,
    async run(_ctx: BindContext) {
      calls.push(name)
      return {}
    },
  }
}

test("onlyPhases: [x] runs only phase x, leaves others untouched", async () => {
  const f = createFixtureHome("bind-only-one")
  try {
    const archive = createYithArchive({ dataDir: f.yithDataDir })
    const calls: BindPhase[] = []
    const phases = BIND_PHASE_ORDER.map((n) => fakePhase(n, calls))
    try {
      await runBind({
        archive,
        tui: silentTui(),
        phases,
        onlyPhases: ["claude_transcripts"],
      })
      assert.deepEqual(
        calls,
        ["claude_transcripts"],
        `expected only claude_transcripts to run, got ${calls.join(", ")}`,
      )
    } finally {
      await archive.shutdown()
    }
  } finally {
    f.cleanup()
  }
})

test("onlyPhases: [a, b] runs only those two phases in order", async () => {
  const f = createFixtureHome("bind-only-two")
  try {
    const archive = createYithArchive({ dataDir: f.yithDataDir })
    const calls: BindPhase[] = []
    const phases = BIND_PHASE_ORDER.map((n) => fakePhase(n, calls))
    try {
      await runBind({
        archive,
        tui: silentTui(),
        phases,
        onlyPhases: ["claude_transcripts", "pending_compression_trigger"],
      })
      assert.deepEqual(calls, [
        "claude_transcripts",
        "pending_compression_trigger",
      ])
    } finally {
      await archive.shutdown()
    }
  } finally {
    f.cleanup()
  }
})

test("onlyPhases does NOT mark skipped phases as completed", async () => {
  // A narrow claude-only run from the hook shouldn't falsely advance
  // other phases' bindState. The next full `oh-my-claudecode bind`
  // invocation must still run embedding_download etc. from pending.
  const f = createFixtureHome("bind-only-no-false-complete")
  try {
    const archive = createYithArchive({ dataDir: f.yithDataDir })
    const calls: BindPhase[] = []
    const phases = BIND_PHASE_ORDER.map((n) => fakePhase(n, calls))
    try {
      await runBind({
        archive,
        tui: silentTui(),
        phases,
        onlyPhases: ["claude_transcripts"],
      })
      // Check bindState: embedding_download should still be pending.
      const { KV } = await import(
        "../src/features/yith-archive/state/schema.js"
      )
      const state = await archive.kv.get<{
        phases: Record<string, { status: string }>
      }>(KV.bindState, "current")
      assert.ok(state, "bindState should be written")
      assert.equal(
        state.phases.embedding_download.status,
        "pending",
        "unrelated phase should remain pending after narrow run",
      )
      assert.equal(
        state.phases.claude_transcripts.status,
        "completed",
        "the only-listed phase should be completed",
      )
    } finally {
      await archive.shutdown()
    }
  } finally {
    f.cleanup()
  }
})

test("projectCwd option threads through to the phase context", async () => {
  // When the caller passes `projectCwd`, runBind should expose it on
  // the BindContext so phase runners (specifically the default
  // claude_transcripts runner) can scope their work. This test uses
  // a fake runner to capture the context it receives.
  const f = createFixtureHome("bind-project-scope")
  try {
    const archive = createYithArchive({ dataDir: f.yithDataDir })
    let capturedCwd: string | undefined
    const phases: PhaseRunner[] = [
      {
        name: "claude_transcripts",
        async run(ctx) {
          capturedCwd = ctx.projectCwd
          return {}
        },
      },
    ]
    try {
      await runBind({
        archive,
        tui: silentTui(),
        phases,
        onlyPhases: ["claude_transcripts"],
        projectCwd: "/home/alice/my-project",
      })
      assert.equal(capturedCwd, "/home/alice/my-project")
    } finally {
      await archive.shutdown()
    }
  } finally {
    f.cleanup()
  }
})
