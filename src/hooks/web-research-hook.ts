/**
 * Web Research Detector Hook
 *
 * PreToolUse hook that detects when user messages indicate a need for web research.
 * Injects system context reminding agents about enforcing current knowledge.
 *
 * When triggered, it warns the agent that web research may be needed and suggests
 * searching for current information before providing answers.
 */

export const WEB_RESEARCH_DETECTOR_HOOK_SCRIPT = `#!/usr/bin/env bash
# oh-my-claudecode: Web Research Detector PreToolUse Hook
# Fires on tool use to detect web research needs and inject enforcement context.

set -euo pipefail

CLAUDE_API_PROMPT="\${CLAUDE_API_PROMPT:-}"

# Extract a simple heuristic from the prompt: look for version patterns or date-sensitive keywords
# This is a bash-level heuristic that doesn't need the full TypeScript detector

# Check for version patterns: v1.0, 2024, latest, etc.
if echo "$CLAUDE_API_PROMPT" | grep -qiE '\\b(v[0-9]+\\.[0-9]+|20[0-9]{2}|latest\\s+(version|release|update)|breaking\\s+changes|what.?s\\s+new)\\b'; then
  echo "[WEB RESEARCH ENFORCEMENT]"
  echo "Detected request that may require current knowledge (version check, date-sensitive info)."
  echo "If you don't have current information available, consider:"
  echo "  1. Using WebSearch to find the latest information"
  echo "  2. Checking official documentation for the most recent updates"
  echo "  3. Being explicit about knowledge cutoff limitations"
  echo ""
fi
`

export function getWebResearchDetectorHookConfig(): object {
  return {
    matcher: "",
    hooks: [
      {
        type: "command",
        command: "~/.claude/hooks/web-research-detector.sh",
      },
    ],
  }
}
