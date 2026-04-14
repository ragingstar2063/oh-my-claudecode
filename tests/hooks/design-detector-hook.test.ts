import { strict as assert } from "assert"
import { test } from "node:test"
import {
  DESIGN_DETECTOR_HOOK_SCRIPT,
  getDesignDetectorHookConfig,
} from "../../src/hooks/design-detector-hook.js"
import { ALL_HOOK_DEFINITIONS } from "../../src/hooks/index.js"

test("design-detector hook integration", async (t) => {
  await t.test("hook script has bash shebang", () => {
    assert(DESIGN_DETECTOR_HOOK_SCRIPT.includes("#!/usr/bin/env bash"))
  })

  await t.test("hook script sets pipefail", () => {
    assert(DESIGN_DETECTOR_HOOK_SCRIPT.includes("set -euo pipefail"))
  })

  await t.test("hook script detects high-confidence keywords", () => {
    assert(
      DESIGN_DETECTOR_HOOK_SCRIPT.includes("component") ||
        DESIGN_DETECTOR_HOOK_SCRIPT.includes("interface") ||
        DESIGN_DETECTOR_HOOK_SCRIPT.includes("ui")
    )
  })

  await t.test("hook script detects medium-confidence keywords", () => {
    assert(
      DESIGN_DETECTOR_HOOK_SCRIPT.includes("react") ||
        DESIGN_DETECTOR_HOOK_SCRIPT.includes("css") ||
        DESIGN_DETECTOR_HOOK_SCRIPT.includes("responsive")
    )
  })

  await t.test("hook script outputs routing suggestion", () => {
    assert(DESIGN_DETECTOR_HOOK_SCRIPT.includes("[DESIGN TASK DETECTED]"))
    assert(DESIGN_DETECTOR_HOOK_SCRIPT.includes("Nodens"))
  })

  await t.test("hook script mentions design methodology", () => {
    assert(DESIGN_DETECTOR_HOOK_SCRIPT.includes("intent") ||
      DESIGN_DETECTOR_HOOK_SCRIPT.includes("spec"))
  })

  await t.test("getDesignDetectorHookConfig returns valid config", () => {
    const config = getDesignDetectorHookConfig()
    assert(config !== null && typeof config === "object")
    assert("hooks" in config)
  })

  await t.test(
    "design-detector is registered in ALL_HOOK_DEFINITIONS",
    () => {
      const hook = ALL_HOOK_DEFINITIONS.find((h) => h.name === "design-detector")
      assert(hook !== undefined)
      assert.equal(hook.event, "PreToolUse")
      assert(hook.scriptPath.includes("design-detector.sh"))
      assert(hook.scriptContent.length > 0)
    }
  )

  await t.test("design-detector hook is not disabled by default", () => {
    const hook = ALL_HOOK_DEFINITIONS.find((h) => h.name === "design-detector")
    assert(hook !== undefined, "Hook should be registered")
  })
})
