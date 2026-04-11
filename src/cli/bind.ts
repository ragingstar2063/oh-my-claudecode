/**
 * oh-my-claudecode bind — the CLI subcommand that drives the
 * Necronomicon binding ritual.
 *
 * Architecture: a state-machine runner (`runBind`) reads `KV.bindState`,
 * walks through each phase in `BIND_PHASE_ORDER`, invokes the matching
 * `PhaseRunner`, and persists progress after every transition. Phases
 * are injectable — tests pass fakes; production passes the real
 * runners defined in `defaultPhaseRunners()`.
 *
 * Failure semantics: if any phase throws, `runBind` records the error
 * into bindState, halts (does NOT run subsequent phases), and returns.
 * The CLI entry point surfaces the error via the TUI and exits with
 * a non-zero code. A re-run picks up from the failed phase and retries
 * it — the state machine treats `failed` the same as `pending`.
 *
 * Cron-friendly: the same entry point is called from `bind --resume`
 * which prints to stdout and exits, so a crontab can invoke it on
 * an interval without an interactive session.
 */

import { existsSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { YithArchiveHandle } from "../features/yith-archive/index.js"
import { KV } from "../features/yith-archive/state/schema.js"
import { migrateSisyphusDir } from "./sisyphus-migrate.js"
import {
  projectSummaryToObservations,
  scanProject,
} from "./project-scan.js"
import {
  BIND_PHASE_ORDER,
  firstPendingPhase,
  initialBindState,
  markPhase,
  type BindPhase,
  type BindState,
} from "../features/yith-archive/state/bind-state.js"
import {
  TuiWriter,
  renderProgressBar,
  renderSectionHeader,
  renderStatusLine,
  formatBytes,
  formatDuration,
} from "./tui.js"

// ============================================================================
// Types
// ============================================================================

export interface BindContext {
  archive: YithArchiveHandle
  tui: TuiWriter
}

export interface PhaseRunner {
  name: BindPhase
  /**
   * Execute the phase's work. Return a details object to merge into
   * the phase's `details` field (e.g., per-project counts, cursor
   * positions). Throw on failure — the runner catches and records
   * the error into bindState for you.
   */
  run(ctx: BindContext): Promise<{ details?: Record<string, unknown> }>
}

export interface RunBindOptions {
  archive: YithArchiveHandle
  tui: TuiWriter
  /**
   * Phase implementations. Defaults to `defaultPhaseRunners()` when
   * omitted. Tests pass fakes to drive the state machine without
   * hitting the real embedding / backfill / opencode paths.
   */
  phases?: PhaseRunner[]
  /**
   * When set, runs only the listed phases (even if they're already
   * completed). Used by `bind --force <phase>` to re-run a specific
   * phase without touching the others. Default: respect bindState.
   */
  force?: BindPhase[]
}

// ============================================================================
// Phase label + runner
// ============================================================================

/** Human-readable label for each phase — what the user sees in the TUI. */
function phaseLabel(phase: BindPhase): string {
  switch (phase) {
    case "embedding_download":
      return "Phase I: The Embedding Sigil"
    case "claude_transcripts":
      return "Phase II: Claude Code Transcripts"
    case "opencode_import":
      return "Phase III: Opencode Grimoire"
    case "sisyphus_migrate":
      return "Phase IV: Sisyphus Migration"
    case "preliminary_seed":
      return "Phase V: Project Code Scan"
    case "pending_compression_trigger":
      return "Phase VI: Sealing the Tome"
  }
}

/**
 * State-machine driver. Reads bindState, runs pending phases in order,
 * persists progress after each, halts on first failure.
 *
 * Returns the final BindState so callers (the CLI entry point) can
 * summarize what happened and exit with the right code.
 */
export async function runBind(opts: RunBindOptions): Promise<BindState> {
  const { archive, tui, phases = defaultPhaseRunners(), force } = opts
  const kv = archive.kv

  // Load or create bindState.
  let state =
    (await kv.get<BindState>(KV.bindState, "current").catch(() => null)) ??
    initialBindState()

  // If the user asked for a forced re-run of specific phases, reset
  // them to pending before walking the state machine.
  if (force && force.length > 0) {
    for (const phase of force) {
      state = markPhase(state, phase, { status: "pending" })
    }
    await kv.set(KV.bindState, "current", state)
    await kv.persist()
  }

  tui.line(renderSectionHeader("Necronomicon Binding Ritual"))
  tui.line(
    renderStatusLine("info", `Necronomicon: ${necronomiconPath()}`),
  )

  // Report any already-completed phases so the user sees resume state.
  for (const phase of BIND_PHASE_ORDER) {
    if (state.phases[phase].status === "completed") {
      tui.line(
        renderStatusLine("ok", `${phaseLabel(phase)} (already bound)`),
      )
    }
  }

  const started = Date.now()

  while (true) {
    const phase = firstPendingPhase(state)
    if (phase === null) break

    const runner = phases.find((p) => p.name === phase)
    if (!runner) {
      // No runner registered for this phase — treat as completed
      // (phase isn't implemented yet). Mark it completed so we don't
      // block forever, and note it in the details.
      tui.line(
        renderStatusLine(
          "warn",
          `${phaseLabel(phase)} — no runner registered, skipping`,
        ),
      )
      state = markPhase(state, phase, {
        status: "completed",
        details: { skipped: true, reason: "no runner registered" },
      })
      await kv.set(KV.bindState, "current", state)
      await kv.persist()
      continue
    }

    // Mark in_progress, persist, announce.
    state = markPhase(state, phase, { status: "in_progress" })
    await kv.set(KV.bindState, "current", state)
    await kv.persist()

    tui.line(renderSectionHeader(phaseLabel(phase)))
    const phaseStarted = Date.now()

    try {
      const result = await runner.run({ archive, tui })
      const elapsed = formatDuration(Date.now() - phaseStarted)
      state = markPhase(state, phase, {
        status: "completed",
        details: result.details,
      })
      await kv.set(KV.bindState, "current", state)
      await kv.persist()
      tui.line(
        renderStatusLine("ok", `${phaseLabel(phase)} — complete in ${elapsed}`),
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      state = markPhase(state, phase, { status: "failed", error: msg })
      await kv.set(KV.bindState, "current", state)
      await kv.persist()
      tui.line(renderStatusLine("error", `${phaseLabel(phase)} — ${msg}`))
      tui.line(
        renderStatusLine(
          "info",
          "Re-run `oh-my-claudecode bind` to retry from this phase.",
        ),
      )
      return state
    }
  }

  const totalElapsed = formatDuration(Date.now() - started)
  tui.line(renderSectionHeader("Binding Complete"))
  tui.line(
    renderStatusLine(
      "ok",
      `The Necronomicon is bound. Ritual elapsed: ${totalElapsed}`,
    ),
  )
  // Pending-compression teaser so the user knows what comes next.
  const pending = await kv
    .get<{ count: number }>(KV.pendingCompression, "state")
    .catch(() => null)
  if (pending && pending.count > 0) {
    tui.line(
      renderStatusLine(
        "info",
        `${pending.count} raw observations awaiting compression — ` +
          `processed in the background or via /necronomicon-bind in a session.`,
      ),
    )
  }
  return state
}

// ============================================================================
// Default phase runners
// ============================================================================

/** Path where the Necronomicon file lives on this machine. */
function necronomiconPath(): string {
  return join(homedir(), ".oh-my-claudecode", "yith", "necronomicon.json")
}

/**
 * Walk the given root directory up to `maxDepth` levels deep looking
 * for `.sisyphus/` subdirectories. Used by the sisyphus migration
 * phase to find every legacy project that needs translating without
 * requiring the user to enumerate them. Excludes well-known heavy
 * paths (node_modules, .git, .cache) to keep the walk bounded.
 */
function findSisyphusDirs(root: string, maxDepth: number): string[] {
  const skip = new Set([
    "node_modules",
    ".git",
    ".cache",
    ".next",
    "dist",
    ".oh-my-claudecode",
    ".claude",
    ".npm",
    ".npm-global",
  ])
  const out: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (skip.has(entry)) continue
      const full = join(dir, entry)
      let s
      try {
        s = statSync(full)
      } catch {
        continue
      }
      if (!s.isDirectory()) continue
      if (entry === ".sisyphus") {
        out.push(full)
        continue // don't recurse into .sisyphus itself
      }
      walk(full, depth + 1)
    }
  }
  walk(root, 0)
  return out
}

/**
 * Production phase runners. Tests inject fakes; the CLI entry point
 * uses these defaults.
 *
 * Each runner is a thin wrapper that calls the underlying feature
 * (provider warmup, backfill function, opencode importer, etc.) and
 * reports progress via the context's TUI writer.
 *
 * Phases B, C, and D (opencode_import, sisyphus_migrate,
 * preliminary_seed) currently register placeholders that log a
 * "pending implementation" status and complete without work. They
 * get real implementations in their respective phase files.
 */
export function defaultPhaseRunners(): PhaseRunner[] {
  return [
    {
      name: "embedding_download",
      async run({ archive, tui }) {
        const provider = (archive as unknown as {
          embeddingProvider?: {
            warmUp?: (opts?: {
              onProgress?: (e: {
                phase: string
                message?: string
                loaded?: number
                total?: number
              }) => void
            }) => Promise<void>
            name?: string
          }
        }).embeddingProvider
        if (!provider || typeof provider.warmUp !== "function") {
          tui.line(
            renderStatusLine(
              "info",
              "No embedding provider configured — BM25-only mode, skipping model download.",
            ),
          )
          return { details: { skipped: true, reason: "no embedding provider" } }
        }

        tui.line(
          renderStatusLine(
            "pending",
            `Fetching ${provider.name ?? "embedding model"}...`,
          ),
        )
        let lastLoaded = 0
        let lastTotal = 0
        await provider.warmUp({
          onProgress: (e) => {
            if (e.phase === "downloading" && e.loaded && e.total) {
              lastLoaded = e.loaded
              lastTotal = e.total
              tui.replaceLastLine(
                renderProgressBar({
                  current: e.loaded,
                  total: e.total,
                  label: `${formatBytes(e.loaded)} / ${formatBytes(e.total)}`,
                }),
              )
            } else if (e.phase === "loading") {
              tui.line(renderStatusLine("pending", e.message ?? "Loading..."))
            } else if (e.phase === "ready") {
              tui.line(
                renderStatusLine(
                  "ok",
                  e.message ?? "Embedding model ready",
                ),
              )
            }
          },
        })
        return {
          details: {
            bytesDownloaded: lastLoaded,
            totalBytes: lastTotal,
          },
        }
      },
    },
    {
      name: "claude_transcripts",
      async run({ archive, tui }) {
        tui.line(
          renderStatusLine(
            "pending",
            "Scanning ~/.claude/projects/ for transcripts...",
          ),
        )
        const result = (await archive.sdk.trigger("mem::backfill-sessions", {
          allProjects: true,
          dryRun: false,
        })) as {
          totalProjects?: number
          totalObservationsCreated?: number
          totalTranscriptsScanned?: number
          perProject?: Array<{
            projectCwd: string
            observationsCreated: number
          }>
        }
        const projects = result.totalProjects ?? 0
        const obs = result.totalObservationsCreated ?? 0
        const transcripts = result.totalTranscriptsScanned ?? 0
        tui.line(
          renderStatusLine(
            "ok",
            `Ingested ${obs} raw observations from ${transcripts} transcripts across ${projects} projects`,
          ),
        )
        // Per-project breakdown — lets the user see which projects
        // contributed what at a glance. Truncate at 10 to keep the
        // output manageable for users with many projects.
        const perProject = result.perProject ?? []
        for (const p of perProject.slice(0, 10)) {
          if (p.observationsCreated > 0) {
            tui.line(
              renderStatusLine(
                "info",
                `${p.projectCwd}: ${p.observationsCreated} obs`,
              ),
            )
          }
        }
        if (perProject.length > 10) {
          tui.line(
            renderStatusLine(
              "info",
              `... and ${perProject.length - 10} more projects`,
            ),
          )
        }
        return { details: { projects, observations: obs, transcripts } }
      },
    },
    {
      name: "opencode_import",
      async run({ archive, tui }) {
        // Check if an opencode database exists at the default path.
        // The function handles "not found" gracefully, but we short-
        // circuit here so the TUI output is clearer.
        const defaultDb = join(
          homedir(),
          ".local",
          "share",
          "opencode",
          "opencode.db",
        )
        if (!existsSync(defaultDb)) {
          tui.line(
            renderStatusLine(
              "info",
              "No opencode.db found — skipping opencode import.",
            ),
          )
          return { details: { skipped: true, reason: "no opencode db" } }
        }
        tui.line(
          renderStatusLine(
            "pending",
            `Reading opencode history from ${defaultDb}...`,
          ),
        )
        const result = (await archive.sdk.trigger("mem::import-opencode", {
          dbPath: defaultDb,
        })) as {
          success: boolean
          observationsCreated: number
          observationsSkipped: number
          projectsScanned: number
          sessionsScanned: number
          error?: string
        }
        if (!result.success) {
          throw new Error(result.error ?? "opencode import failed")
        }
        tui.line(
          renderStatusLine(
            "ok",
            `Imported ${result.observationsCreated} opencode observations ` +
              `(${result.observationsSkipped} duplicates skipped) from ` +
              `${result.sessionsScanned} sessions across ${result.projectsScanned} projects.`,
          ),
        )
        return {
          details: {
            created: result.observationsCreated,
            skipped: result.observationsSkipped,
            sessions: result.sessionsScanned,
            projects: result.projectsScanned,
          },
        }
      },
    },
    {
      name: "sisyphus_migrate",
      async run({ tui }) {
        // Walk the user's home for any `.sisyphus/` dirs to migrate.
        // We don't go deeper than 5 levels — sisyphus dirs were always
        // project-root-scoped.
        tui.line(
          renderStatusLine("pending", "Scanning for .sisyphus directories..."),
        )
        const discovered = findSisyphusDirs(homedir(), 5)
        if (discovered.length === 0) {
          tui.line(renderStatusLine("info", "No .sisyphus directories found."))
          return { details: { dirs: 0 } }
        }
        let migrated = 0
        for (const dir of discovered) {
          const projectRoot = join(dir, "..")
          const dest = join(projectRoot, ".elder-gods")
          const result = migrateSisyphusDir({ source: dir, dest })
          const copied =
            result.plansCopied +
            result.handoffsCopied +
            result.evidenceCopied +
            result.legacyCopied
          if (copied > 0) {
            tui.line(
              renderStatusLine(
                "ok",
                `${dir} → ${dest}: ${result.plansCopied} plans, ` +
                  `${result.handoffsCopied} handoffs, ` +
                  `${result.evidenceCopied} evidence files`,
              ),
            )
            migrated++
          }
        }
        return { details: { discovered: discovered.length, migrated } }
      },
    },
    {
      name: "preliminary_seed",
      async run({ archive, tui }) {
        // Scan every project directory we already know about (from
        // the Claude Code transcripts phase) and emit synthesized
        // preliminary observations. If the project dir no longer
        // exists on disk, skip it with a warning.
        tui.line(
          renderStatusLine(
            "pending",
            "Scanning project code for preliminary memories...",
          ),
        )
        // Re-enumerate sessions to find the set of project cwds.
        const sessions = await archive.kv
          .list<{ id: string; project: string }>(KV.sessions)
          .catch(() => [])
        const projectCwds = new Set<string>()
        for (const s of sessions) {
          if (s.project && s.project.startsWith("/")) {
            projectCwds.add(s.project)
          }
        }
        let scanned = 0
        let created = 0
        for (const cwd of projectCwds) {
          if (!existsSync(cwd)) continue
          try {
            const summary = await scanProject(cwd)
            const obs = projectSummaryToObservations(summary)
            const sessionId = `proj:${cwd}`
            // Upsert a synthetic "project-scan" session so the
            // observations land somewhere the search index can find.
            await archive.kv.set(KV.sessions, sessionId, {
              id: sessionId,
              project: cwd,
              cwd,
              startedAt: new Date().toISOString(),
              status: "completed",
              observationCount: obs.length,
            })
            for (const o of obs) {
              const existing = await archive.kv
                .get(KV.observations(sessionId), o.id)
                .catch(() => null)
              if (existing) continue
              await archive.kv.set(
                KV.observations(sessionId),
                o.id,
                { ...o, sessionId },
              )
              created++
            }
            scanned++
          } catch (err) {
            tui.line(
              renderStatusLine(
                "warn",
                `${cwd}: ${err instanceof Error ? err.message : String(err)}`,
              ),
            )
          }
        }
        tui.line(
          renderStatusLine(
            "ok",
            `Scanned ${scanned} projects, seeded ${created} preliminary observations.`,
          ),
        )
        return { details: { scanned, created } }
      },
    },
    {
      name: "pending_compression_trigger",
      async run({ archive, tui }) {
        const pending = await archive.kv
          .get<{ count: number }>(KV.pendingCompression, "state")
          .catch(() => null)
        const count = pending?.count ?? 0
        if (count > 0) {
          tui.line(
            renderStatusLine(
              "info",
              `${count} raw observations queued for compression. ` +
                `Run /necronomicon-bind inside Claude Code to process them, ` +
                `or install the cron entry with \`oh-my-claudecode bind --install-cron\` ` +
                `for unattended background compression via \`claude -p\`.`,
            ),
          )
        } else {
          tui.line(
            renderStatusLine("ok", "No observations pending compression."),
          )
        }
        return { details: { pendingCompression: count } }
      },
    },
  ]
}
