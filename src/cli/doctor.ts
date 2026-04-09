import * as fs from "fs"
import * as path from "path"
import { ALL_HOOK_DEFINITIONS } from "../hooks/index.js"
import { AGENT_METADATA_MAP } from "../agents/builtin-agents.js"
import { loadPluginConfig } from "../plugin-config.js"

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? ""
const CLAUDE_DIR = path.join(HOME, ".claude")
const HOOKS_DIR = path.join(CLAUDE_DIR, "hooks")
const SKILLS_DIR = path.join(CLAUDE_DIR, "skills")
const SETTINGS_PATH = path.join(CLAUDE_DIR, "settings.json")

interface CheckResult {
  name: string
  status: "ok" | "warn" | "error"
  message: string
}

function check(name: string, condition: boolean, okMsg: string, failMsg: string): CheckResult {
  return {
    name,
    status: condition ? "ok" : "error",
    message: condition ? okMsg : failMsg,
  }
}

function warn(name: string, condition: boolean, okMsg: string, warnMsg: string): CheckResult {
  return {
    name,
    status: condition ? "ok" : "warn",
    message: condition ? okMsg : warnMsg,
  }
}

export async function runDoctor(projectDirectory: string = process.cwd()): Promise<void> {
  console.log("\n╔══════════════════════════════════════════════════════╗")
  console.log("║         oh-my-claudecode — Doctor Diagnostics        ║")
  console.log("╚══════════════════════════════════════════════════════╝\n")

  const results: CheckResult[] = []

  // ── Check 1: ~/.claude directory ────────────────────────────────────────────
  results.push(check(
    "Claude directory",
    fs.existsSync(CLAUDE_DIR),
    `~/.claude exists`,
    `~/.claude not found — run: oh-my-claudecode install`,
  ))

  // ── Check 2: settings.json ──────────────────────────────────────────────────
  const settingsExists = fs.existsSync(SETTINGS_PATH)
  results.push(check(
    "settings.json",
    settingsExists,
    `settings.json found`,
    `settings.json not found — run: oh-my-claudecode install`,
  ))

  // ── Check 3: Hook scripts installed ─────────────────────────────────────────
  let hooksInstalled = 0
  for (const hook of ALL_HOOK_DEFINITIONS) {
    const scriptName = path.basename(hook.scriptPath)
    const scriptPath = path.join(HOOKS_DIR, scriptName)
    if (fs.existsSync(scriptPath)) hooksInstalled++
  }
  results.push(warn(
    "Hook scripts",
    hooksInstalled === ALL_HOOK_DEFINITIONS.length,
    `All ${hooksInstalled} hook scripts installed`,
    `Only ${hooksInstalled}/${ALL_HOOK_DEFINITIONS.length} hook scripts found — run: oh-my-claudecode install`,
  ))

  // ── Check 4: hooks registered in settings.json ──────────────────────────────
  if (settingsExists) {
    try {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8")) as Record<string, unknown>
      const hooksConfig = settings.hooks as Record<string, unknown> | undefined
      const hasHooks = hooksConfig && Object.keys(hooksConfig).length > 0
      results.push(warn(
        "Hooks in settings.json",
        !!hasHooks,
        `Hooks registered in settings.json`,
        `No hooks found in settings.json — run: oh-my-claudecode install`,
      ))
    } catch {
      results.push({ name: "Hooks in settings.json", status: "error", message: "Failed to parse settings.json" })
    }
  }

  // ── Check 5: Skills installed ────────────────────────────────────────────────
  const skillsInstalled = fs.existsSync(SKILLS_DIR)
    ? fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith(".md")).length
    : 0
  results.push(warn(
    "Skills",
    skillsInstalled > 0,
    `${skillsInstalled} skills installed in ~/.claude/skills/`,
    `No skills found in ~/.claude/skills/ — run: oh-my-claudecode install`,
  ))

  // ── Check 6: Plugin config ───────────────────────────────────────────────────
  const configPath = path.join(CLAUDE_DIR, "oh-my-claudecode.jsonc")
  const altConfigPath = path.join(CLAUDE_DIR, "oh-my-claudecode.json")
  const configExists = fs.existsSync(configPath) || fs.existsSync(altConfigPath)
  results.push(warn(
    "Plugin config",
    configExists,
    `Plugin config found`,
    `No plugin config found (~/.claude/oh-my-claudecode.jsonc) — run: oh-my-claudecode install`,
  ))

  // ── Check 7: Validate config if it exists ───────────────────────────────────
  if (configExists) {
    try {
      const config = loadPluginConfig(projectDirectory)
      const agentCount = Object.keys(AGENT_METADATA_MAP).filter(
        n => !(config.disabled_agents ?? []).includes(n),
      ).length
      results.push({ name: "Config validation", status: "ok", message: `Config valid — ${agentCount} agents enabled` })
    } catch (err) {
      results.push({
        name: "Config validation",
        status: "error",
        message: `Config invalid: ${String(err)}`,
      })
    }
  }

  // ── Print results ────────────────────────────────────────────────────────────
  const icons = { ok: "✓", warn: "⚠", error: "✗" }
  const colors = { ok: "\x1b[32m", warn: "\x1b[33m", error: "\x1b[31m" }
  const reset = "\x1b[0m"

  for (const result of results) {
    const icon = icons[result.status]
    const color = colors[result.status]
    console.log(`  ${color}${icon}${reset} ${result.name.padEnd(25)} ${result.message}`)
  }

  const errors = results.filter(r => r.status === "error").length
  const warnings = results.filter(r => r.status === "warn").length

  console.log()
  if (errors === 0 && warnings === 0) {
    console.log("  \x1b[32mAll checks passed. The Elder Gods are pleased.\x1b[0m")
  } else if (errors === 0) {
    console.log(`  \x1b[33m${warnings} warning(s). The stars are almost right.\x1b[0m`)
  } else {
    console.log(`  \x1b[31m${errors} error(s), ${warnings} warning(s). The Elder Gods are not satisfied.\x1b[0m`)
    console.log("  Run: oh-my-claudecode install")
  }
  console.log()
}
