/**
 * Web Research Detector Tests
 * Tests for trigger pattern detection and confidence scoring
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  detectWebResearchNeeded,
  WebResearchTriggerType,
  type WebResearchDetectionResult,
} from "../../src/hooks/web-research-detector.js"

test("web-research-detector", async t => {
  // ─── VERSION CHECK TRIGGERS (MUST confidence) ─────────────────────────────

  await t.test("version check detection (MUST confidence)", async t => {
    await t.test("detects explicit version numbers like v3.5", () => {
      const result = detectWebResearchNeeded("How do I use React v18 features")
      assert.equal(result.confidence, "must")
      assert.equal(result.trigger?.type, WebResearchTriggerType.VERSION_CHECK)
    })

    await t.test("detects semantic versioning like 2.3.0", () => {
      const result = detectWebResearchNeeded("What changed in TypeScript 5.3.0")
      assert.equal(result.confidence, "must")
    })

    await t.test("detects 'latest version' phrase", () => {
      const result = detectWebResearchNeeded("What is the latest version of Next.js")
      assert.equal(result.confidence, "must")
      assert.equal(result.trigger?.type, WebResearchTriggerType.VERSION_CHECK)
    })

    await t.test("detects 'latest release' phrase", () => {
      const result = detectWebResearchNeeded("Show me the latest release of Vite")
      assert.equal(result.confidence, "must")
    })

    await t.test("detects year references like 2024", () => {
      const result = detectWebResearchNeeded("What are best practices in 2024")
      assert.ok(["must", "should"].includes(result.confidence))
      assert.match(result.trigger?.pattern || "", /2024/)
    })
  })

  // ─── FRAMEWORK-SPECIFIC TRIGGERS (SHOULD confidence) ──────────────────────

  await t.test("framework detection (SHOULD confidence)", async t => {
    await t.test("detects React mentions", () => {
      const result = detectWebResearchNeeded("How do I implement hooks in React")
      assert.equal(result.confidence, "should")
      assert.equal(result.trigger?.type, WebResearchTriggerType.FRAMEWORK_SPECIFIC)
    })

    await t.test("detects Vue mentions", () => {
      const result = detectWebResearchNeeded("What's the best way to do reactive state in Vue")
      assert.equal(result.confidence, "should")
    })

    await t.test("detects Next.js mentions", () => {
      const result = detectWebResearchNeeded("How do I use the app router in Next.js")
      assert.equal(result.confidence, "should")
    })

    await t.test("detects TypeScript mentions", () => {
      const result = detectWebResearchNeeded("How do I set up strict TypeScript")
      assert.equal(result.confidence, "should")
    })
  })

  // ─── DATE-SENSITIVE TRIGGERS (MUST confidence) ──────────────────────────────

  await t.test("date-sensitive detection (MUST confidence)", async t => {
    await t.test("detects 'breaking changes' phrase", () => {
      const result = detectWebResearchNeeded("What breaking changes happened")
      assert.equal(result.confidence, "must")
      assert.equal(result.trigger?.type, WebResearchTriggerType.DATE_SENSITIVE)
    })

    await t.test("detects 'what changed' phrase", () => {
      const result = detectWebResearchNeeded("What changed in the latest update")
      assert.equal(result.confidence, "must")
    })

    await t.test("detects 'deprecat' word (deprecation, deprecated)", () => {
      const result = detectWebResearchNeeded("Is this API deprecated")
      assert.equal(result.confidence, "must")
    })

    await t.test("detects 'what's new' phrase", () => {
      const result = detectWebResearchNeeded("What's new in React 19")
      assert.equal(result.confidence, "must")
    })
  })

  // ─── NEGATIVE CASES ───────────────────────────────────────────────────────

  await t.test("negative cases (should not trigger incorrectly)", async t => {
    await t.test("does not trigger on 'my latest project'", () => {
      const result = detectWebResearchNeeded("I built my latest project with React")
      assert.notEqual(result.confidence, "must")
    })

    await t.test("does not trigger on 'the latest trends'", () => {
      const result = detectWebResearchNeeded("What are the latest trends in fashion")
      assert.notEqual(result.confidence, "must")
    })

    await t.test("does not trigger on generic design document", () => {
      const result = detectWebResearchNeeded("Here's my design document")
      assert.equal(result.confidence, "maybe")
    })

    await t.test("has low or no confidence for very short messages", () => {
      const result = detectWebResearchNeeded("hello")
      assert.equal(result.confidence, "maybe")
    })
  })

  // ─── CONFIDENCE TIER ACCURACY ──────────────────────────────────────────────

  await t.test("confidence tier accuracy", async t => {
    await t.test("prioritizes MUST over SHOULD", () => {
      const result = detectWebResearchNeeded("What breaking changes in React v19")
      assert.equal(result.confidence, "must")
    })

    await t.test("returns SHOULD when no MUST triggers match", () => {
      const result = detectWebResearchNeeded("How do I set up Next.js")
      assert.equal(result.confidence, "should")
    })

    await t.test("returns MAYBE for generic questions without triggers", () => {
      const result = detectWebResearchNeeded("Can you help me with my code")
      assert.equal(result.confidence, "maybe")
    })
  })

  // ─── TRIGGER OBJECT STRUCTURE ──────────────────────────────────────────────

  await t.test("trigger object structure", async t => {
    await t.test("includes trigger type, pattern, and context", () => {
      const result = detectWebResearchNeeded("What's new in React v18")
      assert.ok(result.trigger)
      if (result.trigger) {
        assert.ok(result.trigger.type)
        assert.ok(result.trigger.pattern)
      }
    })

    await t.test("includes reason for detection", () => {
      const result = detectWebResearchNeeded("What breaking changes happened")
      assert.ok(result.reason)
      assert.equal(typeof result.reason, "string")
    })
  })

  // ─── EDGE CASES ────────────────────────────────────────────────────────────

  await t.test("edge cases", async t => {
    await t.test("handles mixed case messages", () => {
      const result = detectWebResearchNeeded("WHAT ARE THE LATEST CHANGES IN REACT")
      assert.ok(["must", "should"].includes(result.confidence))
    })

    await t.test("handles multiple frameworks in one message", () => {
      const result = detectWebResearchNeeded("Should I use React or Vue for my project")
      assert.equal(result.confidence, "should")
      assert.equal(result.trigger?.type, WebResearchTriggerType.FRAMEWORK_SPECIFIC)
    })

    await t.test("handles empty string gracefully", () => {
      const result = detectWebResearchNeeded("")
      assert.equal(result.confidence, "maybe")
    })

    await t.test("handles very long messages", () => {
      const longMessage =
        "I have a very long message about many things. " +
        "What breaking changes happened? " +
        "I need to know about React v18."
      const result = detectWebResearchNeeded(longMessage)
      assert.equal(result.confidence, "must")
    })
  })
})
