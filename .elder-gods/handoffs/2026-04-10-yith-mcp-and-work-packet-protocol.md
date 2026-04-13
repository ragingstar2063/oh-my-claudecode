# Session Handoff — 2026-04-10: Yith MCP wiring + Work-Packet Protocol (3b-1 through 3b-5)

## TL;DR

Started this session with the user asking "is the memory system working?" —
discovered Yith was completely non-functional (no data dir, no MCP server
registration, no persistence). Diagnosed the architectural gap (Yith is an
in-process library but the hook was telling the model to use a "helper" that
didn't exist as a callable tool), designed a plan, got alignment, and shipped:

1. **A working Yith MCP server** with 7 tools, atomic persistence, versioned
   index meta, installer integration, doctor integration, and real cross-session
   memory persistence. Original bug fully fixed.

2. **Step 3b-1 through 3b-5 of the work-packet protocol** — the architecture
   that lets LLM-requiring Yith functions run in sessions with no API keys by
   returning work-packet descriptors that the parent Claude session executes
   using its own subscription auth. Pilot (crystallize) verified end-to-end
   across 4 process boundaries, zero LLM calls, state-machine recovery works.

Next session picks up at 3b-6 (audit remaining 12 functions) through 3b-12
(final e2e verification). The rollout is mechanical from here — follow the
crystallize pattern for each function.

## Critical context before resuming

### The original bug

`~/.oh-my-claudecode/yith/` did not exist. Every session's `[yith]` memory
writes had gone to the void since the plugin was installed. The root cause
was a mismatch between what the `memory-override.sh` hook prompt *said*
("use the YithArchive helper exposed by the plugin") and what was actually
reachable from a Claude Code session (nothing — there was no MCP server,
no tool, no process, no daemon). This is now fixed.

### The architectural decisions baked into the code

1. **Claude Code does NOT support MCP sampling** as of v2.1.98 (issue
   [#1785](https://github.com/anthropics/claude-code/issues/1785)). This was
   verified via the claude-code-guide agent at the start of 3b. Because of
   this, Yith can't ask Claude Code to run LLM calls on its behalf through
   the protocol. The work-packet protocol is the workaround.

2. **Work-packet protocol uses split-function state machines.** Every
   LLM-requiring function is mirrored by a `-step` variant that's a state
   machine: state 0 does pre-LLM work and returns a `WorkPacket` describing
   the prompt; state N consumes the completion from state N-1 and either
   emits the next packet or returns terminal. The parent agent loops
   `yith_trigger → execute prompt → yith_commit_work` until terminal.

3. **LLM provider is lazy-constructed** (`LazyLLMProvider` in
   `providers/index.ts`) — boot never touches it, so zero-credentials
   installs work cleanly. It only throws when actually invoked, and
   the work-packet intercept catches that path by routing to `-step`
   variants before the lazy provider is asked to resolve.

4. **Embedding defaults to local nomic** (137 MB, 768 dims, lazy-loaded on
   first embed), NOT any hosted API. The installer offers Gemini/OpenAI/Voyage
   as opt-ins. The existing `@xenova/transformers` optional dep handles
   the model loading.

5. **Atomic writes via tmpfile + rename** in `YithKV.persist()`. Previously
   it was a direct `writeFileSync` that corrupted the store on crash
   (causing the silent data-loss mode where the constructor would catch
   JSON parse failures and reset to empty). Now crash-safe.

6. **Versioned index meta** in a new `mem:index:meta` KV scope — stores
   `{schemaVersion, embeddingProvider, dimensions, entries, generation, lastFlushedAt}`.
   On boot, mismatches (provider change, dim change, schema bump) trigger
   vector index rebuild. Tested by tampering the meta header and
   verifying the rebuild log line.

7. **Logger writes to stderr, not stdout.** Critical: MCP stdio uses stdout
   for JSON-RPC framing. Any `console.log` would corrupt the protocol. Every
   `[yith]` log line goes to stderr, and the MCP server has a defensive
   `console.log → stderr` override at the top of `yith-server.ts`.

8. **Memories-vs-observations search mismatch is a PRE-EXISTING issue** in
   the Yith port, NOT something introduced by this work. `yith_search` uses
   `mem::smart-search` which builds its BM25 index over observations (not
   memories), so memories written via `yith_remember` don't show up in
   `yith_search` results. Tracked in the 3b plan's "NOT in this plan" section
   as the next-next task after 3b finishes. Do not "fix" this as part of 3b.

### The 7-tool MCP surface

- `yith_remember` — save a durable memory
- `yith_search` — hybrid search (observations only, see #8 above)
- `yith_recall` — alias of search
- `yith_context` — assemble project memory bundle
- `yith_observe` — log raw observation
- `yith_commit_work` — deliver LLM completions to resume a paused work-packet flow
- `yith_trigger` — escape hatch for the ~91 advanced functions, description carries a curated 20-entry catalog

All reachable via MCP stdio through `~/.claude/settings.json → mcpServers.yith-archive`.

## Accomplished this session

### Plan docs (in `.elder-gods/plans/`)

- `yith-mcp-wiring.md` — the plan that became steps 1-10
- `yith-work-packet-protocol.md` — the 3b plan, with state-machine design,
  rejected alternatives (generators, recompute-with-cache), loop batching
  strategy, and 12 subtasks. **Has not been updated yet to reflect the
  state-machine design clarification that happened after the plan was
  written** — see "Plan doc drift" below.

### Files created

- `bin/yith-mcp.js` — stdio bin shim
- `src/mcp/yith-server.ts` — stdio MCP server with SIGINT/SIGTERM/stdin-end handlers and defensive console guard
- `src/mcp/yith-tools.ts` — tool definitions for all 7 tools plus `LLM_FUNCTION_REGISTRY` and `handleStepResult` helper
- `src/mcp/yith-catalog.ts` — `CORE_CATALOG` (20 entries, embedded in `yith_trigger` description), `FULL_CATALOG` (91 entries, consumed by `doctor --yith-functions`), `buildTriggerDescription()`, `groupFullCatalog()`
- `src/features/yith-archive/state/work-packets.ts` — `WorkPacket`, `StepInput`, `StepResult`, `PendingWork`, `NeedsWorkResponse`, `SuccessResponse`, `WorkPacketStore`, `planLoopBatches`, `createWorkPacket`, constants (`WORK_PACKET_TTL_MS`, `DEFAULT_BATCH_MAX=10`, `DEFAULT_SIZE_MAX_BYTES=50KB`)
- `.elder-gods/plans/yith-mcp-wiring.md` — plan for steps 1-10
- `.elder-gods/plans/yith-work-packet-protocol.md` — plan for step 3b

### Files modified

- `package.json` — added `@modelcontextprotocol/sdk@^1.29.0` dep and `yith-mcp` bin entry
- `src/features/yith-archive/index.ts` — lazy LLM provider wiring, `hasLLMProvider` field, `workPacketStore` field, `registerCrystallizeStepFunction` call
- `src/features/yith-archive/config.ts` — `detectEmbeddingProvider` default changed from `null` to `"local"`
- `src/features/yith-archive/providers/index.ts` — new `LazyLLMProvider` class + `hasLLMCredentials` helper
- `src/features/yith-archive/providers/embedding/local.ts` — upgraded from `all-MiniLM-L6-v2` (384 dims) to `nomic-embed-text-v1.5` (768 dims) with nomic task prefix scheme (`search_query:` / `search_document:`) and env overrides `LOCAL_EMBEDDING_MODEL` / `LOCAL_EMBEDDING_DIMS`
- `src/features/yith-archive/state/kv.ts` — **atomic persist** (tmpfile + rename + cleanup), parse-failure warning instead of silent reset
- `src/features/yith-archive/state/index-persistence.ts` — versioned meta header, mismatch-detect rebuild on boot, generation counter, compatibility check
- `src/features/yith-archive/state/logger.ts` — all methods route to stderr
- `src/features/yith-archive/state/schema.ts` — added `indexMeta` and `workPackets` to `KV` constants
- `src/features/yith-archive/functions/crystallize.ts` — added `CrystallizeArgs` and `CrystallizeStepState` interfaces, new `registerCrystallizeStepFunction` exporting the `mem::crystallize-step` 2-state machine
- `src/cli/install.ts` — added `ensureYithDataDir`, `detectExistingEmbeddingKey`, `promptEmbeddingProvider`, `writeYithEnvKey` (mode 0600), `registerYithMcpServer` (absolute-path fallback); wired into `runInstall` with interactive prompt and post-install note
- `src/cli/doctor.ts` — added Yith data dir check, MCP server registration check, `createYithArchive` boot health check, `.env` permissions check, `printYithFunctionCatalog` exported
- `src/cli/index.ts` — added `--yith-functions` flag to doctor subcommand
- `src/hooks/memory-override.ts` — rewrote the injected prompt to reference the real 6 MCP tools (pre-3b state), needs one more update for 3b-11 to mention work-packet flow

### End-to-end verification landed

- **Step 10** (post-MCP): install to fixture HOME, write memory in session A, verify disk persistence, start session B, use `yith_trigger mem::diagnose`, verify memory still present after both sessions closed. Passed.
- **Step 3b-5** (post-work-packet): **4 process boundaries**, created action → marked done → triggered crystallize in WP mode → committed fake completion → verified crystal in KV with zero LLM calls. Passed.

## Current state

### Working

- Full cross-session memory persistence via MCP
- All 7 tools callable from Claude Code sessions
- Work-packet protocol functional on `mem::crystallize` end-to-end
- Installer produces working fixture with one `install` command
- Doctor reports health for all checks
- Atomic persistence with versioned meta and crash-safe writes

### Partially done

- Work-packet protocol is only wired for `mem::crystallize`. The
  `LLM_FUNCTION_REGISTRY` in `src/mcp/yith-tools.ts` has exactly one entry:
  ```ts
  const LLM_FUNCTION_REGISTRY: Readonly<Record<string, string>> = {
    "mem::crystallize": "mem::crystallize-step",
  }
  ```
  Every other LLM-requiring function still throws the lazy-provider error
  when invoked. Rollout is 3b-8 and 3b-9.
- `memory-override.sh` still describes the 6-tool surface from step 3a,
  not the 7-tool (with `yith_commit_work` and work-packet loop) surface.
  3b-11 updates it.
- `yith-catalog.ts` does not mark which functions need LLM/work-packet vs
  direct. 3b-11 adds that flag.

### Explicitly left for later

- **Multi-LLM-call functions** (`mem::consolidate-pipeline`, maybe others
  after audit) haven't been split yet. User was explicit that we CANNOT
  defer these to API-key-only — they must work in work-packet mode too.
  3b-7 is the pilot for this (3-state machine).
- **Loop functions** (`mem::enrich-window`, `mem::enrich-session`, possibly
  `mem::consolidate` if it loops) need `planLoopBatches` wiring. 3b-9.
- **Memories-vs-observations search unification** — next-next task after
  3b. Tracked in the plan doc.
- **Session history backfill** — the original motivation from the very
  first conversation. Unblocked once work-packets work. Gets its own
  plan doc after 3b.

## Pending work (next session starts here)

### 3b-6: Audit remaining 12 functions **(start here)**

Read each of these files carefully and classify as `single-call`,
`multi-call-sequential`, or `loop`:

- `src/features/yith-archive/functions/compress.ts` — `mem::compress`
- `src/features/yith-archive/functions/summarize.ts` — `mem::summarize`
- `src/features/yith-archive/functions/consolidate.ts` — `mem::consolidate` (likely has a loop at line 143 per the earlier grep)
- `src/features/yith-archive/functions/consolidation-pipeline.ts` — `mem::consolidate-pipeline` (**confirmed 2 sequential calls at lines 82 and 165**)
- `src/features/yith-archive/functions/flow-compress.ts` — `mem::flow-compress`
- `src/features/yith-archive/functions/graph.ts` — `mem::graph-extract`
- `src/features/yith-archive/functions/query-expansion.ts` — `mem::expand-query`
- `src/features/yith-archive/functions/reflect.ts` — `mem::reflect`
- `src/features/yith-archive/functions/skill-extract.ts` — `mem::skill-extract`
- `src/features/yith-archive/functions/sliding-window.ts` — `mem::enrich-window`, `mem::enrich-session` (**likely loops**)
- `src/features/yith-archive/functions/temporal-graph.ts` — `mem::temporal-graph-extract`
- `src/features/yith-archive/functions/enrich.ts` — **does NOT take a provider param, grep showed no `provider.compress|summarize` calls, so this may be a no-op for 3b purposes. Confirm.**

Output should be a classification table that drives which functions go in
which subsequent step (3b-7 for multi-call, 3b-8 for single-call, 3b-9 for
loops).

### 3b-7: Pilot `mem::consolidate-pipeline-step` as 3-state machine

Prove the multi-round commit path works. The function has 2 sequential LLM
calls, so the state machine is 3-state:
- State 0: pre-LLM work, emit first packet
- State 1: consume first completion, use it to build second prompt (dependent!), emit second packet
- State 2: consume second completion, write final result, terminal

This is important because it exercises the `currentStep` increment on the
`yith_commit_work` code path — which is already implemented in
`handleStepResult` but hasn't been tested against a real multi-step function
yet. The commit-returns-another-needs_llm_work round-trip is the thing to
verify.

After this works end-to-end, the code paths are all exercised and rolling
out the remaining single-call functions is pure mechanical copy-paste of
the crystallize pattern.

### 3b-8: Roll out single-call state machines

For each single-call function from the 3b-6 audit:
1. Add `CamelCaseArgs` and `CamelCaseStepState` interfaces above the register
2. Add `registerXStepFunction(sdk, kv)` exporting a 2-state machine following the crystallize pattern exactly
3. Wire it in `src/features/yith-archive/index.ts` alongside the existing `registerXFunction(sdk, kv, provider)` call
4. Add the mapping to `LLM_FUNCTION_REGISTRY` in `src/mcp/yith-tools.ts`
5. Smoke test each with a 2-process round-trip before moving to the next

Expected: ~8 functions to port, ~30-50 lines of new code per function.

### 3b-9: Loop functions with adaptive batching

For sliding-window and any other loops identified in 3b-6:
1. State 0 computes `planLoopBatches(itemCount, totalPromptBytes)`
2. If `"all-at-once"`: emit all N packets, state 1 consumes all completions
3. If `"batched"`: state 0 emits first batch, subsequent states emit next
   batches with `currentStep` tracking progress through the batch array
4. Terminal state writes all the combined results

Use `YITH_WORK_BATCH_MAX` (default 10) and `YITH_WORK_SIZE_MAX` (default 50KB)
via the env override paths already wired up in `work-packets.ts`.

### 3b-10: `sweepExpired` on boot

One line in `createYithArchive()` after KV restore:
```ts
void workPacketStore.sweepExpired()
```
(Fire-and-forget; logs count if >0.) Add after `const workPacketStore = new WorkPacketStore(kv)`.

### 3b-11: Update `memory-override.sh` + mark LLM-requiring in catalog

In `src/hooks/memory-override.ts`, add a paragraph to the injected prompt
explaining the work-packet loop pattern. Something like:

> If `yith_trigger` returns `{status: "needs_llm_work"}`, run each
> workPacket's prompts through your own LLM (inline or via Task subagent)
> and call `yith_commit_work` with the continuation token. Repeat until
> the response is `{status: "success"}`.

Also mention `yith_commit_work` in the tool list (currently lists 6).

In `src/mcp/yith-catalog.ts`, add an `llmRequired: boolean` field to
`CatalogEntry` and set it true for all 13 LLM-needing functions. Update
`printYithFunctionCatalog` in `doctor.ts` to display a marker (like `⚡`)
next to LLM-requiring entries.

### 3b-12: Final e2e verification

Same fixture-HOME pattern as the step-10 test, but exercise:
1. Fresh install, no API keys
2. Write a memory
3. Trigger crystallize → 2-state flow, commit with fake, verify crystal written
4. Trigger consolidate-pipeline → 3-state flow, commit round 1 with fake,
   verify second `needs_llm_work` response, commit round 2 with fake,
   verify terminal result
5. Trigger a loop function → all-at-once batch path, verify single-round commit
6. Restart server mid-flow between rounds, verify continuation still resolves
7. Doctor reports all green

## Plan doc drift

`.elder-gods/plans/yith-work-packet-protocol.md` was written BEFORE the
user's clarification that multi-call functions cannot be deferred (the
exchange where they said "No, we can't do that, figure out a way"). The
plan doc still has language in places about "single-LLM-call functions
only in v1" and "multi-call functions defer to API-key-only". **This is
outdated.** The actual design we committed to is:

- State machine per function (arbitrary step count)
- `yith_commit_work` returns either terminal OR another `needs_llm_work` for the next round
- Loops use `planLoopBatches` for adaptive strategy
- Nothing is deferred — everything must work in work-packet mode

When you resume, either update the plan doc or just keep it as a
historical record and trust the subtasks in the task list + this handoff
as the authoritative source. I'd suggest the latter — rewriting a plan
doc mid-execution is wasted motion.

## Context for next session

### Key files to read first (in order)

1. `.elder-gods/handoffs/2026-04-10-yith-mcp-and-work-packet-protocol.md` — this file
2. `.elder-gods/plans/yith-work-packet-protocol.md` — for architecture context (with drift caveat above)
3. `src/mcp/yith-tools.ts` — the `handleStepResult` helper and `LLM_FUNCTION_REGISTRY`; this is the core of the protocol plumbing
4. `src/features/yith-archive/functions/crystallize.ts` — the template to copy for other functions (see `registerCrystallizeStepFunction`)
5. `src/features/yith-archive/state/work-packets.ts` — protocol types, to refresh on the `StepInput` / `StepResult` shapes

### The crystallize pattern

Every single-call state-machine function follows this template:

```ts
interface XArgs { /* original function args */ }
interface XStepState {
  originalArgs: XArgs
  // any data loaded in state 0 that finalize needs
  packetId: string
}

export function registerXStepFunction(sdk: FakeSdk, kv: StateKV): void {
  sdk.registerFunction(
    { id: "mem::x-step" },
    async (input: StepInput<XArgs, XStepState>): Promise<StepResult> => {
      const { step, originalArgs, intermediateState, completions } = input
      
      if (step === 0) {
        // Validate args, return terminal error if invalid
        // Load data from KV
        // Build the prompt(s)
        const packet = createWorkPacket({
          kind: "summarize" | "compress",
          systemPrompt: X_SYSTEM,
          userPrompt: builtPrompt,
          purpose: "human-readable intent",
        })
        return {
          done: false,
          nextStep: 1,
          intermediateState: { originalArgs, /*...*/, packetId: packet.id },
          workPackets: [packet],
          instructions: "...",
        }
      }
      
      if (step === 1) {
        if (!intermediateState) return { done: true, result: { success: false, error: "..." } }
        const completion = completions?.[intermediateState.packetId]
        if (!completion) return { done: true, result: { success: false, error: "..." } }
        
        // Parse completion, write to KV, trigger follow-ups
        return { done: true, result: { success: true, /*...*/ } }
      }
      
      return { done: true, result: { success: false, error: `unknown step ${step}` } }
    },
  )
}
```

Then three wiring touches:
1. Import + call in `src/features/yith-archive/index.ts`
2. Add to `LLM_FUNCTION_REGISTRY` in `src/mcp/yith-tools.ts`
3. Smoke test

### Known gotchas

- **Do NOT use `console.log` in any code path the MCP server touches.** The
  defensive override at the top of `yith-server.ts` catches it for the
  server itself, but if you add a new provider or function that logs,
  route it through the `logger` module (which goes to stderr).
- **`yith_search` returning 0 results is expected** for memories written via
  `yith_remember` — see gotcha #8 above. Don't chase it as a bug during 3b.
- **`mem::action-update` requires the action to exist already.** If you're
  building a test fixture, create via `mem::action-create` first.
- **The `crystallize` status check accepts `"done"` OR `"cancelled"`**, not
  `"pending"`. If a test fails with `action status "pending", expected "done"`,
  update the action first.
- **Installer bin path is absolute** — the registered MCP command is
  `node /abs/path/to/bin/yith-mcp.js`, so running `install` against a
  fixture HOME will point to wherever the package is *currently* located.
  If you move the repo mid-session, re-run `install`.
- **The embedding model is NOT downloaded at boot** — only on first actual
  embed call. Smoke tests that don't write observations never trigger the
  ~137 MB download. This is intentional and keeps tests fast.
- **`planLoopBatches` fix**: the `5 items, 100KB total` case was a real bug
  I caught during 3b-1 smoke testing. The fix computes a size-based cap
  (`avgBytesPerItem = totalBytes / itemCount`, `sizeCap = floor(sizeMax / avgBytesPerItem)`)
  and takes `min(batchMax, sizeCap)`. Don't revert this.

## Resume commands

```bash
# 1. Verify you're on the right branch and everything builds
cd /home/ragingstar/Programming/personal-projects/one-off/oh-my-claudecode
git status
npx tsc 2>&1 | head -20

# 2. Verify the end-to-end smoke still passes (same test as 3b-5)
# This proves crystallize work-packet flow works before you touch anything
TMPHOME=$(mktemp -d /tmp/yith-resume-XXXXXX)
HOME=$TMPHOME node --input-type=module -e "
import { runInstall } from './dist/cli/install.js';
await runInstall({ noTui: true, packageRoot: process.cwd() });
" 2>&1 | grep -E "Yith|MCP|Installation Complete"
# Expected: "Registered MCP server: yith-archive → node .../bin/yith-mcp.js"

# 3. Look at the task list to see exactly where you left off
# (Via Claude Code's TaskList tool; the 12 subtasks #11-#22 are in order)

# 4. Read the files from "Key files to read first" above

# 5. Start on 3b-6: audit the remaining 12 functions.
# Use Grep to find provider.summarize/compress calls in each file and
# count them. Loops are identified by for/while containing provider calls.

# Cleanup the resume test fixture when done with it
rm -rf $TMPHOME
```

## Task list state at handoff

Tasks #1-#10 are all completed (original MCP wiring plan).

Tasks from the 3b plan:

- #11 `3b-1: Protocol types and WorkPacketStore` — **completed**
- #12 `3b-2: Register yith_commit_work MCP tool (stub)` — **completed**
- #13 `3b-3: Pilot — crystallize as 2-state state machine` — **completed**
- #14 `3b-4: yith_trigger work-packet intercept and routing` — **completed**
- #15 `3b-5: End-to-end crystallize work-packet smoke` — **completed**
- #16 `3b-6: Audit remaining 12 functions` — pending, **start here**
- #17 `3b-7: Multi-step pilot — consolidate-pipeline as 3-state machine` — pending
- #18 `3b-8: Roll out state machines to remaining single-call functions` — pending
- #19 `3b-9: Loop functions with adaptive batching` — pending
- #20 `3b-10: Expiration sweep on boot` — pending
- #21 `3b-11: Update memory-override hook and yith-catalog` — pending
- #22 `3b-12: Final end-to-end verification` — pending

## Quick architecture reference card

```
Claude Code session
     │  (MCP stdio)
     ▼
yith-mcp process (spawned per-session)
├── McpServer (7 tools: remember/search/recall/context/observe/commit_work/trigger)
│    │
│    ▼ yith_trigger(name, args)
│    ├── name NOT in LLM_FUNCTION_REGISTRY → direct sdk.trigger(name, args)
│    └── name IN LLM_FUNCTION_REGISTRY + hasLLMProvider=false:
│         sdk.trigger(stepFunctionId, {step:0, originalArgs: args})
│         → StepResult
│         → handleStepResult saves to WorkPacketStore
│         → returns NeedsWorkResponse{continuation, workPackets, ...}
│
│    ▼ yith_commit_work(continuation, packetResults)
│    ├── workPacketStore.load(continuation) → PendingWork
│    ├── sdk.trigger(functionId, {step: currentStep, originalArgs, intermediateState, completions})
│    ├── StepResult
│    ├── if done: delete + return {status: success, result}
│    └── if !done: save updated state + return new NeedsWorkResponse
│
└── YithArchive (in-process)
     ├── 91 registered functions via sdk.trigger(id, args)
     ├── LazyLLMProvider (lazy, throws in work-packet mode)
     ├── WorkPacketStore (KV-backed, mem:work-packets scope)
     └── YithKV (atomic persist, versioned index meta)
           │
           ▼
     ~/.oh-my-claudecode/yith/store.json
     (single atomically-written file with all state)
```

Good luck.
