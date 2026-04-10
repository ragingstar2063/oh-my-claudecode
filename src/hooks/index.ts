import type { OhMyClaudeCodeConfig, HookName } from "../config/schema.js"

export { TODO_CONTINUATION_HOOK_SCRIPT, getTodoContinuationHookConfig } from "./todo-continuation.js"
export { ELDER_LOOP_HOOK_SCRIPT, getElderLoopHookConfig } from "./elder-loop.js"
export { COMMENT_CHECKER_HOOK_SCRIPT, getCommentCheckerHookConfig } from "./comment-checker.js"
export { RULES_INJECTOR_HOOK_SCRIPT, getRulesInjectorHookConfig } from "./rules-injector.js"
export { WRITE_GUARD_HOOK_SCRIPT, getWriteGuardHookConfig } from "./write-guard.js"
export { CTHULHU_AUTO_HOOK_SCRIPT, getCthulhuAutoHookConfig } from "./cthulhu-auto.js"

export interface HookDefinition {
  name: HookName
  event: "PreToolUse" | "PostToolUse" | "Stop" | "Notification" | "SessionStart"
  scriptPath: string
  scriptContent: string
  config: object
}

import {
  TODO_CONTINUATION_HOOK_SCRIPT,
  getTodoContinuationHookConfig,
} from "./todo-continuation.js"
import {
  ELDER_LOOP_HOOK_SCRIPT,
  getElderLoopHookConfig,
} from "./elder-loop.js"
import {
  COMMENT_CHECKER_HOOK_SCRIPT,
  getCommentCheckerHookConfig,
} from "./comment-checker.js"
import {
  RULES_INJECTOR_HOOK_SCRIPT,
  getRulesInjectorHookConfig,
} from "./rules-injector.js"
import {
  WRITE_GUARD_HOOK_SCRIPT,
  getWriteGuardHookConfig,
} from "./write-guard.js"
import {
  CTHULHU_AUTO_HOOK_SCRIPT,
  getCthulhuAutoHookConfig,
} from "./cthulhu-auto.js"

/** All hook definitions for the plugin */
export const ALL_HOOK_DEFINITIONS: HookDefinition[] = [
  {
    name: "todo-continuation",
    event: "Stop",
    scriptPath: "~/.claude/hooks/todo-continuation.sh",
    scriptContent: TODO_CONTINUATION_HOOK_SCRIPT,
    config: getTodoContinuationHookConfig(),
  },
  {
    name: "elder-loop",
    event: "Stop",
    scriptPath: "~/.claude/hooks/elder-loop.sh",
    scriptContent: ELDER_LOOP_HOOK_SCRIPT,
    config: getElderLoopHookConfig(),
  },
  {
    name: "comment-checker",
    event: "PostToolUse",
    scriptPath: "~/.claude/hooks/comment-checker.sh",
    scriptContent: COMMENT_CHECKER_HOOK_SCRIPT,
    config: getCommentCheckerHookConfig(),
  },
  {
    name: "rules-injector",
    event: "PreToolUse",
    scriptPath: "~/.claude/hooks/rules-injector.sh",
    scriptContent: RULES_INJECTOR_HOOK_SCRIPT,
    config: getRulesInjectorHookConfig(),
  },
  {
    name: "write-guard",
    event: "PreToolUse",
    scriptPath: "~/.claude/hooks/write-guard.sh",
    scriptContent: WRITE_GUARD_HOOK_SCRIPT,
    config: getWriteGuardHookConfig(),
  },
  {
    name: "cthulhu-auto",
    event: "SessionStart",
    scriptPath: "~/.claude/hooks/cthulhu-auto.sh",
    scriptContent: CTHULHU_AUTO_HOOK_SCRIPT,
    config: getCthulhuAutoHookConfig(),
  },
]

/** Get hooks that should be installed, respecting disabled_hooks config */
export function getEnabledHooks(config: OhMyClaudeCodeConfig): HookDefinition[] {
  const disabled = new Set(config.disabled_hooks ?? [])
  return ALL_HOOK_DEFINITIONS.filter(h => !disabled.has(h.name))
}

/** Build Claude Code settings.json hooks section from enabled hook definitions */
export function buildHooksConfig(enabledHooks: HookDefinition[]): Record<string, object[]> {
  const hooksByEvent: Record<string, object[]> = {
    PreToolUse: [],
    PostToolUse: [],
    Stop: [],
    Notification: [],
    SessionStart: [],
  }

  for (const hook of enabledHooks) {
    hooksByEvent[hook.event].push(hook.config)
  }

  // Remove empty arrays
  for (const event of Object.keys(hooksByEvent)) {
    if (hooksByEvent[event].length === 0) {
      delete hooksByEvent[event]
    }
  }

  return hooksByEvent
}
