import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"

import type { FakeSdk } from "../state/fake-sdk.js"
import type { StateKV } from "../state/kv.js"
import { logger } from "../state/logger.js"
import { KV } from "../state/schema.js"
import type { HookType, RawObservation, Session } from "../types.js"

/**
 * mem::import-opencode — pull past sessions out of a legacy oh-my-
 * opencode install and re-express them as Yith RawObservations so
 * the user's existing agentic history carries forward into the
 * Necronomicon.
 *
 * Target: `~/.local/share/opencode/opencode.db` — a SQLite3 database
 * with tables `project / session / message / part`. The `part.data`
 * field is a JSON blob with `{type: "text" | "tool" | "step-start" |
 * "step-finish" | "reasoning" | "patch" | "file" | "compaction"}`.
 * We keep `text` (conversational) and `tool` (tool invocations) and
 * drop the rest.
 *
 * Idempotency: every observation gets ID `oc:<sessionId>:<partId>`
 * so a re-import skips existing entries via the standard KV upsert
 * check. Cursors in `KV.opencodeImportCursors` record the highest
 * time_created seen per session so incremental imports don't re-scan
 * old history.
 *
 * sqlite3 access: we shell out to the `sqlite3` CLI with the `-json`
 * output format instead of adding `better-sqlite3` as a runtime dep.
 * The CLI is available on every Unix by default; on Windows users can
 * install it via winget / scoop. If sqlite3 isn't on PATH, the
 * function returns a clear error.
 */

// ============================================================================
// Types
// ============================================================================

interface OpencodePartData {
  type?: string
  text?: string
  tool?: string
  callID?: string
  state?: {
    status?: string
    input?: unknown
    output?: unknown
  }
  [key: string]: unknown
}

export interface OpencodePartContext {
  partId: string
  messageId: string
  sessionId: string
  partData: OpencodePartData
  messageRole: string | undefined
  timestamp: string
}

interface OpencodeImportArgs {
  /** Override the default path. Defaults to
   *  `~/.local/share/opencode/opencode.db` via os.homedir(). */
  dbPath?: string
  /** Process at most this many observations. Default 5000 —
   *  opencode histories can be huge (our investigation found 93k
   *  parts on one machine) so we need a reasonable upper bound. */
  limit?: number
  /** Dry-run: parse but don't write. */
  dryRun?: boolean
}

interface OpencodeCursor {
  dbPath: string
  sessionId: string
  lastPartTime: number
  updatedAt: string
}

// ============================================================================
// Mapper: part.data → RawObservation
// ============================================================================

/**
 * Pure mapper from an opencode part to a Yith RawObservation. Returns
 * null for part types we intentionally skip (step-start/finish,
 * reasoning, patch, file, compaction) so the caller can filter with
 * a simple null check.
 *
 * The ID `oc:<sessionId>:<partId>` gives idempotency: re-importing
 * the same opencode DB produces the same IDs, so the upsert skip
 * logic in the scanner deduplicates automatically.
 */
export function opencodePartToRawObservation(
  ctx: OpencodePartContext,
): RawObservation | null {
  const { partId, sessionId, partData, timestamp } = ctx
  const type = partData.type

  if (type === "text") {
    const text = typeof partData.text === "string" ? partData.text : ""
    if (!text) return null
    return {
      id: `oc:${sessionId}:${partId}`,
      sessionId,
      timestamp,
      hookType: "prompt_submit" as HookType,
      userPrompt: text,
      raw: partData,
    }
  }

  if (type === "tool") {
    const toolName =
      typeof partData.tool === "string" ? partData.tool : "unknown"
    return {
      id: `oc:${sessionId}:${partId}`,
      sessionId,
      timestamp,
      hookType: "pre_tool_use" as HookType,
      toolName,
      toolInput: partData.state?.input,
      toolOutput: partData.state?.output,
      raw: partData,
    }
  }

  // step-start / step-finish / reasoning / patch / file / compaction
  // are intentional drops.
  return null
}

// ============================================================================
// sqlite3 CLI availability check
// ============================================================================

/**
 * True if the `sqlite3` CLI is on PATH. Used by tests to skip the
 * integration assertion when the runner doesn't have sqlite installed.
 */
export function isSqlite3Available(): boolean {
  try {
    execFileSync("sqlite3", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

// ============================================================================
// Scanner
// ============================================================================

interface PartRow {
  part_id: string
  message_id: string
  session_id: string
  time_created: number
  part_data: string
  message_data: string
  session_directory: string
  session_title: string
  project_worktree: string
}

/**
 * Run a SELECT query against the opencode.db using the sqlite3 CLI
 * in -json mode and return the parsed rows. The query should return
 * columns matching `PartRow` — see `SCAN_PARTS_SQL` below.
 */
function querySqlite(dbPath: string, sql: string): PartRow[] {
  const out = execFileSync("sqlite3", [dbPath, "-json", sql], {
    encoding: "utf-8",
    maxBuffer: 256 * 1024 * 1024, // 256 MB for large imports
  })
  if (!out.trim()) return []
  try {
    return JSON.parse(out) as PartRow[]
  } catch (err) {
    throw new Error(
      `opencode-import: failed to parse sqlite3 -json output: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/** The join query that pulls everything we need in one pass. */
const SCAN_PARTS_SQL = `
  SELECT
    p.id AS part_id,
    p.message_id,
    p.session_id,
    p.time_created,
    p.data AS part_data,
    m.data AS message_data,
    s.directory AS session_directory,
    s.title AS session_title,
    pr.worktree AS project_worktree
  FROM part p
  JOIN message m ON p.message_id = m.id
  JOIN session s ON p.session_id = s.id
  JOIN project pr ON s.project_id = pr.id
  ORDER BY p.session_id, p.time_created
`

// ============================================================================
// Function registration
// ============================================================================

export function registerOpencodeImportFunction(
  sdk: FakeSdk,
  kv: StateKV,
): void {
  sdk.registerFunction(
    {
      id: "mem::import-opencode",
      description:
        "Import past sessions from an oh-my-opencode SQLite database " +
        "(~/.local/share/opencode/opencode.db by default) as raw " +
        "observations in the Yith Archive.",
    },
    async (args: OpencodeImportArgs) => {
      const dbPath = args.dbPath ?? defaultDbPath()
      const limit = args.limit ?? 5000
      const dryRun = args.dryRun === true

      if (!existsSync(dbPath)) {
        return {
          success: true,
          skipped: true,
          reason: `opencode database not found at ${dbPath}`,
          observationsCreated: 0,
          sessionsScanned: 0,
          projectsScanned: 0,
        }
      }

      if (!isSqlite3Available()) {
        return {
          success: false,
          error:
            "sqlite3 CLI not found on PATH — install it (apt/brew/pacman/winget) " +
            "and re-run. Opencode import needs it to read opencode.db.",
          observationsCreated: 0,
          sessionsScanned: 0,
          projectsScanned: 0,
        }
      }

      let rows: PartRow[]
      try {
        rows = querySqlite(dbPath, SCAN_PARTS_SQL)
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          observationsCreated: 0,
          sessionsScanned: 0,
          projectsScanned: 0,
        }
      }

      const sessionsSeen = new Set<string>()
      const projectsSeen = new Set<string>()
      let observationsCreated = 0
      let observationsSkipped = 0
      const errors: string[] = []

      for (const row of rows) {
        if (observationsCreated >= limit) {
          errors.push(`limit ${limit} reached — remaining parts deferred`)
          break
        }
        sessionsSeen.add(row.session_id)
        projectsSeen.add(row.project_worktree)

        // Load per-session cursor so incremental runs skip rows we've
        // already processed (based on time_created).
        const cursorKey = `${dbPath}|${row.session_id}`
        const cursor = await kv
          .get<OpencodeCursor>(KV.opencodeImportCursors, cursorKey)
          .catch(() => null)
        if (cursor && row.time_created <= cursor.lastPartTime) {
          // Already processed this row on a prior run. Count as
          // skipped so the caller can see "N rows were deduplicated"
          // in the result — matches how the Claude Code backfill
          // reports idempotent re-runs.
          observationsSkipped++
          continue
        }

        let partData: OpencodePartData
        try {
          partData = JSON.parse(row.part_data) as OpencodePartData
        } catch {
          errors.push(`malformed part data in ${row.part_id}`)
          continue
        }

        let messageRole: string | undefined
        try {
          const msgData = JSON.parse(row.message_data) as { role?: string }
          messageRole = msgData.role
        } catch {
          /* non-fatal */
        }

        const obs = opencodePartToRawObservation({
          partId: row.part_id,
          messageId: row.message_id,
          sessionId: row.session_id,
          partData,
          messageRole,
          timestamp: new Date(row.time_created).toISOString(),
        })
        if (!obs) continue

        // Idempotency via existing-ID check.
        const existing = await kv
          .get(KV.observations(obs.sessionId), obs.id)
          .catch(() => null)
        if (existing) {
          observationsSkipped++
          continue
        }

        if (!dryRun) {
          // Upsert Session record tagged with the opencode worktree.
          const existingSession = await kv
            .get<Session>(KV.sessions, obs.sessionId)
            .catch(() => null)
          if (!existingSession) {
            const session: Session = {
              id: obs.sessionId,
              project: row.project_worktree,
              cwd: row.session_directory || row.project_worktree,
              startedAt: new Date(row.time_created).toISOString(),
              status: "completed",
              observationCount: 0,
            }
            await kv.set(KV.sessions, obs.sessionId, session)
          }
          await kv.set(KV.observations(obs.sessionId), obs.id, obs)
          await bumpPendingCompression(kv, 1)

          // Advance the per-session cursor.
          await kv.set(KV.opencodeImportCursors, cursorKey, {
            dbPath,
            sessionId: row.session_id,
            lastPartTime: row.time_created,
            updatedAt: new Date().toISOString(),
          } satisfies OpencodeCursor)
        }
        observationsCreated++
      }

      logger.info("opencode import complete", {
        dbPath,
        projectsScanned: projectsSeen.size,
        sessionsScanned: sessionsSeen.size,
        observationsCreated,
        observationsSkipped,
      })

      return {
        success: true,
        dbPath,
        projectsScanned: projectsSeen.size,
        sessionsScanned: sessionsSeen.size,
        observationsCreated,
        observationsSkipped,
        errors,
      }
    },
  )
}

/** Default opencode database path on this user's machine. */
function defaultDbPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ""
  return `${home}/.local/share/opencode/opencode.db`
}

/** Mirror of backfill.ts's pending-compression helper. Duplicated
 *  rather than imported to avoid a cross-function coupling. */
async function bumpPendingCompression(
  kv: StateKV,
  delta: number,
): Promise<void> {
  const existing =
    (await kv
      .get<{ count: number; updatedAt: string }>(
        KV.pendingCompression,
        "state",
      )
      .catch(() => null)) ?? { count: 0, updatedAt: "" }
  await kv.set(KV.pendingCompression, "state", {
    count: Math.max(0, existing.count + delta),
    updatedAt: new Date().toISOString(),
  })
}
