/**
 * Design Task Detector
 *
 * Detects when a user message indicates a frontend/design task.
 * Used to route messages to The Artisan subagent.
 */

/**
 * Confidence level for design task detection
 */
export type DesignConfidence = "high" | "medium" | "low"

/**
 * Result of design task detection
 */
export interface DesignDetectionResult {
  isDesignTask: boolean
  confidence: DesignConfidence
  keywords: string[]
  reason?: string
}

/**
 * Configuration for design detector
 */
export interface DesignDetectorConfig {
  enabled: boolean
  min_confidence?: "high" | "medium" | "low"
  exclude_patterns?: string[]
}

/**
 * HIGH confidence design keywords — strongly indicate design tasks
 */
const HIGH_CONFIDENCE_KEYWORDS = [
  // Component/UI terms
  "component",
  "ui",
  "interface",
  "design",
  "button",
  "card",
  "form",
  "modal",
  "dialog",
  "sidebar",
  "navbar",
  "menu",
  "dropdown",
  "tooltip",
  "popover",
  "accordion",
  "tab",
  "carousel",

  // Layout/styling
  "layout",
  "responsive",
  "mobile-first",
  "breakpoint",
  "css",
  "tailwind",
  "style",
  "theme",
  "dark mode",
  "flexbox",
  "grid",

  // Accessibility
  "accessibility",
  "wcag",
  "aria",
  "semantic html",
  "keyboard navigation",
  "screen reader",

  // Design system
  "design system",
  "design tokens",
  "component library",
  "storybook",
]

/**
 * MEDIUM confidence design keywords — suggest design tasks
 */
const MEDIUM_CONFIDENCE_KEYWORDS = [
  // Framework/library specific
  "react",
  "vue",
  "svelte",
  "angular",
  "next.js",
  "nuxt",
  "astro",
  "solid",

  // UI libraries
  "shadcn",
  "material-ui",
  "chakra",
  "radix",
  "ant-design",
  "storybook",

  // General design
  "color",
  "typography",
  "animation",
  "transition",
  "interaction",
  "user experience",
  "ux",
  "ui/ux",
  "mockup",
  "prototype",
  "wireframe",
  "styling",
  "style",

  // Styling tools
  "sass",
  "less",
  "postcss",
  "emotion",
  "styled-components",
  "css-in-js",
]

/**
 * LOW confidence design keywords — weak signal for design tasks
 * Used as fallback when other keywords are present
 */
const LOW_CONFIDENCE_KEYWORDS = [
  "design",
  "build",
  "create",
  "make",
  "implement",
  "polish",
  "refine",
  "improve",
  "visual",
  "appearance",
]

/**
 * Negative patterns — indicate this is NOT a design task
 */
const NEGATIVE_PATTERNS = [
  /\bdesign\s+(pattern|doc|document|spec)\b/i,      // "design document", "design spec"
  /\bsystem\s+design\b/i,                             // "system design" (infrastructure)
  /\b(database|schema|architecture|algorithm|data|api|network)\s+design\b/i, // Non-UI design
  /\bdesign\s+(system|database|schema|architecture|algorithm|data|api|network|relational|query)\b/i, // "design system", "design database"
  /\bdesign\s+a\s+(relational\s+)?(database|system|algorithm|schema|api|network|backend|server)\b/i, // "design a database"
]

/**
 * Detects if a user message indicates a design task.
 *
 * Strategy:
 * 1. Check for HIGH confidence keywords (component, ui, interface, etc.)
 * 2. If not found, check MEDIUM confidence keywords (react, vue, animation, etc.)
 * 3. If not found, check LOW confidence keywords
 * 4. Verify no negative patterns are present
 * 5. Return confidence level and matched keywords
 *
 * @param userMessage - The user's input message
 * @returns Detection result with confidence and matched keywords
 */
export function detectDesignTask(userMessage: string): DesignDetectionResult {
  const message = userMessage.toLowerCase().trim()

  // Very short messages unlikely to be design tasks
  if (message.length < 8) {
    return {
      isDesignTask: false,
      confidence: "low",
      keywords: [],
      reason: "Message too short to detect design task",
    }
  }

  // Check for negative patterns first (filter out false positives)
  for (const pattern of NEGATIVE_PATTERNS) {
    if (pattern.test(message)) {
      return {
        isDesignTask: false,
        confidence: "low",
        keywords: [],
        reason: `Matched negative pattern: ${pattern.source}`,
      }
    }
  }

  // Check HIGH confidence keywords
  const highMatches = findMatchingKeywords(message, HIGH_CONFIDENCE_KEYWORDS)
  if (highMatches.length > 0) {
    return {
      isDesignTask: true,
      confidence: "high",
      keywords: highMatches,
      reason: `Found high-confidence design keywords: ${highMatches.join(", ")}`,
    }
  }

  // Check MEDIUM confidence keywords
  const mediumMatches = findMatchingKeywords(message, MEDIUM_CONFIDENCE_KEYWORDS)
  if (mediumMatches.length >= 2) {
    // Require at least 2 medium keywords
    return {
      isDesignTask: true,
      confidence: "medium",
      keywords: mediumMatches,
      reason: `Found multiple medium-confidence keywords: ${mediumMatches.join(", ")}`,
    }
  }

  // Check if there's a high context for design (e.g., specific frameworks + design intent)
  if (mediumMatches.length === 1) {
    const frameworks = ["react", "vue", "svelte", "angular", "next.js", "nuxt", "astro"]
    const isFramework = frameworks.some(fw => message.includes(fw))

    const designIntents = [
      "build",
      "create",
      "make",
      "design",
      "style",
      "implement",
      "component",
    ]
    const hasDesignIntent = designIntents.some(intent => message.includes(intent))

    if (isFramework && hasDesignIntent) {
      return {
        isDesignTask: true,
        confidence: "medium",
        keywords: mediumMatches,
        reason: `Framework + design intent detected: ${mediumMatches.join(", ")}`,
      }
    }
  }

  // Check LOW confidence keywords as last resort
  const lowMatches = findMatchingKeywords(message, LOW_CONFIDENCE_KEYWORDS)
  if (lowMatches.length >= 2) {
    return {
      isDesignTask: true,
      confidence: "low",
      keywords: lowMatches,
      reason: `Found low-confidence design keywords: ${lowMatches.join(", ")}`,
    }
  }

  // No design task detected
  return {
    isDesignTask: false,
    confidence: "low",
    keywords: [],
    reason: "No design keywords or patterns detected",
  }
}

/**
 * Finds matching keywords in a message
 * @param message - The message to search in
 * @param keywords - The keywords to match
 * @returns Array of matched keywords (unique)
 */
function findMatchingKeywords(message: string, keywords: string[]): string[] {
  const matched = new Set<string>()

  for (const keyword of keywords) {
    // Use word boundaries to avoid partial matches
    // "component" should match "component" but not "decompose"
    const pattern = new RegExp(`\\b${keyword}\\b`, "i")
    if (pattern.test(message)) {
      matched.add(keyword)
    }
  }

  return Array.from(matched)
}

/**
 * Export for testing
 * Finds keywords in message without case sensitivity
 */
export function findDesignKeywords(message: string): string[] {
  const highMatches = findMatchingKeywords(message, HIGH_CONFIDENCE_KEYWORDS)
  if (highMatches.length > 0) return highMatches

  const mediumMatches = findMatchingKeywords(message, MEDIUM_CONFIDENCE_KEYWORDS)
  if (mediumMatches.length > 0) return mediumMatches

  return findMatchingKeywords(message, LOW_CONFIDENCE_KEYWORDS)
}
