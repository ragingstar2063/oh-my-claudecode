/**
 * Memory Override Hook
 *
 * SessionStart hook that tells Claude Code not to use its built-in auto-memory
 * system (the per-project MEMORY.md index + typed memory files) for
 * oh-my-claudecode sessions. Instead, Yith Archive is the canonical memory
 * store for everything persistent.
 *
 * We cannot programmatically disable the built-in system — it's instructions
 * baked into Claude Code's runtime. What we can do is inject a prompt at
 * SessionStart that takes precedence and tells Claude to route all memory
 * writes through the Yith Archive helpers instead.
 *
 * Fires only when .elder-gods/ is present in cwd or any parent, matching the
 * cthulhu-auto activation model. Projects without the marker are untouched.
 */

export const MEMORY_OVERRIDE_HOOK_SCRIPT = `#!/usr/bin/env bash
# oh-my-claudecode: Memory Override SessionStart Hook
# Redirects persistent memory from Claude Code's built-in system to Yith Archive.

set -euo pipefail

dir="\${CLAUDE_PROJECT_DIR:-\$PWD}"
found=""
while [ "\$dir" != "/" ] && [ -n "\$dir" ]; do
  if [ -d "\$dir/.elder-gods" ]; then
    found="\$dir/.elder-gods"
    break
  fi
  dir="\$(dirname "\$dir")"
done

[ -z "\$found" ] && exit 0

cat <<'PROMPT'
[oh-my-claudecode: memory system override]

This project uses **Yith Archive** as its canonical persistent memory store —
the telepathic archival practice of the Great Race of Yith, bound to an
on-disk grimoire called the **Necronomicon** at
\`~/.oh-my-claudecode/yith/necronomicon.json\`. The archive is exposed via
the \`yith-archive\` MCP server registered in \`~/.claude.json\`. Claude
Code's built-in auto-memory system (the per-project MEMORY.md index and
typed memory files under ~/.claude/projects/<project>/memory/) is DISABLED
for this session.

If the Necronomicon has not been bound yet on this machine (no
necronomicon.json, no MCP server reachable, or yith_context returns empty),
suggest the user run \`/bind-necronomicon\` once before proceeding — it
runs the first-time setup ritual.

How to use Yith Archive — seven MCP tools prefixed \`yith_\`:

  yith_search(query, limit?)
      Call this BEFORE re-exploring the codebase. Yith stores decisions,
      constraints, user preferences, and past incidents across sessions;
      querying first saves time and prevents re-discovering known facts.

  yith_recall(query, limit?)
      Alias of yith_search — use whichever reads more naturally.

  yith_remember(content, type?, concepts?, files?, ttlDays?)
      Save a durable cross-session memory. Use for non-obvious facts,
      architectural decisions, user preferences, past incidents — anything
      a future session would benefit from knowing but cannot derive from
      the current code or git history.

  yith_context(project, sessionId?)
      Assemble a memory bundle for the current project. Useful at the start
      of a new task to load the most relevant prior context.

  yith_observe(sessionId, project, cwd, timestamp, data)
      Log a raw observation. Observations get crystallized into durable
      memories by background pipelines. Prefer yith_remember for things
      you already know are worth keeping.

  yith_trigger(name, args)
      Escape hatch for ~90 advanced operations (graph extraction,
      consolidation, temporal queries, crystallization, lesson recall,
      reflection). The tool's description carries a curated catalog of
      the most useful function names. Full list: \`oh-my-claudecode
      doctor --yith-functions\`.

  yith_commit_work(continuation, packetResults)
      Closes the work-packet loop for LLM-requiring operations. See
      below for when to use this.

**Work-packet loop** (LLM ops without an API key):

If you call \`yith_trigger\` on an advanced function that requires an
LLM and Yith has no API key configured, the response will NOT be the
operation's result — it will be a \`{status: "needs_llm_work"}\` envelope
containing a \`continuation\` token and one or more \`workPackets\`. Each
packet is a \`{id, kind, systemPrompt, userPrompt, purpose}\` record
describing a prompt Yith would have sent to an LLM.

When you see this, execute each packet yourself (either inline in your
current reasoning, or by dispatching a Task subagent with the prompts),
then call \`yith_commit_work(continuation, packetResults)\` where
\`packetResults\` is \`[{id, completion}, ...]\` — one entry per packet,
matched by id. Yith will resume the paused operation. The next response
is either terminal (\`{status: "success", result}\`) or another
\`needs_llm_work\` envelope for the next round. Loop until terminal.

This lets the ~13 LLM-using functions (crystallize, consolidate,
consolidate-pipeline, compress, summarize, flow-compress, graph-extract,
temporal-graph-extract, expand-query, skill-extract, reflect,
enrich-window, enrich-session) run correctly in work-packet mode, using
your subscription auth for the LLM call instead of requiring Yith to
have its own credentials.

Rules for this session:
- Do NOT write new memories to ~/.claude/projects/<project>/memory/ or update
  MEMORY.md under that path. Treat any existing files there as read-only legacy
  artifacts from before this plugin was installed.
- When you learn something worth remembering across sessions, call
  \`yith_remember\` instead of writing a file.
- When you need context on past decisions, call \`yith_search\` first. Only
  re-explore code if the archive has nothing.
- Memory operations are fast and local — use them liberally. Missing a
  relevant prior memory is more costly than calling search.

[END memory system override]
PROMPT
`

export function getMemoryOverrideHookConfig(): object {
  return {
    matcher: "",
    hooks: [
      {
        type: "command",
        command: "~/.claude/hooks/memory-override.sh",
      },
    ],
  }
}
