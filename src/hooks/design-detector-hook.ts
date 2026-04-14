/**
 * Design Detector Hook
 *
 * PreToolUse hook that detects when user messages indicate a frontend/design task.
 * Injects routing hint suggesting Nodens for design-focused work.
 *
 * When triggered, it suggests delegating to Nodens agent which specializes
 * in design methodology and frontend implementation.
 */

export const DESIGN_DETECTOR_HOOK_SCRIPT = `#!/usr/bin/env bash
# oh-my-claudecode: Design Detector PreToolUse Hook
# Fires on tool use to detect design tasks and suggest Nodens routing.

set -euo pipefail

CLAUDE_API_PROMPT="\${CLAUDE_API_PROMPT:-}"

# Check for design-related keywords
# HIGH confidence: component, ui, interface, design, button, form, modal, etc.
# MEDIUM confidence: react, css, tailwind, responsive, animation, etc.

if echo "$CLAUDE_API_PROMPT" | grep -qiE '\\b(component|ui|interface|design|button|form|modal|card|layout|responsive|css|tailwind|animation|accessibility|wcag|aria)\\b'; then
  echo "[DESIGN TASK DETECTED]"
  echo "This appears to be a design/frontend task. Consider delegating to Nodens:"
  echo "  • Nodens (God of Craftsmanship) specializes in design methodology (intent → spec → impl → polish)"
  echo "  • Expertise in accessibility, responsive design, and design systems"
  echo "  • Recommended for UI components, layouts, design systems, and frontend polish"
  echo ""
fi
`

export function getDesignDetectorHookConfig(): object {
  return {
    matcher: "",
    hooks: [
      {
        type: "command",
        command: "~/.claude/hooks/design-detector.sh",
      },
    ],
  }
}
