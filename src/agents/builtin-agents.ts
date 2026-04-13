import type { AgentConfig, AvailableAgent, AvailableSkill, AvailableCategory, AgentPromptMetadata } from "./types.js"
import type { AgentOverrides } from "../config/schema.js"

import { createCthulhuAgent, CTHULHU_PROMPT_METADATA } from "./cthulhu.js"
import { createYogSothothAgent, YOG_SOTHOTH_PROMPT_METADATA } from "./yog-sothoth.js"
import { createShoggothAgent, SHOGGOTH_PROMPT_METADATA } from "./shoggoth.js"
import { createDagonAgent, DAGON_PROMPT_METADATA } from "./dagon.js"
import { createTsathoggua, TSATHOGGUA_PROMPT_METADATA } from "./tsathoggua.js"
import { createIthaquaAgent, ITHAQUA_PROMPT_METADATA } from "./ithaqua.js"
import { createHasturAgent, HASTUR_PROMPT_METADATA } from "./hastur.js"
import { createNyarlathotepAgent, NYARLATHOTEP_PROMPT_METADATA } from "./nyarlathotep.js"
import { createAzathothAgent, AZATHOTH_PROMPT_METADATA } from "./azathoth.js"
import { createShubNiggurathAgent, SHUB_NIGGURATH_PROMPT_METADATA } from "./shub-niggurath.js"
import { createDeepOneAgent, DEEP_ONE_PROMPT_METADATA } from "./the-deep-one.js"
import { createArtisanAgent, THE_ARTISAN_PROMPT_METADATA } from "./the-artisan.js"
import { resolveAgentModel } from "../shared/model-resolution.js"
import { deepMerge } from "../shared/deep-merge.js"

/** Maps each agent name to its metadata (for orchestrator prompt building) */
export const AGENT_METADATA_MAP: Record<string, AgentPromptMetadata> = {
  cthulhu: CTHULHU_PROMPT_METADATA,
  "yog-sothoth": YOG_SOTHOTH_PROMPT_METADATA,
  shoggoth: SHOGGOTH_PROMPT_METADATA,
  dagon: DAGON_PROMPT_METADATA,
  tsathoggua: TSATHOGGUA_PROMPT_METADATA,
  ithaqua: ITHAQUA_PROMPT_METADATA,
  hastur: HASTUR_PROMPT_METADATA,
  nyarlathotep: NYARLATHOTEP_PROMPT_METADATA,
  azathoth: AZATHOTH_PROMPT_METADATA,
  "shub-niggurath": SHUB_NIGGURATH_PROMPT_METADATA,
  "the-deep-one": DEEP_ONE_PROMPT_METADATA,
  "the-artisan": THE_ARTISAN_PROMPT_METADATA,
}

export interface BuildAgentsOptions {
  disabledAgents?: string[]
  agentOverrides?: AgentOverrides
  systemDefaultModel?: string
  discoveredSkills?: AvailableSkill[]
  availableCategories?: AvailableCategory[]
  useTaskSystem?: boolean
}

/**
 * Creates all built-in Elder God agents with model resolution and overrides applied.
 * Returns a record of agent name → AgentConfig ready for registration.
 */
export function buildBuiltinAgents(options: BuildAgentsOptions = {}): Record<string, AgentConfig> {
  const {
    disabledAgents = [],
    agentOverrides = {},
    systemDefaultModel,
    discoveredSkills = [],
    availableCategories = [],
    useTaskSystem = false,
  } = options

  const disabled = new Set(disabledAgents)
  const result: Record<string, AgentConfig> = {}

  function isEnabled(name: string): boolean {
    return !disabled.has(name)
  }

  function resolveModel(name: string): string {
    const override = agentOverrides[name as keyof typeof agentOverrides]
    return resolveAgentModel(name, override?.model, systemDefaultModel)
  }

  function applyOverride(config: AgentConfig, name: string): AgentConfig {
    const override = agentOverrides[name as keyof typeof agentOverrides]
    if (!override) return config
    return {
      ...config,
      model: resolveModel(name),
      description: override.description ?? config.description,
      temperature: override.temperature ?? config.temperature,
      maxTokens: override.maxTokens ?? config.maxTokens,
      thinking: override.thinking ?? config.thinking,
      color: override.color ?? config.color,
      prompt: override.prompt ?? config.prompt + (override.prompt_append ? `\n\n${override.prompt_append}` : ""),
      tools: override.tools ? deepMerge(config.tools as Record<string, unknown>, override.tools as Record<string, unknown>) as Record<string, boolean> : config.tools,
    }
  }

  // Build available agents list for orchestrator prompt (excludes disabled agents)
  const availableAgentsList: AvailableAgent[] = Object.entries(AGENT_METADATA_MAP)
    .filter(([name]) => isEnabled(name) && name !== "cthulhu")
    .map(([name, metadata]) => ({
      name,
      description: getAgentDescription(name),
      metadata,
    }))

  // ── Cthulhu (main orchestrator) ─────────────────────────────────────────────
  if (isEnabled("cthulhu")) {
    const model = resolveModel("cthulhu")
    const config = createCthulhuAgent(
      model,
      availableAgentsList,
      [],
      discoveredSkills,
      availableCategories,
      useTaskSystem,
    )
    result["cthulhu"] = applyOverride(config, "cthulhu")
  }

  // ── Nyarlathotep (deep worker) ───────────────────────────────────────────────
  if (isEnabled("nyarlathotep")) {
    const config = createNyarlathotepAgent(resolveModel("nyarlathotep"))
    result["nyarlathotep"] = applyOverride(config, "nyarlathotep")
  }

  // ── Azathoth (first-message planner) ────────────────────────────────────────
  if (isEnabled("azathoth")) {
    const config = createAzathothAgent(
      resolveModel("azathoth"),
      availableAgentsList,
      [],
      discoveredSkills,
      availableCategories,
    )
    result["azathoth"] = applyOverride(config, "azathoth")
  }

  // ── Shub-Niggurath (strategic planner) ──────────────────────────────────────
  if (isEnabled("shub-niggurath")) {
    const config = createShubNiggurathAgent(resolveModel("shub-niggurath"))
    result["shub-niggurath"] = applyOverride(config, "shub-niggurath")
  }

  // ── Yog-Sothoth (oracle/advisor) ────────────────────────────────────────────
  if (isEnabled("yog-sothoth")) {
    const config = createYogSothothAgent(resolveModel("yog-sothoth"))
    result["yog-sothoth"] = applyOverride(config, "yog-sothoth")
  }

  // ── Dagon (librarian) ───────────────────────────────────────────────────────
  if (isEnabled("dagon")) {
    const config = createDagonAgent(resolveModel("dagon"))
    result["dagon"] = applyOverride(config, "dagon")
  }

  // ── Ithaqua (plan consultant) ────────────────────────────────────────────────
  if (isEnabled("ithaqua")) {
    const config = createIthaquaAgent(resolveModel("ithaqua"))
    result["ithaqua"] = applyOverride(config, "ithaqua")
  }

  // ── Tsathoggua (quality reviewer) ───────────────────────────────────────────
  if (isEnabled("tsathoggua")) {
    const config = createTsathoggua(resolveModel("tsathoggua"))
    result["tsathoggua"] = applyOverride(config, "tsathoggua")
  }

  // ── Hastur (junior orchestrator) ────────────────────────────────────────────
  if (isEnabled("hastur")) {
    const config = createHasturAgent(resolveModel("hastur"))
    result["hastur"] = applyOverride(config, "hastur")
  }

  // ── Shoggoth (explorer) ─────────────────────────────────────────────────────
  if (isEnabled("shoggoth")) {
    const config = createShoggothAgent(resolveModel("shoggoth"))
    result["shoggoth"] = applyOverride(config, "shoggoth")
  }

  // ── The Deep One (vision) ───────────────────────────────────────────────────
  if (isEnabled("the-deep-one")) {
    const config = createDeepOneAgent(resolveModel("the-deep-one"))
    result["the-deep-one"] = applyOverride(config, "the-deep-one")
  }

  // ── The Artisan (frontend design) ────────────────────────────────────────────
  if (isEnabled("the-artisan")) {
    const config = createArtisanAgent(resolveModel("the-artisan"))
    result["the-artisan"] = applyOverride(config, "the-artisan")
  }

  return result
}

/** Short descriptions for the delegation table in Cthulhu's prompt */
function getAgentDescription(name: string): string {
  const descriptions: Record<string, string> = {
    "yog-sothoth": "Architecture/debugging advisor. Consult for hard problems and design decisions.",
    shoggoth: "Codebase pattern-matcher. Fast parallel search for files and code.",
    dagon: "External library and documentation specialist.",
    tsathoggua: "Work plan reviewer. Verifies plans are executable.",
    ithaqua: "Pre-planning consultant. Analyzes intent, prevents over-engineering.",
    hastur: "Lightweight sub-orchestrator for bounded tasks.",
    nyarlathotep: "Deep autonomous worker. End-to-end goal execution.",
    azathoth: "First-message planner. Initial context gathering.",
    "shub-niggurath": "Strategic planner. Interview → scope → plan.",
    "the-deep-one": "Vision specialist. Analyzes images and visual content.",
    "the-artisan": "Frontend design specialist. Intent → spec → impl → polish methodology.",
  }
  return descriptions[name] ?? "Specialized agent."
}
