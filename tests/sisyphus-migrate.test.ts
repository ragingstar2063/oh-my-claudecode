import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { createFixtureHome } from "./helpers/fixture-home.js"
import { migrateSisyphusDir } from "../src/cli/sisyphus-migrate.js"

/**
 * Tests for the `.sisyphus/` → `.elder-gods/` filesystem migrator.
 *
 * The function is a pure file operation: given a source and dest
 * directory, copy + translate contents. No KV, no network, no
 * process spawning. Every test uses a scratch fixture that gets
 * cleaned up in its finally block.
 */

function buildSisyphusFixture(root: string): string {
  const sis = join(root, ".sisyphus")
  mkdirSync(join(sis, "plans"), { recursive: true })
  mkdirSync(join(sis, "evidence"), { recursive: true })
  mkdirSync(join(sis, "notepads"), { recursive: true })
  mkdirSync(join(sis, "drafts"), { recursive: true })

  writeFileSync(
    join(sis, "boulder.json"),
    JSON.stringify(
      {
        active_plan: "/path/to/plans/fix-auth.md",
        started_at: "2026-04-01T10:00:00Z",
        session_ids: ["ses_abc123", "ses_def456"],
        plan_name: "fix-auth",
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(sis, "plans", "fix-auth.md"),
    "# Fix auth middleware\n\nPlan body here.\n",
  )
  writeFileSync(
    join(sis, "plans", "rewrite-ui.md"),
    "# Rewrite UI\n\nAnother plan.\n",
  )
  writeFileSync(
    join(sis, "evidence", "task-1-pass.md"),
    "Task 1 verification: all tests passed.\n",
  )
  writeFileSync(
    join(sis, "evidence", "task-2-fail.txt"),
    "Task 2 output:\nERROR: something broke\n",
  )
  writeFileSync(
    join(sis, "handoff.md"),
    "# Handoff — fix-auth session\n\nHand this off to Cthulhu.\n",
  )
  writeFileSync(
    join(sis, "notepads", "scratch.md"),
    "Random notes I took during the session.\n",
  )
  return sis
}

test("migrateSisyphusDir copies plans 1:1 into .elder-gods/plans/", () => {
  const f = createFixtureHome("sis-plans")
  try {
    const src = buildSisyphusFixture(f.home)
    const dst = join(f.home, ".elder-gods")

    const result = migrateSisyphusDir({ source: src, dest: dst })

    assert.equal(result.plansCopied, 2)
    assert.ok(existsSync(join(dst, "plans", "fix-auth.md")))
    assert.ok(existsSync(join(dst, "plans", "rewrite-ui.md")))
    const body = readFileSync(join(dst, "plans", "fix-auth.md"), "utf-8")
    assert.match(body, /Fix auth middleware/)
  } finally {
    f.cleanup()
  }
})

test("migrateSisyphusDir converts handoff.md into handoffs/<date>-<slug>.md", () => {
  const f = createFixtureHome("sis-handoff")
  try {
    const src = buildSisyphusFixture(f.home)
    const dst = join(f.home, ".elder-gods")

    const result = migrateSisyphusDir({ source: src, dest: dst })

    assert.equal(result.handoffsCopied, 1)
    // Should end up under handoffs/ with a date prefix.
    const handoffs = join(dst, "handoffs")
    assert.ok(existsSync(handoffs))
    const entries = readdirSync(handoffs)
    assert.equal(entries.length, 1)
    assert.match(
      entries[0],
      /^\d{4}-\d{2}-\d{2}-.*\.md$/,
      `handoff filename should be YYYY-MM-DD-<slug>.md, got ${entries[0]}`,
    )
  } finally {
    f.cleanup()
  }
})

test("migrateSisyphusDir copies evidence/ recursively", () => {
  const f = createFixtureHome("sis-evidence")
  try {
    const src = buildSisyphusFixture(f.home)
    const dst = join(f.home, ".elder-gods")

    const result = migrateSisyphusDir({ source: src, dest: dst })

    assert.equal(result.evidenceCopied, 2)
    assert.ok(existsSync(join(dst, "evidence", "task-1-pass.md")))
    assert.ok(existsSync(join(dst, "evidence", "task-2-fail.txt")))
  } finally {
    f.cleanup()
  }
})

test("migrateSisyphusDir writes boulder.json into a synthesized memory file", () => {
  const f = createFixtureHome("sis-boulder")
  try {
    const src = buildSisyphusFixture(f.home)
    const dst = join(f.home, ".elder-gods")

    const result = migrateSisyphusDir({ source: src, dest: dst })
    assert.ok(result.boulderImported, "boulder.json should be imported")

    // Should land in plans/ or memories/ with the content as a note.
    // Accept either location — the mapping is documented in the
    // function, and we just care the data is preserved somewhere
    // accessible.
    const candidate = join(dst, "plans", "legacy-boulder.md")
    assert.ok(existsSync(candidate), `expected ${candidate}`)
    const body = readFileSync(candidate, "utf-8")
    assert.match(body, /fix-auth/)
    assert.match(body, /ses_abc123/)
  } finally {
    f.cleanup()
  }
})

test("migrateSisyphusDir leaves source dir intact (non-destructive)", () => {
  const f = createFixtureHome("sis-nondestructive")
  try {
    const src = buildSisyphusFixture(f.home)
    const dst = join(f.home, ".elder-gods")

    migrateSisyphusDir({ source: src, dest: dst })

    // Source must still exist with all files.
    assert.ok(existsSync(src))
    assert.ok(existsSync(join(src, "boulder.json")))
    assert.ok(existsSync(join(src, "plans", "fix-auth.md")))
  } finally {
    f.cleanup()
  }
})

test("migrateSisyphusDir is idempotent — second run reports zero copies", () => {
  const f = createFixtureHome("sis-idempotent")
  try {
    const src = buildSisyphusFixture(f.home)
    const dst = join(f.home, ".elder-gods")

    const first = migrateSisyphusDir({ source: src, dest: dst })
    assert.ok(first.plansCopied > 0)

    const second = migrateSisyphusDir({ source: src, dest: dst })
    assert.equal(second.plansCopied, 0, "plans already copied")
    assert.equal(second.handoffsCopied, 0, "handoff already copied")
    assert.equal(second.evidenceCopied, 0, "evidence already copied")
  } finally {
    f.cleanup()
  }
})

test("migrateSisyphusDir returns zero counts when source doesn't exist", () => {
  const f = createFixtureHome("sis-missing")
  try {
    const src = join(f.home, "nonexistent-dir")
    const dst = join(f.home, ".elder-gods")
    const result = migrateSisyphusDir({ source: src, dest: dst })
    assert.equal(result.plansCopied, 0)
    assert.equal(result.handoffsCopied, 0)
    assert.equal(result.evidenceCopied, 0)
    assert.ok(!result.boulderImported)
    assert.equal(result.skipped, true)
  } finally {
    f.cleanup()
  }
})
