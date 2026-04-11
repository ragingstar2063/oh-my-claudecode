/**
 * yith-capture Stop hook — the continuous-ingestion layer for Yith
 * Archive. Fires after every assistant turn (Claude Code's `Stop`
 * event), spawns a fast `oh-my-claudecode bind --resume --claude-only`
 * in the background, and — when the pending-compression queue is big
 * enough — spawns a `claude -p` compression tick too. All spawns are
 * detached so the assistant response never waits on them.
 *
 * Architecture notes:
 *
 *   - Capture debounce (`.last-captured`, 5 seconds): the Stop event
 *     can fire many times in quick succession (one per assistant
 *     response in a long flow), and each bind tick does disk I/O +
 *     a fresh node start. 5 seconds is short enough to feel "live"
 *     and long enough to keep CPU usage bounded.
 *
 *   - Compression debounce (`.last-compressed`, 5 minutes): running
 *     `claude -p` with a compression-batch prompt takes ~30 seconds
 *     of background work and uses the user's subscription. Firing it
 *     every 5 seconds would burn credits; firing it every 5 minutes
 *     catches the queue opportunistically without being invasive.
 *
 *   - Compression threshold (50 pending observations): below this, we
 *     let the user's manual `/necronomicon-bind` ritual handle
 *     compression. Above it, we assume the queue is growing faster
 *     than the user is running the ritual and nudge the cron-style
 *     spawn path into action automatically.
 *
 *   - Fail-safe: the hook exits 0 on every branch. A broken Yith
 *     install can never block the user's Claude Code session — the
 *     hook is purely additive.
 */

export const YITH_CAPTURE_HOOK_SCRIPT = `#!/usr/bin/env bash
# oh-my-claudecode: Yith continuous-ingestion Stop hook
# Runs after every assistant turn. Spawns background bind ticks to
# keep raw observations flowing and (occasionally) to drain pending
# compression via \\\`claude -p\\\`. Never blocks the session.

set -euo pipefail

YITH_DIR="\${HOME}/.oh-my-claudecode/yith"
CAPTURE_SENTINEL="\${YITH_DIR}/.last-captured"
COMPRESS_SENTINEL="\${YITH_DIR}/.last-compressed"
DEBOUNCE_CAPTURE_SEC=5
DEBOUNCE_COMPRESS_SEC=300
COMPRESS_THRESHOLD=50

# Bail early if Yith isn't installed yet (fresh machine, user hasn't
# run \\\`oh-my-claudecode bind\\\` yet). The hook is strictly additive;
# missing prerequisites are a silent no-op, not an error.
if [ ! -d "\$YITH_DIR" ]; then
  exit 0
fi

# Need the CLI on PATH to do anything useful.
if ! command -v oh-my-claudecode >/dev/null 2>&1; then
  exit 0
fi

now=\$(date +%s)

# ── Capture tick (always tries to run) ────────────────────────────────
last_capture=0
if [ -f "\$CAPTURE_SENTINEL" ]; then
  last_capture=\$(cat "\$CAPTURE_SENTINEL" 2>/dev/null || echo 0)
fi

if [ \$((now - last_capture)) -ge \$DEBOUNCE_CAPTURE_SEC ]; then
  echo "\$now" > "\$CAPTURE_SENTINEL"
  # Scope the scan to the current project when CLAUDE_PROJECT_DIR is
  # set by Claude Code — otherwise let bind scan everything.
  PROJECT_FLAG=""
  if [ -n "\${CLAUDE_PROJECT_DIR:-}" ]; then
    PROJECT_FLAG="--project \${CLAUDE_PROJECT_DIR}"
  fi
  # Fork-detach: the CLI's \\\`--background\\\` flag spawns a grandchild
  # with detached stdio and exits the parent immediately, so the Stop
  # hook returns in ~10 ms regardless of how long the backfill takes.
  oh-my-claudecode bind --resume --claude-only --background \$PROJECT_FLAG \\
    >/dev/null 2>&1 || true
fi

# ── Compression tick (threshold-gated, less frequent) ─────────────────
NECRONOMICON="\${YITH_DIR}/necronomicon.json"
if [ -f "\$NECRONOMICON" ] && command -v jq >/dev/null 2>&1; then
  PENDING=\$(jq -r '."mem:pending-compression".state.count // 0' "\$NECRONOMICON" 2>/dev/null || echo 0)
  if [ "\$PENDING" -ge "\$COMPRESS_THRESHOLD" ]; then
    last_compress=0
    if [ -f "\$COMPRESS_SENTINEL" ]; then
      last_compress=\$(cat "\$COMPRESS_SENTINEL" 2>/dev/null || echo 0)
    fi
    if [ \$((now - last_compress)) -ge \$DEBOUNCE_COMPRESS_SEC ]; then
      echo "\$now" > "\$COMPRESS_SENTINEL"
      oh-my-claudecode bind --resume --compress-only --background \\
        >/dev/null 2>&1 || true
    fi
  fi
fi

exit 0
`

export function getYithCaptureHookConfig(): object {
  return {
    matcher: "",
    hooks: [
      {
        type: "command",
        command: "~/.claude/hooks/yith-capture.sh",
      },
    ],
  }
}
