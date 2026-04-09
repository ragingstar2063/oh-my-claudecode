/**
 * oh-my-claudecode — Elder Gods Agentic Harness for Claude Code
 *
 * Ph'nglui mglw'nafh Cthulhu R'lyeh wgah'nagl fhtagn.
 *
 * This is the main plugin entry point. It exports:
 * - Agent configs for all 11 Elder God agents
 * - Hook definitions for lifecycle behaviors
 * - Config loading and merging utilities
 * - The ClaudeCodePlugin descriptor used by the installer
 *
 * The 11 Elder God agents:
 *
 * | Elder God       | Model  | Role                    |
 * |-----------------|--------|-------------------------|
 * | Cthulhu         | Opus   | Main orchestrator       |
 * | Nyarlathotep    | Opus   | Deep autonomous worker  |
 * | Azathoth        | Opus   | First-message planner   |
 * | Shub-Niggurath  | Opus   | Strategic planner       |
 * | Yog-Sothoth     | Opus   | Architecture advisor    |
 * | Hastur          | Sonnet | Lightweight orchestrator|
 * | Ithaqua         | Sonnet | Pre-planning consultant |
 * | Tsathoggua      | Sonnet | Quality reviewer        |
 * | Dagon           | Sonnet | Documentation search    |
 * | The Deep One    | Sonnet | Vision agent            |
 * | Shoggoth        | Haiku  | Fast codebase search    |
 */

export { loadPluginConfig, mergeConfigs, loadConfigFromPath } from "./plugin-config.js"
export { buildBuiltinAgents, AGENT_METADATA_MAP } from "./agents/builtin-agents.js"
export { getEnabledHooks, buildHooksConfig, ALL_HOOK_DEFINITIONS } from "./hooks/index.js"
export { applyConfig } from "./plugin-handlers/config-handler.js"

export type {
  OhMyClaudeCodeConfig,
  AgentOverrides,
  HookName,
  BuiltinAgentName,
  BuiltinCommandName,
  BuiltinSkillName,
  McpName,
  ClaudeModel,
} from "./config/index.js"

export type {
  AgentConfig,
  AgentMode,
  AgentPromptMetadata,
  AvailableAgent,
  AvailableSkill,
  AvailableCategory,
} from "./agents/types.js"

// Individual agent creators
export {
  createCthulhuAgent,
  createYogSothothAgent,
  createShoggothAgent,
  createDagonAgent,
  createTsathoggua,
  createIthaquaAgent,
  createHasturAgent,
  createNyarlathotepAgent,
  createAzathothAgent,
  createShubNiggurathAgent,
  createDeepOneAgent,
} from "./agents/index.js"

export { MODELS, resolveModel, resolveAgentModel } from "./shared/model-resolution.js"
