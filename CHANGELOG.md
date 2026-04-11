# Changelog

All notable changes to oh-my-claudecode are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.5] — 2026-04-11

### Added

- **`yith-capture` Stop hook — continuous ingestion.** Fires after
  every assistant turn and spawns `oh-my-claudecode bind --resume
  --claude-only --project $CLAUDE_PROJECT_DIR` in the background via
  a detached grandchild. Each tick is bounded to ~milliseconds because
  (a) it only runs the `claude_transcripts` phase (no embedding
  download, no opencode scan, no sisyphus walk, no code scan),
  (b) it scopes to the current session's project via the
  `CLAUDE_PROJECT_DIR` env var Claude Code sets on every hook, and
  (c) the per-session cursor in `KV.backfillCursors` means only new
  transcript lines get read. Debounced via a `.last-captured`
  sentinel at 5 seconds so rapid-fire responses don't thrash the
  filesystem. Fail-safe — exits 0 on every branch so a broken Yith
  install can't wedge a Claude Code session.
- **Opportunistic compression tick in the same hook.** When the
  pending-compression counter crosses a 50-observation threshold AND
  the compression sentinel (`.last-compressed`) is more than 5
  minutes old, the hook also spawns `oh-my-claudecode bind --resume
  --compress-only --background`. The `--compress-only` flag spawns
  `claude -p` with the compression-loop prompt under a
  `--max-budget-usd` cap and the yith MCP tool allowlist, so the
  compression runs in a fully detached subprocess using the user's
  subscription auth. The Stop hook itself returns in ~10 ms either
  way — nothing blocks the assistant response.
- **`oh-my-claudecode bind --claude-only` flag** — narrows the state
  machine to just the `claude_transcripts` phase. Unrelated phases'
  bindState stays untouched (pending), so the next full bind
  invocation still runs them in order. Used by the Stop hook to
  avoid re-downloading the embedding model or re-scanning opencode
  on every assistant response.
- **`oh-my-claudecode bind --project <cwd>` flag** — scopes the
  transcript scan to a single project cwd instead of all subdirs
  under `~/.claude/projects/`. Threads through `runBind` via a new
  `projectCwd` field on `BindContext`, which the default
  `claude_transcripts` runner uses to call
  `mem::backfill-sessions` with `allProjects: false` + an explicit
  `projectCwd`.
- **`oh-my-claudecode bind --compress-only` flag** — spawns
  `claude -p` with the pre-built compression loop prompt (via
  `buildClaudePSpawnCommand`) and exits. Fire-and-forget when
  combined with `--background`.
- **`oh-my-claudecode bind --background` flag** — re-execs the CLI
  as a detached grandchild and returns immediately. Used by the
  Stop hook so capture/compression ticks never block the parent
  Claude Code session.
- **`onlyPhases` option on `runBind`** — filter to a subset of
  phases. Tests cover the narrow-run paths, confirm unrelated phases
  are neither invoked nor marked complete, and verify the scoped
  project cwd threads through the `BindContext`.

### Changed

- **Hook count bumped to 8** — `yith-capture` joins the existing
  seven. Disable it via
  `disabled_hooks: ["yith-capture"]` in `~/.claude/oh-my-claudecode.jsonc`
  if you prefer the old bind-and-forget model.
- `README.md` Lifecycle Hooks table now describes `yith-capture`
  including its debounce + threshold behavior.

### Notes

This release completes the "memory that actually keeps itself fresh"
story. Before 0.2.5, the Necronomicon was a one-shot batch: you ran
`oh-my-claudecode bind` once, and the archive stayed frozen at that
snapshot until you manually re-ran it (or installed the hourly
cron). After 0.2.5, every assistant turn fires a tiny capture tick
that walks the current session's transcript cursor forward, so new
user prompts, assistant responses, and tool calls flow into the
raw-observation queue within seconds of happening. Compression still
batches — raw → searchable takes up to ~5 minutes (or instantly if
you're already inside a session running `/necronomicon-bind`), but
the raw ingestion is now live.

## [0.2.4] — 2026-04-11

### Added

- **`oh-my-claudecode bind` CLI subcommand** — the real binding
  ritual runs as a Node process in the user's terminal (not as a
  Claude Code slash command, which the earlier design had and which
  skipped steps silently). Full ANSI TUI with in-place progress
  bars, section headers, status glyphs, and phase-level resume via
  a new `KV.bindState` scope. Six phases in strict order:
  `embedding_download → claude_transcripts → opencode_import →
  sisyphus_migrate → preliminary_seed → pending_compression_trigger`.
  Each phase persists its state after transitioning so a mid-run
  crash resumes exactly where it stopped — no manual intervention.
- **All-projects Claude Code transcript backfill.** `mem::backfill-
  sessions` gains `allProjects: true` mode that enumerates every
  subdirectory under `~/.claude/projects/`, unsanitizes the
  directory name back to an absolute path, and runs the per-project
  scanner against each. Single invocation ingests history for every
  project the user has ever opened Claude Code in.
- **Opencode SQLite importer** (`mem::import-opencode`). Reads a
  legacy `oh-my-opencode`'s `~/.local/share/opencode/opencode.db`
  (or a user-specified path) via the `sqlite3` CLI in `-json` mode,
  walks `project → session → message → part`, and maps each `part`
  to a Yith RawObservation using a dedicated mapper for opencode's
  content-block shape (text / tool / reasoning / patch / step-start
  / step-finish). Stable IDs `oc:<sessionId>:<partId>` make
  re-imports idempotent. Per-session cursors under
  `KV.opencodeImportCursors` enable incremental ingestion.
- **Sisyphus → elder-gods migrator** (`oh-my-claudecode bind`
  handles this as a phase; also exposed as `migrateSisyphusDir`
  function). Walks every `.sisyphus/` directory on the user's
  machine and copies plans / handoffs / evidence into the
  corresponding `.elder-gods/` equivalent, translating
  `boulder.json` into a synthesized `legacy-boulder.md` plan file.
  Non-destructive: the source `.sisyphus/` dir is left intact.
  Idempotent: a second run copies nothing.
- **Deep project-code scanner for preliminary memories**
  (`scanProject` + `projectSummaryToObservations`). Walks a
  project tree honoring `.gitignore`, counts language files by
  extension, parses `package.json` / `tsconfig.json` /
  `Cargo.toml` / `pyproject.toml` / `go.mod` / etc., extracts
  README title + first paragraph + H2 headings, builds a top-level
  directory tree summary. Synthesizes 5 preliminary
  RawObservations per project (languages, package info, README,
  directory structure, config files) so brand-new projects with
  zero history still land in the Necronomicon with useful baseline
  context. Walk depth capped at 6 and file count capped at 2000 to
  keep the scan bounded.
- **`mem::compress-batch-step`** — new loop-style work-packet
  function that walks every raw observation in the archive, emits
  compression prompts in `planLoopBatches` chunks, and consumes
  completions into `CompressedObservation`s. This is the Phase 2
  counterpart to the CLI's fast filesystem Phase 1: the CLI
  ingests raw, `compress-batch-step` distills raw into searchable
  memories. Drives the pending-compression counter from the `bind`
  output down to zero as batches complete.
- **Embedding model pre-download hook** — `LocalEmbeddingProvider`
  gains a `warmUp({onProgress})` method that forces the nomic
  model to load (and download if missing) while emitting
  `{phase: "loading" | "downloading" | "ready" | "error", loaded,
  total}` events. The CLI bind TUI subscribes to these and draws
  a real progress bar so users see the 137 MB download happen
  instead of waiting in silence.
- **Pending-compression counter** — new `KV.pendingCompression`
  scope tracks how many raw observations are awaiting compression
  across the whole archive. `cthulhu-auto` hook reads it on every
  session start and offers to drain the queue via the work-packet
  loop when the count is non-zero.
- **`cthulhu-auto` preflight** now shells out to `jq` to read
  `necronomicon.json` and emit a tailored preflight block based
  on the bind state: hard-block when unbound, retry nudge when
  phases failed, pending-compression offer when the queue has
  entries, quiet confirmation when everything's done.
- **`oh-my-claudecode bind --install-cron [--interval 1h]`** —
  installs a system crontab entry that runs `bind --resume` on
  the chosen interval. The resume path uses `claude -p` (Claude
  Code's non-interactive mode) with restricted tool allowlist
  (`mcp__yith-archive__*` only), a `--max-budget-usd` cap, and
  an embedded compression-loop prompt to drain pending work
  unattended using the user's subscription auth. Idempotent
  crontab edit via a `# oh-my-claudecode bind` marker line.
- **Node built-in test runner (`node:test`) infrastructure** —
  added `tsx` as a devDependency and `test` / `test:watch` npm
  scripts. 70 tests now cover bind state, backfill all-projects
  mode, compress-batch loop, embedding warmup, TUI primitives,
  cron assembly, preflight generation, opencode mapping and
  import, sisyphus migration, and project scan. Run with
  `npm test`.

### Changed

- Slash command renamed `/bind-necronomicon` → `/necronomicon-bind`.
  The new command is a thin wrapper that shells out to
  `oh-my-claudecode bind` (fast, real progress) and then drives
  Phase 2 compression inline via the work-packet loop using the
  session's own LLM. No more prompt-only ritual that silently
  skipped steps.
- `cthulhu.md` and `cthulhu-auto` hook both now read bind state
  from `necronomicon.json` at activation and tell the user to run
  `/necronomicon-bind` if the archive isn't bound yet.

### Fixed

- Earlier versions of `/bind-necronomicon` were prompt-only — they
  relied on Claude to call `yith_remember` / `yith_trigger` inline
  from the slash command. In practice Claude skipped the calls and
  printed cosmetic ✓ marks, leaving the Necronomicon empty. The
  new design moves the actual work into a CLI subcommand so the
  ritual is deterministic.
- `mem::backfill-sessions` previously hardcoded the single-project
  scope to `process.cwd()`, which meant running it from any shell
  only ingested one project's history. The `allProjects: true`
  mode scans every subdir under `~/.claude/projects/` so a single
  invocation covers everything.

## [0.2.3] — 2026-04-11

> Note: v0.2.0 and v0.2.2 were never tagged/released because the
> CI auto-publish workflow blindly bumped patch versions on every
> push to `main` — even on commits whose message was already
> `chore(release): vX.Y.Z`. The user's manual release commits got
> rewritten to v0.2.1 and v0.2.3 respectively. This release includes
> a workflow fix (`.github/workflows/publish.yml`) that detects
> manual release commits and respects the pre-committed version
> instead of auto-bumping over it. Future manual releases will match
> their declared version exactly.

### Fixed

- **CI publish workflow double-bumped manual release commits.**
  `.github/workflows/publish.yml` now inspects HEAD's commit message:
  if it matches `chore(release): v<semver>` AND package.json is
  already at that version, the workflow skips the auto-bump step and
  tags/publishes the user's declared version as-is. A mismatch
  between commit message and package.json now fails the workflow
  with a clear error.
- **MCP server registration landed in the wrong file.** Earlier
  installs wrote `mcpServers.yith-archive` to
  `~/.claude/settings.json`, but Claude Code reads user-level MCP
  servers from the top-level `mcpServers` map in `~/.claude.json`
  (a separate file that holds onboarding state, per-project trust,
  cached growthbook features, etc.). The installer now writes to
  `~/.claude.json` with atomic tmpfile+rename, preserves all existing
  user state, and takes a timestamped backup. `doctor` also queries
  the correct location and warns if it finds a stale entry in the
  old one. Existing broken installs self-heal by re-running
  `oh-my-claudecode install`.

### Added

- **Necronomicon dual-naming.** Yith Archive's on-disk file renamed
  from `store.json` to `necronomicon.json`. Existing installs are
  automatically migrated on boot via an atomic rename — if the new
  name doesn't exist but the old one does, it gets renamed in place.
  Code-level API (types, function IDs, module paths) is unchanged.
  The user-facing flavor treats Yith as the archival practice of the
  Great Race and the Necronomicon as the physical grimoire they bind
  to this machine.
- **`/bind-necronomicon` slash command.** First-time setup ritual
  with five phases: tome reachability check, embedding sigil warmup
  (caches the local nomic model), hybrid search verification,
  optional session history backfill, and a sealing summary.
  Idempotent — safe to run any number of times to verify state.
- **First-run preflight in `/cthulhu` and `cthulhu-auto`.** When
  Cthulhu activates, it runs a one-shot `yith_context` probe. If the
  MCP server isn't reachable, it tells the user to run
  `/bind-necronomicon` first and waits for their decision before
  acting on the original request.
- **`mem::backfill-sessions` — Claude Code transcript ingestion.**
  Reads past session transcripts from
  `~/.claude/projects/<sanitized-cwd>/*.jsonl`, maps each meaningful
  line (user prompts, assistant text, assistant tool calls) into a
  `RawObservation`, and persists them to Yith's KV. Idempotent via
  stable `sess:<sessionId>:<uuid>[:slot]` IDs and per-session cursors
  in `KV.backfillCursors`. Args: `projectCwd`, `sessionId`, `dryRun`,
  `includeSystem`, `includeToolResults`, `maxObservations` (default
  500 cap). The function writes raw observations only — compression
  runs separately through the work-packet loop so callers can pace
  LLM budget independently of ingestion speed.
- **ASCII progress bars for tool-call loops.** Backfill's terminal
  result includes a `progressBar` field rendered as a 20-cell
  monospace bar (`[▓▓▓▓▓░░░░░░░░░░░░] 47% — 171/500 observations
  created`). The `/bind-necronomicon` command documents re-printing
  the bar across successive `yith_commit_work` rounds so the parent
  session's chat shows forward motion during long compression flows.

### Changed

- `memory-override` SessionStart hook prompt rewritten to introduce
  the Yith/Necronomicon dual-naming and instruct the user to run
  `/bind-necronomicon` if the tome isn't bound yet.

## [0.2.1] — 2026-04-11

> Note: v0.2.0 and v0.2.2 never existed as released tags. The CI
> auto-publish workflow was blindly bumping patch numbers on manual
> release commits, so the tags that actually got cut were v0.2.1 and
> v0.2.3. The content below is what was intended as v0.2.0 and
> shipped as v0.2.1. Fixed in the v0.2.3 workflow update.


### Added

- **Yith Archive** — persistent cross-session memory subsystem. 14k lines of
  TypeScript providing file-backed key/value storage, hybrid BM25 + vector
  search, consolidation pipelines, temporal graph retrieval, eviction and
  retention policies, and dozens of memory primitives. Runs entirely
  in-process with zero external dependencies or background services. Public
  API: `createYithArchive({ dataDir })` returns a handle exposing `remember`,
  `recall`, `search`, `context`, `observe`, and a raw `sdk` dispatcher for
  advanced use.
- **Yith MCP server** — Yith Archive is now exposed to Claude Code as a
  stdio MCP server registered automatically during `install`. Seven MCP
  tools: `yith_remember`, `yith_search`, `yith_recall`, `yith_context`,
  `yith_observe`, `yith_commit_work`, and `yith_trigger` (escape hatch
  for ~90 advanced memory functions, with a curated 20-entry catalog
  embedded in the tool description). The server runs as a child process
  per session, speaks JSON-RPC over stdio, and logs to stderr so MCP
  framing on stdout stays clean.
- **Work-packet protocol** — sessions without an LLM API key can still
  run the 13 LLM-requiring memory operations (`crystallize`,
  `consolidate`, `consolidate-pipeline`, `compress`, `summarize`,
  `flow-compress`, `graph-extract`, `temporal-graph-extract`,
  `expand-query`, `skill-extract`, `reflect`, `enrich-window`,
  `enrich-session`). Each is mirrored by a `-step` state-machine variant
  that returns `WorkPacket` descriptors instead of calling the LLM
  itself. The parent Claude Code session executes those prompts with
  its own subscription auth and calls `yith_commit_work` to resume the
  paused operation. Multi-round flows (`consolidate-pipeline` runs
  semantic → reflect → procedural across 3+ rounds) are supported, as
  are batched loops (`consolidate`, `reflect`, `enrich-session` emit
  packets in `planLoopBatches`-sized chunks). Crash-safe: continuations
  survive server restart because the pending state is atomically
  persisted to the same `store.json` as everything else.
- **Memory search unification** — memories written via `yith_remember`
  now land in the hybrid search index at write-time and are surfaced by
  `yith_search` / `mem::smart-search`. Previously the BM25 index only
  indexed observations, so memories were invisible to search despite
  being in the KV. The new `putMemory` / `deleteMemory` helpers in
  `functions/search.ts` keep BM25, vector, and KV in sync across every
  memory-writer call site (consolidation, relations, evolution,
  eviction, forget, import/restore). Memories get a sentinel
  `sessionId` so hydration branches correctly; hybrid-search diversity
  caps bypass them.
- **Atomic KV persistence** — `YithKV.persist()` now writes via
  tmpfile + rename instead of a direct `writeFileSync`, eliminating the
  silent data-loss mode where a crash mid-write corrupted the store
  and the constructor then reset it to empty on reload.
- **Versioned search index meta** — on-disk index header carries
  `{schemaVersion, embeddingProvider, dimensions, generation}`. On boot,
  mismatches (provider change, dimensions bump, schema version bump)
  trigger a full rebuild; compatible headers restore in place.
- **Local nomic embedding default** — fresh installs now ship with
  `nomic-embed-text-v1.5` (768 dims, ~137 MB, lazy-downloaded on first
  embed) as the default embedding backend via the existing
  `@xenova/transformers` optional dep. Hosted providers (Gemini,
  OpenAI, Voyage) remain opt-in via the installer. Zero-credential
  installs are now fully functional for hybrid search.
- **Lazy LLM provider** — `LazyLLMProvider` defers provider
  construction until first use so boot never touches the API path,
  keeping credential-less installs clean. When the work-packet protocol
  intercept routes to a `-step` variant, the lazy provider never
  resolves and the flow runs end-to-end without an LLM call.
- **`doctor --yith-functions`** — prints the full 90-entry catalog
  grouped by category, with a ⚡ marker on the 13 LLM-requiring
  functions so callers know to expect the `needs_llm_work` envelope
  when invoking them.
- **Boot-time expiration sweep** — `WorkPacketStore.sweepExpired()`
  runs fire-and-forget on every `createYithArchive()`, pruning
  continuation tokens older than 24 hours so abandoned work-packet
  flows don't accumulate across sessions.
- **Block Summarizer** — in-session context trimming via
  delegation-as-block summarization. After Cthulhu delegates to a specialist
  via the Agent tool, the full output can be piped through
  `summarizeBlock()`, which writes the raw text to
  `.elder-gods/blocks/<timestamp>-<slug>.md` and returns a 3-5 bullet summary
  for the main thread to proceed with. Inspired by Microsoft's Memento paper,
  applied at the delegation boundary instead of the KV cache.
- **`memory-override` hook** — SessionStart hook that redirects persistent
  memory writes from Claude Code's built-in auto-memory system to Yith
  Archive. Fires only when `.elder-gods/` is present. The injected prompt
  documents the 7 MCP tools and the work-packet loop pattern.
- Cthulhu's orchestrator prompt gained two new operating principles:
  "Summarize after delegation" and "Persist insights to Yith Archive."
- `LICENSE` file added at repo root (MIT) — previously declared in
  `package.json` but never materialized as a standalone file.
- New package dependencies: `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`,
  `dotenv`. Optional: `@xenova/transformers` (for local embedding-based
  retrieval, enabled by default).

### Changed

- Expanded hook count from 6 to 8 (adding `memory-override` and the Yith
  Archive's SessionStart retrieval flow).
- `README.md` overhauled to reflect the larger scope: Yith Archive section,
  Block Summarizer section, updated hooks table, new architecture notes,
  MCP server + work-packet protocol docs.
- `mem::consolidate-pipeline`'s `-step` variant runs reflect as a nested
  sub-state-machine between semantic and procedural (matching the direct
  path's ordering), not as a skipped marker. Reflect sub-failures are
  soft-caught and recorded into `results.reflect` without blocking the
  pipeline's terminal success.
- `FakeSdk` logger now routes every `[yith]` line to stderr so MCP stdio
  framing on stdout stays intact.

### Fixed

- Memories written via `yith_remember` were invisible to `yith_search`
  (the BM25 index was only populated from observations). Every memory
  writer in the codebase now routes through `putMemory` / `deleteMemory`
  helpers that keep the index in sync — `remember`, `consolidate`,
  `consolidate-pipeline`, `flow-compress`, `relations`, `evolve`,
  `auto-forget`, `working-memory` auto-page, `diagnostics` heal,
  `evict`, `retention-evict`, `import`, `snapshot-restore`.
- Compile-time consistency check between `LLM_FUNCTION_REGISTRY` and
  `LLM_REQUIRED_FUNCTIONS` — drift now throws at MCP server boot with
  a clear error message pointing at the two files that must agree.
- `planLoopBatches` throws on zero-item input instead of silently
  returning a zero-plan that leads to empty-packet `needs_llm_work`
  responses.

### Notes

This release ships the second half of Yith Archive: the MCP server that
actually exposes it to Claude Code sessions, plus the work-packet protocol
that lets credential-less sessions still run LLM-requiring memory
operations through the parent agent's own auth. Combined with the search
unification fix, memory written via `yith_remember` is now immediately
retrievable via `yith_search` without waiting for a rebuild.

The work-packet protocol is the architectural workaround for Claude Code
not (yet) supporting MCP sampling. When MCP sampling lands upstream, Yith
can run the LLM calls itself and the `-step` variants become optional.
Until then, the state-machine pattern lets every memory function run in
zero-credential mode with the parent session as the LLM host.

## [0.1.6] — 2026-04-10

### Fixed

- Installer now writes slash commands to `~/.claude/commands/` instead of
  `~/.claude/skills/`. Earlier versions dropped flat `.md` files into the
  skills directory, which matches neither Claude Code's skill layout
  (directories with `SKILL.md`) nor the commands layout (flat `.md`) and
  caused `/cthulhu`, `/shoggoth`, etc. to silently not register.
- Installer now cleans up stray command files left in
  `~/.claude/skills/` by older versions so existing users self-heal on
  reinstall.

### Changed

- Renamed the package's `skills/` source directory to `commands/` for
  semantic clarity. Same content, new name.

## [0.1.5] — 2026-04-10

### Added

- `/cthulhu` skill now creates `.elder-gods/` at the project root on first
  invocation. This marks the project as Cthulhu-enabled so the
  `cthulhu-auto` SessionStart hook activates orchestrator mode on every
  subsequent session automatically. Intentional first activation, automatic
  follow-ups.

## [0.1.4] — 2026-04-10

### Added

- `cthulhu-auto` SessionStart hook that walks up from the current working
  directory looking for a `.elder-gods/` marker. When found, injects the
  Cthulhu orchestrator prompt into the session so every user message is
  routed through the intent gate and delegation system without the user
  having to manually run `/cthulhu`. Projects without `.elder-gods/` are
  untouched.

## [0.1.3] — 2026-04-10

### Fixed

- Resolved TypeScript compilation errors from the initial port:
  - Escaped shell `${VAR:-default}` interpolations inside TypeScript
    template literals (comment-checker, elder-loop, write-guard,
    todo-continuation, rules-injector hooks).
  - Fixed premature block comment termination caused by `*/` inside doc
    comments (`parse-jsonc.ts`, `skill-loader/index.ts`).

### Changed

- Removed all external project references and cleaned up broken
  find-and-replace artifacts left by an earlier rebranding pass.

## [0.1.2] — 2026-04-10

### Added

- CI/CD workflow (`.github/workflows/publish.yml`) that runs typecheck,
  build, and smoke on every push to main, auto-bumps the patch version,
  publishes to npm, tags the release, and creates a GitHub release. Uses
  `NPM_TOKEN` secret and the GitHub Actions bot identity to avoid
  re-triggering itself.
- README badges for npm version, npm downloads, CI status, latest release,
  and license.
- `typecheck` and `smoke` npm scripts for CI.

## [0.1.1] — 2026-04-09

### Added

- Initial public release on npm with auto-publish from CI.

## [0.1.0] — 2026-04-09

### Added

- Initial release.
- 11 Cthulhu Mythos agents: Cthulhu, Nyarlathotep, Azathoth, Shub-Niggurath,
  Yog-Sothoth, Hastur, Ithaqua, Tsathoggua, Dagon, The Deep One, Shoggoth.
- 5 lifecycle hooks: `todo-continuation`, `elder-loop`, `comment-checker`,
  `rules-injector`, `write-guard`.
- 9 slash commands: `/cthulhu`, `/shoggoth`, `/yog-sothoth`, `/elder-loop`,
  `/cancel-elder-loop`, `/old-ones-init`, `/invoke-shub`, `/session-handoff`,
  `/exorcise-ai-slop`.
- 3-level config system (defaults → user → project) with Zod validation.
- Background agent manager with circuit breaker and concurrency limits.
- Work plan system with Shub-Niggurath planning flow and Tsathoggua review.
- CLI with `install`, `doctor`, and `list-agents` commands.

[Unreleased]: https://github.com/ragingstar2063/oh-my-claudecode/compare/v0.1.6...HEAD
[0.1.6]: https://github.com/ragingstar2063/oh-my-claudecode/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/ragingstar2063/oh-my-claudecode/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/ragingstar2063/oh-my-claudecode/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/ragingstar2063/oh-my-claudecode/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/ragingstar2063/oh-my-claudecode/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/ragingstar2063/oh-my-claudecode/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ragingstar2063/oh-my-claudecode/releases/tag/v0.1.0
