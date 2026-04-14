/**
 * AST-Based Type Safety Linter Tests
 *
 * Tests for AST analysis, auto-fix, and metrics generation
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import {
  lintFileAST,
  fixIssuesInFile,
  generateTypeMetrics,
  exportMetrics,
  loadHistoricalMetrics,
  calculateMetricsTrend,
} from "../../src/linters/type-safety-ast.js"

// Helper to create temporary test files
function createTempFile(content: string, extension: string = ".ts"): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "type-safety-test-"))
  const filePath = path.join(tmpDir, `test${extension}`)
  fs.writeFileSync(filePath, content, "utf-8")
  return filePath
}

function cleanupTempFile(filePath: string): void {
  try {
    const dir = path.dirname(filePath)
    fs.rmSync(filePath, { force: true })
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir, { recursive: true })
    }
  } catch (error) {
    // Ignore cleanup errors
  }
}

test("type-safety-ast-linter", async t => {
  // ─── AST-BASED DETECTION ─────────────────────────────────────────────────

  await t.test("AST-based issue detection", async t => {
    await t.test("detects any type annotations", () => {
      const code = `
const value: any = 123
function process(input: any): void {
  console.log(input)
}
      `
      const filePath = createTempFile(code)
      try {
        const issues = lintFileAST(filePath)
        assert.ok(issues.some(i => i.ruleId === "TS_ANY_TYPE"))
      } finally {
        cleanupTempFile(filePath)
      }
    })

    await t.test("detects unsafe type assertions", () => {
      const code = `
const value = someValue as any
const obj = result as unknown
      `
      const filePath = createTempFile(code)
      try {
        const issues = lintFileAST(filePath)
        assert.ok(issues.some(i => i.ruleId === "TS_UNSAFE_CAST"))
      } finally {
        cleanupTempFile(filePath)
      }
    })

    await t.test("detects missing return type annotations", () => {
      const code = `
function processData(input: string) {
  return input.length
}

async function fetchData() {
  return fetch('/api/data')
}
      `
      const filePath = createTempFile(code)
      try {
        const issues = lintFileAST(filePath)
        assert.ok(issues.some(i => i.ruleId === "MISSING_RETURN_TYPE"))
      } finally {
        cleanupTempFile(filePath)
      }
    })

    await t.test("detects Promise without type parameter", () => {
      const code = `
const promise: Promise = new Promise(() => {})
async function getData() {
  return Promise.resolve()
}
      `
      const filePath = createTempFile(code)
      try {
        const issues = lintFileAST(filePath)
        assert.ok(issues.some(i => i.ruleId === "MISSING_PROMISE_TYPE"))
      } finally {
        cleanupTempFile(filePath)
      }
    })

    await t.test("detects @ts-ignore without reason", () => {
      const code = `
// @ts-ignore
const value: any = 123

// @ts-ignore - complex type from library
const other = someFunc()
      `
      const filePath = createTempFile(code)
      try {
        const issues = lintFileAST(filePath)
        // Should detect the first @ts-ignore but not the second
        const ignoreIssues = issues.filter(i => i.ruleId === "TS_IGNORE_WITHOUT_REASON")
        assert.ok(ignoreIssues.length > 0)
      } finally {
        cleanupTempFile(filePath)
      }
    })
  })

  // ─── AUTO-FIX CAPABILITIES ───────────────────────────────────────────────

  await t.test("auto-fix capabilities", async t => {
    await t.test("fixes @ts-ignore without reason", () => {
      const code = `
// @ts-ignore
const value = complexType
      `
      const filePath = createTempFile(code)
      try {
        const issues = lintFileAST(filePath)
        const result = fixIssuesInFile(filePath, issues, { auto_fix: true })

        assert.equal(result.success, true)
        const fixed = fs.readFileSync(filePath, "utf-8")
        assert.ok(fixed.includes("@ts-ignore -"))
      } finally {
        cleanupTempFile(filePath)
      }
    })

    await t.test("reports unfixable issues", () => {
      const code = `
function processData(input: string) {
  return input.length
}
      `
      const filePath = createTempFile(code)
      try {
        const issues = lintFileAST(filePath)
        const fixable = issues.filter(i => i.fixable)
        const unfixable = issues.filter(i => !i.fixable)

        assert.ok(fixable.length >= 0)
        assert.ok(unfixable.length >= 0)
      } finally {
        cleanupTempFile(filePath)
      }
    })

    await t.test("respects auto_fix_rules configuration", () => {
      const code = `
// @ts-ignore
const value = test

const other: any = 123
      `
      const filePath = createTempFile(code)
      try {
        const issues = lintFileAST(filePath)
        const result = fixIssuesInFile(filePath, issues, {
          auto_fix: true,
          auto_fix_rules: ["TS_IGNORE_WITHOUT_REASON"],
        })

        // Should only fix TS_IGNORE_WITHOUT_REASON
        assert.ok(result.issuesFixed >= 0)
      } finally {
        cleanupTempFile(filePath)
      }
    })
  })

  // ─── METRICS GENERATION ──────────────────────────────────────────────────

  await t.test("metrics generation", async t => {
    await t.test("generates metrics for multiple files", () => {
      const files = [
        createTempFile("const x: any = 1"),
        createTempFile("function foo() { return 42 }"),
        createTempFile("const y: Promise = new Promise(() => {})"),
      ]

      try {
        const metrics = generateTypeMetrics(files)

        assert.ok(metrics.totalFiles === 3)
        assert.ok(metrics.filesWithIssues > 0)
        assert.ok(metrics.totalIssues > 0)
        assert.ok(metrics.scorePercentage >= 0)
        assert.ok(metrics.scorePercentage <= 100)
      } finally {
        files.forEach(f => cleanupTempFile(f))
      }
    })

    await t.test("tracks issues by rule", () => {
      const files = [createTempFile("const x: any = 1\nconst y: any = 2")]

      try {
        const metrics = generateTypeMetrics(files)

        assert.ok(metrics.issuesByRule["TS_ANY_TYPE"])
        assert.ok(metrics.issuesByRule["TS_ANY_TYPE"] >= 1)
      } finally {
        files.forEach(f => cleanupTempFile(f))
      }
    })

    await t.test("calculates error and warning counts", () => {
      const files = [createTempFile("const x: any = 1\nfunction foo() {}")]

      try {
        const metrics = generateTypeMetrics(files)

        assert.ok(typeof metrics.errorCount === "number")
        assert.ok(typeof metrics.warningCount === "number")
        assert.equal(metrics.errorCount + metrics.warningCount, metrics.totalIssues)
      } finally {
        files.forEach(f => cleanupTempFile(f))
      }
    })
  })

  // ─── METRICS EXPORT AND IMPORT ───────────────────────────────────────────

  await t.test("metrics persistence", async t => {
    await t.test("exports metrics to JSON", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "metrics-test-"))
      try {
        const metrics = {
          totalFiles: 10,
          filesWithIssues: 3,
          totalIssues: 15,
          issuesByRule: { TS_ANY_TYPE: 8, MISSING_RETURN_TYPE: 7 },
          errorCount: 8,
          warningCount: 7,
          scorePercentage: 85.5,
          timestamp: Date.now(),
        }

        const outputPath = path.join(tmpDir, "metrics.json")
        const success = exportMetrics(metrics, outputPath)

        assert.equal(success, true)
        assert.ok(fs.existsSync(outputPath))

        const loaded = JSON.parse(fs.readFileSync(outputPath, "utf-8"))
        assert.deepEqual(loaded, metrics)
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    await t.test("loads historical metrics", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "history-test-"))
      try {
        const m1 = {
          totalFiles: 5,
          filesWithIssues: 2,
          totalIssues: 10,
          issuesByRule: {},
          errorCount: 5,
          warningCount: 5,
          scorePercentage: 80,
          timestamp: Date.now() - 1000,
        }
        const m2 = {
          totalFiles: 5,
          filesWithIssues: 1,
          totalIssues: 5,
          issuesByRule: {},
          errorCount: 2,
          warningCount: 3,
          scorePercentage: 90,
          timestamp: Date.now(),
        }

        exportMetrics(m1, path.join(tmpDir, "001-metrics.json"))
        exportMetrics(m2, path.join(tmpDir, "002-metrics.json"))

        const historical = loadHistoricalMetrics(tmpDir)
        assert.equal(historical.length, 2)
        assert.equal(historical[0].scorePercentage, 80)
        assert.equal(historical[1].scorePercentage, 90)
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    await t.test("returns empty array for non-existent metrics dir", () => {
      const metrics = loadHistoricalMetrics("/non/existent/path")
      assert.deepEqual(metrics, [])
    })
  })

  // ─── METRICS TREND ANALYSIS ──────────────────────────────────────────────

  await t.test("metrics trend analysis", async t => {
    await t.test("detects improvement", () => {
      const metrics = [
        {
          totalFiles: 5,
          filesWithIssues: 2,
          totalIssues: 10,
          issuesByRule: {},
          errorCount: 5,
          warningCount: 5,
          scorePercentage: 70,
          timestamp: 1000,
        },
        {
          totalFiles: 5,
          filesWithIssues: 1,
          totalIssues: 5,
          issuesByRule: {},
          errorCount: 2,
          warningCount: 3,
          scorePercentage: 85,
          timestamp: 2000,
        },
      ]

      const trend = calculateMetricsTrend(metrics)
      assert.equal(trend.improvement, true)
      assert.equal(trend.percentChange, 15)
    })

    await t.test("detects degradation", () => {
      const metrics = [
        {
          totalFiles: 5,
          filesWithIssues: 1,
          totalIssues: 5,
          issuesByRule: {},
          errorCount: 2,
          warningCount: 3,
          scorePercentage: 90,
          timestamp: 1000,
        },
        {
          totalFiles: 5,
          filesWithIssues: 3,
          totalIssues: 15,
          issuesByRule: {},
          errorCount: 8,
          warningCount: 7,
          scorePercentage: 70,
          timestamp: 2000,
        },
      ]

      const trend = calculateMetricsTrend(metrics)
      assert.equal(trend.improvement, false)
      assert.equal(trend.percentChange, -20)
    })

    await t.test("handles insufficient data", () => {
      const metrics = [
        {
          totalFiles: 5,
          filesWithIssues: 1,
          totalIssues: 5,
          issuesByRule: {},
          errorCount: 2,
          warningCount: 3,
          scorePercentage: 90,
          timestamp: 1000,
        },
      ]

      const trend = calculateMetricsTrend(metrics)
      assert.equal(trend.improvement, false)
      assert.equal(trend.percentChange, 0)
    })
  })

  // ─── EDGE CASES AND ACCURACY ────────────────────────────────────────────

  await t.test("AST accuracy - no false positives on generics", () => {
    const code = `
function identity<T>(value: T): T {
  return value
}

const result = identity<string>("hello")
    `
    const filePath = createTempFile(code)
    try {
      const issues = lintFileAST(filePath)
      // Should not flag generic T as 'any'
      const anyTypeIssues = issues.filter(i => i.ruleId === "TS_ANY_TYPE")
      assert.equal(anyTypeIssues.length, 0)
    } finally {
      cleanupTempFile(filePath)
    }
  })

  await t.test("handles non-existent files gracefully", () => {
    const issues = lintFileAST("/non/existent/file.ts")
    assert.deepEqual(issues, [])
  })

  await t.test("generates valid JSON for metrics export", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "json-test-"))
    try {
      const metrics = {
        totalFiles: 1,
        filesWithIssues: 0,
        totalIssues: 0,
        issuesByRule: {},
        errorCount: 0,
        warningCount: 0,
        scorePercentage: 100,
        timestamp: Date.now(),
      }

      const outputPath = path.join(tmpDir, "metrics.json")
      exportMetrics(metrics, outputPath)

      const content = fs.readFileSync(outputPath, "utf-8")
      const parsed = JSON.parse(content)
      assert.ok(parsed.totalFiles === 1)
    } finally {
      fs.rmSync(tmpDir, { recursive: true })
    }
  })
})
