import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync } from "node:fs"

import { createFixtureHome } from "./helpers/fixture-home.js"

/**
 * Canary test — verifies the test harness itself boots and runs,
 * tsx can load the fixture helpers as a TS module, and the fixture
 * creates a real temp directory that gets cleaned up. If this fails,
 * nothing else in the test suite works.
 */
test("test harness boots and fixture HOME is creatable", () => {
  const f = createFixtureHome("smoke")
  try {
    assert.ok(existsSync(f.home), "fixture home dir should exist")
    assert.ok(
      existsSync(f.claudeProjectsDir),
      "~/.claude/projects/ should exist",
    )
    assert.ok(
      existsSync(f.yithDataDir),
      "~/.oh-my-claudecode/yith/ should exist",
    )
    assert.ok(
      f.home.includes("smoke-"),
      "fixture label should prefix the temp dir",
    )
  } finally {
    f.cleanup()
    assert.ok(!existsSync(f.home), "cleanup should remove the fixture dir")
  }
})
