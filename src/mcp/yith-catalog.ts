/**
 * Yith function catalog — the single source of truth for the curated list
 * of advanced memory operations exposed through the yith_trigger escape
 * hatch. Two consumers:
 *
 *   1. yith-tools.ts builds yith_trigger's description from CORE_CATALOG so
 *      subagents and Claude itself can see the most useful ops inline in
 *      the tool's schema without having to run any discovery command.
 *   2. cli/doctor.ts prints the FULL_CATALOG when invoked with the
 *      --yith-functions flag, so humans and agents have a complete
 *      reference without bloating every MCP tool description.
 *
 * To add a function: add it to FULL_CATALOG. If it's broadly useful enough
 * to surface inline, also add it to CORE_CATALOG (keep that list under 25
 * entries — it rides in every tool-list response and bloats the context).
 *
 * Names here must match the `id` field passed to sdk.registerFunction in
 * src/features/yith-archive/functions/*.ts. Stale names will surface as
 * "No handler registered" errors from the dispatcher at call time.
 */

export interface CatalogEntry {
  /** Fully qualified function name, as passed to sdk.trigger. */
  name: string
  /** One-line summary — keep it short, 3-8 words. */
  summary: string
  /** Logical grouping for the full-catalog print output. */
  category: CatalogCategory
}

/**
 * Set of function IDs that require an LLM. Used by lookups that can't
 * reach a full CatalogEntry (e.g. routing checks). Keep in sync with
 * the `llmRequired: true` entries below and with LLM_FUNCTION_REGISTRY
 * in src/mcp/yith-tools.ts — these three lists must agree or users will
 * see "function not found" errors in work-packet mode.
 */
export const LLM_REQUIRED_FUNCTIONS: ReadonlySet<string> = new Set([
  "mem::crystallize",
  "mem::consolidate",
  "mem::consolidate-pipeline",
  "mem::compress",
  "mem::summarize",
  "mem::flow-compress",
  "mem::graph-extract",
  "mem::temporal-graph-extract",
  "mem::expand-query",
  "mem::skill-extract",
  "mem::reflect",
  "mem::enrich-window",
  "mem::enrich-session",
])

export type CatalogCategory =
  | "graph"
  | "consolidation"
  | "summarization"
  | "crystallization"
  | "lessons"
  | "working-memory"
  | "actions"
  | "facets"
  | "sketches"
  | "checkpoints"
  | "leases"
  | "signals"
  | "snapshots"
  | "skills"
  | "timeline"
  | "profile"
  | "diagnostics"
  | "files"
  | "frontier"
  | "migration"
  | "privacy"
  | "retention"
  | "relations"

/**
 * Top ~20 functions subagents are most likely to need. Embedded directly
 * into yith_trigger's tool description so every session sees them without
 * needing to run doctor. Ordering is roughly by expected frequency of use.
 */
export const CORE_CATALOG: readonly CatalogEntry[] = [
  {
    name: "mem::consolidate-pipeline",
    summary: "full consolidation pass (merge, dedup, prune)",
    category: "consolidation",
  },
  {
    name: "mem::graph-extract",
    summary: "pull entities + relations from observations",
    category: "graph",
  },
  {
    name: "mem::graph-query",
    summary: "traverse the knowledge graph",
    category: "graph",
  },
  {
    name: "mem::crystallize",
    summary: "promote observations to durable memories",
    category: "crystallization",
  },
  {
    name: "mem::lesson-save",
    summary: "save a lesson from an incident or outcome",
    category: "lessons",
  },
  {
    name: "mem::lesson-recall",
    summary: "recall relevant lessons for current context",
    category: "lessons",
  },
  {
    name: "mem::reflect",
    summary: "trigger reflection pass on recent work",
    category: "crystallization",
  },
  {
    name: "mem::temporal-query",
    summary: "query memories by time range",
    category: "graph",
  },
  {
    name: "mem::working-context",
    summary: "assemble working-set context",
    category: "working-memory",
  },
  {
    name: "mem::core-add",
    summary: "pin a memory into working memory",
    category: "working-memory",
  },
  {
    name: "mem::patterns",
    summary: "surface recurring patterns",
    category: "timeline",
  },
  {
    name: "mem::profile",
    summary: "build profile for a project or user",
    category: "profile",
  },
  {
    name: "mem::evolve",
    summary: "create a new version of a memory (supersede)",
    category: "relations",
  },
  {
    name: "mem::forget",
    summary: "hard-delete a memory by id",
    category: "retention",
  },
  {
    name: "mem::snapshot-create",
    summary: "snapshot the full archive to disk",
    category: "snapshots",
  },
  {
    name: "mem::export",
    summary: "export archive as portable JSON",
    category: "migration",
  },
  {
    name: "mem::diagnose",
    summary: "health and stats dump",
    category: "diagnostics",
  },
  {
    name: "mem::backfill-sessions",
    summary: "ingest past Claude Code transcripts as raw observations",
    category: "migration",
  },
  {
    name: "mem::enrich-session",
    summary: "enrich an entire session's observations",
    category: "summarization",
  },
  {
    name: "mem::skill-extract",
    summary: "extract skills from session summaries",
    category: "skills",
  },
  {
    name: "mem::verify",
    summary: "fact-check a claim against stored memories",
    category: "diagnostics",
  },
] as const

/**
 * Complete registry of every non-core function registered against the Yith
 * in-process dispatcher. The five functions backed by first-class MCP tools
 * (`mem::remember`, `mem::smart-search`, `mem::context`, `mem::observe`,
 * `mem::search`) are intentionally omitted — callers should use the tools
 * directly. Everything else is reachable via yith_trigger.
 *
 * When a new function is added to src/features/yith-archive/functions/*.ts,
 * add a matching entry here and the doctor command will pick it up.
 */
export const FULL_CATALOG: readonly CatalogEntry[] = [
  // Graph & temporal
  { name: "mem::graph-extract", summary: "extract entities + relations from observations", category: "graph" },
  { name: "mem::graph-query", summary: "traverse the knowledge graph", category: "graph" },
  { name: "mem::graph-stats", summary: "graph metrics (nodes, edges, density)", category: "graph" },
  { name: "mem::temporal-graph-extract", summary: "time-aware graph extraction", category: "graph" },
  { name: "mem::temporal-query", summary: "query memories by time range", category: "graph" },
  { name: "mem::differential-state", summary: "diff graph state between two times", category: "graph" },

  // Consolidation & lifecycle
  { name: "mem::consolidate", summary: "merge related memories once", category: "consolidation" },
  { name: "mem::consolidate-pipeline", summary: "full consolidation pass (merge, dedup, prune)", category: "consolidation" },
  { name: "mem::cascade-update", summary: "propagate updates through related memories", category: "consolidation" },

  // Retention & eviction
  { name: "mem::auto-forget", summary: "apply TTL / decay policies", category: "retention" },
  { name: "mem::retention-score", summary: "score memories for retention", category: "retention" },
  { name: "mem::retention-evict", summary: "evict low-retention memories", category: "retention" },
  { name: "mem::evict", summary: "manual eviction by criteria", category: "retention" },
  { name: "mem::forget", summary: "hard-delete a memory by id", category: "retention" },

  // Summarization & compression
  { name: "mem::summarize", summary: "generate end-of-session summary", category: "summarization" },
  { name: "mem::compress", summary: "compress long observations", category: "summarization" },
  { name: "mem::flow-compress", summary: "compress a trajectory/flow of events", category: "summarization" },
  { name: "mem::enrich", summary: "enrich observations with inferred context", category: "summarization" },
  { name: "mem::enrich-window", summary: "enrich a sliding window of observations", category: "summarization" },
  { name: "mem::enrich-session", summary: "enrich an entire session's observations", category: "summarization" },
  { name: "mem::expand-query", summary: "query expansion for search", category: "summarization" },

  // Crystallization & reflection
  { name: "mem::crystallize", summary: "promote observations to durable memories", category: "crystallization" },
  { name: "mem::auto-crystallize", summary: "automated crystallization pass", category: "crystallization" },
  { name: "mem::crystal-list", summary: "list crystallized memories", category: "crystallization" },
  { name: "mem::crystal-get", summary: "get a specific crystallized memory", category: "crystallization" },
  { name: "mem::reflect", summary: "reflect on recent work, emit insights", category: "crystallization" },
  { name: "mem::insight-list", summary: "list insights", category: "crystallization" },
  { name: "mem::insight-search", summary: "search insights", category: "crystallization" },
  { name: "mem::insight-decay-sweep", summary: "decay old insights", category: "crystallization" },

  // Lessons
  { name: "mem::lesson-save", summary: "save a lesson from an incident or outcome", category: "lessons" },
  { name: "mem::lesson-recall", summary: "recall relevant lessons for current context", category: "lessons" },
  { name: "mem::lesson-list", summary: "list all saved lessons", category: "lessons" },
  { name: "mem::lesson-strengthen", summary: "strengthen a lesson (reinforcement)", category: "lessons" },
  { name: "mem::lesson-decay-sweep", summary: "decay unused lessons", category: "lessons" },

  // Working memory
  { name: "mem::core-add", summary: "pin a memory into working memory", category: "working-memory" },
  { name: "mem::core-remove", summary: "unpin a working memory entry", category: "working-memory" },
  { name: "mem::core-list", summary: "list working memory entries", category: "working-memory" },
  { name: "mem::working-context", summary: "assemble working-set context", category: "working-memory" },
  { name: "mem::auto-page", summary: "auto-page working memory to archival", category: "working-memory" },

  // Actions
  { name: "mem::action-create", summary: "create an action record", category: "actions" },
  { name: "mem::action-update", summary: "update an action record", category: "actions" },
  { name: "mem::action-edge-create", summary: "link two actions", category: "actions" },
  { name: "mem::action-list", summary: "list actions", category: "actions" },
  { name: "mem::action-get", summary: "fetch an action by id", category: "actions" },

  // Facets
  { name: "mem::facet-tag", summary: "tag a memory with a facet", category: "facets" },
  { name: "mem::facet-untag", summary: "remove a facet tag", category: "facets" },
  { name: "mem::facet-query", summary: "query memories by facet", category: "facets" },
  { name: "mem::facet-get", summary: "get facet details", category: "facets" },
  { name: "mem::facet-stats", summary: "facet usage statistics", category: "facets" },
  { name: "mem::facet-dimensions", summary: "list all facet dimensions", category: "facets" },

  // Sketches
  { name: "mem::sketch-create", summary: "create a sketch (draft memory)", category: "sketches" },
  { name: "mem::sketch-add", summary: "add content to a sketch", category: "sketches" },
  { name: "mem::sketch-promote", summary: "promote sketch to durable memory", category: "sketches" },
  { name: "mem::sketch-discard", summary: "discard a sketch", category: "sketches" },
  { name: "mem::sketch-list", summary: "list active sketches", category: "sketches" },
  { name: "mem::sketch-gc", summary: "garbage-collect stale sketches", category: "sketches" },

  // Checkpoints
  { name: "mem::checkpoint-create", summary: "create a session checkpoint", category: "checkpoints" },
  { name: "mem::checkpoint-resolve", summary: "resolve a checkpoint", category: "checkpoints" },
  { name: "mem::checkpoint-list", summary: "list checkpoints", category: "checkpoints" },
  { name: "mem::checkpoint-expire", summary: "expire old checkpoints", category: "checkpoints" },

  // Leases (mutual exclusion)
  { name: "mem::lease-acquire", summary: "acquire a lease on a memory", category: "leases" },
  { name: "mem::lease-release", summary: "release a lease", category: "leases" },
  { name: "mem::lease-renew", summary: "renew a held lease", category: "leases" },
  { name: "mem::lease-cleanup", summary: "clean up expired leases", category: "leases" },

  // Signals (cross-agent messaging)
  { name: "mem::signal-send", summary: "send a cross-agent signal", category: "signals" },
  { name: "mem::signal-read", summary: "read incoming signals", category: "signals" },
  { name: "mem::signal-threads", summary: "list active signal threads", category: "signals" },
  { name: "mem::signal-cleanup", summary: "clean up delivered signals", category: "signals" },

  // Snapshots
  { name: "mem::snapshot-create", summary: "snapshot the archive to disk", category: "snapshots" },
  { name: "mem::snapshot-list", summary: "list archive snapshots", category: "snapshots" },
  { name: "mem::snapshot-restore", summary: "restore from a snapshot", category: "snapshots" },

  // Skills (meta-memory)
  { name: "mem::skill-extract", summary: "extract skills from session summaries", category: "skills" },
  { name: "mem::skill-list", summary: "list extracted skills", category: "skills" },
  { name: "mem::skill-match", summary: "match a skill to current context", category: "skills" },

  // Timeline & patterns
  { name: "mem::timeline", summary: "build project timeline", category: "timeline" },
  { name: "mem::patterns", summary: "surface recurring patterns", category: "timeline" },
  { name: "mem::generate-rules", summary: "generate rules from detected patterns", category: "timeline" },

  // Profile
  { name: "mem::profile", summary: "build profile for a project or user", category: "profile" },

  // Diagnostics
  { name: "mem::diagnose", summary: "health and stats dump", category: "diagnostics" },
  { name: "mem::heal", summary: "heal corrupted archive state", category: "diagnostics" },
  { name: "mem::verify", summary: "fact-check a claim against stored memories", category: "diagnostics" },

  // Files
  { name: "mem::file-context", summary: "get context relevant to a file", category: "files" },

  // Frontier (exploration hints)
  { name: "mem::frontier", summary: "exploration frontier for current project", category: "frontier" },
  { name: "mem::next", summary: "suggested next action from frontier", category: "frontier" },

  // Migration & I/O
  { name: "mem::migrate", summary: "migrate archive schema versions", category: "migration" },
  { name: "mem::export", summary: "export archive as portable JSON", category: "migration" },
  { name: "mem::import", summary: "import archive from JSON", category: "migration" },
  { name: "mem::backfill-sessions", summary: "ingest past Claude Code transcripts as raw observations", category: "migration" },

  // Privacy
  { name: "mem::privacy", summary: "apply privacy rules to memories", category: "privacy" },

  // Relations
  { name: "mem::relate", summary: "create a relation between two memories", category: "relations" },
  { name: "mem::evolve", summary: "create a new version of a memory (supersede)", category: "relations" },
  { name: "mem::get-related", summary: "fetch related memories for an id", category: "relations" },
] as const

/**
 * Render the CORE_CATALOG as a plain-text block suitable for embedding into
 * yith_trigger's description field. The block is stable across calls so MCP
 * clients that cache tool descriptions see the same content.
 */
export function buildTriggerDescription(): string {
  const lines: string[] = [
    "Dispatch an arbitrary registered Yith memory function by name. Use for " +
      "advanced ops beyond the five core tools (yith_remember/search/recall/" +
      "context/observe) — things like graph extraction, consolidation, " +
      "temporal queries, crystallization, lesson recall, and reflection.",
    "",
    "Functions marked ⚡ need an LLM. In work-packet mode (no API key) " +
      "they return a `needs_llm_work` envelope — execute the workPackets " +
      "and call yith_commit_work to resume.",
    "",
    "Top functions (pass `name` as one of these):",
  ]
  // Account for the ⚡ marker when sizing the name column.
  const nameWidth = Math.max(
    ...CORE_CATALOG.map((e) => e.name.length + (LLM_REQUIRED_FUNCTIONS.has(e.name) ? 2 : 0)),
  )
  for (const entry of CORE_CATALOG) {
    const marker = LLM_REQUIRED_FUNCTIONS.has(entry.name) ? "⚡ " : "  "
    lines.push(`  ${marker}${entry.name.padEnd(nameWidth - 2)}  ${entry.summary}`)
  }
  lines.push(
    "",
    `Full list of ${FULL_CATALOG.length} functions: run \`oh-my-claudecode doctor --yith-functions\`.`,
  )
  return lines.join("\n")
}

/**
 * Group the full catalog by category for pretty-printing in the doctor
 * command. Returns an ordered array of [category, entries[]] pairs.
 */
export function groupFullCatalog(): Array<[CatalogCategory, CatalogEntry[]]> {
  const groups = new Map<CatalogCategory, CatalogEntry[]>()
  for (const entry of FULL_CATALOG) {
    const bucket = groups.get(entry.category) ?? []
    bucket.push(entry)
    groups.set(entry.category, bucket)
  }
  return Array.from(groups.entries())
}
