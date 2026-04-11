/**
 * Cthulhu Auto-Activation Hook
 *
 * SessionStart hook that walks up from the current working directory looking
 * for a `.elder-gods/` marker. When found, injects the Cthulhu orchestrator
 * prompt into the session so every user message is routed through the Elder
 * God delegation system without the user having to type `/cthulhu` first.
 *
 * Projects without `.elder-gods/` are left untouched — the hook exits silently
 * so ordinary Claude Code sessions stay unchanged.
 */

export const CTHULHU_AUTO_HOOK_SCRIPT = `#!/usr/bin/env bash
# oh-my-claudecode: Cthulhu Auto-Activation SessionStart Hook
# If .elder-gods/ is found in cwd or any parent, injects Cthulhu orchestrator mode.

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

# --- Necronomicon preflight ---
# Extract bindState + pending-compression count from the user's
# necronomicon.json (Yith Archive's on-disk file). The flags drive
# the preflight text block the hook injects below.
NECRONOMICON="\${HOME}/.oh-my-claudecode/yith/necronomicon.json"
BIND_EXISTS="false"
ALL_COMPLETE="false"
PENDING_COUNT="0"
FAILED_PHASES=""
PENDING_PHASES=""
if [ -f "\$NECRONOMICON" ] && command -v jq >/dev/null 2>&1; then
  if jq -e '."mem:bind-state".current' "\$NECRONOMICON" >/dev/null 2>&1; then
    BIND_EXISTS="true"
    ALL_COMPLETE=\$(jq -r '
      [."mem:bind-state".current.phases | to_entries[] | .value.status]
      | all(. == "completed")
    ' "\$NECRONOMICON" 2>/dev/null || echo "false")
    FAILED_PHASES=\$(jq -r '
      [."mem:bind-state".current.phases
        | to_entries[]
        | select(.value.status == "failed")
        | .key] | join(",")
    ' "\$NECRONOMICON" 2>/dev/null || echo "")
    PENDING_PHASES=\$(jq -r '
      [."mem:bind-state".current.phases
        | to_entries[]
        | select(.value.status == "pending" or .value.status == "in_progress")
        | .key] | join(",")
    ' "\$NECRONOMICON" 2>/dev/null || echo "")
  fi
  PENDING_COUNT=\$(jq -r '
    ."mem:pending-compression".state.count // 0
  ' "\$NECRONOMICON" 2>/dev/null || echo "0")
fi

cat <<'PROMPT'
[oh-my-claudecode: Cthulhu orchestrator auto-activated — .elder-gods/ detected]

You are now operating as Cthulhu, the Great Dreamer — primary orchestrator of the
oh-my-claudecode system. Every user message in this session passes through the
Cthulhu intent gate before any action is taken.

Operating principles:
1. Intent gate first — verbalize what the user actually wants before doing anything
2. Delegate aggressively — never work alone when a specialist is available
3. Parallelize everything — independent searches and reads happen simultaneously
4. Plan before implement — todos BEFORE touching files
5. Verify before completing — diagnostics, tests, evidence required
6. Agent-speed time framing — you are not a human team. NEVER estimate work in
   human units (days, weeks, sprints, story points, "a few hours of dev time").
   Agents operate in tool-call budgets, not calendars. If asked "how long", answer
   in concrete units you actually control: number of steps, files touched, tool
   calls, parallel agent fires, or verification passes. If pressed for wall-clock,
   give a seconds-to-minutes range for the current session and say so explicitly.
   Reject any framing that treats this work as human-scale engineering time.

Available Elder God specialists (use via Agent tool subagent_type):
- "shoggoth"       — codebase search (fire 3+ in parallel for exploration)
- "dagon"          — external docs, GitHub source, library research
- "yog-sothoth"    — architecture decisions, hard debugging after 2+ failed attempts
- "tsathoggua"     — review .elder-gods/plans/*.md files for executability
- "ithaqua"        — pre-planning consultant for complex or ambiguous requests
- "hastur"         — bounded sub-tasks and nested orchestration
- "nyarlathotep"   — end-to-end autonomous execution of whole goals
- "shub-niggurath" — strategic planning flow (interview → plan → review)
- "the-deep-one"   — image/screenshot/diagram analysis

Classification flow for each user message:
- Trivial        → direct tools, no delegation
- Exploratory    → parallel Shoggoth agents
- Implementation → plan with todos, then delegate or execute
- Ambiguous      → exactly one clarifying question

[END cthulhu orchestrator injection]
PROMPT

# --- Dynamic Necronomicon preflight ---
# Emit a tailored preflight block based on the bindState flags we
# extracted above. The text here drives Cthulhu's first-user-message
# behavior: hard-block on unbound Necronomicon, nag on failures,
# offer to drain pending compression when the queue is non-empty.
echo
echo "[Necronomicon preflight]"
if [ "\$BIND_EXISTS" = "false" ]; then
  echo
  echo "The Necronomicon has not been bound on this machine yet. The Yith"
  echo "Archive is empty and no past Claude Code sessions have been ingested."
  echo
  echo "**Action required**: tell the user to run \\\`oh-my-claudecode bind\\\`"
  echo "in their terminal OR \\\`/necronomicon-bind\\\` inside this session"
  echo "before proceeding with any memory-dependent work."
elif [ -n "\$FAILED_PHASES" ]; then
  echo
  echo "The binding ritual has failed phases: \$FAILED_PHASES"
  echo "Re-run \\\`/necronomicon-bind\\\` (or \\\`oh-my-claudecode bind --resume\\\`"
  echo "in a terminal) to retry from the failed phase — the state machine"
  echo "resumes automatically without redoing completed work."
elif [ "\$ALL_COMPLETE" != "true" ]; then
  echo
  echo "The Necronomicon is partially bound. Pending phases: \$PENDING_PHASES"
  echo "Run \\\`/necronomicon-bind\\\` to continue the ritual from where it stopped."
elif [ "\$PENDING_COUNT" != "0" ]; then
  echo
  echo "✓ Necronomicon bound. \$PENDING_COUNT raw observations are queued for"
  echo "compression into searchable memories."
  echo
  echo "**Offer the user**: \"Process pending compression now (runs via the"
  echo "work-packet loop using this session's LLM)? It takes one commit round"
  echo "per batch.\" If they accept, call yith_trigger with"
  echo "mem::compress-batch-step and drive the needs_llm_work -> yith_commit_work"
  echo "loop until terminal. Render an ASCII progress bar per round."
else
  echo
  echo "✓ Necronomicon is bound and every phase is complete. Nothing pending."
fi
`

export function getCthulhuAutoHookConfig(): object {
  return {
    matcher: "",
    hooks: [
      {
        type: "command",
        command: "~/.claude/hooks/cthulhu-auto.sh",
      },
    ],
  }
}
