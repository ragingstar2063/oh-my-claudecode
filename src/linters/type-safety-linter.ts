/**
 * TypeScript Type Safety Linter
 *
 * Enforces type safety rules via regex patterns.
 * Core rules:
 * 1. TS_ANY_TYPE - ban 'any' type (exception: @ts-safety:allow-any)
 * 2. TS_UNSAFE_CAST - ban unsafe casts like 'as any', 'as unknown' (exception: @ts-safety:allow-cast)
 * 3. TS_IGNORE_WITHOUT_REASON - @ts-ignore must have comment
 * 4. MISSING_RETURN_TYPE - function must have return type (exception: arrow functions with implicit returns)
 * 5. MISSING_PROMISE_TYPE - Promise must have type parameter (exception: Promise<void>)
 */

import * as fs from "fs"
import * as path from "path"

/**
 * Rule identifiers
 */
export enum TypeSafetyRuleId {
  TS_ANY_TYPE = "TS_ANY_TYPE",
  TS_UNSAFE_CAST = "TS_UNSAFE_CAST",
  TS_IGNORE_WITHOUT_REASON = "TS_IGNORE_WITHOUT_REASON",
  MISSING_RETURN_TYPE = "MISSING_RETURN_TYPE",
  MISSING_PROMISE_TYPE = "MISSING_PROMISE_TYPE",
}

/**
 * Severity levels for linting issues
 */
export enum TypeSafetySeverity {
  ERROR = "error",
  WARN = "warn",
  INFO = "info",
}

/**
 * A type safety issue found by the linter
 */
export interface TypeSafetyIssue {
  ruleId: TypeSafetyRuleId
  message: string
  line: number
  column: number
  severity: TypeSafetySeverity
  fix?: string // Optional suggestion for fixing
}

/**
 * Configuration for a type safety rule
 */
export interface TypeSafetyRule {
  id: TypeSafetyRuleId
  enabled: boolean
  severity: TypeSafetySeverity
  description: string
}

/**
 * Linter configuration
 */
export interface TypeSafetyLinterConfig {
  enabled: boolean
  rules?: Record<TypeSafetyRuleId, TypeSafetySeverity>
  ignore_patterns?: string[] // File patterns to ignore
}

/**
 * Core linting rules with patterns and detection logic
 */
const DEFAULT_RULES: TypeSafetyRule[] = [
  {
    id: TypeSafetyRuleId.TS_ANY_TYPE,
    enabled: true,
    severity: TypeSafetySeverity.ERROR,
    description: "Disallow 'any' type without @ts-safety:allow-any comment",
  },
  {
    id: TypeSafetyRuleId.TS_UNSAFE_CAST,
    enabled: true,
    severity: TypeSafetySeverity.ERROR,
    description: "Disallow unsafe casts (as any, as unknown, as Record<...>)",
  },
  {
    id: TypeSafetyRuleId.TS_IGNORE_WITHOUT_REASON,
    enabled: true,
    severity: TypeSafetySeverity.WARN,
    description: "@ts-ignore must have a reason comment",
  },
  {
    id: TypeSafetyRuleId.MISSING_RETURN_TYPE,
    enabled: true,
    severity: TypeSafetySeverity.WARN,
    description: "Function must have explicit return type",
  },
  {
    id: TypeSafetyRuleId.MISSING_PROMISE_TYPE,
    enabled: true,
    severity: TypeSafetySeverity.WARN,
    description: "Promise must have type parameter",
  },
]

/**
 * Lints a TypeScript file for type safety issues.
 *
 * @param filePath - Path to the TypeScript file
 * @param config - Linter configuration
 * @returns Array of issues found
 */
export function lintFile(filePath: string, config?: TypeSafetyLinterConfig): TypeSafetyIssue[] {
  if (!fs.existsSync(filePath)) {
    return []
  }

  const content = fs.readFileSync(filePath, "utf-8")
  const lines = content.split("\n")

  const issues: TypeSafetyIssue[] = []
  const enabledRules = getEnabledRules(config)

  // Check each line for issues
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]
    const lineNumber = lineIndex + 1

    // Rule: TS_ANY_TYPE
    if (enabledRules.has(TypeSafetyRuleId.TS_ANY_TYPE)) {
      const anyIssues = checkAnyType(line, lineNumber, lines)
      issues.push(...anyIssues)
    }

    // Rule: TS_UNSAFE_CAST
    if (enabledRules.has(TypeSafetyRuleId.TS_UNSAFE_CAST)) {
      const castIssues = checkUnsafeCast(line, lineNumber, lines)
      issues.push(...castIssues)
    }

    // Rule: TS_IGNORE_WITHOUT_REASON
    if (enabledRules.has(TypeSafetyRuleId.TS_IGNORE_WITHOUT_REASON)) {
      const ignoreIssues = checkTsIgnore(line, lineNumber)
      issues.push(...ignoreIssues)
    }

    // Rule: MISSING_RETURN_TYPE
    if (enabledRules.has(TypeSafetyRuleId.MISSING_RETURN_TYPE)) {
      const returnTypeIssues = checkMissingReturnType(line, lineNumber, lines, lineIndex)
      issues.push(...returnTypeIssues)
    }

    // Rule: MISSING_PROMISE_TYPE
    if (enabledRules.has(TypeSafetyRuleId.MISSING_PROMISE_TYPE)) {
      const promiseIssues = checkPromiseType(line, lineNumber)
      issues.push(...promiseIssues)
    }
  }

  return issues
}

/**
 * Gets enabled rules from configuration
 * If no config provided, defaults to all rules enabled
 */
function getEnabledRules(config?: TypeSafetyLinterConfig): Set<TypeSafetyRuleId> {
  const enabled = new Set<TypeSafetyRuleId>()

  // If explicitly disabled, return empty set
  if (config && config.enabled === false) {
    return enabled
  }

  // Default to enabling all rules if:
  // - No config provided, OR
  // - Config is enabled (or not explicitly disabled)
  if (!config || config.enabled === true || config.enabled === undefined) {
    if (config?.rules) {
      Object.entries(config.rules).forEach(([ruleId]) => {
        enabled.add(ruleId as TypeSafetyRuleId)
      })
    } else {
      // Use defaults - enable all rules by default
      DEFAULT_RULES.forEach(rule => {
        enabled.add(rule.id)
      })
    }
  }

  return enabled
}

/**
 * Checks for 'any' type usage without allowlist comment
 */
function checkAnyType(line: string, lineNumber: number, lines?: string[]): TypeSafetyIssue[] {
  const issues: TypeSafetyIssue[] = []

  // Skip if line has allowlist comment
  if (line.includes("@ts-safety:allow-any")) {
    return issues
  }

  // Skip if previous line has allowlist comment
  if (lines && lineNumber > 1 && lines[lineNumber - 2]?.includes("@ts-safety:allow-any")) {
    return issues
  }

  // Skip comments and strings
  if (line.trim().startsWith("//") || line.trim().startsWith("*")) {
    return issues
  }

  // Pattern: 'any' as a standalone type
  // Matches: : any, <any>, (any), [any], = any, as any
  // But NOT: "any" (in strings), "anything", "anyway"
  const anyPatterns = [
    /:\s*any\b/,           // ": any"
    /\bany\s*[,})\];=]/,   // "any,"  "any}"  "any)"
    /\bany\s*$/, // "any" at end of line
  ]

  for (const pattern of anyPatterns) {
    const match = pattern.exec(line)
    if (match) {
      const column = match.index + 1
      issues.push({
        ruleId: TypeSafetyRuleId.TS_ANY_TYPE,
        message: "Use of 'any' type is not allowed. Use specific type or @ts-safety:allow-any comment",
        line: lineNumber,
        column,
        severity: TypeSafetySeverity.ERROR,
        fix: "Replace 'any' with a specific type (e.g., unknown, Record<string, any>, etc.)",
      })
    }
  }

  return issues
}

/**
 * Checks for unsafe casts (as any, as unknown, as Record<...>)
 */
function checkUnsafeCast(line: string, lineNumber: number, lines?: string[]): TypeSafetyIssue[] {
  const issues: TypeSafetyIssue[] = []

  // Skip if line has allowlist comment
  if (line.includes("@ts-safety:allow-cast")) {
    return issues
  }

  // Skip if previous line has allowlist comment
  if (lines && lineNumber > 1 && lines[lineNumber - 2]?.includes("@ts-safety:allow-cast")) {
    return issues
  }

  // Skip comments
  if (line.trim().startsWith("//") || line.trim().startsWith("*")) {
    return issues
  }

  // Pattern: "as any", "as unknown", "as Record<...>"
  const castPatterns = [
    { pattern: /\bas\s+any\b/, description: "unsafe cast 'as any'" },
    { pattern: /\bas\s+unknown\b/, description: "unsafe cast 'as unknown'" },
    { pattern: /\bas\s+Record</, description: "unsafe cast 'as Record<...>'" },
    { pattern: /\bas\s+\{\}/, description: "unsafe cast 'as {}'" },
  ]

  for (const { pattern, description } of castPatterns) {
    const match = pattern.exec(line)
    if (match) {
      const column = match.index + 1
      issues.push({
        ruleId: TypeSafetyRuleId.TS_UNSAFE_CAST,
        message: `Found ${description}. This bypasses type safety. Use specific type or @ts-safety:allow-cast`,
        line: lineNumber,
        column,
        severity: TypeSafetySeverity.ERROR,
        fix: `Replace '${match[0]}' with a specific type or add @ts-safety:allow-cast comment`,
      })
    }
  }

  return issues
}

/**
 * Checks that @ts-ignore has a reason comment
 */
function checkTsIgnore(line: string, lineNumber: number): TypeSafetyIssue[] {
  const issues: TypeSafetyIssue[] = []

  // Pattern: @ts-ignore followed by reason comment or not
  const ignorePattern = /@ts-ignore/
  if (!ignorePattern.test(line)) {
    return issues
  }

  // Check if there's a reason comment after @ts-ignore
  const reasonPattern = /@ts-ignore\s*(?:\/\/|$)/
  if (reasonPattern.test(line)) {
    // No reason provided
    issues.push({
      ruleId: TypeSafetyRuleId.TS_IGNORE_WITHOUT_REASON,
      message: "@ts-ignore must have a reason comment (e.g., @ts-ignore - reason here)",
      line: lineNumber,
      column: line.indexOf("@ts-ignore") + 1,
      severity: TypeSafetySeverity.WARN,
      fix: "Add a reason comment after @ts-ignore (e.g., @ts-ignore - complex type from library)",
    })
  }

  return issues
}

/**
 * Checks for functions without return type annotations
 */
function checkMissingReturnType(
  line: string,
  lineNumber: number,
  lines: string[],
  lineIndex: number,
): TypeSafetyIssue[] {
  const issues: TypeSafetyIssue[] = []

  // Skip comments and strings
  if (line.trim().startsWith("//") || line.trim().startsWith("*")) {
    return issues
  }

  // Skip private/protected/property functions (TypeScript handles these)
  if (/private|protected|readonly|\bget\s+|\bset\s+/.test(line)) {
    return issues
  }

  // Patterns:
  // - "function foo() {" - missing return type
  // - "public foo() {" - missing return type
  // - "foo(): ReturnType" - has return type (OK)
  // - "async foo()" - async functions should have return type
  // - Arrow functions with {} block - should have return type
  // - Constructor, getters/setters - skip

  const functionPattern = /(?:async\s+)?(?:function\s+\w+|(?:public|protected)?\s*\w+)\s*\([^)]*\)\s*(?!:|\{)/

  if (functionPattern.test(line) && !line.includes("=>") && !line.includes(":")) {
    // This might be a function declaration without return type
    // Double-check it's actually a function
    if (/^\s*((?:async\s+)?(?:public\s+)?function|(?:async\s+)?\w+\s*\()/.test(line)) {
      issues.push({
        ruleId: TypeSafetyRuleId.MISSING_RETURN_TYPE,
        message: "Function missing explicit return type annotation",
        line: lineNumber,
        column: 1,
        severity: TypeSafetySeverity.WARN,
        fix: "Add return type annotation: function name(): ReturnType { ... }",
      })
    }
  }

  return issues
}

/**
 * Checks for Promise without type parameter
 */
function checkPromiseType(line: string, lineNumber: number): TypeSafetyIssue[] {
  const issues: TypeSafetyIssue[] = []

  // Skip comments
  if (line.trim().startsWith("//") || line.trim().startsWith("*")) {
    return issues
  }

  // Pattern: Promise<...> vs Promise without parameter
  // "Promise<T>" is OK
  // "Promise<unknown>" or "Promise<any>" should be flagged
  // "Promise" without any type parameter is an issue

  // This is a simplified check - looks for Promise without brackets
  const promiseWithoutTypePattern = /\bPromise\b(?!\s*<)/

  if (promiseWithoutTypePattern.test(line)) {
    // Make sure it's not in a comment or string
    const match = promiseWithoutTypePattern.exec(line)
    if (match && !line.substring(0, match.index).includes("//")) {
      issues.push({
        ruleId: TypeSafetyRuleId.MISSING_PROMISE_TYPE,
        message: "Promise must have type parameter (e.g., Promise<void>, Promise<string>)",
        line: lineNumber,
        column: match.index + 1,
        severity: TypeSafetySeverity.WARN,
        fix: "Add type parameter: Promise<ReturnType>",
      })
    }
  }

  return issues
}
