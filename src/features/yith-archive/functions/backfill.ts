import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { FakeSdk } from "../state/fake-sdk.js"
import type { StateKV } from "../state/kv.js"
import { KV, generateId } from "../state/schema.js"
import { logger } from "../state/logger.js"
import type { RawObservation, HookType, Session } from "../types.js"

/**
 * Session history backfill — reads Claude Code's per-project transcript
 * files at `~/.claude/projects/<sanitized-cwd>/<sessionId>.jsonl` and
 * converts each meaningful line into a `RawObservation` in the Yith
 * Archive's KV. From there, the existing compression pipeline (run via
 * the work-packet loop from the parent session) turns raw observations
 * into searchable memories.
 *
 * Idempotency: every observation's ID is derived from the transcript
 * line's stable `uuid` field as `sess:<sessionId>:<uuid>`, so re-running
 * the backfill skips lines that were already ingested. A per-session
 * cursor in `KV.backfillCursors` records the highest uuid processed so
 * incremental runs only scan new tail lines.
 *
 * Scope: the function writes RAW observations — it does NOT trigger
 * compression. Decoupling lets callers run backfill fast (thousands of
 * lines in seconds) and then compress incrementally through the
 * work-packet loop at their own LLM-budget pace.
 *
 * See `.elder-gods/plans/yith-session-history-backfill.md` for the full
 * design and open-question answers this implementation locks in.
 */

// ============================================================================
// Transcript discovery + parsing
// ============================================================================

/**
 * Convert an absolute cwd to the directory-name sanitization Claude Code
 * uses for its transcript layout: `/home/x/foo/bar` → `-home-x-foo-bar`.
 *
 * Claude Code replaces every `/` with `-` and prepends the result with a
 * single leading dash (so an absolute path's leading `/` becomes `-`).
 */
function sanitizeCwd(cwd: string): string {
  return cwd.replace(/\//g, "-")
}

/**
 * Best-effort inverse of `sanitizeCwd` — maps a sanitized Claude Code
 * directory name (e.g. `-home-alice-foo`) back to the absolute path
 * that produced it (`/home/alice/foo`). Reliable for paths that contain
 * no literal dashes; ambiguous for paths that do (e.g. `my-project`
 * would round-trip incorrectly). For the common case of home paths
 * like `/home/<user>/<project>` it's exact.
 *
 * Used by the all-projects backfill path to reconstruct the original
 * cwd from every directory under `~/.claude/projects/` so observations
 * can be tagged with a real absolute project path instead of just the
 * sanitized label.
 */
export function unsanitizeClaudeCodeDirName(dirName: string): string {
  // Collapse leading dashes to a single slash.
  if (!dirName.startsWith("-")) return dirName
  return "/" + dirName.slice(1).replace(/-/g, "/")
}

/**
 * Descriptor for one project's transcripts, yielded by the
 * `enumerateTranscriptProjects` scanner.
 */
export interface TranscriptProject {
  /** Absolute path, best-effort reconstructed from the sanitized name. */
  projectCwd: string
  /** Raw directory name on disk, e.g. `-home-alice-foo`. */
  sanitized: string
  /** Absolute path to the transcript dir itself. */
  dirPath: string
  /** Number of valid `.jsonl` files in the directory. */
  transcriptCount: number
}

/**
 * List every project subdirectory under a given `~/.claude/projects/`
 * base path, returning one descriptor per subdir. Used by the all-
 * projects backfill mode so a single `bind` run ingests every project's
 * history, not just the cwd's.
 *
 * Subdirs that contain zero `.jsonl` files are still returned with
 * `transcriptCount: 0` so the caller can report them in the TUI as
 * "known but empty" rather than silently skipping.
 *
 * Returns empty array (never throws) when `baseDir` doesn't exist —
 * fresh machines with no prior Claude Code history show up as zero
 * projects rather than a hard error.
 */
export function enumerateTranscriptProjects(
  baseDir: string,
): TranscriptProject[] {
  if (!existsSync(baseDir)) return []

  let entries: string[]
  try {
    entries = readdirSync(baseDir)
  } catch {
    return []
  }

  const projects: TranscriptProject[] = []
  for (const entry of entries) {
    const full = join(baseDir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue

    // Count transcripts matching the UUID pattern. Non-.jsonl files
    // and random files (READMEs, .bak backups) are excluded.
    let count = 0
    try {
      for (const inner of readdirSync(full)) {
        if (!inner.endsWith(".jsonl")) continue
        const sid = inner.slice(0, -".jsonl".length)
        if (!/^[0-9a-f-]{8,}$/i.test(sid)) continue
        count++
      }
    } catch {
      // Subdir unreadable — report as zero and continue.
    }

    projects.push({
      projectCwd: unsanitizeClaudeCodeDirName(entry),
      sanitized: entry,
      dirPath: full,
      transcriptCount: count,
    })
  }
  return projects
}

/** Metadata about a discovered transcript file. */
interface TranscriptInfo {
  sessionId: string
  path: string
  sizeBytes: number
  mtime: number
}

/**
 * List every transcript JSONL for a given project cwd. Returns empty
 * array if `~/.claude/projects/<sanitized-cwd>/` doesn't exist.
 *
 * Filenames are `<sessionId>.jsonl` where `sessionId` is a UUID. Any
 * file in the directory that doesn't match the pattern is skipped.
 */
export function discoverTranscripts(projectCwd: string): TranscriptInfo[] {
  const sanitized = sanitizeCwd(projectCwd)
  const transcriptDir = join(homedir(), ".claude", "projects", sanitized)
  if (!existsSync(transcriptDir)) return []

  const entries = readdirSync(transcriptDir)
  const results: TranscriptInfo[] = []
  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue
    const sessionId = entry.slice(0, -".jsonl".length)
    // Sanity-check the sessionId looks like a UUID. We don't need strict
    // validation — just avoid picking up e.g. `.jsonl.bak` backups.
    if (!/^[0-9a-f-]{8,}$/i.test(sessionId)) continue
    const fullPath = join(transcriptDir, entry)
    try {
      const st = statSync(fullPath)
      results.push({
        sessionId,
        path: fullPath,
        sizeBytes: st.size,
        mtime: st.mtimeMs,
      })
    } catch {
      // File vanished between readdir and stat — skip silently.
    }
  }
  return results
}

/** A single parsed transcript line with only the fields we care about. */
interface TranscriptLine {
  type: string
  uuid?: string
  timestamp?: string
  sessionId?: string
  cwd?: string
  message?: {
    role?: string
    content?: unknown
  }
}

/**
 * Stream-parse a transcript JSONL. Yields one parsed line per JSON
 * record; skips malformed lines with a warn log but doesn't throw so
 * a single bad line doesn't kill the whole backfill.
 *
 * If `sinceUuid` is provided, skips every line up to and including that
 * uuid. This is the incremental-ingestion path used when a backfill
 * cursor exists for the session.
 */
function* parseTranscriptLines(
  transcriptPath: string,
  sinceUuid?: string,
): Generator<TranscriptLine, void, undefined> {
  let raw: string
  try {
    raw = readFileSync(transcriptPath, "utf-8")
  } catch {
    return
  }

  let foundCursor = !sinceUuid
  const lines = raw.split("\n")
  for (const line of lines) {
    if (!line.trim()) continue
    let parsed: TranscriptLine
    try {
      parsed = JSON.parse(line) as TranscriptLine
    } catch {
      continue
    }

    if (!foundCursor) {
      if (parsed.uuid === sinceUuid) foundCursor = true
      continue
    }

    yield parsed
  }
}

/**
 * Map a transcript line to a RawObservation, or return null to skip.
 *
 * The mapping rules (documented in the plan doc):
 * - `user` line with string content → prompt_submit observation
 * - `user` line with tool_result content → skip (duplicates the prior
 *   assistant's tool_use; compressing the result adds noise)
 * - `assistant` line with text blocks → conversation observation
 *   containing the concatenated text
 * - `assistant` line with tool_use blocks → one pre_tool_use observation
 *   per block
 * - `system` line → skip by default (auto-generated hook injections)
 * - attachment / file-history-snapshot / permission-mode / last-prompt
 *   → skip
 *
 * Each resulting RawObservation gets a stable ID derived from the
 * transcript's uuid so re-ingestion is idempotent.
 */
function* lineToRawObservations(
  line: TranscriptLine,
  includeSystem: boolean,
  includeToolResults: boolean,
): Generator<RawObservation, void, undefined> {
  if (!line.uuid || !line.timestamp || !line.sessionId) return

  const baseId = `sess:${line.sessionId}:${line.uuid}`
  const ts = line.timestamp
  const sid = line.sessionId

  if (line.type === "user") {
    const content = line.message?.content
    if (typeof content === "string") {
      yield {
        id: baseId,
        sessionId: sid,
        timestamp: ts,
        hookType: "prompt_submit" as HookType,
        userPrompt: content,
        raw: line,
      }
      return
    }
    if (Array.isArray(content)) {
      // Tool results: only emit if the caller asked to include them.
      if (!includeToolResults) return
      for (let i = 0; i < content.length; i++) {
        const block = content[i]
        if (
          block &&
          typeof block === "object" &&
          (block as { type?: string }).type === "tool_result"
        ) {
          const b = block as { content?: unknown; tool_use_id?: string }
          const text = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "")
          yield {
            id: `${baseId}:tr${i}`,
            sessionId: sid,
            timestamp: ts,
            hookType: "post_tool_use" as HookType,
            toolName: b.tool_use_id ?? "unknown",
            toolOutput: text,
            raw: block,
          }
        }
      }
    }
    return
  }

  if (line.type === "assistant") {
    const content = line.message?.content
    if (!Array.isArray(content)) return

    // First pass: concatenate all text blocks into one narrative obs.
    const textBlocks: string[] = []
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: string }).type === "text"
      ) {
        const t = (block as { text?: string }).text
        if (typeof t === "string" && t.trim()) textBlocks.push(t)
      }
    }
    if (textBlocks.length > 0) {
      yield {
        id: `${baseId}:text`,
        sessionId: sid,
        timestamp: ts,
        hookType: "prompt_submit" as HookType,
        userPrompt: textBlocks.join("\n\n"),
        raw: { type: "assistant-text", blocks: textBlocks },
      }
    }

    // Second pass: one observation per tool_use block.
    for (let i = 0; i < content.length; i++) {
      const block = content[i]
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: string }).type === "tool_use"
      ) {
        const b = block as { name?: string; input?: unknown; id?: string }
        yield {
          id: `${baseId}:tu${i}`,
          sessionId: sid,
          timestamp: ts,
          hookType: "pre_tool_use" as HookType,
          toolName: b.name ?? "unknown",
          toolInput: b.input,
          raw: block,
        }
      }
    }
    return
  }

  if (line.type === "system" && includeSystem) {
    const content = line.message?.content
    const text =
      typeof content === "string" ? content : JSON.stringify(content ?? "")
    yield {
      id: baseId,
      sessionId: sid,
      timestamp: ts,
      hookType: "session_start" as HookType,
      userPrompt: text,
      raw: line,
    }
  }

  // All other types (attachment, file-history-snapshot, permission-mode,
  // last-prompt) are intentionally dropped.
}

// ============================================================================
// Backfill function
// ============================================================================

/** Args accepted by `mem::backfill-sessions`. Mirrors the plan doc. */
interface BackfillArgs {
  /** Absolute cwd of the project whose transcripts to scan. Ignored
   *  when `allProjects: true` is set. */
  projectCwd?: string
  /**
   * All-projects mode: scan every subdirectory under
   * `~/.claude/projects/`, unsanitize each one back to its absolute
   * path, and run the single-project backfill over each. Observations
   * for each project land in their own session scope, tagged with
   * the real cwd. This is the default mode used by the CLI `bind`
   * subcommand so a single invocation ingests history for every
   * project the user has ever opened Claude Code in.
   */
  allProjects?: boolean
  /** Scan only a specific session. Default: all transcripts in the dir. */
  sessionId?: string
  /** Dry-run — report counts, write nothing. */
  dryRun?: boolean
  /** Include `system` lines (hook injections). Default false. */
  includeSystem?: boolean
  /** Include `tool_result` blocks. Default false. */
  includeToolResults?: boolean
  /** Hard cap on observations created per run. Default 500. Applies
   *  GLOBALLY across all projects in allProjects mode (not per-project)
   *  so a runaway backfill can't blow past the budget. */
  maxObservations?: number
}

/** Per-session cursor stored in KV.backfillCursors. */
interface BackfillCursor {
  projectCwd: string
  sessionId: string
  lastUuid: string
  updatedAt: string
}

/** Run metadata stored in KV.backfillRuns. */
interface BackfillRun {
  runId: string
  projectCwd: string
  startedAt: string
  completedAt: string
  transcriptsScanned: number
  linesRead: number
  observationsCreated: number
  observationsSkipped: number
  linesSkippedByType: Record<string, number>
  errors: string[]
  progressBar: string
}

/**
 * Render a monospace ASCII progress bar for the given `current/total`.
 * Designed to be re-printed in successive tool-call outputs so the
 * parent Claude Code session chat shows forward motion as the backfill
 * advances. Width is fixed at 20 cells to fit comfortably in chat UI.
 */
export function renderProgressBar(
  current: number,
  total: number,
  label: string,
): string {
  const width = 20
  const pct = total > 0 ? Math.min(1, current / total) : 0
  const filled = Math.round(pct * width)
  const empty = width - filled
  const bar = "▓".repeat(filled) + "░".repeat(empty)
  const pctStr = `${Math.round(pct * 100)}%`.padStart(4)
  return `[${bar}] ${pctStr} — ${current}/${total} ${label}`
}

/**
 * Increment the global pending-compression counter by `delta`. The
 * counter lives under `KV.pendingCompression → "state"` and drives
 * the /cthulhu preflight's "you have N observations pending" nudge
 * plus the CLI bind summary line. Negative deltas are fine — the
 * counter is floored at zero to avoid drift if compress-step double-
 * decrements for some reason.
 */
async function bumpPendingCompression(
  kv: StateKV,
  delta: number,
): Promise<number> {
  const existing =
    (await kv
      .get<{ count: number; updatedAt: string }>(
        KV.pendingCompression,
        "state",
      )
      .catch(() => null)) ?? { count: 0, updatedAt: "" }
  const next = Math.max(0, existing.count + delta)
  await kv.set(KV.pendingCompression, "state", {
    count: next,
    updatedAt: new Date().toISOString(),
  })
  return next
}

/**
 * Per-project backfill worker — scans one project's transcripts, writes
 * raw observations, advances cursors, and bumps the pending counter.
 * Extracted so the top-level function can invoke it once (single-project
 * mode) or in a loop (all-projects mode) without duplicating logic.
 *
 * Returns a `BackfillRun` with the stats for this one project.
 *
 * The `globalBudget` argument is the remaining observation cap across
 * the whole bind run (not just this project). In all-projects mode it
 * decrements as each project contributes observations so the total
 * across projects never exceeds `maxObservations`. Pass `Infinity` for
 * single-project mode to disable the cross-project constraint.
 */
async function runProjectBackfill(
  kv: StateKV,
  projectCwd: string,
  args: BackfillArgs,
  globalBudget: number,
): Promise<BackfillRun> {
  const dryRun = args.dryRun === true
  const includeSystem = args.includeSystem === true
  const includeToolResults = args.includeToolResults === true

  const runId = generateId("bfr")
  const startedAt = new Date().toISOString()

  const transcripts = discoverTranscripts(projectCwd)
  if (transcripts.length === 0) {
    return {
      runId,
      projectCwd,
      startedAt,
      completedAt: new Date().toISOString(),
      transcriptsScanned: 0,
      linesRead: 0,
      observationsCreated: 0,
      observationsSkipped: 0,
      linesSkippedByType: {},
      errors: [
        `No transcripts found in ~/.claude/projects/${sanitizeCwd(projectCwd)}/`,
      ],
      progressBar: renderProgressBar(0, 0, "observations created"),
    }
  }

  const scoped = args.sessionId
    ? transcripts.filter((t) => t.sessionId === args.sessionId)
    : transcripts

  let linesRead = 0
  let observationsCreated = 0
  let observationsSkipped = 0
  const linesSkippedByType: Record<string, number> = {}
  const errors: string[] = []
  const cursorUpdates: Array<BackfillCursor> = []

  outer: for (const t of scoped) {
    const cursorKey = `${projectCwd}|${t.sessionId}`
    const existingCursor = await kv
      .get<BackfillCursor>(KV.backfillCursors, cursorKey)
      .catch(() => null)
    const sinceUuid = existingCursor?.lastUuid

    let lastUuidThisRun: string | undefined

    try {
      for (const line of parseTranscriptLines(t.path, sinceUuid)) {
        linesRead++
        if (!includeSystem && line.type === "system") {
          linesSkippedByType[line.type] =
            (linesSkippedByType[line.type] ?? 0) + 1
          lastUuidThisRun = line.uuid ?? lastUuidThisRun
          continue
        }
        const droppedType = [
          "attachment",
          "file-history-snapshot",
          "permission-mode",
          "last-prompt",
        ]
        if (droppedType.includes(line.type)) {
          linesSkippedByType[line.type] =
            (linesSkippedByType[line.type] ?? 0) + 1
          lastUuidThisRun = line.uuid ?? lastUuidThisRun
          continue
        }

        for (const obs of lineToRawObservations(
          line,
          includeSystem,
          includeToolResults,
        )) {
          if (observationsCreated >= globalBudget) {
            errors.push(
              `global budget reached — remaining lines deferred to next run`,
            )
            break outer
          }

          const existing = await kv
            .get(KV.observations(obs.sessionId), obs.id)
            .catch(() => null)
          if (existing) {
            observationsSkipped++
            lastUuidThisRun = line.uuid ?? lastUuidThisRun
            continue
          }

          if (!dryRun) {
            // Upsert a Session record so search.rebuildIndex and the
            // consolidation pipeline can discover these obs via the
            // standard KV.sessions → KV.observations traversal.
            const existingSession = await kv
              .get<Session>(KV.sessions, obs.sessionId)
              .catch(() => null)
            if (!existingSession) {
              const session: Session = {
                id: obs.sessionId,
                project: projectCwd,
                cwd: projectCwd,
                startedAt: obs.timestamp,
                status: "completed",
                observationCount: 0,
              }
              await kv.set(KV.sessions, obs.sessionId, session)
            }
            await kv.set(KV.observations(obs.sessionId), obs.id, obs)
            // Raw obs are pending compression until a compress-step
            // writes a CompressedObservation over them.
            await bumpPendingCompression(kv, 1)
          }

          observationsCreated++
          lastUuidThisRun = line.uuid ?? lastUuidThisRun
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${t.sessionId}: ${msg}`)
      continue
    }

    if (lastUuidThisRun && !dryRun) {
      cursorUpdates.push({
        projectCwd,
        sessionId: t.sessionId,
        lastUuid: lastUuidThisRun,
        updatedAt: new Date().toISOString(),
      })
    }
  }

  if (!dryRun) {
    for (const cursor of cursorUpdates) {
      const key = `${cursor.projectCwd}|${cursor.sessionId}`
      await kv.set(KV.backfillCursors, key, cursor)
    }
  }

  const completedAt = new Date().toISOString()
  const run: BackfillRun = {
    runId,
    projectCwd,
    startedAt,
    completedAt,
    transcriptsScanned: scoped.length,
    linesRead,
    observationsCreated,
    observationsSkipped,
    linesSkippedByType,
    errors,
    progressBar: renderProgressBar(
      observationsCreated,
      Math.max(observationsCreated, 1),
      `observations in ${projectCwd}`,
    ),
  }
  if (!dryRun) {
    await kv.set(KV.backfillRuns, runId, run)
  }
  return run
}

export function registerBackfillFunction(
  sdk: FakeSdk,
  kv: StateKV,
): void {
  sdk.registerFunction(
    {
      id: "mem::backfill-sessions",
      description:
        "Scan ~/.claude/projects/ transcripts and persist past user " +
        "prompts, assistant responses, and tool calls as raw observations. " +
        "Pass allProjects:true to ingest every project at once.",
    },
    async (args: BackfillArgs) => {
      const maxObservations = args.maxObservations ?? 500

      // All-projects mode: enumerate every subdir under
      // ~/.claude/projects/, run the per-project backfill in sequence
      // with a shared global budget, and return aggregated results.
      if (args.allProjects === true) {
        const baseDir = join(homedir(), ".claude", "projects")
        const projects = enumerateTranscriptProjects(baseDir)
        const perProject: BackfillRun[] = []
        let remaining = maxObservations

        for (const p of projects) {
          if (remaining <= 0) break
          const run = await runProjectBackfill(kv, p.projectCwd, args, remaining)
          remaining -= run.observationsCreated
          perProject.push(run)
        }

        const totalObservationsCreated = perProject.reduce(
          (s, r) => s + r.observationsCreated,
          0,
        )
        const totalTranscriptsScanned = perProject.reduce(
          (s, r) => s + r.transcriptsScanned,
          0,
        )
        const totalLinesRead = perProject.reduce(
          (s, r) => s + r.linesRead,
          0,
        )
        const allErrors = perProject.flatMap((r) => r.errors)

        logger.info("All-projects backfill complete", {
          totalProjects: projects.length,
          totalObservationsCreated,
          totalTranscriptsScanned,
          errors: allErrors.length,
        })

        return {
          success: true,
          allProjects: true,
          totalProjects: projects.length,
          totalTranscriptsScanned,
          totalLinesRead,
          totalObservationsCreated,
          perProject: perProject.map((r) => ({
            projectCwd: r.projectCwd,
            transcriptsScanned: r.transcriptsScanned,
            observationsCreated: r.observationsCreated,
            observationsSkipped: r.observationsSkipped,
            errors: r.errors,
          })),
          errors: allErrors,
          progressBar: renderProgressBar(
            totalObservationsCreated,
            Math.max(totalObservationsCreated, 1),
            "observations across all projects",
          ),
        }
      }

      // Single-project mode (original behavior).
      const projectCwd = args.projectCwd ?? process.cwd()
      const run = await runProjectBackfill(
        kv,
        projectCwd,
        args,
        maxObservations,
      )

      logger.info("Backfill complete", {
        runId: run.runId,
        projectCwd: run.projectCwd,
        transcriptsScanned: run.transcriptsScanned,
        observationsCreated: run.observationsCreated,
        observationsSkipped: run.observationsSkipped,
        errors: run.errors.length,
      })

      return { success: true, ...run }
    },
  )
}
