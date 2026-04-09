import { Command } from "commander"
import * as path from "path"
import { fileURLToPath } from "url"
import { runInstall } from "./install.js"
import { runDoctor } from "./doctor.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PACKAGE_ROOT = path.resolve(__dirname, "../..")

const program = new Command()

program
  .name("oh-my-claudecode")
  .description("Elder Gods agentic harness for Claude Code")
  .version("0.1.0")

program
  .command("install")
  .description("Interactive setup wizard — installs hooks, skills, and config")
  .option("--no-tui", "Non-interactive mode (accept all defaults)")
  .action(async (options) => {
    await runInstall({
      noTui: options.noTui,
      packageRoot: PACKAGE_ROOT,
    })
  })

program
  .command("doctor")
  .description("Health diagnostics — verify installation is complete")
  .argument("[directory]", "Project directory to check", process.cwd())
  .action(async (directory: string) => {
    await runDoctor(directory)
  })

program
  .command("list-agents")
  .description("List all available Elder God agents")
  .action(async () => {
    const { AGENT_METADATA_MAP } = await import("../agents/builtin-agents.js")
    const { DEFAULT_AGENT_MODELS } = await import("../shared/model-resolution.js")

    console.log("\n╔══════════════════════════════════════════╗")
    console.log("║         Elder God Agent Roster           ║")
    console.log("╚══════════════════════════════════════════╝\n")

    const rows = Object.entries(AGENT_METADATA_MAP).map(([name, meta]) => ({
      name,
      alias: meta.promptAlias,
      model: DEFAULT_AGENT_MODELS[name] ?? "sonnet",
      cost: meta.cost,
      category: meta.category,
    }))

    for (const row of rows) {
      console.log(`  ${row.alias.padEnd(20)} ${row.name.padEnd(20)} ${row.model.padEnd(25)} [${row.cost}]`)
    }
    console.log()
  })

program.parse()
