/**
 * Todo Continuation Hook
 *
 *
 * When Claude Code's Stop event fires but there are incomplete todos,
 * this hook injects a reminder that the agent should keep working.
 *
 * In Claude Code: configured as a Stop hook that checks the todo state
 * and emits a system reminder if incomplete todos exist.
 */

export interface TodoContinuationOptions {
  enabled: boolean
  checkCommand?: string
}

/**
 * Shell script content for the todo continuation Stop hook.
 * This is installed into Claude Code's settings.json hooks.
 */
export const TODO_CONTINUATION_HOOK_SCRIPT = `#!/usr/bin/env bash
# oh-my-claudecode: Todo Continuation Enforcer
# Fires on Stop — if incomplete todos exist, prints a reminder to keep working.

set -euo pipefail

TRANSCRIPT_PATH="\${CLAUDE_TRANSCRIPT:-}"
if [ -z "$TRANSCRIPT_PATH" ]; then
  exit 0
fi

# Check for incomplete TodoWrite entries in the transcript
INCOMPLETE=$(python3 -c "
import json, sys

try:
    with open('$TRANSCRIPT_PATH') as f:
        data = json.load(f)
except Exception:
    sys.exit(0)

messages = data.get('messages', [])
for msg in reversed(messages):
    if msg.get('role') != 'tool':
        continue
    for block in msg.get('content', []):
        if isinstance(block, dict) and block.get('type') == 'tool_result':
            for item in block.get('content', []):
                if isinstance(item, dict) and 'todo' in str(item).lower():
                    # Found a todo block — check for incomplete items
                    text = str(item)
                    if 'in_progress' in text or 'pending' in text:
                        print('INCOMPLETE')
                        sys.exit(0)
sys.exit(0)
" 2>/dev/null)

if [ "$INCOMPLETE" = "INCOMPLETE" ]; then
  echo '[SYSTEM REMINDER - TODO CONTINUATION]'
  echo 'You have incomplete todo items. The Elder Gods demand completion.'
  echo 'Resume work on your in-progress items. Do not stop until all todos are marked completed.'
  echo '[END SYSTEM REMINDER]'
fi
`

/**
 * Generates the hook configuration entry for Claude Code settings.json
 */
export function getTodoContinuationHookConfig(): object {
  return {
    matcher: "",
    hooks: [
      {
        type: "command",
        command: "~/.claude/hooks/todo-continuation.sh",
      },
    ],
  }
}
