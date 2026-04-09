/**
 * Elder Loop Hook
 *
 *
 * The Elder Loop is a self-referential completion mechanism — when activated,
 * it causes Claude Code to continue iterating until a completion promise is met.
 *
 * Like Cthulhu dreaming in R'lyeh, the loop continues until the ancient one
 * is satisfied. Unlike death, it CAN be stopped with /cancel-elder-loop.
 */

export interface ElderLoopState {
  active: boolean
  iteration: number
  maxIterations: number
  completionPromise: string
  strategy: "reset" | "continue"
}

const ELDER_LOOP_STATE_FILE = ".claude/elder-loop-state.json"

export function buildElderLoopSystemPrompt(state: ElderLoopState): string {
  return `[SYSTEM REMINDER - ELDER LOOP]
The Elder Loop is active. Iteration ${state.iteration}/${state.maxIterations}.

COMPLETION PROMISE:
${state.completionPromise}

You must continue working until the completion promise is fully met.
- If the promise is not yet met: continue working
- If the promise IS met: report completion and stop
- If you are uncertain: check by running tests or diagnostics

This is iteration ${state.iteration} of ${state.maxIterations}. If the maximum is reached, report status.
[END ELDER LOOP REMINDER]`
}

/**
 * Stop hook script for the Elder Loop.
 * Reads the loop state file and injects the continuation reminder.
 */
export const ELDER_LOOP_HOOK_SCRIPT = `#!/usr/bin/env bash
# oh-my-claudecode: Elder Loop Stop Hook
# Fires on Stop — if elder loop is active, injects continuation reminder.

set -euo pipefail

STATE_FILE="\${CLAUDE_PROJECT_DIR:-.}/.claude/elder-loop-state.json"

if [ ! -f "$STATE_FILE" ]; then
  exit 0
fi

ACTIVE=$(python3 -c "
import json, sys
try:
    with open('$STATE_FILE') as f:
        state = json.load(f)
    if state.get('active') and state.get('iteration', 0) < state.get('maxIterations', 10):
        state['iteration'] = state.get('iteration', 0) + 1
        with open('$STATE_FILE', 'w') as f:
            json.dump(state, f)
        print(json.dumps(state))
except Exception:
    pass
" 2>/dev/null)

if [ -n "$ACTIVE" ]; then
  ITERATION=$(echo "$ACTIVE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['iteration'])")
  MAX=$(echo "$ACTIVE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['maxIterations'])")
  PROMISE=$(echo "$ACTIVE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('completionPromise','Complete all tasks'))")

  echo "[SYSTEM REMINDER - ELDER LOOP]"
  echo "The Elder Loop is active. Iteration $ITERATION/$MAX."
  echo ""
  echo "COMPLETION PROMISE:"
  echo "$PROMISE"
  echo ""
  echo "Continue working until the completion promise is fully met."
  echo "[END ELDER LOOP REMINDER]"
fi
`

export function getElderLoopHookConfig(): object {
  return {
    matcher: "",
    hooks: [
      {
        type: "command",
        command: "~/.claude/hooks/elder-loop.sh",
      },
    ],
  }
}
