/**
 * Type Safety Linter Tests
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import {
  lintFile,
  TypeSafetyRuleId,
  TypeSafetySeverity,
  type TypeSafetyLinterConfig,
} from "../../src/linters/type-safety-linter.js"

test("type-safety-linter", async t => {
  let tempDir: string

  async function setupTest(t: any): Promise<() => void> {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "type-safety-"))
    return () => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true })
      }
    }
  }

  function createTempFile(content: string): string {
    const filePath = path.join(tempDir, "test.ts")
    fs.writeFileSync(filePath, content)
    return filePath
  }

  // ─── TS_ANY_TYPE RULE ──────────────────────────────────────────────────────

  await t.test("TS_ANY_TYPE rule - detect 'any' type", async t => {
    const cleanup = await setupTest(t)

    try {
      await t.test("detects 'any' type in variable declaration", () => {
        const code = `let value: any = 42`
        const filePath = createTempFile(code)
        const issues = lintFile(filePath)
        const anyIssues = issues.filter(i => i.ruleId === TypeSafetyRuleId.TS_ANY_TYPE)
        assert.ok(anyIssues.length > 0)
      })

      await t.test("detects 'any' in function parameter", () => {
        const code = `function test(x: any) { return x }`
        const filePath = createTempFile(code)
        const issues = lintFile(filePath)
        const anyIssues = issues.filter(i => i.ruleId === TypeSafetyRuleId.TS_ANY_TYPE)
        assert.ok(anyIssues.length > 0)
      })

      await t.test("allows 'any' with @ts-safety:allow-any comment", () => {
        const code = `// @ts-safety:allow-any
const value: any = 42`
        const filePath = createTempFile(code)
        const issues = lintFile(filePath)
        const anyIssues = issues.filter(i => i.ruleId === TypeSafetyRuleId.TS_ANY_TYPE)
        assert.equal(anyIssues.length, 0)
      })

      await t.test("ignores 'any' in comments", () => {
        const code = `// This is any type example
const value: string = "test"`
        const filePath = createTempFile(code)
        const issues = lintFile(filePath)
        const anyIssues = issues.filter(i => i.ruleId === TypeSafetyRuleId.TS_ANY_TYPE)
        assert.equal(anyIssues.length, 0)
      })
    } finally {
      cleanup()
    }
  })

  // ─── TS_UNSAFE_CAST RULE ──────────────────────────────────────────────────

  await t.test("TS_UNSAFE_CAST rule - detect unsafe casts", async t => {
    const cleanup = await setupTest(t)

    try {
      await t.test("detects 'as any' cast", () => {
        const code = `const value = obj as any`
        const filePath = createTempFile(code)
        const issues = lintFile(filePath)
        const castIssues = issues.filter(i => i.ruleId === TypeSafetyRuleId.TS_UNSAFE_CAST)
        assert.ok(castIssues.length > 0)
      })

      await t.test("detects 'as unknown' cast", () => {
        const code = `const value = obj as unknown`
        const filePath = createTempFile(code)
        const issues = lintFile(filePath)
        const castIssues = issues.filter(i => i.ruleId === TypeSafetyRuleId.TS_UNSAFE_CAST)
        assert.ok(castIssues.length > 0)
      })

      await t.test("allows cast with @ts-safety:allow-cast comment", () => {
        const code = `// @ts-safety:allow-cast
const value = obj as any`
        const filePath = createTempFile(code)
        const issues = lintFile(filePath)
        const castIssues = issues.filter(i => i.ruleId === TypeSafetyRuleId.TS_UNSAFE_CAST)
        assert.equal(castIssues.length, 0)
      })
    } finally {
      cleanup()
    }
  })

  // ─── TS_IGNORE_WITHOUT_REASON RULE ────────────────────────────────────────

  await t.test("TS_IGNORE_WITHOUT_REASON rule", async t => {
    const cleanup = await setupTest(t)

    try {
      await t.test("detects @ts-ignore without reason", () => {
        const code = `// @ts-ignore
const value: any = 42`
        const filePath = createTempFile(code)
        const issues = lintFile(filePath)
        const ignoreIssues = issues.filter(
          i => i.ruleId === TypeSafetyRuleId.TS_IGNORE_WITHOUT_REASON
        )
        assert.ok(ignoreIssues.length > 0)
      })

      await t.test("allows @ts-ignore with reason", () => {
        const code = `// @ts-ignore - complex type from external library
const value: any = 42`
        const filePath = createTempFile(code)
        const issues = lintFile(filePath)
        const ignoreIssues = issues.filter(
          i => i.ruleId === TypeSafetyRuleId.TS_IGNORE_WITHOUT_REASON
        )
        assert.equal(ignoreIssues.length, 0)
      })
    } finally {
      cleanup()
    }
  })

  // ─── CONFIGURATION HANDLING ────────────────────────────────────────────────

  await t.test("configuration handling", async t => {
    const cleanup = await setupTest(t)

    try {
      await t.test("respects disabled config", () => {
        const code = `let x: any = 42`
        const filePath = createTempFile(code)
        const config: TypeSafetyLinterConfig = { enabled: false }
        const issues = lintFile(filePath, config)
        assert.equal(issues.length, 0)
      })
    } finally {
      cleanup()
    }
  })

  // ─── NON-EXISTENT FILES ──────────────────────────────────────────────────

  await t.test("non-existent files", async t => {
    await t.test("handles non-existent file gracefully", () => {
      const issues = lintFile("/nonexistent/file.ts")
      assert.deepEqual(issues, [])
    })
  })

  // ─── EDGE CASES ────────────────────────────────────────────────────────────

  await t.test("edge cases", async t => {
    const cleanup = await setupTest(t)

    try {
      await t.test("handles empty file", () => {
        const filePath = createTempFile("")
        const issues = lintFile(filePath)
        assert.deepEqual(issues, [])
      })

      await t.test("handles file with only comments", () => {
        const code = `// This is a comment
// Another comment
/* Block comment */`
        const filePath = createTempFile(code)
        const issues = lintFile(filePath)
        assert.equal(issues.length, 0)
      })

      await t.test("handles mixed quotes and strings", () => {
        const code = `const str = "This is any type"
const str2 = 'Also any but not a problem'`
        const filePath = createTempFile(code)
        const issues = lintFile(filePath)
        const anyIssues = issues.filter(i => i.ruleId === TypeSafetyRuleId.TS_ANY_TYPE)
        assert.equal(anyIssues.length, 0)
      })
    } finally {
      cleanup()
    }
  })

  // ─── SEVERITY LEVELS ──────────────────────────────────────────────────────

  await t.test("severity levels", async t => {
    const cleanup = await setupTest(t)

    try {
      await t.test("assigns ERROR severity to TS_ANY_TYPE", () => {
        const code = `let x: any = 42`
        const filePath = createTempFile(code)
        const issues = lintFile(filePath)
        const anyIssues = issues.filter(i => i.ruleId === TypeSafetyRuleId.TS_ANY_TYPE)
        if (anyIssues.length > 0) {
          assert.equal(anyIssues[0].severity, TypeSafetySeverity.ERROR)
        }
      })

      await t.test("assigns ERROR severity to TS_UNSAFE_CAST", () => {
        const code = `const x = y as any`
        const filePath = createTempFile(code)
        const issues = lintFile(filePath)
        const castIssues = issues.filter(i => i.ruleId === TypeSafetyRuleId.TS_UNSAFE_CAST)
        if (castIssues.length > 0) {
          assert.equal(castIssues[0].severity, TypeSafetySeverity.ERROR)
        }
      })
    } finally {
      cleanup()
    }
  })
})
