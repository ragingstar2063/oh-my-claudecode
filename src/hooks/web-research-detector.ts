/**
 * Web Research Detector
 *
 * Identifies when user messages indicate a need for web research.
 * Used by web-research hook and agent prompts to enforce current knowledge.
 */

/**
 * Categories of web research triggers
 */
export enum WebResearchTriggerType {
  VERSION_CHECK = "version_check",      // "latest", "v3.5", "2024", version numbers
  FRAMEWORK_SPECIFIC = "framework",     // React, Vue, Next.js, etc.
  DATE_SENSITIVE = "date_sensitive",    // "what's new", "breaking changes", "deprecation"
  LIBRARY_UPDATE = "library_update",    // "npm updates", "package releases"
  BEST_PRACTICES = "best_practices",    // "best practice for X in 2024", "modern approach"
  CURRENT_STATUS = "current_status",    // "is X still maintained", "does X still work"
}

/**
 * A detected web research trigger
 */
export interface WebResearchTrigger {
  type: WebResearchTriggerType
  pattern: string  // The matched pattern
  context?: string // Optional context
}

/**
 * Confidence levels for web research need
 */
export type ResearchConfidence = "must" | "should" | "maybe"

/**
 * Result of web research detection
 */
export interface WebResearchDetectionResult {
  trigger: WebResearchTrigger | null
  confidence: ResearchConfidence
  reason?: string
}

/**
 * Configuration for web research detector
 */
export interface WebResearchDetectorConfig {
  enabled: boolean
  min_confidence?: "must" | "should" | "maybe"
  trigger_types?: WebResearchTriggerType[]
}

/**
 * Pattern definitions for web research detection
 * Each pattern has: regex, trigger type, confidence level
 */
const TRIGGER_PATTERNS: Array<{
  pattern: RegExp
  trigger: WebResearchTriggerType
  confidence: ResearchConfidence
}> = [
  // ─── VERSION CHECKS (MUST confidence) ─────────────────────────────────────
  // Explicit v-prefix version numbers like "v3.5", "v18", "v2.3.0"
  {
    pattern: /\bv\d+(?:\.\d+)?(?:\.\d+)?(?:-\w+)?/,
    trigger: WebResearchTriggerType.VERSION_CHECK,
    confidence: "must",
  },
  // Semantic versioning patterns "2.3.0", "3.5", "18.0"
  {
    pattern: /\b(\d+\.\d+(?:\.\d+)?)\b/,
    trigger: WebResearchTriggerType.VERSION_CHECK,
    confidence: "must",
  },
  // "latest version", "latest update", "latest release"
  {
    pattern: /\b(latest\s+(version|release|update|api))\b/i,
    trigger: WebResearchTriggerType.VERSION_CHECK,
    confidence: "must",
  },
  // Years (2023, 2024, 2025)
  {
    pattern: /\b(202[3-9])\b/,
    trigger: WebResearchTriggerType.VERSION_CHECK,
    confidence: "should",
  },

  // ─── FRAMEWORK-SPECIFIC (SHOULD confidence) ─────────────────────────────────
  // Major frameworks: React, Vue, Angular, Svelte, Next.js, Nuxt, etc.
  {
    pattern: /\b(React|Vue|Angular|Svelte|Next\.js|Nuxt|Ember\.js|Astro|Remix|SolidJS)\b/i,
    trigger: WebResearchTriggerType.FRAMEWORK_SPECIFIC,
    confidence: "should",
  },
  // Node.js, Python, Go, Rust version references
  {
    pattern: /\b(Node\.js|Python|Go|Rust|Java|C#)\s+(\d+|LTS|latest)\b/i,
    trigger: WebResearchTriggerType.FRAMEWORK_SPECIFIC,
    confidence: "should",
  },
  // Popular packages: TypeScript, Webpack, Vitest, Playwright, etc.
  {
    pattern: /\b(TypeScript|Webpack|Vite|Turbopack|Playwright|Cypress|Jest|Vitest|ESLint|Prettier)\b/i,
    trigger: WebResearchTriggerType.FRAMEWORK_SPECIFIC,
    confidence: "should",
  },

  // ─── DATE-SENSITIVE QUERIES (MUST confidence) ─────────────────────────────
  // "breaking changes", "what changed", "deprecat*"
  {
    pattern: /\b(breaking\s+changes|what\s+changed|deprecat\w+|removed\s+in)\b/i,
    trigger: WebResearchTriggerType.DATE_SENSITIVE,
    confidence: "must",
  },
  // "what's new", "what's the latest", "anything new"
  {
    pattern: /\b(what'?s\s+new|what'?s\s+the\s+latest|anything\s+new)\b/i,
    trigger: WebResearchTriggerType.DATE_SENSITIVE,
    confidence: "must",
  },
  // "current best practice", "modern approach", "in 2024"
  {
    pattern: /\b(current\s+best\s+practice|modern\s+approach|modern\s+way|best\s+way\s+to)\b/i,
    trigger: WebResearchTriggerType.DATE_SENSITIVE,
    confidence: "should",
  },

  // ─── LIBRARY/PACKAGE UPDATES (SHOULD confidence) ──────────────────────────
  // "npm", "package.json", "dependencies", "updates"
  {
    pattern: /\b(npm\s+update|package\s+update|latest\s+version|new\s+release)\b/i,
    trigger: WebResearchTriggerType.LIBRARY_UPDATE,
    confidence: "should",
  },

  // ─── BEST PRACTICES (SHOULD confidence) ────────────────────────────────────
  // "best practice for X", "recommended way to"
  {
    pattern: /\b(best\s+practice|best\s+way|recommended\s+way|recommended\s+approach)\b/i,
    trigger: WebResearchTriggerType.BEST_PRACTICES,
    confidence: "should",
  },

  // ─── CURRENT STATUS (SHOULD confidence) ────────────────────────────────────
  // "is X still maintained", "is X still supported", "does X still work"
  {
    pattern: /\b(is\s+.*\s+(still\s+)?(maintained|supported|used|working|active))\b/i,
    trigger: WebResearchTriggerType.CURRENT_STATUS,
    confidence: "should",
  },
  // "dead project", "abandoned", "no longer maintained"
  {
    pattern: /\b(dead\s+project|abandoned|no\s+longer\s+maintained|unmaintained)\b/i,
    trigger: WebResearchTriggerType.CURRENT_STATUS,
    confidence: "should",
  },
]

/**
 * Detects if a user message indicates web research is needed.
 *
 * Strategy:
 * 1. Check for "MUST" confidence triggers first (version checks, breaking changes)
 * 2. If not found, check "SHOULD" triggers (frameworks, best practices)
 * 3. If not found, return "MAYBE" or null
 *
 * @param userMessage - The user's input message
 * @returns Detection result with trigger and confidence level
 */
export function detectWebResearchNeeded(userMessage: string): WebResearchDetectionResult {
  // Normalize the input
  const message = userMessage.toLowerCase().trim()

  // Avoid obvious false positives
  // "my latest project" should not trigger on "latest"
  // "design document" should not trigger as "design"
  const isFalsePositive = (text: string): boolean => {
    // Very short messages probably don't need web research
    if (text.length < 10) return true

    // Avoid false positives from common phrases
    const falsePositivePhrases = [
      /\bmy\s+latest\s+/i,      // "my latest project"
      /\bthe\s+latest\s+trends\b/i, // "the latest trends"
      /\bliterally\s+/i,         // "literally latest"
    ]
    return falsePositivePhrases.some(phrase => phrase.test(text))
  }

  if (isFalsePositive(message)) {
    return { trigger: null, confidence: "maybe" }
  }

  // Collect all matches with their confidence levels
  let bestMatch: { trigger: WebResearchTrigger; confidence: ResearchConfidence } | null = null
  let bestConfidenceLevel = 0 // must = 3, should = 2, maybe = 1

  const confidenceLevels = { must: 3, should: 2, maybe: 1 }

  for (const { pattern, trigger, confidence } of TRIGGER_PATTERNS) {
    if (pattern.test(message)) {
      const match = message.match(pattern)
      const confidenceValue = confidenceLevels[confidence]

      // Keep the match with the highest confidence level
      if (confidenceValue > bestConfidenceLevel) {
        bestConfidenceLevel = confidenceValue
        bestMatch = {
          trigger: {
            type: trigger,
            pattern: match?.[0] || "",
            context: extractContext(message, match?.[0]),
          },
          confidence,
        }
      }
    }
  }

  if (bestMatch) {
    return {
      ...bestMatch,
      reason:
        bestMatch.confidence === "must"
          ? `Found strong indicator: "${bestMatch.trigger.pattern}"`
          : `Found indicator: "${bestMatch.trigger.pattern}"`,
    }
  }

  // No triggers found, but check if message is asking about current/new information
  // This gives us a low "maybe" confidence for general queries
  if (/\b(how|what|why|when|where|which)\b/i.test(message)) {
    return {
      trigger: null,
      confidence: "maybe",
      reason: "Generic question detected",
    }
  }

  return { trigger: null, confidence: "maybe" }
}

/**
 * Extracts context around a matched pattern for informational purposes.
 * @param text - The full text
 * @param pattern - The matched pattern
 * @returns A substring with context (up to 80 chars)
 */
function extractContext(text: string, pattern: string | undefined): string | undefined {
  if (!pattern) return undefined

  const index = text.indexOf(pattern)
  if (index === -1) return undefined

  const start = Math.max(0, index - 20)
  const end = Math.min(text.length, index + pattern.length + 20)
  const context = text.substring(start, end).trim()

  return context.length <= 80 ? context : context.substring(0, 77) + "..."
}
