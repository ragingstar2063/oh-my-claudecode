/**
 * Write Guard Hook
 *
 *
 * Warns when Write is used on an existing file (should use Edit instead).
 * Prevents accidental full-file overwrites when only a portion should change.
 */

export const WRITE_GUARD_HOOK_SCRIPT = `#!/usr/bin/env bash
# oh-my-claudecode: Write Guard PreToolUse Hook
# Fires before Write — warns if writing to an existing file.

set -euo pipefail

TOOL_NAME="\${CLAUDE_TOOL_NAME:-}"
FILE_PATH="\${CLAUDE_TOOL_INPUT_FILE_PATH:-}"

if [ "$TOOL_NAME" != "Write" ] || [ -z "$FILE_PATH" ]; then
  exit 0
fi

if [ -f "$FILE_PATH" ]; then
  echo "[WRITE GUARD] Warning: Write tool used on existing file: $FILE_PATH"
  echo "Consider using Edit instead to preserve unintended changes."
  echo "If you intend to fully replace this file, proceed."
fi
`

export function getWriteGuardHookConfig(): object {
  return {
    matcher: "Write",
    hooks: [
      {
        type: "command",
        command: "~/.claude/hooks/write-guard.sh",
      },
    ],
  }
}
