# oh-my-claudecode

[![npm version](https://img.shields.io/npm/v/oh-my-claudecode.svg)](https://www.npmjs.com/package/oh-my-claudecode)
[![npm downloads](https://img.shields.io/npm/dw/oh-my-claudecode.svg)](https://www.npmjs.com/package/oh-my-claudecode)
[![publish npm](https://github.com/ragingstar2063/oh-my-claudecode/actions/workflows/publish.yml/badge.svg)](https://github.com/ragingstar2063/oh-my-claudecode/actions/workflows/publish.yml)
[![release](https://img.shields.io/github/v/release/ragingstar2063/oh-my-claudecode?display_name=tag)](https://github.com/ragingstar2063/oh-my-claudecode/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> *Ph'nglui mglw'nafh Cthulhu R'lyeh wgah'nagl fhtagn.*
>
> **The agentic operations system for [Claude Code](https://claude.ai/code).**

oh-my-claudecode (OMC) turns a raw Claude Code session into a fully-orchestrated agentic environment. Instead of typing to a single model that loses its mind between sessions, you talk to **Cthulhu** — a primary orchestrator that plans, delegates to ten specialized Elder God subagents, remembers what it learned last time via a persistent archive, and trims its own context between delegations so long sessions stay sharp. It is opinionated, integrated, and end-to-end: one install, one command, every piece wired into every other piece.

---

## Why this exists

A bare Claude Code session has three structural problems. OMC exists to fix all three at once.

1. **No orchestration.** One generalist model tries to do everything. It half-plans, half-searches, half-implements, and burns context on tasks that should be routed to specialists.
2. **No memory across sessions.** Every new session starts cold. You re-explain architecture, re-point to files, re-describe conventions. Built-in mechanisms exist but cap out at ~200 lines of static text.
3. **Context rot within a session.** Long sessions accumulate raw tool output and subagent results until the main thread is half "past grep dumps" and reasoning quality degrades. Compaction mostly happens at the limit — by then it's too late.

OMC's three pillars address each problem directly.

## The three pillars

```
 ┌───────────────────────────────────────────────────────────────┐
 │                     oh-my-claudecode                          │
 │                                                               │
 │  ┌────────────────┐  ┌─────────────────┐  ┌───────────────┐   │
 │  │  ORCHESTRATION │  │      MEMORY     │  │    CONTEXT    │   │
 │  │                │  │                 │  │  DISCIPLINE   │   │
 │  │   Cthulhu +    │  │  Yith Archive   │  │     Block     │   │
 │  │  10 Elder God  │  │   cross-session │  │   Summarizer  │   │
 │  │   specialists  │  │   persistent    │  │   in-session  │   │
 │  │  intent gate   │  │   retrieval     │  │   trimming    │   │
 │  │  delegation    │  │                 │  │               │   │
 │  └────────────────┘  └─────────────────┘  └───────────────┘   │
 │                                                               │
 │  Lifecycle hooks · Work plans · Slash commands · Config       │
 └───────────────────────────────────────────────────────────────┘
```

- **Orchestration.** Cthulhu sits at the top of every session. Every user message passes through an intent gate that classifies the request (trivial / exploratory / implementation / ambiguous) and routes it. Trivial requests run inline. Exploratory work fans out to parallel Shoggoth searches. Implementation tasks get planned as todos first and then delegated to the right specialist. Ten Elder God subagents each own a specific domain — search, architecture advisory, planning, quality review, documentation, autonomous execution, vision analysis, and more.

- **Memory.** Yith Archive is a persistent, file-backed, retrieval-based memory subsystem that runs entirely in-process. New sessions start with relevant memories auto-injected from past sessions. Notable events get captured during the session and consolidated into durable lessons. No background service, no network I/O, no subprocess management — just an on-disk archive with hybrid keyword + vector retrieval.

- **Context discipline.** Block Summarizer wraps every delegation. Full subagent output goes to disk at `.elder-gods/blocks/<timestamp>.md`. The main thread only carries a 3-5 bullet summary forward. Cthulhu can re-read any block with the Read tool if a summary proves insufficient. Long sessions stay small; nothing is ever lost.

These aren't three plugins you pick and choose. They're one integrated system that only works because each piece knows about the others.

## What you get

| Capability | What it does |
|---|---|
| **11 Elder God agents** | Cthulhu orchestrator + 10 specialists (search, advisory, planning, review, docs, autonomy, vision, etc.) |
| **Yith Archive** | Persistent cross-session memory with retrieval-based injection. Dozens of memory primitives: remember, search, consolidate, evict, crystallize, reflect, temporal graph, pattern extraction, and more. Exposed to Claude Code as a stdio MCP server with 7 tools. |
| **Work-packet protocol** | LLM-requiring memory ops (consolidate, summarize, reflect, etc.) run in sessions with no API key — each function has a state-machine variant that emits prompts for the parent agent to execute with its own subscription auth. |
| **Block Summarizer** | In-session delegation summarization with on-disk block archive |
| **8 lifecycle hooks** | Auto-activation, memory redirect, todo enforcement, completion loops, code-quality checks, rule injection, write guards |
| **10 slash commands** | Direct-invoke any mode or flow from the Claude Code chat bar |
| **Intent gate** | Every user message is classified and routed before Cthulhu acts |
| **Work plan system** | Multi-step planning flow with interview → scope → plan → review before execution |
| **3-level config** | Defaults → user (`~/.claude/oh-my-claudecode.jsonc`) → project (`.claude/...`) with Zod validation and partial parsing |
| **Background agent manager** | Circuit breaker, concurrency limits, task lifecycle tracking |
| **Project activation** | `.elder-gods/` marker directory opts a project into Cthulhu mode — unrelated repos stay default Claude Code |
| **Installer + doctor** | Interactive wizard, health diagnostics, agent listing |
| **CI/CD** | GitHub Actions publishing pipeline with auto-bump, tag, release, and npm push |

## Installation

```bash
npx oh-my-claudecode install
```

The installer asks a few questions and then:

1. Drops hook scripts into `~/.claude/hooks/`
2. Registers them in `~/.claude/settings.json`
3. Copies slash command definitions to `~/.claude/commands/`
4. Creates `~/.claude/oh-my-claudecode.jsonc` with sensible defaults
5. Leaves your existing Claude Code config intact (backup is made)

Non-interactive install (for CI or scripts):

```bash
npx oh-my-claudecode install --no-tui
```

### Requirements

- Claude Code CLI installed (`npm install -g @anthropic-ai/claude-code` or equivalent)
- Node.js 20 or newer
- `~/.claude/` directory writable
- (Optional for Yith Archive summarization/consolidation) `ANTHROPIC_API_KEY` in `~/.oh-my-claudecode/yith/.env` or as an environment variable
- (Optional for semantic memory retrieval) `@xenova/transformers` — install with `npm install @xenova/transformers` if you want embedding-backed search instead of BM25-only

## Quick tour — what a session looks like

Open Claude Code in any project with `.elder-gods/` at its root. The `cthulhu-auto` hook fires on session start and injects Cthulhu's orchestrator prompt. The `memory-override` hook tells the session to use Yith Archive instead of the built-in memory. Yith Archive's session-start step retrieves and injects the most relevant memories from past work on this project.

You type: *"add rate limiting to the auth routes."*

1. **Intent gate**: Cthulhu verbalizes what you want and classifies it as *implementation*.
2. **Plan**: Cthulhu writes todos before touching anything.
3. **Parallel exploration**: Shoggoth fans out in parallel to find existing middleware, the router setup, and any similar rate-limiting patterns already in the codebase. Each result is summarized by the Block Summarizer — the raw output goes to `.elder-gods/blocks/`, only bullets come back to the main thread.
4. **Memory lookup**: Cthulhu asks Yith Archive for anything it knows about this project's middleware conventions. The archive returns (for example) *"the auth middleware uses jose; the team chose jose over jsonwebtoken due to Edge compat"* from last week's session.
5. **Execution**: Cthulhu or a delegated specialist implements the change following the retrieved conventions.
6. **Verification**: before declaring done, tests are run, diagnostics checked, evidence shown.
7. **Persistence**: anything new and worth remembering is committed to Yith Archive for future sessions.

On your next session in the same project, steps 4 and the initial memory injection give you a head start. On a completely unrelated project (no `.elder-gods/`), Claude Code behaves normally — OMC only activates where you've opted in.

## Agent Roster

| Elder God | Model | Mode | Role |
|-----------|-------|------|------|
| **Cthulhu** | Opus | primary | Main orchestrator — intent gate, delegation, parallel execution, verification |
| **Nyarlathotep** | Opus | subagent | Deep autonomous worker — end-to-end goal execution |
| **Azathoth** | Opus | primary | First-message planner — initial context sweep and routing |
| **Shub-Niggurath** | Opus | primary | Strategic planner — interview → scope → plan → Tsathoggua review |
| **Yog-Sothoth** | Opus | subagent | Architecture/debug advisor — read-only, high-reasoning consultation |
| **Hastur** | Sonnet | subagent | Lightweight sub-orchestrator for bounded tasks |
| **Ithaqua** | Sonnet | subagent | Pre-planning consultant — intent classification, anti-slop guardrails |
| **Tsathoggua** | Sonnet | subagent | Work plan reviewer — blocker-finder, not perfectionist |
| **Dagon** | Sonnet | subagent | External documentation and GitHub source research |
| **The Deep One** | Sonnet | subagent | Vision agent — images, screenshots, diagrams |
| **Shoggoth** | Haiku | subagent | Fast parallel codebase search |

## Yith Archive — persistent cross-session memory

Named for the Great Race of Yith from *The Shadow Out of Time* — mind-transferring archivists who maintain records across time — Yith Archive is OMC's canonical persistent memory subsystem. It is a novel, in-process combined implementation inspired by the broader ecosystem of agent-memory research, rewritten from scratch to fit a single-process Claude Code plugin instead of a multi-client service.

### What it gives you

- **Hybrid retrieval** — BM25 keyword search combined with semantic embedding search (local nomic model by default, 768 dims, lazy-downloaded on first use) and a graph retrieval weight. Memories AND observations both land in the same index at write-time, so `yith_search` returns freshly-written memories immediately.
- **Exposed as an MCP server** — during `install`, Yith Archive is registered with Claude Code as a stdio MCP server named `yith-archive`. Sessions get 7 tools: `yith_remember`, `yith_search`, `yith_recall`, `yith_context`, `yith_observe`, `yith_commit_work`, and `yith_trigger` (escape hatch for ~90 advanced memory functions, with a curated top-20 catalog embedded in the tool description).
- **Rich memory primitives** — `remember`, `search`, `recall`, `context`, `observe`, plus dozens more under the hood: consolidation pipelines, temporal graph retrieval, lesson crystallization, pattern extraction, eviction and retention policies, file-scoped memory index, sliding window compression, query expansion, working memory, session timeline, export/import.
- **Automatic capture** — notable events during a session can be observed into the archive; a background consolidation pass merges similar memories into distilled lessons.
- **Zero external runtime** — file-backed JSON storage at `~/.oh-my-claudecode/yith/necronomicon.json` (legacy installs are auto-migrated from `store.json` on boot). Atomic writes via tmpfile + rename so a crash mid-write can't corrupt the tome. No database, no background server, no subprocess, no network, no ports to manage. The MCP server itself is registered user-level in `~/.claude.json`.
- **Crash-safe work-packet flows** — pending continuations for LLM-requiring operations persist to the same store and survive server restarts; resuming with the same continuation token picks up where the flow left off.
- **Replaces Claude Code's built-in auto-memory** via the `memory-override` SessionStart hook, which tells the session not to write to the built-in memory files. Disable the override with `disabled_hooks: ["memory-override"]` if you prefer to keep the built-in system active.

### The binding ritual (`oh-my-claudecode bind`)

Fresh installs start with an empty `necronomicon.json`. To populate it
with history, run one command in your terminal:

```bash
oh-my-claudecode bind
```

This kicks off a six-phase ritual with a real ANSI TUI (progress bars,
section headers, per-phase status):

1. **Embedding sigil** — downloads the local nomic embedding model
   (~137 MB) with a live byte-counter progress bar.
2. **Claude Code transcripts** — scans every subdirectory under
   `~/.claude/projects/` (every project you've ever opened a session
   in), parses the `.jsonl` transcripts, and writes one raw
   observation per user prompt / assistant text / tool call.
3. **Opencode grimoire** — if you're migrating from oh-my-opencode, the
   ritual auto-detects `~/.local/share/opencode/opencode.db` and
   imports every project / session / message / part it finds.
4. **Sisyphus migration** — walks your home looking for legacy
   `.sisyphus/` directories (the oh-my-opencode equivalent of
   `.elder-gods/`) and copies plans, handoffs, and evidence into the
   new layout without touching the source.
5. **Project code scan** — for each project the CLI has seen, walks
   the code tree (gitignore-aware) and seeds preliminary memories:
   language stats, package metadata, README sections, directory tree.
6. **Sealing** — reports how many raw observations are queued for
   compression and points you at the next step.

The ritual is **resumable**: if any phase errors or you interrupt it,
re-running `oh-my-claudecode bind` picks up from the failed phase via
the `KV.bindState` cursor — no manual intervention required.

Phase 2 (LLM-dependent compression of raw observations into
searchable memories) runs **inside a Claude Code session** via the
work-packet loop. Either:

- Open Claude Code and run `/necronomicon-bind` — uses your
  subscription auth via the MCP work-packet protocol.
- Or install a cron entry that spawns `claude -p` on an interval:
  ```bash
  oh-my-claudecode bind --install-cron --interval 1h
  ```
  The cron tick drives compression unattended. No API key needed.

### Work-packet protocol — LLM ops without an API key

13 of Yith's memory operations need an LLM to do their work (`crystallize`, `consolidate`, `consolidate-pipeline`, `compress`, `summarize`, `flow-compress`, `graph-extract`, `temporal-graph-extract`, `expand-query`, `skill-extract`, `reflect`, `enrich-window`, `enrich-session`). If Yith has its own `ANTHROPIC_API_KEY` in `~/.oh-my-claudecode/yith/.env`, these run directly in-process.

If no API key is configured, the session doesn't lose access to these functions — they just route through the **work-packet protocol** instead. Each LLM-requiring function has a `-step` state-machine variant that emits `WorkPacket` descriptors (systemPrompt + userPrompt + metadata) instead of calling the LLM itself. The flow looks like this:

```
yith_trigger("mem::consolidate-pipeline", {...})
   ↓
{status: "needs_llm_work", workPackets: [...], continuation: "wp_..."}
   ↓
Claude Code session executes each packet's prompts with its own subscription auth
   ↓
yith_commit_work(continuation, [{id, completion}, ...])
   ↓
{status: "needs_llm_work", ...} (another round) OR {status: "success", result}
```

Multi-call functions like `consolidate-pipeline` chain multiple rounds (semantic → reflect → procedural). Loop functions like `consolidate` / `reflect` / `enrich-session` emit packets in adaptive batches via `planLoopBatches` — small loops go "all-at-once" in one round, large loops batch in chunks sized by packet count or total prompt bytes. `doctor --yith-functions` marks LLM-requiring functions with a ⚡ so callers know to expect the `needs_llm_work` envelope.

### Programmatic API

```ts
import { createYithArchive } from "oh-my-claudecode"

const archive = createYithArchive()  // defaults to ~/.oh-my-claudecode/yith

await archive.remember({
  content: "The auth middleware uses jose — jsonwebtoken was removed due to Edge incompatibility.",
  type: "architecture",
  concepts: ["auth", "middleware", "jose"],
  files: ["src/middleware/auth.ts"],
})

const results = await archive.search({ query: "how does auth work", limit: 5 })

// When you're done
await archive.shutdown()
```

### Environment configuration

Yith Archive reads its own variables from `~/.oh-my-claudecode/yith/.env` (or the ambient environment):

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | LLM calls for summarization, consolidation, reflection |
| `EMBEDDING_PROVIDER` | `xenova` for local embeddings, unset for BM25-only |
| `AUTO_FORGET_ENABLED` | `false` to disable background eviction sweeps |
| `CONSOLIDATION_ENABLED` | `false` to disable automatic memory consolidation |
| `YITH_GRAPH_WEIGHT` | Weight of graph retrieval in hybrid search (default `0.3`) |
| `YITH_DEBUG` | Any value enables verbose logging |

## Block Summarizer — in-session context discipline

Long Claude Code sessions die a slow death: every delegation to a subagent pipes the full raw output back into the main context. After an hour of real work, half of what's in front of the model is yesterday's grep dumps, and reasoning quality suffers accordingly.

Block Summarizer is OMC's solution: at every delegation boundary, the full output is written to disk and the main thread continues from a 3-5 bullet summary. The raw block is never lost — it's sitting at `.elder-gods/blocks/<timestamp>-<slug>.md` and can be re-read with the Read tool if Cthulhu needs it.

The technique is a novel combined implementation inspired by the broader ecosystem of context-compression research, adapted specifically to the delegation boundary (which is the only "block boundary" a harness can cleanly observe from outside the model).

### How Cthulhu uses it

Cthulhu's orchestrator prompt has two relevant principles baked in:

6. **Summarize after delegation** — after every `Agent(subagent_type=...)` call, write the full output to `.elder-gods/blocks/<timestamp>-<slug>.md` and continue reasoning from a 3-5 bullet summary.
7. **Persist insights to Yith Archive** — salient facts from delegation blocks become durable memories.

You don't have to do anything to enable this — it's automatic when Cthulhu is active. Blocks accumulate as a replayable audit trail of every delegation the session performed. Commit them, grep them, diff them, or nuke the `.elder-gods/blocks/` directory between runs.

### Programmatic API

```ts
import { summarizeBlock } from "oh-my-claudecode"

const { summary, blockPath, blockId } = await summarizeBlock({
  agentName: "shoggoth",
  fullOutput: rawSubagentOutput,
  taskDescription: "Find all usages of the legacy auth helper",
})
```

## Slash Commands

After installation these are available in Claude Code sessions:

| Command | Description |
|---------|-------------|
| `/cthulhu` | Activate Cthulhu orchestrator mode (also creates `.elder-gods/` on first use) |
| `/necronomicon-bind` | Necronomicon binding ritual — shells out to `oh-my-claudecode bind` (real TUI, all-projects ingestion, opencode import, sisyphus migration, preliminary code scan) then drains pending compression via the work-packet loop using this session's LLM |
| `/shoggoth` | Fast parallel codebase search |
| `/yog-sothoth` | Consult the architecture/debug advisor |
| `/elder-loop` | Start the self-referential completion loop |
| `/cancel-elder-loop` | Stop the active completion loop |
| `/old-ones-init` | Generate the hierarchical AGENTS.md knowledge base |
| `/invoke-shub` | Strategic planning interview flow |
| `/session-handoff` | Create a detailed session continuation document |
| `/exorcise-ai-slop` | Purge AI-generated code smells from the current codebase |

## Lifecycle Hooks

8 hooks are installed into Claude Code's `settings.json`. They provide the connective tissue between OMC's subsystems and the live session.

| Hook | Event | Description |
|------|-------|-------------|
| `cthulhu-auto` | SessionStart | Auto-activate Cthulhu orchestrator mode when `.elder-gods/` is present in the project |
| `memory-override` | SessionStart | Redirect persistent memory writes from Claude Code's built-in auto-memory to Yith Archive |
| `todo-continuation` | Stop | Inject a reminder to continue if incomplete todos exist when stopping |
| `elder-loop` | Stop | Self-referential completion loop — keeps running until the promise is met |
| `comment-checker` | PostToolUse | Warn when AI-slop comments are introduced (comments that explain obvious code) |
| `rules-injector` | PreToolUse | Auto-inject `.elder-gods/rules/*.md` into every agent's context |
| `write-guard` | PreToolUse | Warn when `Write` is used on an existing file (suggest `Edit` instead) |

Disable specific hooks via config:

```jsonc
{ "disabled_hooks": ["comment-checker", "write-guard"] }
```

### Activation via `.elder-gods/`

By default, Cthulhu only takes over when you explicitly type `/cthulhu`. To auto-activate on every new session in a project, create the marker directory at the project root:

```bash
mkdir .elder-gods
```

The `cthulhu-auto` hook walks upward from the current directory looking for `.elder-gods/`. If it finds one, Cthulhu's orchestrator prompt is injected at SessionStart; if not, nothing happens — unrelated projects keep their normal Claude Code behavior. You can also drop architectural rules into `.elder-gods/rules/*.md` and work plans into `.elder-gods/plans/*.md` — the other hooks will pick them up automatically.

Turn auto-activation off globally with:

```jsonc
{ "disabled_hooks": ["cthulhu-auto"] }
```

## Configuration

Config file: `~/.claude/oh-my-claudecode.jsonc` (user-level) and/or `.claude/oh-my-claudecode.jsonc` (project-level). Project config overrides user config for scalar and object fields. Array fields like `disabled_*` are unioned across levels.

```jsonc
{
  // Override models for specific agents
  "agents": {
    "cthulhu": {
      "model": "opus",
      "prompt_append": "Always write tests for every function you create."
    },
    "shoggoth": {
      "model": "haiku"
    }
  },

  // Disable agents you don't need
  "disabled_agents": ["nyarlathotep", "the-deep-one"],

  // Disable specific lifecycle hooks
  "disabled_hooks": ["comment-checker", "write-guard"],

  // Elder Loop settings (completion loop)
  "elder_loop": {
    "max_iterations": 15,
    "strategy": "continue"  // or "reset"
  },

  // Background agent limits
  "background_task": {
    "max_concurrent": 8,
    "circuit_breaker_threshold": 3
  }
}
```

### Available models

Only Claude models are supported:

| Short Alias | Full Model ID |
|-------------|--------------|
| `opus` | `claude-opus-4-6` |
| `sonnet` | `claude-sonnet-4-6` |
| `haiku` | `claude-haiku-4-5` |

## Project-Level Setup

### Architectural rules

Place rules in `.elder-gods/rules/*.md`. They are auto-injected into every agent's context by the `rules-injector` hook, so every specialist sees them without you repeating yourself:

```
.elder-gods/
└── rules/
    ├── no-any.md          # No TypeScript `any`
    ├── test-coverage.md   # Minimum test requirements
    └── naming-conv.md     # Naming conventions
```

Example `.elder-gods/rules/no-any.md`:

```markdown
# No TypeScript `any`

NEVER use `any` type. Use `unknown` and narrow appropriately, or define a proper type.
This rule is non-negotiable. Tsathoggua will reject any plan that introduces `any`.
```

### Work plans

Plans are stored in `.elder-gods/plans/*.md` and reviewed by Tsathoggua before execution.

Use `/invoke-shub` to start the planning flow:

1. Shub-Niggurath surveys the codebase
2. Interviews you with scoping questions
3. Creates a plan at `.elder-gods/plans/<task>.md`
4. Tsathoggua reviews it for executability — OKAY or REJECT with at most 3 blocking issues
5. Cthulhu orchestrates the implementation

### Knowledge base

Use `/old-ones-init` to generate `AGENTS.md` files at the root and in key subdirectories. These give every agent project context at a glance, without repeated exploration and without consuming tool-budget on re-discovery.

## Diagnostics

```bash
npx oh-my-claudecode doctor
```

Checks:

- `~/.claude/` directory exists
- `settings.json` present
- All hook scripts installed
- Hooks registered in settings
- Slash commands installed
- Plugin config valid

## Project Structure

```
oh-my-claudecode/
├── src/
│   ├── agents/               # 11 Elder God agent definitions + builder
│   ├── config/               # Zod schema — full type system
│   ├── hooks/                # Lifecycle hook scripts and configs
│   ├── features/
│   │   ├── yith-archive/     # Persistent cross-session memory (~14k LOC)
│   │   │   ├── functions/    #   40+ memory primitives
│   │   │   ├── state/        #   KV store, vector index, hybrid search, reranker
│   │   │   ├── providers/    #   Anthropic / OpenRouter / Gemini / Minimax providers
│   │   │   ├── prompts/      #   Summarization, consolidation, reflection templates
│   │   │   ├── triggers/     #   Event triggers for session lifecycle
│   │   │   ├── eval/         #   Quality/validation helpers
│   │   │   └── index.ts      #   createYithArchive() factory — public API
│   │   ├── block-summarizer/ # In-session context trimming
│   │   ├── background-agent/ # BackgroundManager (circuit breaker, concurrency)
│   │   ├── skill-loader/     # Discovers user skills from .claude/skills/
│   │   └── mcp-manager/      # Skill-scoped MCP lifecycle
│   ├── plugin-handlers/      # 5-phase config pipeline
│   ├── shared/               # Logging, deep-merge, model resolution
│   └── cli/                  # Installer, doctor, list-agents
├── commands/                 # Markdown slash commands (installed to ~/.claude/commands/)
├── CHANGELOG.md              # Release history
├── LICENSE                   # MIT
└── NECRONOMICON.md           # Plugin architecture reference
```

## Agent detail

### Cthulhu (main orchestrator)

The heart of the system. Every user message passes through Cthulhu's intent gate:

1. **Verbalize intent** — explicitly classify what the user wants before acting
2. **Route accordingly** — trivial → direct tools; exploratory → parallel Shoggoth agents; implementation → plan + delegate; ambiguous → one question
3. **Plan before acting** — if 2+ steps, create detailed todos immediately
4. **Delegate aggressively** — never work alone when a specialist is available
5. **Verify before completing** — diagnostics, tests, evidence required
6. **Summarize after delegation** — full block to disk, main thread continues from bullets
7. **Persist insights to Yith Archive** — salient facts become cross-session memory

### Shoggoth (codebase search)

Fire 3+ in parallel. They're formless and free. Use for finding where X is implemented, discovering patterns to follow, cross-module structure discovery.

### Yog-Sothoth (architecture advisor)

Consult when an architecture decision requires multi-system tradeoffs, after 2+ failed fix attempts, or when completing a significant implementation and you want a self-review pass. Responses always include: bottom line (2-3 sentences), action plan (≤7 steps), effort estimate.

### Shub-Niggurath + Tsathoggua (planning flow)

Shub-Niggurath interviews → creates `.elder-gods/plans/<task>.md` → Tsathoggua reviews it → OKAY or REJECT with max 3 blocking issues → Cthulhu executes.

### The Elder Loop

Activate with `/elder-loop [completion promise]`. The loop writes state to `.claude/elder-loop-state.json`. On each Stop event, the hook checks whether the promise is met — if not, it injects a reminder to continue. Deactivate with `/cancel-elder-loop`.

## Development

```bash
git clone https://github.com/ragingstar2063/oh-my-claudecode
cd oh-my-claudecode
npm install
npm run build
npm run typecheck
```

Releases are published automatically via GitHub Actions on every push to `main` — the workflow bumps the patch version, publishes to npm, tags the commit, and creates a GitHub release.

## Philosophy

- **Delegate first** — specialists exist for a reason; use them
- **Parallel by default** — independent work always runs simultaneously
- **Evidence required** — no task is complete without diagnostics or test proof
- **Plan before touching files** — todos before edits, every time
- **Trim on delegation boundaries** — every delegation is a block; the block lives on disk, the main thread lives in summaries
- **Persist what matters** — across sessions, knowledge compounds; don't re-explain
- **No AI slop** — no unnecessary abstractions, no useless comments, no scope creep
- **Blocker-finding, not perfectionism** — reviews find actual blockers, not nitpicks

## Attribution

Yith Archive and Block Summarizer are novel combined implementations inspired by the broader ecosystem of agent-memory and context-compression research. They were rewritten from scratch to fit a single-process Claude Code plugin and are released here under MIT as part of oh-my-claudecode.

## License

MIT — see [LICENSE](LICENSE).
