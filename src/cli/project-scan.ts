import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { basename, extname, join, relative } from "node:path"
import { createHash } from "node:crypto"

import type { HookType, RawObservation } from "../features/yith-archive/types.js"

/**
 * Deep project scanner — Phase D of the binding ritual.
 *
 * Walks a project's directory tree (respecting .gitignore), parses
 * the well-known package-manager metadata files, extracts README
 * structure, counts language files by extension, and synthesizes a
 * set of RawObservations summarizing the project. These observations
 * get compressed into searchable memories later via the work-packet
 * loop, so even brand-new projects with zero session history land in
 * the Necronomicon with a useful baseline of context.
 *
 * Scope notes:
 *   - Walk depth is capped at 6 to avoid pathological directory trees.
 *   - File count is capped at 2000 so a leaked node_modules doesn't
 *     hang the scan.
 *   - Gitignore parsing is intentionally shallow — only the top-level
 *     .gitignore is respected, and only literal and glob-star patterns.
 *     Nested .gitignore files are skipped. This is a preliminary
 *     scan, not a perfect build tool.
 *   - Config file parsers cover the common cases (package.json,
 *     Cargo.toml, pyproject.toml, go.mod, composer.json, Gemfile).
 *     Rarer ones fall through to a "config file of unknown type"
 *     observation with the filename only.
 */

// ============================================================================
// Types
// ============================================================================

export interface LanguageStats {
  byExt: Record<string, number>
  primary: string
  total: number
}

export interface ReadmeSections {
  title: string | null
  firstParagraph: string | null
  headings: string[]
}

export interface PackageInfo {
  name?: string
  version?: string
  description?: string
  runtimeDependencies: string[]
  devDependencies: string[]
  scripts: Record<string, string>
  entryPoint?: string
}

export interface ProjectSummary {
  path: string
  files: string[]
  languages: LanguageStats
  packageInfo: PackageInfo | null
  readme: ReadmeSections | null
  configFiles: string[]
  directoryTree: string
}

// ============================================================================
// Gitignore
// ============================================================================

/**
 * Parse a .gitignore body into a flat list of patterns. Drops
 * comment lines (# prefix) and empty lines. Trailing slashes on
 * directory patterns are preserved so `isIgnored` can match them.
 */
export function parseGitignore(body: string): string[] {
  const out: string[] = []
  for (const line of body.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    out.push(trimmed)
  }
  return out
}

/**
 * Check whether a relative path matches any gitignore pattern.
 * Supports literal names, `*.ext` globs, and trailing-slash
 * directory patterns.
 */
export function isIgnored(relPath: string, patterns: string[]): boolean {
  const firstSegment = relPath.split("/")[0]
  for (const p of patterns) {
    const pattern = p.endsWith("/") ? p.slice(0, -1) : p
    // Literal match anywhere in the path.
    if (firstSegment === pattern) return true
    if (relPath === pattern) return true
    // Glob: *.ext
    if (pattern.startsWith("*.")) {
      const ext = pattern.slice(1) // ".ext"
      if (relPath.endsWith(ext)) return true
    }
    // Directory glob: dir or dir/
    if (relPath.startsWith(`${pattern}/`)) return true
  }
  return false
}

// ============================================================================
// Language stats
// ============================================================================

/**
 * Count file paths by extension and return the most-common one as
 * the primary language indicator. Extensions include the leading dot
 * so callers can distinguish `.ts` / `.tsx` / `.js` etc.
 */
export function summarizeLanguages(files: string[]): LanguageStats {
  const byExt: Record<string, number> = {}
  for (const f of files) {
    const ext = extname(f).toLowerCase()
    if (!ext) continue
    byExt[ext] = (byExt[ext] ?? 0) + 1
  }
  // Pick primary: max by count. Tie goes to whichever iterates first.
  let primary = ""
  let max = 0
  for (const [ext, n] of Object.entries(byExt)) {
    if (n > max) {
      max = n
      primary = ext
    }
  }
  return { byExt, primary, total: files.length }
}

// ============================================================================
// README extraction
// ============================================================================

/**
 * Extract the top-level title, first paragraph, and H2 headings from
 * a README markdown body. Used for the project-summary observation
 * so downstream search has something to match against even when the
 * README is the only source of truth about what the project does.
 */
export function extractReadmeSections(body: string): ReadmeSections {
  // Title: first `# <title>`
  const titleMatch = body.match(/^#\s+(.+?)\s*$/m)
  const title = titleMatch ? titleMatch[1].trim() : null

  // First paragraph: first non-empty block after the title.
  let firstParagraph: string | null = null
  if (titleMatch) {
    const afterTitle = body.slice(titleMatch.index! + titleMatch[0].length)
    const paras = afterTitle.split(/\n\s*\n/).map((p) => p.trim())
    firstParagraph = paras.find((p) => p && !p.startsWith("#")) ?? null
  }

  // H2 headings.
  const headings: string[] = []
  for (const m of body.matchAll(/^##\s+(.+?)\s*$/gm)) {
    headings.push(m[1].trim())
  }

  return { title, firstParagraph, headings }
}

// ============================================================================
// package.json parser
// ============================================================================

/**
 * Parse a package.json body into a simplified PackageInfo summary.
 * Returns null on malformed JSON — callers should handle the null
 * case (e.g., emit a "malformed package.json" observation).
 */
export function parsePackageJson(body: string): PackageInfo | null {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(body) as Record<string, unknown>
  } catch {
    return null
  }
  const name = typeof data.name === "string" ? data.name : undefined
  const version = typeof data.version === "string" ? data.version : undefined
  const description =
    typeof data.description === "string" ? data.description : undefined
  const entryPoint = typeof data.main === "string" ? data.main : undefined

  const runtime = (data.dependencies ?? {}) as Record<string, unknown>
  const dev = (data.devDependencies ?? {}) as Record<string, unknown>
  const scripts = (data.scripts ?? {}) as Record<string, unknown>

  return {
    name,
    version,
    description,
    entryPoint,
    runtimeDependencies: Object.keys(runtime),
    devDependencies: Object.keys(dev),
    scripts: Object.fromEntries(
      Object.entries(scripts).filter(([, v]) => typeof v === "string"),
    ) as Record<string, string>,
  }
}

// ============================================================================
// Directory walk
// ============================================================================

const MAX_WALK_DEPTH = 6
const MAX_FILES = 2000

/** Recursively walk a project tree, honoring a gitignore patterns
 *  list. Returns relative paths (relative to `root`). */
function walkProject(
  root: string,
  patterns: string[],
  current: string,
  depth: number,
  accum: string[],
): void {
  if (depth > MAX_WALK_DEPTH) return
  if (accum.length >= MAX_FILES) return
  let entries: string[]
  try {
    entries = readdirSync(current)
  } catch {
    return
  }

  for (const entry of entries) {
    if (accum.length >= MAX_FILES) return
    // Hard skip for well-known heavy dirs regardless of gitignore.
    if (
      entry === ".git" ||
      entry === "node_modules" ||
      entry === ".next" ||
      entry === "dist"
    ) {
      continue
    }
    const abs = join(current, entry)
    const rel = relative(root, abs)
    if (isIgnored(rel, patterns)) continue

    let s
    try {
      s = statSync(abs)
    } catch {
      continue
    }
    if (s.isDirectory()) {
      walkProject(root, patterns, abs, depth + 1, accum)
    } else if (s.isFile()) {
      accum.push(rel)
    }
  }
}

// ============================================================================
// Top-level scan
// ============================================================================

const KNOWN_CONFIG_FILES = [
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  "Cargo.toml",
  "pyproject.toml",
  "go.mod",
  "composer.json",
  "Gemfile",
  "shard.yml",
  "build.gradle",
  "pom.xml",
  "Makefile",
  "CMakeLists.txt",
  "Dockerfile",
  "docker-compose.yml",
  ".prettierrc",
  ".eslintrc.json",
]

export async function scanProject(root: string): Promise<ProjectSummary> {
  if (!existsSync(root)) {
    return {
      path: root,
      files: [],
      languages: { byExt: {}, primary: "", total: 0 },
      packageInfo: null,
      readme: null,
      configFiles: [],
      directoryTree: "",
    }
  }

  // Load top-level .gitignore.
  const gitignorePath = join(root, ".gitignore")
  const patterns = existsSync(gitignorePath)
    ? parseGitignore(readFileSync(gitignorePath, "utf-8"))
    : []

  // Walk.
  const files: string[] = []
  walkProject(root, patterns, root, 0, files)

  // Config files discovered by name at top level.
  const configFiles = KNOWN_CONFIG_FILES.filter((name) =>
    existsSync(join(root, name)),
  )

  // Language stats.
  const languages = summarizeLanguages(files)

  // package.json.
  let packageInfo: PackageInfo | null = null
  const pkgPath = join(root, "package.json")
  if (existsSync(pkgPath)) {
    try {
      packageInfo = parsePackageJson(readFileSync(pkgPath, "utf-8"))
    } catch {
      /* malformed — leave null */
    }
  }

  // README.
  let readme: ReadmeSections | null = null
  for (const name of ["README.md", "readme.md", "Readme.md", "README"]) {
    const p = join(root, name)
    if (existsSync(p)) {
      try {
        readme = extractReadmeSections(readFileSync(p, "utf-8"))
        break
      } catch {
        /* ignore */
      }
    }
  }

  // Directory tree: flatten to depth-2 string.
  const directoryTree = buildDirectoryTree(root, patterns)

  return {
    path: root,
    files,
    languages,
    packageInfo,
    readme,
    configFiles,
    directoryTree,
  }
}

function buildDirectoryTree(root: string, patterns: string[]): string {
  const lines: string[] = []
  try {
    const entries = readdirSync(root)
    for (const entry of entries) {
      if (
        entry === ".git" ||
        entry === "node_modules" ||
        entry === ".next" ||
        entry === "dist"
      )
        continue
      if (isIgnored(entry, patterns)) continue
      let s
      try {
        s = statSync(join(root, entry))
      } catch {
        continue
      }
      lines.push(`${entry}${s.isDirectory() ? "/" : ""}`)
    }
  } catch {
    /* unreadable root */
  }
  return lines.sort().join("\n")
}

// ============================================================================
// Summary → observations
// ============================================================================

/**
 * Emit a set of RawObservations synthesized from the scan results.
 * Every observation gets a stable ID derived from the project path
 * plus the observation kind, so re-running the scan produces the
 * same IDs and the idempotent-upsert path in the write layer
 * dedupes automatically.
 */
export function projectSummaryToObservations(
  summary: ProjectSummary,
): RawObservation[] {
  const obs: RawObservation[] = []
  const now = new Date().toISOString()
  const sessionId = `proj:${hash(summary.path)}`
  const mkId = (kind: string) =>
    `proj:${hash(summary.path)}:${kind}`

  // 1. Language summary.
  if (summary.languages.total > 0) {
    const topExts = Object.entries(summary.languages.byExt)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ext, n]) => `${ext} (${n})`)
      .join(", ")
    obs.push({
      id: mkId("languages"),
      sessionId,
      timestamp: now,
      hookType: "session_start" as HookType,
      userPrompt:
        `Project at ${summary.path} has ${summary.languages.total} source files. ` +
        `Top languages: ${topExts}. Primary: ${summary.languages.primary || "mixed"}.`,
      raw: { kind: "project-languages", languages: summary.languages },
    })
  }

  // 2. Package info.
  if (summary.packageInfo) {
    const pkg = summary.packageInfo
    const deps = pkg.runtimeDependencies.slice(0, 10).join(", ")
    const devDeps = pkg.devDependencies.slice(0, 10).join(", ")
    obs.push({
      id: mkId("package"),
      sessionId,
      timestamp: now,
      hookType: "session_start" as HookType,
      userPrompt:
        `Package ${pkg.name ?? "(unnamed)"} v${pkg.version ?? "0"}: ` +
        `${pkg.description ?? ""}. ` +
        (pkg.entryPoint ? `Entry: ${pkg.entryPoint}. ` : "") +
        (deps ? `Runtime deps: ${deps}. ` : "") +
        (devDeps ? `Dev deps: ${devDeps}.` : ""),
      raw: { kind: "project-package", package: pkg },
    })
  }

  // 3. README summary.
  if (summary.readme?.title || summary.readme?.firstParagraph) {
    obs.push({
      id: mkId("readme"),
      sessionId,
      timestamp: now,
      hookType: "session_start" as HookType,
      userPrompt:
        `README for project ${summary.path}: ` +
        (summary.readme.title ? `"${summary.readme.title}". ` : "") +
        (summary.readme.firstParagraph ?? "") +
        (summary.readme.headings.length > 0
          ? ` Sections: ${summary.readme.headings.join(", ")}.`
          : ""),
      raw: { kind: "project-readme", readme: summary.readme },
    })
  }

  // 4. Directory structure.
  if (summary.directoryTree) {
    obs.push({
      id: mkId("tree"),
      sessionId,
      timestamp: now,
      hookType: "session_start" as HookType,
      userPrompt:
        `Top-level structure of ${summary.path}:\n` + summary.directoryTree,
      raw: { kind: "project-tree", tree: summary.directoryTree },
    })
  }

  // 5. Config files.
  if (summary.configFiles.length > 0) {
    obs.push({
      id: mkId("configs"),
      sessionId,
      timestamp: now,
      hookType: "session_start" as HookType,
      userPrompt:
        `Config files detected in ${summary.path}: ${summary.configFiles.join(", ")}.`,
      raw: { kind: "project-configs", configs: summary.configFiles },
    })
  }

  return obs
}

/** Short stable hash of a string, used for generating observation IDs. */
function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12)
}
