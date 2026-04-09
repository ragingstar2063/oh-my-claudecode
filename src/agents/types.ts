import type { BuiltinAgentName } from "../config/schema.js"

/** How an agent integrates with Claude Code */
export type AgentMode = "primary" | "subagent" | "all"

/** Metadata for building the Cthulhu orchestrator's dynamic prompt sections */
export interface AgentPromptMetadata {
  /** Broad category for grouping in delegation tables */
  category: "orchestration" | "exploration" | "advisor" | "utility"
  /** Relative invocation cost */
  cost: "FREE" | "CHEAP" | "MODERATE" | "EXPENSIVE"
  /** Name displayed in delegation tables */
  promptAlias: string
  /** One-liner trigger for when to fire this agent */
  keyTrigger?: string
  /** Specific trigger scenarios */
  triggers?: Array<{ domain: string; trigger: string }>
  /** When to prefer this agent */
  useWhen?: string[]
  /** When to avoid this agent */
  avoidWhen?: string[]
}

/** Full agent configuration registered with Claude Code */
export interface AgentConfig {
  name: BuiltinAgentName | string
  description: string
  mode: AgentMode
  model: string
  temperature?: number
  maxTokens?: number
  prompt: string
  color?: string
  permission?: Record<string, "allow" | "deny">
  thinking?: { type: "enabled" | "disabled"; budgetTokens?: number }
  tools?: Record<string, boolean>
  skills?: string[]
}

/** Factory function signature for agents that need dynamic prompts */
export type AgentFactory = (
  model: string,
  availableAgents?: AvailableAgent[],
  availableToolNames?: string[],
  availableSkills?: AvailableSkill[],
  availableCategories?: AvailableCategory[],
) => AgentConfig

export interface AvailableAgent {
  name: string
  description: string
  metadata: AgentPromptMetadata
}

export interface AvailableSkill {
  name: string
  description: string
}

export interface AvailableCategory {
  name: string
  description: string
}

export interface AvailableTool {
  name: string
  description: string
}
