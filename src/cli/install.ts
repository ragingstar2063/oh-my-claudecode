import * as fs from "fs"
import * as path from "path"
import * as readline from "readline"
import { ALL_HOOK_DEFINITIONS } from "../hooks/index.js"

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? ""
const CLAUDE_DIR = path.join(HOME, ".claude")
const HOOKS_DIR = path.join(CLAUDE_DIR, "hooks")
const SKILLS_DIR = path.join(CLAUDE_DIR, "skills")
const SETTINGS_PATH = path.join(CLAUDE_DIR, "settings.json")

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve))
}

/** Load existing settings.json or return empty object */
function loadSettings(): Record<string, unknown> {
  if (!fs.existsSync(SETTINGS_PATH)) return {}
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8")) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Save settings.json atomically with backup */
function saveSettings(settings: Record<string, unknown>): void {
  if (fs.existsSync(SETTINGS_PATH)) {
    const backup = SETTINGS_PATH + `.bak.${Date.now()}`
    fs.copyFileSync(SETTINGS_PATH, backup)
    console.log(`  Backed up existing settings to ${backup}`)
  }
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8")
}

/** Install hook shell scripts */
function installHooks(disabled: Set<string>): void {
  ensureDir(HOOKS_DIR)
  for (const hook of ALL_HOOK_DEFINITIONS) {
    if (disabled.has(hook.name)) continue
    const scriptPath = path.join(HOOKS_DIR, path.basename(hook.scriptPath.replace("~/.claude/hooks/", "")))
    fs.writeFileSync(scriptPath, hook.scriptContent, { mode: 0o755 })
    console.log(`  Installed hook: ${hook.name} → ${scriptPath}`)
  }
}

/** Register hooks in settings.json */
function registerHooksInSettings(
  settings: Record<string, unknown>,
  disabled: Set<string>,
): void {
  const hooks = settings.hooks as Record<string, object[]> | undefined ?? {}

  for (const hook of ALL_HOOK_DEFINITIONS) {
    if (disabled.has(hook.name)) continue
    const event = hook.event as string
    if (!hooks[event]) hooks[event] = []

    // Avoid duplicate entries
    const existingCommands = (hooks[event] as Array<{ hooks?: Array<{ command?: string }> }>)
      .flatMap(h => h.hooks?.map(hh => hh.command) ?? [])
    const scriptName = path.basename(hook.scriptPath)

    if (!existingCommands.some(cmd => cmd?.includes(scriptName))) {
      ;(hooks[event] as object[]).push(hook.config)
      console.log(`  Registered ${event} hook: ${hook.name}`)
    } else {
      console.log(`  Hook already registered: ${hook.name}`)
    }
  }

  settings.hooks = hooks
}

/** Install skill files from the package */
function installSkills(packageRoot: string, disabled: Set<string>): void {
  ensureDir(SKILLS_DIR)
  const skillsSourceDir = path.join(packageRoot, "skills")
  if (!fs.existsSync(skillsSourceDir)) {
    console.log("  No skills directory found in package — skipping")
    return
  }

  const skillFiles = fs.readdirSync(skillsSourceDir).filter(f => f.endsWith(".md"))
  for (const file of skillFiles) {
    const skillName = path.basename(file, ".md")
    if (disabled.has(skillName)) {
      console.log(`  Skipping disabled skill: ${skillName}`)
      continue
    }
    const src = path.join(skillsSourceDir, file)
    const dest = path.join(SKILLS_DIR, file)
    fs.copyFileSync(src, dest)
    console.log(`  Installed skill: ${skillName} → ${dest}`)
  }
}

/** Create initial config file if none exists */
function createInitialConfig(configPath: string): void {
  if (fs.existsSync(configPath)) {
    console.log(`  Config already exists: ${configPath}`)
    return
  }
  const initialConfig = {
    $schema: "https://raw.githubusercontent.com/oh-my-claudecode/oh-my-claudecode/main/schema.json",
    // Agent overrides (uncomment to customize)
    // agents: {
    //   cthulhu: { model: "opus" },
    //   shoggoth: { model: "haiku" }
    // },
    // Disable agents you don't need:
    // disabled_agents: ["nyarlathotep", "the-deep-one"],
    // Disable hooks:
    // disabled_hooks: ["comment-checker"],
  }
  fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), "utf-8")
  console.log(`  Created config: ${configPath}`)
}

export async function runInstall(options: {
  noTui?: boolean
  packageRoot: string
}): Promise<void> {
  const { noTui = false, packageRoot } = options

  console.log("\n╔══════════════════════════════════════════════════════╗")
  console.log("║         oh-my-claudecode — Elder Gods Arise          ║")
  console.log("║   Ph'nglui mglw'nafh Cthulhu R'lyeh wgah'nagl fhtagn ║")
  console.log("╚══════════════════════════════════════════════════════╝\n")

  ensureDir(CLAUDE_DIR)

  let disabledHooks = new Set<string>()
  let disabledSkills = new Set<string>()

  if (!noTui) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

    console.log("The Elder Gods shall be configured for your codebase.\n")

    const hookAnswer = await ask(rl, "Enable all lifecycle hooks? [Y/n] ")
    if (hookAnswer.toLowerCase() === "n") {
      console.log("\nAvailable hooks:")
      ALL_HOOK_DEFINITIONS.forEach((h, i) => {
        console.log(`  ${i + 1}. ${h.name} (${h.event})`)
      })
      const disableAnswer = await ask(rl, "Enter hook numbers to disable (comma-separated), or press Enter to keep all: ")
      if (disableAnswer.trim()) {
        const indices = disableAnswer.split(",").map(s => parseInt(s.trim(), 10) - 1)
        for (const i of indices) {
          if (ALL_HOOK_DEFINITIONS[i]) {
            disabledHooks.add(ALL_HOOK_DEFINITIONS[i].name)
          }
        }
      }
    }

    const skillAnswer = await ask(rl, "\nInstall all skills (slash commands)? [Y/n] ")
    if (skillAnswer.toLowerCase() === "n") {
      disabledSkills = new Set(["all"])
    }

    rl.close()
    console.log()
  }

  console.log("Installing oh-my-claudecode...\n")

  // Install hook scripts
  console.log("► Hooks:")
  installHooks(disabledHooks)

  // Update settings.json
  console.log("\n► Settings:")
  const settings = loadSettings()
  registerHooksInSettings(settings, disabledHooks)
  saveSettings(settings)
  console.log(`  Saved settings to ${SETTINGS_PATH}`)

  // Install skills
  if (!disabledSkills.has("all")) {
    console.log("\n► Skills:")
    installSkills(packageRoot, disabledSkills)
  }

  // Create config
  console.log("\n► Config:")
  const configPath = path.join(CLAUDE_DIR, "oh-my-claudecode.jsonc")
  createInitialConfig(configPath)

  console.log("\n╔══════════════════════════════════════════════════════╗")
  console.log("║              Installation Complete!                  ║")
  console.log("║                                                      ║")
  console.log("║  The Elder Gods now watch over your codebase.        ║")
  console.log("║  Cthulhu orchestrates. Shoggoth searches.            ║")
  console.log("║  Yog-Sothoth knows. R'lyeh has risen.                ║")
  console.log("╚══════════════════════════════════════════════════════╝")
  console.log(`\nConfig: ${path.join(CLAUDE_DIR, "oh-my-claudecode.jsonc")}`)
  console.log("Run: claude (and invoke /cthulhu to start)\n")
}
