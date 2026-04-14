/**
 * Advanced Web Research Pattern Detection
 *
 * Extends basic web research detection with advanced patterns:
 * - Tech announcements: "just released", "announced", "new features"
 * - Security: CVE references, vulnerability announcements
 * - Framework release schedules
 * - Library/package updates: npm audit, dependency updates
 * - Service status: status.*.com patterns
 */

import type { WebResearchTriggerType } from "../../hooks/web-research-detector.js"

/**
 * Extended trigger types for advanced patterns
 */
export enum AdvancedTriggerType {
  TECH_ANNOUNCEMENT = "tech_announcement",
  SECURITY = "security",
  RELEASE_SCHEDULE = "release_schedule",
  NPM_AUDIT = "npm_audit",
  STATUS_PAGE = "status_page",
}

/**
 * Advanced trigger patterns with high specificity
 */
export interface AdvancedPatternMatch {
  type: AdvancedTriggerType
  pattern: string
  confidence: "must" | "should"
  context?: string
}

/**
 * Tech announcement patterns
 */
const TECH_ANNOUNCEMENT_PATTERNS: Array<{
  pattern: RegExp
  confidence: "must" | "should"
}> = [
  { pattern: /\b(just\s+released|just\s+announced|newly\s+announced)\b/i, confidence: "must" },
  { pattern: /\b(new\s+features?|feature\s+release)\b/i, confidence: "should" },
  { pattern: /\b(major\s+release|minor\s+release|patch\s+release)\b/i, confidence: "should" },
  { pattern: /\b(comes?\s+with|introducing|presents?|rolls?\s+out)\b/i, confidence: "should" },
]

/**
 * Security and vulnerability patterns
 */
const SECURITY_PATTERNS: Array<{
  pattern: RegExp
  confidence: "must" | "should"
}> = [
  { pattern: /\bCVE-\d{4}-\d{4,}\b/i, confidence: "must" },
  { pattern: /\b(vulnerability|vulnerabilities|vuln)\b/i, confidence: "must" },
  { pattern: /\b(security\s+patch|security\s+fix|security\s+update)\b/i, confidence: "must" },
  { pattern: /\b(exploit|breach|compromis\w+)\b/i, confidence: "must" },
  { pattern: /\b(zero\s+day|0-day)\b/i, confidence: "must" },
]

/**
 * Release schedule patterns
 */
const RELEASE_SCHEDULE_PATTERNS: Array<{
  pattern: RegExp
  confidence: "must" | "should"
}> = [
  {
    pattern: /\b(Next\.js\s+\d+|React\s+\d+|Vue\s+\d+|Angular\s+\d+)\s+(releases?|coming soon|will\s+release)\b/i,
    confidence: "should",
  },
  { pattern: /\b(LTS\s+version|long\s+term\s+support)\b/i, confidence: "should" },
  { pattern: /\b(roadmap|release\s+schedule|release\s+plan)\b/i, confidence: "should" },
]

/**
 * NPM and package management patterns
 */
const NPM_AUDIT_PATTERNS: Array<{
  pattern: RegExp
  confidence: "must" | "should"
}> = [
  { pattern: /\b(npm\s+audit|npm\s+outdated|dependencies?\s+outdated)\b/i, confidence: "must" },
  { pattern: /\b(dependency\s+update|package\s+update|outdated\s+packages?)\b/i, confidence: "should" },
  { pattern: /\b(critical\s+vulnerabilit|high\s+risk\s+packages?)\b/i, confidence: "must" },
]

/**
 * Service status patterns
 */
const STATUS_PAGE_PATTERNS: Array<{
  pattern: RegExp
  confidence: "must" | "should"
}> = [
  { pattern: /\bstatus\.(github|aws|vercel|netlify|cloudflare)\.(com|io)\b/i, confidence: "should" },
  { pattern: /\b(is\s+.*\s+down|outage|incident|service\s+unavailable)\b/i, confidence: "should" },
  { pattern: /\b(API\s+status|service\s+status|system\s+status)\b/i, confidence: "should" },
]

/**
 * Detect advanced web research patterns
 *
 * @param message - User message to analyze
 * @returns Array of advanced pattern matches
 */
export function detectAdvancedPatterns(message: string): AdvancedPatternMatch[] {
  const normalized = message.toLowerCase().trim()
  const matches: AdvancedPatternMatch[] = []

  // Check tech announcements
  for (const { pattern, confidence } of TECH_ANNOUNCEMENT_PATTERNS) {
    if (pattern.test(normalized)) {
      matches.push({
        type: AdvancedTriggerType.TECH_ANNOUNCEMENT,
        pattern: pattern.source,
        confidence,
      })
    }
  }

  // Check security patterns
  for (const { pattern, confidence } of SECURITY_PATTERNS) {
    if (pattern.test(normalized)) {
      matches.push({
        type: AdvancedTriggerType.SECURITY,
        pattern: pattern.source,
        confidence,
      })
    }
  }

  // Check release schedules
  for (const { pattern, confidence } of RELEASE_SCHEDULE_PATTERNS) {
    if (pattern.test(normalized)) {
      matches.push({
        type: AdvancedTriggerType.RELEASE_SCHEDULE,
        pattern: pattern.source,
        confidence,
      })
    }
  }

  // Check npm/package patterns
  for (const { pattern, confidence } of NPM_AUDIT_PATTERNS) {
    if (pattern.test(normalized)) {
      matches.push({
        type: AdvancedTriggerType.NPM_AUDIT,
        pattern: pattern.source,
        confidence,
      })
    }
  }

  // Check status page patterns
  for (const { pattern, confidence } of STATUS_PAGE_PATTERNS) {
    if (pattern.test(normalized)) {
      matches.push({
        type: AdvancedTriggerType.STATUS_PAGE,
        pattern: pattern.source,
        confidence,
      })
    }
  }

  return matches
}

/**
 * Check if message has any high-confidence advanced patterns
 *
 * @param message - User message to check
 * @returns True if any "must" confidence pattern is found
 */
export function hasHighConfidenceAdvancedPattern(message: string): boolean {
  const matches = detectAdvancedPatterns(message)
  return matches.some(m => m.confidence === "must")
}
