import * as fs from "fs"
import * as path from "path"
import * as readline from "readline"
import { ALL_HOOK_DEFINITIONS } from "../hooks/index.js"

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? ""
const CLAUDE_DIR = path.join(HOME, ".claude")
const HOOKS_DIR = path.join(CLAUDE_DIR, "hooks")
const COMMANDS_DIR = path.join(CLAUDE_DIR, "commands")
const LEGACY_SKILLS_DIR = path.join(CLAUDE_DIR, "skills")
const SETTINGS_PATH = path.join(CLAUDE_DIR, "settings.json")
const YITH_DATA_DIR = path.join(HOME, ".oh-my-claudecode", "yith")
const YITH_ENV_PATH = path.join(YITH_DATA_DIR, ".env")
const MCP_SERVER_NAME = "yith-archive"

/**
 * Map of env var names to hosted embedding providers the installer supports.
 * The installer uses this for both pre-existing-key detection and interactive
 * selection. Order matters — it's the preference used when multiple keys
 * happen to be set (mirrors detectEmbeddingProvider in yith-archive/config.ts).
 */
const EMBEDDING_PROVIDERS: Array<{
  id: "local" | "gemini" | "openai" | "voyage"
  label: string
  envKey: string
  description: string
}> = [
  {
    id: "local",
    label: "Local nomic",
    envKey: "",
    description: "nomic-embed-text-v1.5, ~137 MB, downloaded on first use — private, offline, zero setup",
  },
  {
    id: "gemini",
    label: "Gemini",
    envKey: "GEMINI_API_KEY",
    description: "free tier: 1,500 RPM, generous for backfill",
  },
  {
    id: "openai",
    label: "OpenAI",
    envKey: "OPENAI_API_KEY",
    description: "paid, text-embedding-3-small",
  },
  {
    id: "voyage",
    label: "Voyage",
    envKey: "VOYAGE_API_KEY",
    description: "Anthropic's recommended partner",
  },
]

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/** Create the Yith data dir with restrictive permissions. Idempotent. */
function ensureYithDataDir(): void {
  if (!fs.existsSync(YITH_DATA_DIR)) {
    fs.mkdirSync(YITH_DATA_DIR, { recursive: true, mode: 0o700 })
    console.log(`  Created Yith data dir: ${YITH_DATA_DIR}`)
  } else {
    // Tighten perms if a previous install created the dir world-readable.
    try {
      fs.chmodSync(YITH_DATA_DIR, 0o700)
    } catch {
      /* non-fatal */
    }
  }
}

/**
 * Check the environment for an already-set embedding-provider API key.
 * Returns the matching provider id + key value, or null if none set.
 * Used to pre-seed the interactive prompt so users aren't asked twice.
 */
function detectExistingEmbeddingKey(): { id: "gemini" | "openai" | "voyage"; key: string } | null {
  for (const p of EMBEDDING_PROVIDERS) {
    if (p.envKey && process.env[p.envKey]) {
      return { id: p.id as "gemini" | "openai" | "voyage", key: process.env[p.envKey]! }
    }
  }
  return null
}

/**
 * Prompt the user for an embedding provider choice. Returns the selected
 * provider id and (if a hosted provider was picked) the API key to write
 * into the Yith .env. Honors pre-existing env keys by offering them as
 * the default instead of re-asking. Returns "local" with no key if the
 * user takes the default or declines every hosted option.
 */
async function promptEmbeddingProvider(
  rl: readline.Interface,
): Promise<{ providerId: "local" | "gemini" | "openai" | "voyage"; apiKey?: string }> {
  const existing = detectExistingEmbeddingKey()

  if (existing) {
    const label = EMBEDDING_PROVIDERS.find((p) => p.id === existing.id)!.label
    const answer = await ask(
      rl,
      `\n► Embeddings: detected ${existing.id.toUpperCase()}_API_KEY in your shell — use ${label} for Yith embeddings? [Y/n] `,
    )
    if (answer.trim().toLowerCase() !== "n") {
      return { providerId: existing.id, apiKey: existing.key }
    }
    // User declined the detected key — fall through to full menu.
  }

  console.log("\n► Embeddings:")
  console.log(
    "  Yith Archive uses local embeddings by default. Alternatives are available if you'd rather",
  )
  console.log("  use a hosted provider:\n")
  EMBEDDING_PROVIDERS.forEach((p, i) => {
    const tag = p.id === "local" ? "  [default]" : ""
    console.log(`    ${i + 1}. ${p.label}${tag} — ${p.description}`)
  })

  const answer = await ask(rl, "\n  Choice [1]: ")
  const idx = parseInt(answer.trim() || "1", 10) - 1
  const chosen = EMBEDDING_PROVIDERS[idx]
  if (!chosen || chosen.id === "local") {
    return { providerId: "local" }
  }

  // Hosted provider chosen — collect the key. Plain readline input, not
  // hidden — matches how `git credential` etc. work for local tools and
  // keeps the install flow simple. Users running in screen-shared sessions
  // can set the env var before running install instead.
  const keyPrompt = `\n  Enter ${chosen.envKey} (or press Enter to fall back to local): `
  const rawKey = await ask(rl, keyPrompt)
  const key = rawKey.trim()
  if (!key) {
    console.log("  No key entered — falling back to local embeddings.")
    return { providerId: "local" }
  }
  return { providerId: chosen.id, apiKey: key }
}

/**
 * Write (or update) the Yith .env file with a single KEY=value line for
 * the given embedding provider. Preserves any existing lines untouched.
 * Sets file mode 0600 so the API key isn't world-readable.
 */
function writeYithEnvKey(envKey: string, value: string): void {
  ensureYithDataDir()
  let existing = ""
  if (fs.existsSync(YITH_ENV_PATH)) {
    existing = fs.readFileSync(YITH_ENV_PATH, "utf-8")
  }
  const lines = existing.split("\n").filter((l) => !l.startsWith(`${envKey}=`))
  lines.push(`${envKey}=${value}`)
  // Trim trailing empty line noise and ensure exactly one newline at EOF.
  const content = lines.filter((l, i, arr) => !(l === "" && i === arr.length - 1)).join("\n") + "\n"
  fs.writeFileSync(YITH_ENV_PATH, content, { mode: 0o600 })
  // writeFileSync won't tighten perms if the file already exists with a
  // looser mode — apply explicitly to cover that case.
  try {
    fs.chmodSync(YITH_ENV_PATH, 0o600)
  } catch {
    /* non-fatal */
  }
  console.log(`  Saved ${envKey} to ${YITH_ENV_PATH} (mode 600)`)
}

/**
 * Register the yith-mcp server in settings.json → mcpServers. Idempotent:
 * if the entry already exists with a matching command, leaves it alone.
 * Uses an absolute path to bin/yith-mcp.js from the installed package so
 * Claude Code can spawn it regardless of whether `yith-mcp` is on PATH.
 */
function registerYithMcpServer(
  settings: Record<string, unknown>,
  packageRoot: string,
): void {
  const serverPath = path.join(packageRoot, "bin", "yith-mcp.js")
  const mcpServers =
    (settings.mcpServers as Record<string, unknown> | undefined) ?? {}

  const existing = mcpServers[MCP_SERVER_NAME] as
    | { command?: string; args?: string[]; type?: string }
    | undefined
  if (existing?.command === "node" && existing.args?.[0] === serverPath) {
    console.log(`  MCP server already registered: ${MCP_SERVER_NAME}`)
  } else {
    mcpServers[MCP_SERVER_NAME] = {
      type: "stdio",
      command: "node",
      args: [serverPath],
    }
    console.log(
      `  Registered MCP server: ${MCP_SERVER_NAME} → node ${serverPath}`,
    )
  }
  settings.mcpServers = mcpServers
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

/** Install slash command markdown files from the package into ~/.claude/commands/ */
function installCommands(packageRoot: string, disabled: Set<string>): void {
  ensureDir(COMMANDS_DIR)
  const commandsSourceDir = path.join(packageRoot, "commands")
  if (!fs.existsSync(commandsSourceDir)) {
    console.log("  No commands directory found in package — skipping")
    return
  }

  const commandFiles = fs.readdirSync(commandsSourceDir).filter(f => f.endsWith(".md"))
  for (const file of commandFiles) {
    const commandName = path.basename(file, ".md")
    if (disabled.has(commandName)) {
      console.log(`  Skipping disabled command: /${commandName}`)
      continue
    }
    const src = path.join(commandsSourceDir, file)
    const dest = path.join(COMMANDS_DIR, file)
    fs.copyFileSync(src, dest)
    console.log(`  Installed command: /${commandName} → ${dest}`)
  }
}

/**
 * Clean up stray markdown files left by older buggy installs in ~/.claude/skills/.
 * Earlier versions of the installer wrote slash commands to the wrong directory;
 * this removes those stragglers so they don't confuse anything.
 */
function cleanupLegacySkillFiles(packageRoot: string): void {
  if (!fs.existsSync(LEGACY_SKILLS_DIR)) return
  const commandsSourceDir = path.join(packageRoot, "commands")
  if (!fs.existsSync(commandsSourceDir)) return

  const ourFileNames = new Set(
    fs.readdirSync(commandsSourceDir).filter(f => f.endsWith(".md")),
  )

  for (const name of ourFileNames) {
    const strayPath = path.join(LEGACY_SKILLS_DIR, name)
    if (fs.existsSync(strayPath) && fs.statSync(strayPath).isFile()) {
      fs.unlinkSync(strayPath)
      console.log(`  Removed stray file from old install: ${strayPath}`)
    }
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
  let disabledCommands = new Set<string>()
  let embeddingChoice: {
    providerId: "local" | "gemini" | "openai" | "voyage"
    apiKey?: string
  } = { providerId: "local" }

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

    const commandAnswer = await ask(rl, "\nInstall all slash commands? [Y/n] ")
    if (commandAnswer.toLowerCase() === "n") {
      disabledCommands = new Set(["all"])
    }

    embeddingChoice = await promptEmbeddingProvider(rl)

    rl.close()
    console.log()
  }

  console.log("Installing oh-my-claudecode...\n")

  // Install hook scripts
  console.log("► Hooks:")
  installHooks(disabledHooks)

  // Ensure Yith data dir before writing .env or settings
  console.log("\n► Yith Archive:")
  ensureYithDataDir()
  if (embeddingChoice.providerId !== "local" && embeddingChoice.apiKey) {
    const envKey = EMBEDDING_PROVIDERS.find((p) => p.id === embeddingChoice.providerId)!.envKey
    writeYithEnvKey(envKey, embeddingChoice.apiKey)
  } else {
    console.log("  Embeddings: local nomic (no API key needed)")
  }

  // Update settings.json
  console.log("\n► Settings:")
  const settings = loadSettings()
  registerHooksInSettings(settings, disabledHooks)
  registerYithMcpServer(settings, packageRoot)
  saveSettings(settings)
  console.log(`  Saved settings to ${SETTINGS_PATH}`)

  // Clean up stragglers left by older buggy installs that wrote to ~/.claude/skills/
  cleanupLegacySkillFiles(packageRoot)

  // Install slash commands
  if (!disabledCommands.has("all")) {
    console.log("\n► Slash commands:")
    installCommands(packageRoot, disabledCommands)
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
  console.log(`Commands: ${COMMANDS_DIR}`)
  console.log(`Yith data: ${YITH_DATA_DIR}`)
  if (embeddingChoice.providerId === "local") {
    console.log(
      "\nNote: first Yith session will download the nomic embedding model (~137 MB). One-time.",
    )
  }
  console.log("Start a new Claude Code session and type /cthulhu to begin.\n")
}
