/**
 * Nodens - Advanced Design Capabilities Tests
 *
 * Tests for vision analysis, Figma integration, A11y automation, and Playwright testing
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  analyzeComponentVision,
  extractFigmaTokens,
  generateA11yAuditCode,
  generatePlaywrightTests,
  isVisionEnabled,
  isFigmaEnabled,
  isA11yEnabled,
  isPlaywrightEnabled,
  type NodensAdvancedConfig,
} from "../../src/agents/nodens-advanced.js"

test("nodens-advanced", async t => {
  // ─── VISION ANALYSIS ──────────────────────────────────────────────────────

  await t.test("vision analysis", async t => {
    await t.test("disabled when not configured", async () => {
      const result = await analyzeComponentVision("data:image/png;base64,...", {
        enabled: false,
      })

      assert.equal(result.success, false)
      assert.ok(result.issues?.includes("Vision analysis disabled"))
    })

    await t.test("returns color analysis", async () => {
      const result = await analyzeComponentVision("data:image/png;base64,...", {
        enabled: true,
        capabilities: ["color_analysis"],
      })

      assert.equal(result.success, true)
      assert.ok(result.colors)
      assert.ok(result.colors.dominant.length > 0)
      assert.ok(result.colors.palette.length > 0)
    })

    await t.test("returns typography analysis", async () => {
      const result = await analyzeComponentVision("data:image/png;base64,...", {
        enabled: true,
        capabilities: ["typography"],
      })

      assert.equal(result.success, true)
      assert.ok(result.typography)
      assert.ok(result.typography.families.length > 0)
    })

    await t.test("returns spacing analysis", async () => {
      const result = await analyzeComponentVision("data:image/png;base64,...", {
        enabled: true,
        capabilities: ["spacing"],
      })

      assert.equal(result.success, true)
      assert.ok(result.spacing)
      assert.ok(result.spacing.consistent)
    })

    await t.test("returns layout analysis", async () => {
      const result = await analyzeComponentVision("data:image/png;base64,...", {
        enabled: true,
        capabilities: ["layout"],
      })

      assert.equal(result.success, true)
      assert.ok(result.layout)
      assert.ok(["flex", "grid", "responsive"].includes(result.layout.type))
    })

    await t.test("analyzes contrast ratios", async () => {
      const result = await analyzeComponentVision("data:image/png;base64,...", {
        enabled: true,
      })

      assert.equal(result.success, true)
      assert.ok(result.colors?.contrast)
      assert.ok(result.colors.contrast.length > 0)
      assert.ok(result.colors.contrast[0].ratio > 0)
    })
  })

  // ─── FIGMA INTEGRATION ────────────────────────────────────────────────────

  await t.test("figma integration", async t => {
    await t.test("disabled when not configured", async () => {
      const result = await extractFigmaTokens(
        "https://www.figma.com/file/abc123/Design",
        { enabled: false },
      )

      assert.equal(result.success, false)
      assert.ok(result.issues?.includes("Figma integration disabled"))
    })

    await t.test("extracts file ID from URL", async () => {
      const result = await extractFigmaTokens(
        "https://www.figma.com/file/abc123/Design",
        { enabled: true },
      )

      assert.equal(result.success, true)
      assert.equal(result.fileId, "abc123")
    })

    await t.test("rejects invalid Figma URL", async () => {
      const result = await extractFigmaTokens("https://example.com", {
        enabled: true,
      })

      assert.equal(result.success, false)
      assert.ok(result.issues?.includes("Invalid Figma URL format"))
    })

    await t.test("extracts color tokens", async () => {
      const result = await extractFigmaTokens(
        "https://www.figma.com/file/abc123/Design",
        { enabled: true },
      )

      assert.equal(result.success, true)
      assert.ok(result.colors)
      assert.ok(result.colors.length > 0)
      assert.ok(result.colors[0].category === "color")
    })

    await t.test("extracts typography tokens", async () => {
      const result = await extractFigmaTokens(
        "https://www.figma.com/file/abc123/Design",
        { enabled: true },
      )

      assert.equal(result.success, true)
      assert.ok(result.typography)
      assert.ok(result.typography.length > 0)
      assert.ok(result.typography[0].category === "typography")
    })

    await t.test("extracts spacing tokens", async () => {
      const result = await extractFigmaTokens(
        "https://www.figma.com/file/abc123/Design",
        { enabled: true },
      )

      assert.equal(result.success, true)
      assert.ok(result.spacing)
      assert.ok(result.spacing.length > 0)
    })

    await t.test("extracts component definitions", async () => {
      const result = await extractFigmaTokens(
        "https://www.figma.com/file/abc123/Design",
        { enabled: true },
      )

      assert.equal(result.success, true)
      assert.ok(result.components)
      assert.ok(result.components.length > 0)
      assert.ok(result.components[0].variants)
    })
  })

  // ─── A11y AUTOMATION ──────────────────────────────────────────────────────

  await t.test("a11y automation", async t => {
    await t.test("disabled when not configured", async () => {
      const result = await generateA11yAuditCode("Button", { enabled: false })

      assert.equal(result.success, false)
      assert.equal(result.wcagAACompliant, false)
    })

    await t.test("generates test code", async () => {
      const result = await generateA11yAuditCode("Button", {
        enabled: true,
      })

      assert.equal(result.success, true)
      assert.ok(result.testCode)
      assert.ok(result.testCode.includes("@playwright/test"))
      assert.ok(result.testCode.includes("axe-playwright"))
    })

    await t.test("includes WCAG level in tests", async () => {
      const result = await generateA11yAuditCode("Button", {
        enabled: true,
        wcagLevel: "AAA",
      })

      assert.equal(result.success, true)
      assert.ok(result.testCode?.includes("AAA"))
    })

    await t.test("includes keyboard navigation tests", async () => {
      const result = await generateA11yAuditCode("Button", {
        enabled: true,
      })

      assert.equal(result.success, true)
      assert.ok(result.testCode?.includes("Keyboard navigation"))
    })

    await t.test("includes screen reader tests", async () => {
      const result = await generateA11yAuditCode("Button", {
        enabled: true,
      })

      assert.equal(result.success, true)
      assert.ok(result.testCode?.includes("Screen reader compatibility"))
    })

    await t.test("includes contrast tests", async () => {
      const result = await generateA11yAuditCode("Button", {
        enabled: true,
      })

      assert.equal(result.success, true)
      assert.ok(result.testCode?.includes("Color contrast"))
    })

    await t.test("marks WCAG AA compliance", async () => {
      const result = await generateA11yAuditCode("Button", {
        enabled: true,
        wcagLevel: "AA",
      })

      assert.equal(result.success, true)
      assert.equal(result.wcagAACompliant, true)
    })
  })

  // ─── PLAYWRIGHT TEST GENERATION ───────────────────────────────────────────

  await t.test("playwright test generation", async t => {
    await t.test("generates visual tests", () => {
      const tests = generatePlaywrightTests("Button", {
        enabled: true,
        generateVisualTests: true,
      })

      assert.ok(tests.visualTests)
      assert.ok(tests.visualTests.includes("Visual Regression"))
      assert.ok(tests.visualTests.includes("default state"))
      assert.ok(tests.visualTests.includes("hover state"))
    })

    await t.test("generates interaction tests", () => {
      const tests = generatePlaywrightTests("Button", {
        enabled: true,
        generateInteractionTests: true,
      })

      assert.ok(tests.interactionTests)
      assert.ok(tests.interactionTests.includes("Interactions"))
      assert.ok(tests.interactionTests.includes("click triggers action"))
      assert.ok(tests.interactionTests.includes("disabled state"))
    })

    await t.test("generates responsive tests", () => {
      const tests = generatePlaywrightTests("Button", {
        enabled: true,
        generateResponsiveTests: true,
      })

      assert.ok(tests.responsiveTests)
      assert.ok(tests.responsiveTests.includes("Responsive Design"))
      assert.ok(tests.responsiveTests.includes("mobile"))
      assert.ok(tests.responsiveTests.includes("tablet"))
      assert.ok(tests.responsiveTests.includes("desktop"))
    })

    await t.test("respects custom breakpoints", () => {
      const tests = generatePlaywrightTests("Button", {
        enabled: true,
        breakpoints: { sm: 320, md: 768, lg: 1440 },
      })

      assert.ok(tests.responsiveTests.includes("320"))
      assert.ok(tests.responsiveTests.includes("768"))
      assert.ok(tests.responsiveTests.includes("1440"))
    })

    await t.test("includes focus state testing", () => {
      const tests = generatePlaywrightTests("Button", {
        enabled: true,
      })

      assert.ok(tests.visualTests.includes("focus state"))
    })

    await t.test("includes loading state testing", () => {
      const tests = generatePlaywrightTests("Button", {
        enabled: true,
      })

      assert.ok(tests.interactionTests.includes("loading state"))
    })
  })

  // ─── CONFIGURATION CHECKS ────────────────────────────────────────────────

  await t.test("configuration checks", async t => {
    await t.test("isVisionEnabled returns true when configured", () => {
      const config: ArtisanAdvancedConfig = {
        vision: { enabled: true },
      }
      assert.equal(isVisionEnabled(config), true)
    })

    await t.test("isVisionEnabled returns false when disabled", () => {
      const config: ArtisanAdvancedConfig = {
        vision: { enabled: false },
      }
      assert.equal(isVisionEnabled(config), false)
    })

    await t.test("isFigmaEnabled returns true when configured", () => {
      const config: ArtisanAdvancedConfig = {
        figma: { enabled: true },
      }
      assert.equal(isFigmaEnabled(config), true)
    })

    await t.test("isA11yEnabled returns true when configured", () => {
      const config: ArtisanAdvancedConfig = {
        a11y: { enabled: true },
      }
      assert.equal(isA11yEnabled(config), true)
    })

    await t.test("isPlaywrightEnabled returns true when configured", () => {
      const config: ArtisanAdvancedConfig = {
        playwright: { enabled: true },
      }
      assert.equal(isPlaywrightEnabled(config), true)
    })

    await t.test("all checks return false when config is undefined", () => {
      assert.equal(isVisionEnabled(), false)
      assert.equal(isFigmaEnabled(), false)
      assert.equal(isA11yEnabled(), false)
      assert.equal(isPlaywrightEnabled(), false)
    })
  })

  // ─── COMBINED WORKFLOWS ──────────────────────────────────────────────────

  await t.test("combined design workflows", async t => {
    await t.test("full design system extraction", async () => {
      const config: ArtisanAdvancedConfig = {
        figma: { enabled: true },
        a11y: { enabled: true },
        playwright: { enabled: true },
      }

      const tokens = await extractFigmaTokens(
        "https://www.figma.com/file/abc123/DesignSystem",
        config.figma,
      )
      assert.equal(tokens.success, true)

      const a11y = await generateA11yAuditCode("Button", config.a11y)
      assert.equal(a11y.success, true)

      const tests = generatePlaywrightTests("Button", config.playwright)
      assert.ok(tests.visualTests.length > 0)
      assert.ok(tests.interactionTests.length > 0)
    })

    await t.test("component design review workflow", async () => {
      const config: ArtisanAdvancedConfig = {
        vision: { enabled: true, capabilities: ["color_analysis", "spacing"] },
        a11y: { enabled: true, wcagLevel: "AA" },
      }

      const vision = await analyzeComponentVision("data:image/png;base64,...", config.vision)
      assert.equal(vision.success, true)

      const a11y = await generateA11yAuditCode("Card", config.a11y)
      assert.equal(a11y.success, true)
    })
  })
})
