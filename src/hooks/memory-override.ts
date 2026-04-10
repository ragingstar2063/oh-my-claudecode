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

This project uses **Yith Archive** as its canonical persistent memory store.
Claude Code's built-in auto-memory system (the per-project MEMORY.md index and
typed memory files under ~/.claude/projects/<project>/memory/) is DISABLED for
this session.

Rules:
- Do NOT write new memories to ~/.claude/projects/<project>/memory/ or update
  MEMORY.md under that path. Treat any existing files there as read-only legacy
  artifacts from before this plugin was installed.
- When you learn something worth remembering across sessions (user
  preferences, project conventions, non-obvious constraints, architectural
  decisions, past incidents), write to Yith Archive instead. The archive lives
  at ~/.oh-my-claudecode/yith/ and is accessed through the YithArchive helper
  exposed by the oh-my-claudecode plugin.
- When you need to recall past knowledge about this project, query Yith Archive
  first. Only fall back to the built-in memory index if Yith Archive has nothing.
- At session start, Yith Archive's SessionStart hook will inject the top
  relevant memories automatically. Use those before re-exploring the codebase.

The Yith Archive system provides:
  remember(content, type, concepts, files)   — save a durable memory
  search(query, limit)                        — retrieve by semantic/keyword query
  context(project)                            — assemble the current project's memory bundle
  observe(sessionId, project, data)           — log an observation for later extraction

If you genuinely believe a piece of information belongs in the built-in memory
system and NOT in Yith Archive, ask the user before writing it there.

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
