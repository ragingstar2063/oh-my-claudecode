import { Command } from "commander"
import * as path from "path"
import { fileURLToPath } from "url"
import { execFileSync } from "node:child_process"
import { runInstall } from "./install.js"
import { runDoctor, printYithFunctionCatalog } from "./doctor.js"
import { runBind } from "./bind.js"
import {
  buildClaudePSpawnCommand,
  buildCrontabLine,
  installCrontabEntry,
  parseIntervalSpec,
} from "./bind-cron.js"
import { TuiWriter } from "./tui.js"

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
  .option("--yith-functions", "Print the full Yith memory function catalog and exit")
  .action(async (directory: string, options: { yithFunctions?: boolean }) => {
    if (options.yithFunctions) {
      printYithFunctionCatalog()
      return
    }
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

program
  .command("bind")
  .description(
    "Run the Necronomicon binding ritual — download embedding model, " +
      "ingest past transcripts, import opencode history, migrate sisyphus " +
      "dirs, seed preliminary memories. Resumable.",
  )
  .option("--resume", "Cron-friendly: run only pending work and exit")
  .option(
    "--install-cron",
    "Install a system crontab entry that runs `bind --resume` on an interval",
  )
  .option(
    "--interval <spec>",
    "Interval for the cron entry (e.g. 1h, 30m, 1d). Used with --install-cron.",
    "1h",
  )
  .option("--force <phase>", "Re-run a specific phase even if already completed")
  .action(async (options: {
    resume?: boolean
    installCron?: boolean
    interval?: string
    force?: string
  }) => {
    if (options.installCron) {
      // Install the crontab entry that runs `bind --resume`.
      const schedule = parseIntervalSpec(options.interval ?? "1h")
      const binCmd = process.argv[1] ?? "oh-my-claudecode"
      const crontabBody = buildCrontabLine({
        schedule,
        command: `${binCmd} bind --resume`,
      })
      let current = ""
      try {
        current = execFileSync("crontab", ["-l"], {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        })
      } catch {
        current = ""
      }
      const updated = installCrontabEntry(current, crontabBody)
      execFileSync("crontab", ["-"], { input: updated })
      console.log(
        `Installed crontab entry on schedule '${schedule}'. The cron ` +
          `tick will run \`${binCmd} bind --resume\` to ingest new data ` +
          `and drive compression via \`claude -p\`.`,
      )
      console.log(`Spawn command preview:\n  ${buildClaudePSpawnCommand({})}`)
      return
    }

    const { createYithArchive } = await import(
      "../features/yith-archive/index.js"
    )
    const archive = createYithArchive()
    const tui = new TuiWriter({
      write: (s: string) => process.stdout.write(s),
      isTTY: process.stdout.isTTY ?? false,
    })
    try {
      await runBind({
        archive,
        tui,
        force: options.force
          ? [
              options.force as
                | "embedding_download"
                | "claude_transcripts"
                | "opencode_import"
                | "sisyphus_migrate"
                | "preliminary_seed"
                | "pending_compression_trigger",
            ]
          : undefined,
      })
    } finally {
      await archive.shutdown()
    }
  })

program.parse()
