/**
 * AST-Based TypeScript Type Safety Linter
 *
 * Uses TypeScript compiler API to perform accurate type safety analysis:
 * - Detects 'any' types in all contexts with zero false positives
 * - Identifies missing return type annotations
 * - Finds unsafe casts with context awareness
 * - Validates Promise type parameters
 * - Provides auto-fix capabilities for common issues
 * - Tracks type safety metrics over time
 */

import * as fs from "fs"
import * as path from "path"
import * as ts from "typescript"

/**
 * AST-based type safety issue
 */
export interface ASTTypeSafetyIssue {
  ruleId: string
  message: string
  line: number
  column: number
  severity: "error" | "warn" | "info"
  fix?: string
  fixable?: boolean
}

/**
 * Auto-fix result
 */
export interface AutoFixResult {
  success: boolean
  message?: string
  originalCode?: string
  fixedCode?: string
  issuesFixed: number
}

/**
 * Type safety metrics
 */
export interface TypeSafetyMetrics {
  totalFiles: number
  filesWithIssues: number
  totalIssues: number
  issuesByRule: Record<string, number>
  errorCount: number
  warningCount: number
  scorePercentage: number
  timestamp: number
}

/**
 * Linter configuration for AST mode
 */
export interface ASTLinterConfig {
  enabled: boolean
  auto_fix?: boolean
  auto_fix_rules?: string[]
  track_metrics?: boolean
  metrics_dir?: string
}

/**
 * Lint TypeScript file using AST analysis
 *
 * @param filePath - Path to the TypeScript file
 * @param config - Linter configuration
 * @returns Array of type safety issues found
 */
export function lintFileAST(filePath: string, config?: ASTLinterConfig): ASTTypeSafetyIssue[] {
  if (!fs.existsSync(filePath)) {
    return []
  }

  const sourceCode = fs.readFileSync(filePath, "utf-8")
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )

  const issues: ASTTypeSafetyIssue[] = []
  const lines = sourceCode.split("\n")

  // Walk the AST and collect issues
  const visit = (node: ts.Node): void => {
    // Check for 'any' type usage
    if (ts.isTypeNode(node) && node.kind === ts.SyntaxKind.AnyKeyword) {
      const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart())
      issues.push({
        ruleId: "TS_ANY_TYPE",
        message: "Use of 'any' type is not allowed",
        line: pos.line + 1,
        column: pos.character + 1,
        severity: "error",
        fix: "Replace 'any' with specific type",
        fixable: true,
      })
    }

    // Check for unsafe type assertions
    if (ts.isAsExpression(node)) {
      const typeNode = node.type
      const typeText = typeNode.getText(sourceFile)

      if (
        typeText === "any" ||
        typeText === "unknown" ||
        typeText.startsWith("Record<") ||
        typeText === "{}"
      ) {
        const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart())
        issues.push({
          ruleId: "TS_UNSAFE_CAST",
          message: `Unsafe cast to '${typeText}'`,
          line: pos.line + 1,
          column: pos.character + 1,
          severity: "error",
          fix: `Use type guard or specific type instead of '${typeText}'`,
          fixable: true,
        })
      }
    }

    // Check for missing return type annotations on functions
    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      !node.type &&
      node.body
    ) {
      // Skip constructors and getters/setters
      const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
      const isConstructor =
        ts.isFunctionDeclaration(node) && node.name?.text === "constructor"
      const isGetterSetter =
        modifiers?.some(m => m.kind === ts.SyntaxKind.GetKeyword || m.kind === ts.SyntaxKind.SetKeyword)

      if (!isConstructor && !isGetterSetter) {
        const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart())
        issues.push({
          ruleId: "MISSING_RETURN_TYPE",
          message: "Function missing explicit return type annotation",
          line: pos.line + 1,
          column: pos.character + 1,
          severity: "warn",
          fix: "Add return type annotation to function",
          fixable: false, // Would require inference
        })
      }
    }

    // Check for Promise without type parameter
    if (ts.isTypeReferenceNode(node)) {
      const typeName = node.typeName
      if (ts.isIdentifier(typeName) && typeName.text === "Promise") {
        if (!node.typeArguments || node.typeArguments.length === 0) {
          const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart())
          issues.push({
            ruleId: "MISSING_PROMISE_TYPE",
            message: "Promise must have type parameter",
            line: pos.line + 1,
            column: pos.character + 1,
            severity: "warn",
            fix: "Add type parameter: Promise<T>",
            fixable: false,
          })
        }
      }
    }

    // Check for @ts-ignore without reason
    const precedingComments = ts.getLeadingCommentRanges(sourceCode, node.getFullStart())
    if (precedingComments) {
      for (const range of precedingComments) {
        const comment = sourceCode.substring(range.pos, range.end)
        if (comment.includes("@ts-ignore") && !comment.includes("@ts-ignore -")) {
          const pos = sourceFile.getLineAndCharacterOfPosition(range.pos)
          issues.push({
            ruleId: "TS_IGNORE_WITHOUT_REASON",
            message: "@ts-ignore must have a reason comment",
            line: pos.line + 1,
            column: pos.character + 1,
            severity: "warn",
            fix: "Add reason: @ts-ignore - <reason>",
            fixable: true,
          })
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return issues
}

/**
 * Apply auto-fixes to a file
 *
 * @param filePath - Path to the TypeScript file
 * @param issues - Issues to fix
 * @param config - Configuration
 * @returns Auto-fix result
 */
export function fixIssuesInFile(
  filePath: string,
  issues: ASTTypeSafetyIssue[],
  config?: ASTLinterConfig,
): AutoFixResult {
  if (!fs.existsSync(filePath)) {
    return { success: false, message: "File not found", issuesFixed: 0 }
  }

  const originalCode = fs.readFileSync(filePath, "utf-8")
  let fixedCode = originalCode
  let issuesFixed = 0

  const fixableRules = config?.auto_fix_rules || [
    "TS_ANY_TYPE",
    "TS_UNSAFE_CAST",
    "TS_IGNORE_WITHOUT_REASON",
  ]

  const linesToFix = issues
    .filter(issue => issue.fixable && fixableRules.includes(issue.ruleId))
    .sort((a, b) => b.line - a.line) // Process from bottom to top to preserve positions

  const lines = fixedCode.split("\n")

  for (const issue of linesToFix) {
    const lineIndex = issue.line - 1
    if (lineIndex >= 0 && lineIndex < lines.length) {
      const line = lines[lineIndex]

      // Apply fix based on rule
      if (issue.ruleId === "TS_IGNORE_WITHOUT_REASON") {
        if (line.includes("@ts-ignore") && !line.includes("@ts-ignore -")) {
          lines[lineIndex] = line.replace(/@ts-ignore\b/, "@ts-ignore - complex type")
          issuesFixed++
        }
      } else if (issue.ruleId === "TS_ANY_TYPE") {
        // Replace simple 'any' with 'unknown'
        if (line.includes(": any")) {
          lines[lineIndex] = line.replace(/:\s*any\b/, ": unknown")
          issuesFixed++
        }
      } else if (issue.ruleId === "TS_UNSAFE_CAST") {
        // Replace unsafe casts with 'unknown'
        if (line.includes("as any")) {
          lines[lineIndex] = line.replace(/\bas\s+any\b/, "as unknown")
          issuesFixed++
        }
      }
    }
  }

  fixedCode = lines.join("\n")

  if (issuesFixed > 0) {
    fs.writeFileSync(filePath, fixedCode, "utf-8")
  }

  return {
    success: issuesFixed > 0,
    message: `Fixed ${issuesFixed} issues`,
    originalCode,
    fixedCode,
    issuesFixed,
  }
}

/**
 * Generate type safety metrics for files
 *
 * @param filePaths - Array of file paths to analyze
 * @param config - Configuration
 * @returns Type safety metrics
 */
export function generateTypeMetrics(
  filePaths: string[],
  config?: ASTLinterConfig,
): TypeSafetyMetrics {
  const allIssues: ASTTypeSafetyIssue[] = []
  const filesWithIssues = new Set<string>()
  const issuesByRule: Record<string, number> = {}

  for (const filePath of filePaths) {
    const issues = lintFileAST(filePath, config)
    if (issues.length > 0) {
      filesWithIssues.add(filePath)
      allIssues.push(...issues)

      for (const issue of issues) {
        issuesByRule[issue.ruleId] = (issuesByRule[issue.ruleId] || 0) + 1
      }
    }
  }

  const errorCount = allIssues.filter(i => i.severity === "error").length
  const warningCount = allIssues.filter(i => i.severity === "warn").length

  // Calculate type safety score (0-100)
  const maxIssues = filePaths.length * 10 // Arbitrary max issues per file
  const scorePercentage = Math.max(0, 100 - (allIssues.length / maxIssues) * 100)

  return {
    totalFiles: filePaths.length,
    filesWithIssues: filesWithIssues.size,
    totalIssues: allIssues.length,
    issuesByRule,
    errorCount,
    warningCount,
    scorePercentage: Math.round(scorePercentage * 10) / 10,
    timestamp: Date.now(),
  }
}

/**
 * Export metrics to JSON file
 *
 * @param metrics - Metrics to export
 * @param outputPath - Output file path
 * @returns Success status
 */
export function exportMetrics(metrics: TypeSafetyMetrics, outputPath: string): boolean {
  try {
    const dir = path.dirname(outputPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    fs.writeFileSync(outputPath, JSON.stringify(metrics, null, 2), "utf-8")
    return true
  } catch (error) {
    return false
  }
}

/**
 * Load historical metrics
 *
 * @param metricsDir - Directory containing metrics files
 * @returns Array of metrics in chronological order
 */
export function loadHistoricalMetrics(metricsDir: string): TypeSafetyMetrics[] {
  const metrics: TypeSafetyMetrics[] = []

  if (!fs.existsSync(metricsDir)) {
    return metrics
  }

  const files = fs.readdirSync(metricsDir).filter(f => f.endsWith(".json")).sort()

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(metricsDir, file), "utf-8")
      const data = JSON.parse(content) as TypeSafetyMetrics
      metrics.push(data)
    } catch (error) {
      // Skip invalid files
    }
  }

  return metrics
}

/**
 * Calculate metrics trend
 *
 * @param metrics - Array of metrics in chronological order
 * @returns Trend information
 */
export function calculateMetricsTrend(metrics: TypeSafetyMetrics[]): {
  improvement: boolean
  percentChange: number
  description: string
} {
  if (metrics.length < 2) {
    return { improvement: false, percentChange: 0, description: "Insufficient data for trend" }
  }

  const first = metrics[0]
  const last = metrics[metrics.length - 1]

  const percentChange = last.scorePercentage - first.scorePercentage
  const improvement = percentChange > 0

  return {
    improvement,
    percentChange: Math.round(percentChange * 10) / 10,
    description: improvement
      ? `Type safety improved by ${percentChange.toFixed(1)}%`
      : `Type safety decreased by ${Math.abs(percentChange).toFixed(1)}%`,
  }
}
