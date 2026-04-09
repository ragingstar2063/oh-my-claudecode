import type { ClaudeModel } from "../config/schema.js"

/** Canonical model IDs for Claude Code */
export const MODELS = {
  OPUS: "claude-opus-4-6",
  SONNET: "claude-sonnet-4-6",
  HAIKU: "claude-haiku-4-5",
} as const

/** Resolve a short alias or canonical ID to a full model string */
export function resolveModel(model: string | undefined): string {
  if (!model) return MODELS.SONNET
  const aliases: Record<string, string> = {
    opus: MODELS.OPUS,
    sonnet: MODELS.SONNET,
    haiku: MODELS.HAIKU,
  }
  return aliases[model] ?? model
}

/** Default model for each agent tier */
export const DEFAULT_AGENT_MODELS: Record<string, string> = {
  // Opus-tier: primary orchestrators and deep reasoners
  cthulhu: MODELS.OPUS,
  nyarlathotep: MODELS.OPUS,
  azathoth: MODELS.OPUS,
  "shub-niggurath": MODELS.OPUS,
  "yog-sothoth": MODELS.OPUS,
  // Sonnet-tier: mid-complexity specialists
  hastur: MODELS.SONNET,
  ithaqua: MODELS.SONNET,
  tsathoggua: MODELS.SONNET,
  dagon: MODELS.SONNET,
  "the-deep-one": MODELS.SONNET,
  // Haiku-tier: fast pattern matchers
  shoggoth: MODELS.HAIKU,
}

/** Fallback chain for each tier if primary model fails */
export const MODEL_FALLBACK_CHAINS: Record<string, string[]> = {
  [MODELS.OPUS]: [MODELS.SONNET, MODELS.HAIKU],
  [MODELS.SONNET]: [MODELS.HAIKU],
  [MODELS.HAIKU]: [],
}

export function resolveAgentModel(
  agentName: string,
  overrideModel: ClaudeModel | undefined,
  systemDefaultModel: string | undefined,
): string {
  if (overrideModel) return resolveModel(overrideModel)
  return DEFAULT_AGENT_MODELS[agentName] ?? systemDefaultModel ?? MODELS.SONNET
}
