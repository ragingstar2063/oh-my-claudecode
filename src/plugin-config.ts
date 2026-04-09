import * as fs from "fs"
import * as path from "path"
import { OhMyClaudeCodeConfigSchema, type OhMyClaudeCodeConfig } from "./config/schema.js"
import { deepMerge, parseJsonc, log } from "./shared/index.js"

const CONFIG_BASENAME = "oh-my-claudecode"
const LEGACY_BASENAME = "elder-gods"

const PARTIAL_STRING_ARRAY_KEYS = new Set([
  "disabled_mcps",
  "disabled_agents",
  "disabled_skills",
  "disabled_hooks",
  "disabled_commands",
  "disabled_tools",
  "mcp_env_allowlist",
])

/** Parse config partially — skip invalid sections instead of failing entirely */
export function parseConfigPartially(
  rawConfig: Record<string, unknown>,
): OhMyClaudeCodeConfig | null {
  const fullResult = OhMyClaudeCodeConfigSchema.safeParse(rawConfig)
  if (fullResult.success) return fullResult.data

  const partial: Record<string, unknown> = {}

  for (const key of Object.keys(rawConfig)) {
    if (PARTIAL_STRING_ARRAY_KEYS.has(key)) {
      const val = rawConfig[key]
      if (Array.isArray(val) && val.every(v => typeof v === "string")) {
        partial[key] = val
      }
      continue
    }

    const result = OhMyClaudeCodeConfigSchema.safeParse({ [key]: rawConfig[key] })
    if (result.success) {
      const parsed = result.data as Record<string, unknown>
      if (parsed[key] !== undefined) {
        partial[key] = parsed[key]
      }
    } else {
      log(`Config section "${key}" is invalid — skipping`, {
        errors: result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`),
      })
    }
  }

  return partial as OhMyClaudeCodeConfig
}

/** Detect config file at a base directory, preferring .jsonc over .json */
export function detectConfigFile(baseDir: string): { path: string; exists: boolean } {
  const candidates = [
    path.join(baseDir, `${CONFIG_BASENAME}.jsonc`),
    path.join(baseDir, `${CONFIG_BASENAME}.json`),
    path.join(baseDir, `${LEGACY_BASENAME}.jsonc`),
    path.join(baseDir, `${LEGACY_BASENAME}.json`),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { path: candidate, exists: true }
    }
  }
  return { path: path.join(baseDir, `${CONFIG_BASENAME}.json`), exists: false }
}

/** Load and parse a config file from a given path */
export function loadConfigFromPath(configPath: string): OhMyClaudeCodeConfig | null {
  try {
    if (!fs.existsSync(configPath)) return null

    const content = fs.readFileSync(configPath, "utf-8")
    const rawConfig = parseJsonc<Record<string, unknown>>(content)

    const result = OhMyClaudeCodeConfigSchema.safeParse(rawConfig)
    if (result.success) {
      log(`Config loaded from ${configPath}`)
      return result.data
    }

    log(`Config validation errors in ${configPath}`, {
      errors: result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`),
    })

    const partial = parseConfigPartially(rawConfig)
    if (partial) {
      log(`Partial config loaded from ${configPath}`)
      return partial
    }

    return null
  } catch (err) {
    log(`Error loading config from ${configPath}`, { error: String(err) })
    return null
  }
}

/** Deep merge two configs, with array keys unioned and objects recursively merged */
export function mergeConfigs(
  base: OhMyClaudeCodeConfig,
  override: OhMyClaudeCodeConfig,
): OhMyClaudeCodeConfig {
  return {
    ...base,
    ...override,
    agents: deepMerge(
      base.agents as Record<string, unknown>,
      override.agents as Record<string, unknown>,
    ) as OhMyClaudeCodeConfig["agents"],
    categories: deepMerge(
      base.categories as Record<string, unknown>,
      override.categories as Record<string, unknown>,
    ) as OhMyClaudeCodeConfig["categories"],
    disabled_agents: [...new Set([...(base.disabled_agents ?? []), ...(override.disabled_agents ?? [])])],
    disabled_mcps: [...new Set([...(base.disabled_mcps ?? []), ...(override.disabled_mcps ?? [])])],
    disabled_hooks: [...new Set([...(base.disabled_hooks ?? []), ...(override.disabled_hooks ?? [])])],
    disabled_commands: [...new Set([...(base.disabled_commands ?? []), ...(override.disabled_commands ?? [])])],
    disabled_skills: [...new Set([...(base.disabled_skills ?? []), ...(override.disabled_skills ?? [])])],
    disabled_tools: [...new Set([...(base.disabled_tools ?? []), ...(override.disabled_tools ?? [])])],
    mcp_env_allowlist: [...new Set([...(base.mcp_env_allowlist ?? []), ...(override.mcp_env_allowlist ?? [])])],
  }
}

/**
 * Load and merge plugin config from:
 * 1. User-level (~/.claude/oh-my-claudecode.json[c])
 * 2. Project-level (.claude/oh-my-claudecode.json[c])
 *
 * Project config overrides user config for scalar/object fields.
 * Array fields (disabled_*) are unioned.
 */
export function loadPluginConfig(projectDirectory: string): OhMyClaudeCodeConfig {
  // User-level config
  const userConfigDir = path.join(
    process.env.HOME ?? process.env.USERPROFILE ?? "~",
    ".claude",
  )
  const userDetected = detectConfigFile(userConfigDir)
  const userConfig = userDetected.exists ? loadConfigFromPath(userDetected.path) : null

  // Project-level config
  const projectConfigDir = path.join(projectDirectory, ".claude")
  const projectDetected = detectConfigFile(projectConfigDir)
  const projectConfig = projectDetected.exists ? loadConfigFromPath(projectDetected.path) : null

  // Start from user config (or Zod defaults)
  let config: OhMyClaudeCodeConfig = userConfig ?? OhMyClaudeCodeConfigSchema.parse({})

  // Layer project config on top
  if (projectConfig) {
    config = mergeConfigs(config, projectConfig)
  }

  log("Final merged plugin config", {
    disabled_agents: config.disabled_agents,
    disabled_hooks: config.disabled_hooks,
    disabled_mcps: config.disabled_mcps,
  })

  return config
}
