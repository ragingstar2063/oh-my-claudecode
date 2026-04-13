import { strict as assert } from "assert"
import { test } from "node:test"
import {
  WEB_RESEARCH_DETECTOR_HOOK_SCRIPT,
  getWebResearchDetectorHookConfig,
} from "../../src/hooks/web-research-hook.js"
import { ALL_HOOK_DEFINITIONS } from "../../src/hooks/index.js"

test("web-research-detector hook integration", async (t) => {
  await t.test("hook script has bash shebang", () => {
    assert(WEB_RESEARCH_DETECTOR_HOOK_SCRIPT.includes("#!/usr/bin/env bash"))
  })

  await t.test("hook script sets pipefail", () => {
    assert(WEB_RESEARCH_DETECTOR_HOOK_SCRIPT.includes("set -euo pipefail"))
  })

  await t.test("hook script detects version patterns", () => {
    assert(WEB_RESEARCH_DETECTOR_HOOK_SCRIPT.includes("v[0-9]"))
  })

  await t.test("hook script detects date-sensitive patterns", () => {
    assert(
      WEB_RESEARCH_DETECTOR_HOOK_SCRIPT.includes("breaking") ||
        WEB_RESEARCH_DETECTOR_HOOK_SCRIPT.includes("what.?s\\s+new")
    )
  })

  await t.test("hook script outputs enforcement message on match", () => {
    assert(
      WEB_RESEARCH_DETECTOR_HOOK_SCRIPT.includes(
        "[WEB RESEARCH ENFORCEMENT]"
      )
    )
  })

  await t.test("getWebResearchDetectorHookConfig returns valid config", () => {
    const config = getWebResearchDetectorHookConfig()
    assert(config !== null && typeof config === "object")
    assert("hooks" in config)
  })

  await t.test(
    "web-research-detector is registered in ALL_HOOK_DEFINITIONS",
    () => {
      const hook = ALL_HOOK_DEFINITIONS.find((h) => h.name === "web-research-detector")
      assert(hook !== undefined)
      assert.equal(hook.event, "PreToolUse")
      assert(hook.scriptPath.includes("web-research-detector.sh"))
      assert(hook.scriptContent.length > 0)
    }
  )

  await t.test("web-research-detector hook is not disabled by default", () => {
    const hook = ALL_HOOK_DEFINITIONS.find((h) => h.name === "web-research-detector")
    assert(hook !== undefined, "Hook should be registered")
  })
})
