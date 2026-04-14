/**
 * Web Research Background Execution Tests
 *
 * Tests for advanced pattern detection, background spawning, offline handling
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  spawnBackgroundResearch,
  getBackgroundResearchStatus,
  hasAdvancedResearchPatterns,
  collectResearchTriggers,
  detectAdvancedPatterns,
} from "../../src/features/web-research-background/index.js"
import { AdvancedTriggerType } from "../../src/features/web-research-background/advanced-patterns.js"

test("web-research-background", async t => {
  // ─── ADVANCED PATTERN DETECTION ───────────────────────────────────────────

  await t.test("advanced pattern detection", async t => {
    await t.test("detects tech announcements", () => {
      const matches = detectAdvancedPatterns("Just released React 19 with new features")
      assert.ok(matches.length > 0)
      assert.match(
        String(matches[0].type),
        /TECH_ANNOUNCEMENT|FRAMEWORK_SPECIFIC/
      )
    })

    await t.test("detects CVE patterns", () => {
      const matches = detectAdvancedPatterns("CVE-2024-1234 affects our infrastructure")
      assert.ok(matches.some(m => m.type === AdvancedTriggerType.SECURITY))
      assert.ok(matches.some(m => m.confidence === "must"))
    })

    await t.test("detects vulnerability announcements", () => {
      const matches = detectAdvancedPatterns("Critical vulnerability discovered in OpenSSL")
      assert.ok(matches.some(m => m.type === AdvancedTriggerType.SECURITY))
    })

    await t.test("detects security patches", () => {
      const matches = detectAdvancedPatterns("Security patch released for TypeScript")
      assert.ok(matches.some(m => m.type === AdvancedTriggerType.SECURITY))
    })

    await t.test("detects npm audit patterns", () => {
      const matches = detectAdvancedPatterns("Need to run npm audit on dependencies")
      assert.ok(matches.some(m => m.type === AdvancedTriggerType.NPM_AUDIT))
    })

    await t.test("detects outdated packages", () => {
      const matches = detectAdvancedPatterns("Multiple packages are outdated")
      assert.ok(matches.some(m => m.type === AdvancedTriggerType.NPM_AUDIT))
    })

    await t.test("detects release schedule patterns", () => {
      const matches = detectAdvancedPatterns("Next.js 15 coming soon")
      assert.ok(matches.some(m => m.type === AdvancedTriggerType.RELEASE_SCHEDULE))
    })

    await t.test("detects LTS version mentions", () => {
      const matches = detectAdvancedPatterns("Should upgrade to the LTS version")
      assert.ok(matches.some(m => m.type === AdvancedTriggerType.RELEASE_SCHEDULE))
    })

    await t.test("detects status page patterns", () => {
      const matches = detectAdvancedPatterns("Check status.github.com for updates")
      assert.ok(matches.some(m => m.type === AdvancedTriggerType.STATUS_PAGE))
    })
  })

  // ─── HIGH-CONFIDENCE ADVANCED PATTERNS ────────────────────────────────────

  await t.test("high-confidence pattern detection", async t => {
    await t.test("hasAdvancedResearchPatterns returns true for CVE", () => {
      const hasMust = hasAdvancedResearchPatterns("CVE-2024-99999 affects systems")
      assert.equal(hasMust, true)
    })

    await t.test("hasAdvancedResearchPatterns returns true for vulnerability", () => {
      const hasMust = hasAdvancedResearchPatterns("Zero day vulnerability announced")
      assert.equal(hasMust, true)
    })

    await t.test("hasAdvancedResearchPatterns returns false for normal text", () => {
      const hasMust = hasAdvancedResearchPatterns("How do I create a button component")
      assert.equal(hasMust, false)
    })
  })

  // ─── RESEARCH TRIGGER COLLECTION ─────────────────────────────────────────

  await t.test("research trigger collection", async t => {
    await t.test("combines basic and advanced triggers", () => {
      const basicResult = { trigger: null, confidence: "should" as const }
      const triggers = collectResearchTriggers("NPM audit found CVE-2024-1234", basicResult)

      assert.ok(triggers.advanced.length > 0)
      assert.equal(triggers.basic.confidence, "should")
      assert.equal(triggers.hasMustTrigger, true)
    })

    await t.test("marks hasMustTrigger when basic is must", () => {
      const basicResult = { trigger: null, confidence: "must" as const }
      const triggers = collectResearchTriggers("Some message", basicResult)

      assert.equal(triggers.hasMustTrigger, true)
    })

    await t.test("marks hasMustTrigger when advanced has must", () => {
      const basicResult = { trigger: null, confidence: "maybe" as const }
      const triggers = collectResearchTriggers("CVE-2024-1234", basicResult)

      assert.equal(triggers.hasMustTrigger, true)
    })
  })

  // ─── BACKGROUND RESEARCH SPAWNING ────────────────────────────────────────

  await t.test("background research spawning", async t => {
    await t.test("spawns task for must confidence", async () => {
      const basicResult = { trigger: null, confidence: "must" as const }
      const result = await spawnBackgroundResearch("React v18 features", basicResult, {
        enabled: true,
        timeout_ms: 1000,
      })

      assert.equal(result.success, true)
      assert.ok(result.taskId)
    })

    await t.test("does not spawn for should confidence by default", async () => {
      const basicResult = { trigger: null, confidence: "should" as const }
      const result = await spawnBackgroundResearch("React best practices", basicResult, {
        enabled: true,
        timeout_ms: 1000,
      })

      assert.equal(result.success, false)
    })

    await t.test("respects enabled flag", async () => {
      const basicResult = { trigger: null, confidence: "must" as const }
      const result = await spawnBackgroundResearch("React v18", basicResult, {
        enabled: false,
        timeout_ms: 1000,
      })

      assert.equal(result.success, false)
    })

    await t.test("returns task for status checking", async () => {
      const basicResult = { trigger: null, confidence: "must" as const }
      const spawnResult = await spawnBackgroundResearch("Test message", basicResult, {
        enabled: true,
        timeout_ms: 1000,
      })

      const status = getBackgroundResearchStatus(spawnResult.taskId)
      assert.ok(status)
      assert.equal(status.message, "Test message")
    })

    await t.test("completes task within timeout", async () => {
      const basicResult = { trigger: null, confidence: "must" as const }
      const spawnResult = await spawnBackgroundResearch("Test message", basicResult, {
        enabled: true,
        timeout_ms: 2000,
      })

      // Give it time to complete
      await new Promise(resolve => setTimeout(resolve, 300))

      const status = getBackgroundResearchStatus(spawnResult.taskId)
      assert.ok(status)
      assert.equal(status.completed, true)
    })
  })


  // ─── MULTI-TRIGGER SCENARIOS ─────────────────────────────────────────────

  await t.test("complex trigger scenarios", async t => {
    await t.test("multiple advanced patterns in single message", () => {
      const text = "CVE-2024-1234 vulnerability announced: npm audit required"
      const matches = detectAdvancedPatterns(text)

      // Should detect both CVE and npm audit
      assert.ok(matches.length >= 2)
      const types = matches.map(m => m.type)
      assert.ok(types.includes(AdvancedTriggerType.SECURITY))
      assert.ok(types.includes(AdvancedTriggerType.NPM_AUDIT))
    })

    await t.test("combines with basic web research detection", () => {
      const basicResult = { trigger: null, confidence: "must" as const }
      const triggers = collectResearchTriggers(
        "React v19 just released with breaking changes",
        basicResult,
      )

      assert.ok(triggers.advanced.length > 0)
      assert.equal(triggers.hasMustTrigger, true)
    })
  })
})
