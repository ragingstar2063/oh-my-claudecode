/**
 * SSH tmux Reminder Hook
 *
 * PreToolUse hook that fires before Bash commands containing SSH.
 * Reminds the agent to wrap long-running remote work in tmux/screen
 * so that SSH disconnections don't kill running processes.
 *
 * Real-world motivation:
 *   SSH sessions drop during model downloads, container image pulls,
 *   or pip installs on remote GPU servers — losing hours of work.
 *   A simple tmux wrapper prevents this entirely.
 */

export const SSH_TMUX_REMINDER_HOOK_SCRIPT = `#!/usr/bin/env bash
# oh-my-claudecode: SSH tmux Reminder PreToolUse Hook
# Fires before Bash — warns when SSH commands lack tmux/screen protection.

set -euo pipefail

TOOL_NAME="\${CLAUDE_TOOL_NAME:-}"
COMMAND="\${CLAUDE_TOOL_INPUT_COMMAND:-}"

# Only check Bash tool
if [ "$TOOL_NAME" != "Bash" ] || [ -z "$COMMAND" ]; then
  exit 0
fi

# Skip if not an SSH command
if ! echo "$COMMAND" | grep -qE '\\bssh\\b'; then
  exit 0
fi

# Skip if already using tmux/screen inside the SSH command
if echo "$COMMAND" | grep -qE '\\b(tmux|screen)\\b'; then
  exit 0
fi

# Skip simple, short-lived SSH commands (single quick command via ssh host 'cmd')
# These are safe without tmux: probing, status checks, short queries
if echo "$COMMAND" | grep -qE "^ssh\\s+\\S+\\s+'[^']{0,80}'$"; then
  exit 0
fi
if echo "$COMMAND" | grep -qE '^ssh\\s+\\S+\\s+"[^"]{0,80}"$'; then
  exit 0
fi

# Detect high-risk patterns that especially need tmux
HIGH_RISK=""
if echo "$COMMAND" | grep -qEi 'pip install|podman pull|docker pull|wget|curl.*-[oO]|git clone|huggingface|safetensors|gguf|model.*download|apt.get|yum install|make.*install'; then
  HIGH_RISK=" This command includes a long-running download/install — tmux is strongly recommended."
fi

cat <<REMINDER
[SSH TMUX REMINDER] Detected SSH command without tmux/screen protection.

If this is a long-running remote operation (downloads, installs, builds),
wrap it in tmux to survive SSH disconnections:

  ssh <host> -t 'tmux new-session -A -s work'

Or run the command inside an existing tmux session:

  ssh <host> 'tmux send-keys -t work "<command>" Enter'
\${HIGH_RISK:+
⚠ \$HIGH_RISK}
REMINDER
`

export function getSshTmuxReminderHookConfig(): object {
  return {
    matcher: "Bash",
    hooks: [
      {
        type: "command",
        command: "~/.claude/hooks/ssh-tmux-reminder.sh",
      },
    ],
  }
}
