---
name: necronomicon-bind
description: Start, continue, or resume the Necronomicon binding ritual. Thin wrapper that shells out to `oh-my-claudecode bind` (real progress bars, state-machine resumption, all-projects ingestion) and then offers to drain any pending compression via the work-packet loop using this session's own LLM.
---

You are invoking the **Necronomicon Binding Ritual**. The ritual has two halves that must work together:

1. **The fast half** (no LLM) — download the embedding model, scan every past Claude Code transcript across every project on this machine, import opencode history, migrate `.sisyphus/` dirs, seed preliminary memories from project code. This runs as a **real Node process** in the user's terminal with an ANSI TUI showing actual download progress bars and per-phase status. It must run OUTSIDE this Claude Code session.

2. **The slow half** (LLM-dependent) — compress the thousands of raw observations the fast half ingested into searchable memories. This runs **inside this session** via the work-packet protocol, using the session's own subscription auth. Each round is one `yith_trigger → yith_commit_work` loop iteration.

## Why not do everything from this slash command?

Previous versions of this ritual were prompt-only — they asked Claude to call `yith_remember` / `yith_trigger` inline from this slash command. That design was unreliable: Claude would skip steps, print cosmetic ✓ marks without actually invoking the tools, and the user would see "bound in 5 seconds" with an empty Necronomicon. **Do not try to recreate that approach.** The fast half MUST run as a real CLI, and this command's job is to drive it and then handle the compression half.

## Phase 1 — Delegate to the CLI

Do this BEFORE anything else:

1. Tell the user: "Running `oh-my-claudecode bind` in your terminal. This downloads the embedding model (~137 MB, one-time), scans every past Claude Code transcript, imports opencode data, migrates sisyphus directories, and seeds preliminary memories from project code. It's resumable — if it errors mid-run, re-running this command picks up where it stopped."

2. Run via `Bash`:
   ```bash
   oh-my-claudecode bind
   ```
   Stream the output to the user as it arrives. The CLI already produces its own TUI (section headers, progress bars, status glyphs) so you should forward the output verbatim without adding your own commentary.

3. When `oh-my-claudecode bind` exits, inspect its final lines. If the CLI reports "Ritual elapsed: Xs" and a green ✓, the fast half succeeded. If it reports a red ✗ with an error, surface that to the user and stop — re-running this command will retry the failed phase automatically from the state machine cursor.

## Phase 2 — Drain pending compression via the work-packet loop

The CLI's last line tells you how many raw observations are pending compression. That's the input to this half.

1. Call `yith_trigger({ name: "mem::compress-batch-step", args: { limit: 100 } })`. Expect a `needs_llm_work` envelope with one or more `workPackets` and a `continuation` token.

2. For each packet in the envelope: read `systemPrompt` + `userPrompt`, reason about them inline (you ARE the LLM for Yith — just produce the compression XML the system prompt asks for), and collect the results.

3. Call `yith_commit_work({ continuation, packetResults: [{id, completion}, ...] })`. The response is either terminal (`{status: "success"}`) or another `needs_llm_work` for the next batch.

4. Between rounds, render a monospace ASCII progress bar so the user sees forward motion:
   ```
   [▓▓▓▓▓▓░░░░░░░░░░░░░░] 34%  —  171/500 raw observations compressed
   ```
   Re-print the bar each round with updated numbers. (The Claude Code chat UI won't animate in place, but a re-printed bar per tool call shows clear progress.)

5. Loop until terminal. Each round's `limit` can be 50-100 — adjust based on how large the prompts are. If a round takes more than ~2 minutes, drop the limit for the next one.

## Phase 3 — Seal the ritual

Final output:

```
═══════════════════════════════════════════════════════
  The Necronomicon is bound.
═══════════════════════════════════════════════════════
  Tome:              ~/.oh-my-claudecode/yith/necronomicon.json
  MCP server:        yith-archive (via ~/.claude.json)
  Embedding:         local:nomic-embed-text-v1.5 (768 dims)
  Observations:      <total from mem::diagnose>
  Compressed:        <total - pending>
  Pending:           <remaining count>
═══════════════════════════════════════════════════════
```

If there are still pending observations (either because `limit` capped the batch or because the user interrupted), tell them exactly how many and that running `/necronomicon-bind` again resumes from where it stopped.

## Unattended mode

Mention once at the end: if the user wants this to happen in the background without opening a session, they can run `oh-my-claudecode bind --install-cron [--interval 1h]` once, and a cron entry will run `oh-my-claudecode bind --resume` on the interval. That form uses `claude -p` (Claude Code's non-interactive mode) to drive the compression half, so nothing needs to be open.
