import { Command } from "commander"
import * as path from "path"
import { fileURLToPath } from "url"
import { execFileSync } from "node:child_process"
import { runInstall } from "./install.js"
import { runDoctor, printYithFunctionCatalog } from "./doctor.js"
import { CLI_VERSION } from "./version.js"
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
  .version(CLI_VERSION)

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
  .option("--force-all", "Reset every phase to pending and re-run the full ritual")
  .option(
    "--claude-only",
    "Run only the claude_transcripts phase. Used by the Stop hook for fast per-tick ingestion.",
  )
  .option(
    "--compress-only",
    "Spawn `claude -p` to drain the pending-compression queue and exit. Non-blocking when --background is set.",
  )
  .option(
    "--background",
    "Fork the current invocation into the background and return immediately. Used by the Stop hook so assistant responses don't block.",
  )
  .option(
    "--project <cwd>",
    "Scope the transcript scan to a specific project cwd (default: all projects).",
  )
  .action(async (options: {
    resume?: boolean
    installCron?: boolean
    interval?: string
    force?: string
    forceAll?: boolean
    claudeOnly?: boolean
    compressOnly?: boolean
    background?: boolean
    project?: string
  }) => {
    // Background fork: re-exec ourselves detached so the parent (the
    // Stop hook shell) returns immediately. Node's spawn with `detached`
    // + `unref` lets us exit the parent while the child continues.
    // Used exclusively by the hook so assistant-turn latency stays low.
    if (options.background) {
      const { spawn } = await import("node:child_process")
      const args = process.argv.slice(2).filter((a) => a !== "--background")
      const child = spawn(process.execPath, [process.argv[1], ...args], {
        detached: true,
        stdio: "ignore",
        env: process.env,
      })
      child.unref()
      return
    }

    if (options.compressOnly) {
      // Spawn `claude -p` with the compression loop prompt. We don't
      // await it — if caller passed --background we already forked
      // above; otherwise we fire-and-forget so the CLI itself returns
      // promptly and the user isn't blocked by a multi-minute claude -p.
      const { spawn } = await import("node:child_process")
      const spawnCmd = buildClaudePSpawnCommand({ limit: 50 })
      // spawnCmd is a shell-formatted string; run via /bin/sh -c.
      const child = spawn("/bin/sh", ["-c", spawnCmd], {
        detached: true,
        stdio: "ignore",
      })
      child.unref()
      console.log(
        "Spawned background compression tick via `claude -p`. " +
          "Check `~/.oh-my-claudecode/yith/necronomicon.json` and the log " +
          "for progress.",
      )
      return
    }

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
        force: options.forceAll
          ? [
              "embedding_download",
              "claude_transcripts",
              "opencode_import",
              "sisyphus_migrate",
              "preliminary_seed",
              "pending_compression_trigger",
            ]
          : options.force
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
        onlyPhases: options.claudeOnly ? ["claude_transcripts"] : undefined,
        projectCwd: options.project,
      })
    } finally {
      await archive.shutdown()
    }
  })

program.parse()
