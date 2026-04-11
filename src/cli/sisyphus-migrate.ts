import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  copyFileSync,
  statSync,
} from "node:fs"
import { join, basename, extname } from "node:path"

/**
 * .sisyphus/ → .elder-gods/ filesystem migrator.
 *
 * oh-my-opencode used per-project `.sisyphus/` dirs to hold
 * operational state: plans, handoffs, evidence, and a `boulder.json`
 * tracking the active task. oh-my-claudecode uses the analogous
 * `.elder-gods/` layout. This function walks a single project's
 * `.sisyphus/` and copies / translates contents into the project's
 * new `.elder-gods/` home.
 *
 * Non-destructive: the source directory is left fully intact. Users
 * can delete it manually after verifying the migration. No in-place
 * rename, no recycle bin — the migrator only reads the source.
 *
 * Idempotent: a second run detects files that already exist at the
 * destination (by name) and skips them. Zero-copy counts are the
 * expected steady state.
 *
 * Mapping:
 *
 *   .sisyphus/plans/*.md  →  .elder-gods/plans/*.md  (1:1)
 *   .sisyphus/handoff.md  →  .elder-gods/handoffs/YYYY-MM-DD-<slug>.md
 *   .sisyphus/evidence/   →  .elder-gods/evidence/    (recursive copy)
 *   .sisyphus/notepads/   →  .elder-gods/legacy/notepads/
 *   .sisyphus/drafts/     →  .elder-gods/legacy/drafts/
 *   .sisyphus/run-continuation/ → .elder-gods/legacy/run-continuation/
 *   .sisyphus/boulder.json → .elder-gods/plans/legacy-boulder.md
 *                            (translated to markdown — see
 *                            `boulderToMarkdown` below)
 *
 * The legacy/ subdir is a catch-all for state we don't have a first-
 * class equivalent for. Users can grep it, migrate it further, or
 * delete it.
 */

export interface MigrateSisyphusOptions {
  source: string
  dest: string
}

export interface MigrateSisyphusResult {
  /** True when source doesn't exist — nothing to do. */
  skipped: boolean
  plansCopied: number
  handoffsCopied: number
  evidenceCopied: number
  legacyCopied: number
  boulderImported: boolean
  errors: string[]
}

export function migrateSisyphusDir(
  opts: MigrateSisyphusOptions,
): MigrateSisyphusResult {
  const { source, dest } = opts
  const result: MigrateSisyphusResult = {
    skipped: false,
    plansCopied: 0,
    handoffsCopied: 0,
    evidenceCopied: 0,
    legacyCopied: 0,
    boulderImported: false,
    errors: [],
  }

  if (!existsSync(source)) {
    result.skipped = true
    return result
  }

  mkdirSync(dest, { recursive: true })

  // ---- Plans ----
  const plansSrc = join(source, "plans")
  if (existsSync(plansSrc)) {
    const plansDest = join(dest, "plans")
    mkdirSync(plansDest, { recursive: true })
    for (const entry of readdirSafe(plansSrc)) {
      if (!entry.endsWith(".md")) continue
      const destFile = join(plansDest, entry)
      if (existsSync(destFile)) continue // idempotent
      try {
        copyFileSync(join(plansSrc, entry), destFile)
        result.plansCopied++
      } catch (err) {
        result.errors.push(
          `plans/${entry}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  // ---- Handoff ----
  const handoffSrc = join(source, "handoff.md")
  if (existsSync(handoffSrc)) {
    const handoffsDest = join(dest, "handoffs")
    mkdirSync(handoffsDest, { recursive: true })
    const stamp = formatDateStamp(statSync(handoffSrc).mtimeMs)
    const slug = slugify(
      extractHandoffTitle(handoffSrc) ?? "sisyphus-handoff",
    )
    const targetName = `${stamp}-${slug}.md`
    const target = join(handoffsDest, targetName)
    if (!existsSync(target)) {
      try {
        copyFileSync(handoffSrc, target)
        result.handoffsCopied++
      } catch (err) {
        result.errors.push(
          `handoff.md: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  // ---- Evidence ----
  const evidenceSrc = join(source, "evidence")
  if (existsSync(evidenceSrc)) {
    const evidenceDest = join(dest, "evidence")
    mkdirSync(evidenceDest, { recursive: true })
    for (const entry of readdirSafe(evidenceSrc)) {
      const src = join(evidenceSrc, entry)
      const dst = join(evidenceDest, entry)
      if (existsSync(dst)) continue
      try {
        const s = statSync(src)
        if (s.isDirectory()) {
          copyDirRecursive(src, dst)
          result.evidenceCopied++
        } else {
          copyFileSync(src, dst)
          result.evidenceCopied++
        }
      } catch (err) {
        result.errors.push(
          `evidence/${entry}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  // ---- Legacy (notepads, drafts, run-continuation) ----
  const legacyNames = ["notepads", "drafts", "run-continuation"]
  for (const name of legacyNames) {
    const src = join(source, name)
    if (!existsSync(src)) continue
    const dst = join(dest, "legacy", name)
    if (existsSync(dst)) continue
    try {
      copyDirRecursive(src, dst)
      result.legacyCopied++
    } catch (err) {
      result.errors.push(
        `legacy/${name}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  // ---- Boulder ----
  const boulderSrc = join(source, "boulder.json")
  if (existsSync(boulderSrc)) {
    const plansDest = join(dest, "plans")
    mkdirSync(plansDest, { recursive: true })
    const target = join(plansDest, "legacy-boulder.md")
    if (!existsSync(target)) {
      try {
        const body = boulderToMarkdown(boulderSrc)
        writeFileSync(target, body, "utf-8")
        result.boulderImported = true
      } catch (err) {
        result.errors.push(
          `boulder.json: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  return result
}

// ============================================================================
// Helpers
// ============================================================================

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/**
 * Recursively copy every file in src into dst. Creates parent
 * directories as needed. Skips entries that already exist at dst
 * (so idempotent re-runs don't clobber user edits).
 */
function copyDirRecursive(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSafe(src)) {
    const sp = join(src, entry)
    const dp = join(dst, entry)
    const s = statSync(sp)
    if (s.isDirectory()) {
      copyDirRecursive(sp, dp)
    } else if (s.isFile()) {
      if (!existsSync(dp)) {
        copyFileSync(sp, dp)
      }
    }
  }
}

function formatDateStamp(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "handoff"
}

/**
 * Best-effort title extraction from a handoff markdown file. Looks
 * for the first `# Title` heading; falls back to the filename without
 * extension.
 */
function extractHandoffTitle(path: string): string | null {
  try {
    const body = readFileSync(path, "utf-8")
    const m = body.match(/^#\s+(.+?)\s*$/m)
    if (m) {
      const title = m[1].trim()
      // Strip common suffix noise like "— sisyphus handoff".
      return title.replace(/^sisyphus\s+handoff\b.*$/i, "sisyphus-handoff")
    }
    return basename(path, extname(path))
  } catch {
    return null
  }
}

/**
 * Render a legacy boulder.json as a markdown plan note so the data
 * isn't lost in the migration. The resulting file lives at
 * `.elder-gods/plans/legacy-boulder.md` and describes what the last
 * active task was — useful for users resuming where they left off.
 */
function boulderToMarkdown(path: string): string {
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>
  } catch {
    return "# Legacy boulder\n\n(failed to parse source boulder.json)\n"
  }

  const lines: string[] = []
  lines.push("# Legacy Boulder State (imported from .sisyphus/boulder.json)")
  lines.push("")
  lines.push(
    "This file captures the final state of the oh-my-opencode sisyphus " +
      "boulder at migration time. Use it to remember what you were " +
      "working on before the switch.",
  )
  lines.push("")
  if (data.plan_name) lines.push(`**Plan:** ${String(data.plan_name)}`)
  if (data.active_plan) lines.push(`**Active plan path:** \`${String(data.active_plan)}\``)
  if (data.started_at) lines.push(`**Started:** ${String(data.started_at)}`)
  if (Array.isArray(data.session_ids)) {
    lines.push(`**Session IDs:**`)
    for (const sid of data.session_ids as unknown[]) {
      lines.push(`- ${String(sid)}`)
    }
  }
  lines.push("")
  lines.push("## Raw JSON")
  lines.push("```json")
  lines.push(JSON.stringify(data, null, 2))
  lines.push("```")
  return lines.join("\n") + "\n"
}
