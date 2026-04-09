/**
 * Rules Injector Hook
 *
 *
 * Loads `.elder-gods/rules/*.md` files and injects them as system context.
 * This is the Cthulhu equivalent of sisyphus rules — project-specific
 * architectural enforcement rules that every agent must follow.
 */

export const RULES_INJECTOR_HOOK_SCRIPT = `#!/usr/bin/env bash
# oh-my-claudecode: Rules Injector PreToolUse Hook
# Fires on first message — injects .elder-gods/rules/*.md into context.

set -euo pipefail

RULES_DIR="\${CLAUDE_PROJECT_DIR:-.}/.elder-gods/rules"

if [ ! -d "$RULES_DIR" ]; then
  exit 0
fi

RULES_FILES=$(find "$RULES_DIR" -name "*.md" -type f 2>/dev/null | sort)

if [ -z "$RULES_FILES" ]; then
  exit 0
fi

echo "[SYSTEM RULES - ELDER GODS]"
echo "The following architectural rules govern this project:"
echo ""

while IFS= read -r rule_file; do
  RULE_NAME=$(basename "$rule_file" .md)
  echo "## Rule: $RULE_NAME"
  cat "$rule_file"
  echo ""
done <<< "$RULES_FILES"

echo "[END SYSTEM RULES]"
`

export function getRulesInjectorHookConfig(): object {
  return {
    matcher: "",
    hooks: [
      {
        type: "command",
        command: "~/.claude/hooks/rules-injector.sh",
      },
    ],
  }
}
