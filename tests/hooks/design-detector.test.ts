/**
 * Design Task Detector Tests
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  detectDesignTask,
  findDesignKeywords,
  type DesignDetectionResult,
} from "../../src/hooks/design-detector.js"

test("design-detector", async t => {
  // ─── HIGH CONFIDENCE KEYWORDS ─────────────────────────────────────────────

  await t.test("HIGH confidence design keywords", async t => {
    await t.test("detects 'design a component' as high confidence", () => {
      const result = detectDesignTask("Design a React component")
      assert.equal(result.isDesignTask, true)
      assert.equal(result.confidence, "high")
    })

    await t.test("detects 'create a button' as high confidence", () => {
      const result = detectDesignTask("Create a button component")
      assert.equal(result.isDesignTask, true)
      assert.equal(result.confidence, "high")
    })

    await t.test("detects 'card component' as high confidence", () => {
      const result = detectDesignTask("Build a card component")
      assert.equal(result.isDesignTask, true)
      assert.equal(result.confidence, "high")
    })

    await t.test("detects 'form design' as high confidence", () => {
      const result = detectDesignTask("Design a form")
      assert.equal(result.isDesignTask, true)
      assert.equal(result.confidence, "high")
    })

    await t.test("includes matched keywords in result", () => {
      const result = detectDesignTask("Design a button component")
      assert.ok(result.keywords.length > 0)
      const hasButton = result.keywords.some(k => k.includes("button"))
      assert.equal(hasButton, true)
    })
  })

  // ─── MEDIUM CONFIDENCE KEYWORDS ────────────────────────────────────────────

  await t.test("MEDIUM confidence detection (needs 2+ keywords)", async t => {
    await t.test("detects 'React button' as medium/high confidence", () => {
      const result = detectDesignTask("Build a React button")
      assert.equal(result.isDesignTask, true)
      assert.ok(["medium", "high"].includes(result.confidence))
    })

    await t.test("detects 'Vue component styling' as medium confidence", () => {
      const result = detectDesignTask("Style a Vue component")
      assert.equal(result.isDesignTask, true)
    })

    await t.test("detects 'dark mode' toggle as design task", () => {
      const result = detectDesignTask("Add dark mode support")
      assert.equal(result.isDesignTask, true)
    })

    await t.test("detects 'animation' additions as design task", () => {
      const result = detectDesignTask("Add animations to the UI")
      assert.equal(result.isDesignTask, true)
    })
  })

  // ─── NEGATIVE CASES ───────────────────────────────────────────────────────

  await t.test("negative cases (should NOT be design tasks)", async t => {
    await t.test("does not trigger on 'design document'", () => {
      const result = detectDesignTask("Here's my design document")
      assert.equal(result.isDesignTask, false)
    })

    await t.test("does not trigger on 'design system' (architecture)", () => {
      const result = detectDesignTask("System design for a database")
      assert.equal(result.isDesignTask, false)
    })

    await t.test("does not trigger on 'API design'", () => {
      const result = detectDesignTask("API design patterns")
      assert.equal(result.isDesignTask, false)
    })

    await t.test("does not trigger on 'database design'", () => {
      const result = detectDesignTask("Design a relational database")
      assert.equal(result.isDesignTask, false)
    })

    await t.test("does not trigger on very short messages", () => {
      const result = detectDesignTask("hello")
      assert.equal(result.isDesignTask, false)
    })

    await t.test("does not trigger on non-design messages", () => {
      const result = detectDesignTask("Fix this bug in my code")
      assert.equal(result.isDesignTask, false)
    })
  })

  // ─── CASE INSENSITIVITY ────────────────────────────────────────────────────

  await t.test("case insensitivity", async t => {
    await t.test("matches uppercase keywords", () => {
      const result = detectDesignTask("DESIGN A BUTTON")
      assert.equal(result.isDesignTask, true)
    })

    await t.test("matches mixed case keywords", () => {
      const result = detectDesignTask("Design a Component")
      assert.equal(result.isDesignTask, true)
    })

    await t.test("matches lowercase keywords", () => {
      const result = detectDesignTask("design a card")
      assert.equal(result.isDesignTask, true)
    })
  })

  // ─── KEYWORD MATCHING ──────────────────────────────────────────────────────

  await t.test("keyword matching", async t => {
    await t.test("returns matched keywords in result", () => {
      const result = detectDesignTask("Design a React component")
      assert.ok(result.keywords.length > 0)
    })

    await t.test("matches whole words only", () => {
      const result = detectDesignTask("Create a button")
      const hasButton = result.keywords.some(k => k === "button")
      assert.equal(hasButton, true)
    })
  })

  // ─── CONFIDENCE LEVELS ─────────────────────────────────────────────────────

  await t.test("confidence level accuracy", async t => {
    await t.test("returns high confidence for direct component keywords", () => {
      const result = detectDesignTask("Build a button component")
      assert.equal(result.confidence, "high")
    })

    await t.test("returns medium confidence for framework + design", () => {
      const result = detectDesignTask("React component design")
      assert.ok(["high", "medium"].includes(result.confidence))
    })

    await t.test("returns false for low signals", () => {
      const result = detectDesignTask("Can you help me build something")
      assert.equal(result.isDesignTask, false)
    })
  })

  // ─── REASON FIELD ─────────────────────────────────────────────────────────

  await t.test("reason field", async t => {
    await t.test("includes reason in result", () => {
      const result = detectDesignTask("Design a button")
      assert.ok(result.reason)
      assert.equal(typeof result.reason, "string")
    })
  })

  // ─── FRAMEWORK DETECTION ──────────────────────────────────────────────────

  await t.test("framework-specific detection", async t => {
    await t.test("detects React design tasks", () => {
      const result = detectDesignTask("React component")
      assert.equal(result.isDesignTask, true)
    })

    await t.test("detects Vue design tasks", () => {
      const result = detectDesignTask("Vue styling")
      assert.equal(result.isDesignTask, true)
    })

    await t.test("detects Svelte design tasks", () => {
      const result = detectDesignTask("Svelte animation")
      assert.equal(result.isDesignTask, true)
    })

    await t.test("detects Next.js design tasks", () => {
      const result = detectDesignTask("Next.js design")
      assert.equal(result.isDesignTask, true)
    })
  })

  // ─── ACCESSIBILITY KEYWORDS ───────────────────────────────────────────────

  await t.test("accessibility-specific keywords", async t => {
    await t.test("detects accessibility task", () => {
      const result = detectDesignTask("Add accessibility")
      assert.equal(result.isDesignTask, true)
    })

    await t.test("detects WCAG compliance task", () => {
      const result = detectDesignTask("Ensure WCAG compliance")
      assert.equal(result.isDesignTask, true)
    })

    await t.test("detects ARIA labels task", () => {
      const result = detectDesignTask("Add ARIA labels")
      assert.equal(result.isDesignTask, true)
    })

    await t.test("detects semantic HTML task", () => {
      const result = detectDesignTask("Use semantic HTML")
      assert.equal(result.isDesignTask, true)
    })

    await t.test("detects screen reader task", () => {
      const result = detectDesignTask("Test with screen reader")
      assert.equal(result.isDesignTask, true)
    })
  })

  // ─── STYLING KEYWORDS ──────────────────────────────────────────────────────

  await t.test("styling and layout keywords", async t => {
    await t.test("detects Tailwind styling task", () => {
      const result = detectDesignTask("Use Tailwind")
      assert.equal(result.isDesignTask, true)
    })

    await t.test("detects responsive grid task", () => {
      const result = detectDesignTask("Create a responsive grid")
      assert.equal(result.isDesignTask, true)
    })

    await t.test("detects flexbox layout task", () => {
      const result = detectDesignTask("Use flexbox for layout")
      assert.equal(result.isDesignTask, true)
    })
  })

  // ─── EDGE CASES ────────────────────────────────────────────────────────────

  await t.test("edge cases", async t => {
    await t.test("handles empty string", () => {
      const result = detectDesignTask("")
      assert.equal(result.isDesignTask, false)
    })

    await t.test("handles whitespace-only string", () => {
      const result = detectDesignTask("   ")
      assert.equal(result.isDesignTask, false)
    })

    await t.test("handles very long message", () => {
      const longMsg =
        "I want to design a component that is " +
        "a button with multiple variants and " +
        "supports responsive design and accessibility"
      const result = detectDesignTask(longMsg)
      assert.equal(result.isDesignTask, true)
      assert.equal(result.confidence, "high")
    })

    await t.test("handles message with punctuation", () => {
      const result = detectDesignTask("Design a button! Can you make it responsive?")
      assert.equal(result.isDesignTask, true)
    })
  })

  // ─── findDesignKeywords FUNCTION ──────────────────────────────────────────

  await t.test("findDesignKeywords utility function", async t => {
    await t.test("returns matched keywords", () => {
      const keywords = findDesignKeywords("Design a React button")
      assert.ok(keywords.length > 0)
    })

    await t.test("returns empty array when no keywords found", () => {
      const keywords = findDesignKeywords("The weather is nice today")
      assert.equal(keywords.length, 0)
    })

    await t.test("prioritizes high confidence keywords", () => {
      const keywords = findDesignKeywords("Design a button with React")
      const hasHighConfidence = keywords.some(k => ["design", "button"].includes(k))
      assert.equal(hasHighConfidence, true)
    })
  })

  // ─── COMPREHENSIVE SCENARIOS ──────────────────────────────────────────────

  await t.test("comprehensive real-world scenarios", async t => {
    await t.test("detects complex design request", () => {
      const message =
        "I need to build a React component that's a responsive card " +
        "with buttons and proper WCAG accessibility support"
      const result = detectDesignTask(message)
      assert.equal(result.isDesignTask, true)
      assert.equal(result.confidence, "high")
    })

    await t.test("detects styling request", () => {
      const message =
        "Can you help me style a Next.js app with Tailwind and " +
        "make it dark mode compatible"
      const result = detectDesignTask(message)
      assert.equal(result.isDesignTask, true)
    })

    await t.test("does not trigger on unrelated code request", () => {
      const message =
        "Fix this API endpoint and add error handling. " +
        "Also update the database schema."
      const result = detectDesignTask(message)
      assert.equal(result.isDesignTask, false)
    })
  })
})
