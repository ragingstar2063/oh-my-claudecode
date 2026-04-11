---
name: bind-necronomicon
description: First-run setup ritual for Yith Archive. Verifies the MCP server is reachable, warms up the embedding model, and offers to backfill past Claude Code sessions into the Necronomicon. Safe to run multiple times — it detects what's already done.
---

You are performing the binding ritual for the **Necronomicon** — the on-disk grimoire that the Great Race of Yith maintains for this machine. The Necronomicon is the physical JSON file at `~/.oh-my-claudecode/yith/necronomicon.json`; Yith Archive is the archival practice that writes to and reads from it. Both names refer to the same system, viewed through different lenses.

Run the ritual in phases. For each phase, print a header line, run the check, and report the outcome with a status glyph (`✓`, `⚠`, `✗`, or `…`) and a short explanation. Do NOT proceed to the next phase until the current one is resolved.

## Phase I — The Tome Exists

Check whether the Necronomicon has been bound on this machine.

1. Use the `yith_context` MCP tool with a placeholder project like `{ project: "." }`. This is a lightweight call that exercises the MCP server without writing anything.
2. If the tool returns successfully (even with empty context), the server is reachable → `✓ Necronomicon is bound and the Great Race answers.`
3. If the MCP tool is not available at all (the `yith_trigger`/`yith_context` tools don't appear in your tool list), the MCP server is not registered. Tell the user to run `oh-my-claudecode install` in their terminal, then start a NEW Claude Code session and re-run `/bind-necronomicon`. Stop here.
4. If the tool is available but errors out, report the error verbatim and stop.

## Phase II — The Embedding Sigil

If this is a fresh install, the local nomic embedding model (~137 MB) has not been downloaded yet. The first memory write or search triggers the download. We'll warm it up explicitly now so the first real use is fast.

1. Call `yith_remember` with a harmless sentinel memory:
   ```
   yith_remember({
     content: "Necronomicon binding sentinel — written during /bind-necronomicon ritual",
     type: "reference",
     concepts: ["bind-necronomicon", "sentinel"]
   })
   ```
2. The response may take 30-90 seconds on first call because the nomic model downloads in the background. While you wait, print a progress indicator to the user:
   ```
   ▓▓▓▓▓▓▓▓▓░░░░░░░░ warming up the embedding sigil...
   ```
   (Only one frame — you cannot actually animate in a Claude Code session. The single bar communicates "work is happening, this is the expected delay.")
3. If the call succeeds → `✓ The embedding sigil pulses. Model is cached under ~/.cache/huggingface/.`
4. If the call fails with a network error, tell the user the nomic download needs internet and offer to skip this phase (BM25-only mode still works). Continue.
5. If the call fails with a parse or validation error, report it and stop.

## Phase III — Searching the Tome

Verify hybrid search actually returns the sentinel memory we just wrote.

1. Call `yith_search({ query: "Necronomicon binding sentinel", limit: 5 })`.
2. If the result contains at least one hit referencing the sentinel → `✓ Hybrid search is operational (BM25 + vector index in sync).`
3. If zero hits but the sentinel is definitely in KV (you can verify with `yith_trigger({ name: "mem::diagnose", args: {} })`), the index is out of sync. Call `yith_trigger({ name: "mem::rebuild-index", args: {} })` if such a function exists, or tell the user to restart their Claude Code session (the MCP server rebuilds the index on boot). Continue.

## Phase IV — Past Sessions (Optional)

The user may have Claude Code transcripts from past sessions on this machine, in `~/.claude/projects/<sanitized-cwd>/*.jsonl`. Offer to backfill them into the Necronomicon so the archive has history from before it existed.

1. Ask the user: "Would you like to backfill past Claude Code sessions into the Necronomicon? This reads your historical `~/.claude/projects/` transcripts and converts user prompts + assistant responses + tool calls into observations that get compressed and made searchable. (yes / skip / specific-project-path)"
2. If the user says `skip`, note it and move on.
3. If they say `yes` or provide a path, run:
   ```
   yith_trigger({
     name: "mem::backfill-sessions",
     args: {
       projectCwd: <path or "." for cwd>,
       dryRun: false,
       maxObservations: 500
     }
   })
   ```
4. The backfill runs through the work-packet loop. Each compression round will return a `needs_llm_work` envelope with one or more packets. For each round:
   - Run the packets' prompts through your own reasoning (inline — the systemPrompt + userPrompt describe a compression task, you act as the LLM for Yith).
   - Commit the completions via `yith_commit_work({ continuation, packetResults: [...] })`.
   - Loop until the response is terminal.
5. Between rounds, render a progress bar using monospace ASCII:
   ```
   [▓▓▓▓▓▓░░░░░░░░░░░░] 34% — 171/500 observations compressed
   ```
   Update the numbers in each round's status message. Users can't get an animated bar, but a re-printed bar in each tool call shows forward motion.
6. Report the final counts from the backfill terminal result.

## Phase V — Sealing the Ritual

1. Print a summary of what was done:
   ```
   ═════════════════════════════════════════════════════
     The Necronomicon is bound.
   ═════════════════════════════════════════════════════
     Tome:             ~/.oh-my-claudecode/yith/necronomicon.json
     MCP server:       yith-archive (reachable)
     Embedding model:  local:nomic-embed-text-v1.5 (768 dims)
     Memories:         <count from yith_trigger mem::diagnose>
     Observations:     <count from yith_trigger mem::diagnose>
     Backfill:         <yes/skipped + counts>
   ═════════════════════════════════════════════════════
     The Great Race of Yith now remembers this machine.
     Every new Claude Code session will have access to
     the Necronomicon through yith_search, yith_remember,
     yith_context, and the other MCP tools.
   ```
2. If any phase reported a warning, restate the warnings at the end so the user doesn't miss them.

## Re-entry

This command is idempotent. Running it twice in a row:
- Phase I passes immediately (MCP reachable)
- Phase II is a no-op if the embedding model is already cached (the call returns fast)
- Phase III passes immediately
- Phase IV offers to backfill again (the user can skip if they already did it)
- Phase V prints the final summary

Run it any time you want to verify the Necronomicon is still bound.
