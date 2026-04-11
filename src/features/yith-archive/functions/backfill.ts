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
  /** Absolute cwd of the project whose transcripts to scan. */
  projectCwd?: string
  /** Scan only a specific session. Default: all transcripts in the dir. */
  sessionId?: string
  /** Dry-run — report counts, write nothing. */
  dryRun?: boolean
  /** Include `system` lines (hook injections). Default false. */
  includeSystem?: boolean
  /** Include `tool_result` blocks. Default false. */
  includeToolResults?: boolean
  /** Hard cap on observations created per run. Default 500. */
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

export function registerBackfillFunction(
  sdk: FakeSdk,
  kv: StateKV,
): void {
  sdk.registerFunction(
    {
      id: "mem::backfill-sessions",
      description:
        "Scan ~/.claude/projects/<cwd>/*.jsonl transcripts and persist past " +
        "user prompts, assistant responses, and tool calls as raw observations.",
    },
    async (args: BackfillArgs) => {
      const projectCwd = args.projectCwd ?? process.cwd()
      const dryRun = args.dryRun === true
      const includeSystem = args.includeSystem === true
      const includeToolResults = args.includeToolResults === true
      const maxObservations = args.maxObservations ?? 500

      const runId = generateId("bfr")
      const startedAt = new Date().toISOString()

      const transcripts = discoverTranscripts(projectCwd)
      if (transcripts.length === 0) {
        return {
          success: true,
          runId,
          projectCwd,
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

      // Filter to a single session if requested.
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
        // Load existing cursor for this session to enable incremental ingestion.
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
              if (observationsCreated >= maxObservations) {
                errors.push(
                  `maxObservations cap (${maxObservations}) reached — remaining lines deferred to next run`,
                )
                break outer
              }

              // Idempotency: skip if this observation ID already exists
              // in the session's observation scope.
              const existing = await kv
                .get(KV.observations(obs.sessionId), obs.id)
                .catch(() => null)
              if (existing) {
                observationsSkipped++
                lastUuidThisRun = line.uuid ?? lastUuidThisRun
                continue
              }

              if (!dryRun) {
                // Ensure a Session record exists so downstream code
                // (search.rebuildIndex, consolidate, etc.) can discover
                // the backfilled observations via the standard
                // KV.sessions → KV.observations traversal.
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

      // Persist cursor updates in a single batch so a crash mid-scan
      // doesn't leave half the cursors advanced.
      if (!dryRun) {
        for (const cursor of cursorUpdates) {
          const key = `${cursor.projectCwd}|${cursor.sessionId}`
          await kv.set(KV.backfillCursors, key, cursor)
        }
      }

      const completedAt = new Date().toISOString()
      const progressBar = renderProgressBar(
        observationsCreated,
        Math.max(observationsCreated, maxObservations),
        "observations created (raw — run mem::compress-step to compress)",
      )

      const runRecord: BackfillRun = {
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
        progressBar,
      }
      if (!dryRun) {
        await kv.set(KV.backfillRuns, runId, runRecord)
      }

      logger.info("Backfill complete", {
        runId,
        projectCwd,
        transcriptsScanned: scoped.length,
        observationsCreated,
        observationsSkipped,
        errors: errors.length,
      })

      return { success: true, ...runRecord }
    },
  )
}
