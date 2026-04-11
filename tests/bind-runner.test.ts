import { test } from "node:test"
import assert from "node:assert/strict"

import { createFixtureHome } from "./helpers/fixture-home.js"
import { createYithArchive } from "../src/features/yith-archive/index.js"
import { KV } from "../src/features/yith-archive/state/schema.js"
import {
  runBind,
  type PhaseRunner,
  type BindContext,
} from "../src/cli/bind.js"
import {
  BIND_PHASE_ORDER,
  initialBindState,
  markPhase,
  type BindPhase,
  type BindState,
} from "../src/features/yith-archive/state/bind-state.js"
import { TuiWriter } from "../src/cli/tui.js"

/**
 * Tests for runBind — the top-level state-machine driver. Uses
 * injectable fake phase runners so each test can control exactly
 * which phases succeed, fail, or get skipped.
 */

function fakePhase(
  name: BindPhase,
  behavior: {
    call?: (ctx: BindContext) => Promise<void> | void
    throws?: string
    returnDetails?: Record<string, unknown>
  } = {},
): PhaseRunner {
  return {
    name,
    async run(ctx: BindContext) {
      if (behavior.call) await behavior.call(ctx)
      if (behavior.throws) throw new Error(behavior.throws)
      return { details: behavior.returnDetails }
    },
  }
}

function captureTui(): {
  tui: TuiWriter
  output: string[]
} {
  const output: string[] = []
  const tui = new TuiWriter({
    write: (chunk: string) => output.push(chunk),
    isTTY: false,
  })
  return { tui, output }
}

test("runBind calls every phase runner in BIND_PHASE_ORDER", async () => {
  const f = createFixtureHome("runbind-order")
  try {
    const archive = createYithArchive({ dataDir: f.yithDataDir })
    const { tui } = captureTui()
    const callOrder: BindPhase[] = []
    const phases = BIND_PHASE_ORDER.map((name) =>
      fakePhase(name, {
        call: () => {
          callOrder.push(name)
        },
      }),
    )
    try {
      await runBind({ archive, tui, phases })
      assert.deepEqual(callOrder, [...BIND_PHASE_ORDER])
    } finally {
      await archive.shutdown()
    }
  } finally {
    f.cleanup()
  }
})

test("runBind skips already-completed phases on resume", async () => {
  const f = createFixtureHome("runbind-resume")
  try {
    const archive = createYithArchive({ dataDir: f.yithDataDir })
    const { tui } = captureTui()
    const callOrder: BindPhase[] = []
    try {
      // Pre-seed bindState with the first two phases already done.
      let state = initialBindState()
      state = markPhase(state, "embedding_download", { status: "completed" })
      state = markPhase(state, "claude_transcripts", { status: "completed" })
      await archive.kv.set(KV.bindState, "current", state)
      await archive.kv.persist()

      const phases = BIND_PHASE_ORDER.map((name) =>
        fakePhase(name, {
          call: () => {
            callOrder.push(name)
          },
        }),
      )
      await runBind({ archive, tui, phases })

      // The two pre-completed phases should not be called again.
      assert.ok(
        !callOrder.includes("embedding_download"),
        "embedding_download was already done",
      )
      assert.ok(
        !callOrder.includes("claude_transcripts"),
        "claude_transcripts was already done",
      )
      // Remaining phases should have run.
      assert.ok(callOrder.includes("opencode_import"))
      assert.ok(callOrder.includes("sisyphus_migrate"))
    } finally {
      await archive.shutdown()
    }
  } finally {
    f.cleanup()
  }
})

test("runBind persists bindState after each successful phase", async () => {
  const f = createFixtureHome("runbind-persist")
  try {
    const archive = createYithArchive({ dataDir: f.yithDataDir })
    const { tui } = captureTui()
    try {
      const phases = BIND_PHASE_ORDER.map((name) => fakePhase(name))
      await runBind({ archive, tui, phases })
      await archive.kv.persist()

      const persisted = await archive.kv.get<BindState>(KV.bindState, "current")
      assert.ok(persisted, "state should be persisted")
      for (const phase of BIND_PHASE_ORDER) {
        assert.equal(
          persisted.phases[phase].status,
          "completed",
          `${phase} should be completed in persisted state`,
        )
      }
    } finally {
      await archive.shutdown()
    }
  } finally {
    f.cleanup()
  }
})

test("runBind halts on failure and persists the error into bindState", async () => {
  const f = createFixtureHome("runbind-halt")
  try {
    const archive = createYithArchive({ dataDir: f.yithDataDir })
    const { tui } = captureTui()
    const callOrder: BindPhase[] = []

    const phases: PhaseRunner[] = [
      fakePhase("embedding_download", {
        call: () => {
          callOrder.push("embedding_download")
        },
      }),
      fakePhase("claude_transcripts", {
        call: () => {
          callOrder.push("claude_transcripts")
        },
        throws: "simulated failure",
      }),
      fakePhase("opencode_import", {
        call: () => {
          callOrder.push("opencode_import")
        },
      }),
      fakePhase("sisyphus_migrate"),
      fakePhase("preliminary_seed"),
      fakePhase("pending_compression_trigger"),
    ]

    try {
      // runBind should NOT throw — it's designed to report errors
      // into bindState and exit cleanly so the caller can surface
      // them via the TUI. (Re-running the bind resumes from the
      // failed phase automatically.)
      await runBind({ archive, tui, phases })

      // Only phases up to and including the failing one should
      // have run. Phases after the failure are deferred.
      assert.deepEqual(callOrder, [
        "embedding_download",
        "claude_transcripts",
      ])

      await archive.kv.persist()
      const persisted = await archive.kv.get<BindState>(KV.bindState, "current")
      assert.equal(persisted?.phases.embedding_download.status, "completed")
      assert.equal(persisted?.phases.claude_transcripts.status, "failed")
      assert.match(
        persisted?.phases.claude_transcripts.error ?? "",
        /simulated failure/,
      )
      assert.equal(
        persisted?.phases.opencode_import.status,
        "pending",
        "phases after failure should remain pending",
      )
    } finally {
      await archive.shutdown()
    }
  } finally {
    f.cleanup()
  }
})

test("runBind resumes a failed phase on a subsequent call", async () => {
  const f = createFixtureHome("runbind-retry")
  try {
    const archive = createYithArchive({ dataDir: f.yithDataDir })
    const { tui } = captureTui()
    const firstRunCalls: BindPhase[] = []
    const secondRunCalls: BindPhase[] = []
    try {
      // First run: fail at opencode_import.
      const phasesA: PhaseRunner[] = BIND_PHASE_ORDER.map((name) =>
        fakePhase(name, {
          call: () => {
            firstRunCalls.push(name)
          },
          throws: name === "opencode_import" ? "flaky" : undefined,
        }),
      )
      await runBind({ archive, tui, phases: phasesA })
      assert.ok(firstRunCalls.includes("opencode_import"))
      assert.ok(!firstRunCalls.includes("sisyphus_migrate"))

      // Second run: all phases succeed. Expect earlier ones to be
      // skipped (already completed), failed one to retry, and later
      // ones to fire.
      const phasesB: PhaseRunner[] = BIND_PHASE_ORDER.map((name) =>
        fakePhase(name, {
          call: () => {
            secondRunCalls.push(name)
          },
        }),
      )
      await runBind({ archive, tui, phases: phasesB })

      assert.ok(
        !secondRunCalls.includes("embedding_download"),
        "already-completed phase should not re-run",
      )
      assert.ok(
        secondRunCalls.includes("opencode_import"),
        "failed phase should retry",
      )
      assert.ok(
        secondRunCalls.includes("sisyphus_migrate"),
        "later phases should run after retry succeeds",
      )
    } finally {
      await archive.shutdown()
    }
  } finally {
    f.cleanup()
  }
})
