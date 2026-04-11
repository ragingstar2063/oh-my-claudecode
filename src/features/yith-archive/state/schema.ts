import { createHash } from "node:crypto";

export const KV = {
  sessions: "mem:sessions",
  observations: (sessionId: string) => `mem:obs:${sessionId}`,
  memories: "mem:memories",
  summaries: "mem:summaries",
  config: "mem:config",
  metrics: "mem:metrics",
  health: "mem:health",
  embeddings: (obsId: string) => `mem:emb:${obsId}`,
  bm25Index: "mem:index:bm25",
  relations: "mem:relations",
  profiles: "mem:profiles",
  claudeBridge: "mem:claude-bridge",
  graphNodes: "mem:graph:nodes",
  graphEdges: "mem:graph:edges",
  semantic: "mem:semantic",
  procedural: "mem:procedural",
  teamShared: (teamId: string) => `mem:team:${teamId}:shared`,
  teamUsers: (teamId: string, userId: string) =>
    `mem:team:${teamId}:users:${userId}`,
  teamProfile: (teamId: string) => `mem:team:${teamId}:profile`,
  audit: "mem:audit",
  actions: "mem:actions",
  actionEdges: "mem:action-edges",
  leases: "mem:leases",
  routines: "mem:routines",
  routineRuns: "mem:routine-runs",
  signals: "mem:signals",
  checkpoints: "mem:checkpoints",
  mesh: "mem:mesh",
  sketches: "mem:sketches",
  facets: "mem:facets",
  sentinels: "mem:sentinels",
  crystals: "mem:crystals",
  lessons: "mem:lessons",
  insights: "mem:insights",
  graphEdgeHistory: "mem:graph:edge-history",
  enrichedChunks: (sessionId: string) => `mem:enriched:${sessionId}`,
  latentEmbeddings: (obsId: string) => `mem:latent:${obsId}`,
  retentionScores: "mem:retention",
  indexMeta: "mem:index:meta",
  workPackets: "mem:work-packets",
  /** Per-session backfill cursors. Key = `${projectCwd}|${transcriptSessionId}`,
   *  value = `{ lastUuid, updatedAt }`. Used by mem::backfill-sessions to
   *  pick up where the last run left off so re-running the ritual only
   *  scans new transcript lines since the last pass. */
  backfillCursors: "mem:backfill:cursors",
  /** History of backfill runs for debugging / auditing. Key = runId,
   *  value = `{ startedAt, completedAt, projectCwd, stats, errors }`. */
  backfillRuns: "mem:backfill:runs",
  /** Binding ritual state. Single entry under key "current" holds the
   *  BindState object (phase completion, cursors, errors). The CLI's
   *  `oh-my-claudecode bind` command reads this on start and resumes
   *  from the first incomplete phase. See state/bind-state.ts. */
  bindState: "mem:bind-state",
  /** Pending-compression counter. Key "state" holds `{ count, updatedAt }`.
   *  Incremented on raw observation writes by mem::backfill-sessions,
   *  decremented on compressed-observation writes by mem::compress-step.
   *  The /cthulhu preflight reads this to tell the user how much work
   *  is waiting to be processed via the work-packet loop. */
  pendingCompression: "mem:pending-compression",
  /** Per-session cursors for the opencode SQLite importer. Key =
   *  `${db_path}|${opencode_session_id}`, value = `{ lastPartId }`. */
  opencodeImportCursors: "mem:opencode-import:cursors",
} as const;

export const STREAM = {
  name: "mem-live",
  group: (sessionId: string) => sessionId,
  viewerGroup: "viewer",
} as const;

export function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}_${ts}_${rand}`;
}

export function fingerprintId(prefix: string, content: string): string {
  const hash = createHash("sha256").update(content).digest("hex");
  return `${prefix}_${hash.slice(0, 16)}`;
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(/\s+/).filter((t) => t.length > 2));
  const setB = new Set(b.split(/\s+/).filter((t) => t.length > 2));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}
