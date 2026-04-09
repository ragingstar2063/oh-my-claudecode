/**
 * Comment Checker Hook
 *
 *
 * Detects and removes AI-generated comment patterns that litter codebases.
 * These are the "// Handle error gracefully" and "// TODO: implement this"
 * comments that AI models add automatically — useless noise.
 *
 * In Claude Code: PostToolUse hook that checks written/edited files.
 */

/** Patterns that indicate AI-slop comments */
export const AI_SLOP_COMMENT_PATTERNS = [
  // Explaining obvious things
  /\/\/\s*(handle|handles|handling)\s+error/i,
  /\/\/\s*return\s+(the\s+)?(result|value|response)/i,
  /\/\/\s*log\s+(the\s+)?(error|message|output)/i,
  /\/\/\s*initialize\s+(the\s+)?\w+/i,
  /\/\/\s*check\s+(if\s+)?(the\s+)?\w+\s+(is\s+)?(valid|null|undefined|empty)/i,
  // Generic implementation markers
  /\/\/\s*(main\s+)?implementation/i,
  /\/\/\s*business\s+logic/i,
  /\/\/\s*core\s+(logic|functionality)/i,
  // Unnecessary docstrings
  /\/\*\*\s*\n\s*\*\s*@description\s+.{1,50}\n\s*\*\/\n\s*(export\s+)?(function|const|class)/,
]

/** Python equivalents */
export const AI_SLOP_PYTHON_PATTERNS = [
  /#\s*(handle|handles|handling)\s+error/i,
  /#\s*return\s+(the\s+)?(result|value|response)/i,
  /#\s*main\s+logic/i,
]

export const COMMENT_CHECKER_HOOK_SCRIPT = `#!/usr/bin/env bash
# oh-my-claudecode: Comment Checker PostToolUse Hook
# Fires after Write/Edit — warns if AI-slop comments were introduced.

set -euo pipefail

TOOL_NAME="\${CLAUDE_TOOL_NAME:-}"
FILE_PATH="\${CLAUDE_TOOL_INPUT_FILE_PATH:-\${CLAUDE_TOOL_INPUT_PATH:-}}"

# Only check Write/Edit tools
case "$TOOL_NAME" in
  Write|Edit) ;;
  *) exit 0 ;;
esac

if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# Check for AI-slop patterns
SLOP=$(grep -nE \
  '(//|#)\s*(handle[s]? error|return (the )?(result|value)|log (the )?(error|message)|initialize (the )?[a-z]+|business logic|core (logic|functionality)|main implementation)' \
  "$FILE_PATH" 2>/dev/null | head -5)

if [ -n "$SLOP" ]; then
  echo "[COMMENT CHECKER] Potential AI-slop comments detected in $FILE_PATH:"
  echo "$SLOP"
  echo ""
  echo "Consider removing comments that explain obvious code. Code should be self-documenting."
fi
`

export function getCommentCheckerHookConfig(): object {
  return {
    matcher: "Write|Edit",
    hooks: [
      {
        type: "command",
        command: "~/.claude/hooks/comment-checker.sh",
      },
    ],
  }
}
