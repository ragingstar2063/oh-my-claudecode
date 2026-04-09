import type { OhMyClaudeCodeConfig } from "../config/schema.js"
import { buildBuiltinAgents } from "../agents/builtin-agents.js"
import { log } from "../shared/log.js"
import type { AvailableSkill, AvailableCategory } from "../agents/types.js"

export interface ConfigHandlerDeps {
  pluginConfig: OhMyClaudeCodeConfig
  projectDirectory: string
}

/**
 * Applies the full 5-phase config pipeline:
 *   Phase 1: providers
 *   Phase 2: plugin components (skills, categories)
 *   Phase 3: agents — build and register all Elder God agents
 *   Phase 4: tools — register/disable tools
 *   Phase 5: commands — register built-in commands
 *
 * Returns agent configs for consumption by the plugin host.
 */
export async function applyConfig(
  deps: ConfigHandlerDeps,
  discoveredSkills: AvailableSkill[] = [],
): Promise<{
  agents: Record<string, object>
  availableCategories: AvailableCategory[]
}> {
  const { pluginConfig } = deps

  // Phase 2: resolve categories
  const availableCategories: AvailableCategory[] = Object.entries(pluginConfig.categories ?? {})
    .filter(([, cfg]) => !cfg?.disable)
    .map(([name, cfg]) => ({
      name,
      description: cfg?.description ?? name,
    }))

  // Phase 3: build agents
  const agents = buildBuiltinAgents({
    disabledAgents: pluginConfig.disabled_agents ?? [],
    agentOverrides: pluginConfig.agents ?? {},
    discoveredSkills,
    availableCategories,
    useTaskSystem: pluginConfig.cthulhu_agent?.use_task_system ?? false,
  })

  log("[config-handler] Agents registered", { count: Object.keys(agents).length, names: Object.keys(agents) })

  return { agents, availableCategories }
}
