# NECRONOMICON — oh-my-claudecode

*The Book of Dead Names. The Elder Gods' instruction manual.*

## What This Is

oh-my-claudecode is a Cthulhu Mythos-themed agentic harness for Claude Code. It provides 11 specialized Elder God agents, lifecycle hooks, a skill system, and multi-tier orchestration.

## Agent Roster

| Elder God | Model | Mode | Role |
|-----------|-------|------|------|
| **Cthulhu** | Opus | primary | Main orchestrator — plans, delegates, verifies |
| **Nyarlathotep** | Opus | subagent | Deep autonomous worker — end-to-end execution |
| **Azathoth** | Opus | primary | First-message planner — initial context sweep |
| **Shub-Niggurath** | Opus | primary | Strategic planner — interview → plan → review |
| **Yog-Sothoth** | Opus | subagent | Architecture/debug advisor — read-only, high-IQ |
| **Hastur** | Sonnet | subagent | Lightweight orchestrator — bounded sub-tasks |
| **Ithaqua** | Sonnet | subagent | Pre-planning consultant — intent classification |
| **Tsathoggua** | Sonnet | subagent | Work plan reviewer — blocker-finder |
| **Dagon** | Sonnet | subagent | Documentation search — external libraries, GitHub |
| **The Deep One** | Sonnet | subagent | Vision agent — images, screenshots, diagrams |
| **Shoggoth** | Haiku | subagent | Fast codebase search — parallel pattern matching |

## Architecture

```
oh-my-claudecode/
├── src/
│   ├── agents/           # All 11 Elder God agent definitions
│   ├── config/           # Zod schema — full config type system
│   ├── hooks/            # Lifecycle hook scripts and configs
│   ├── plugin-handlers/  # Config pipeline (5-phase)
│   ├── shared/           # Logging, deep-merge, model resolution
│   └── cli/              # Installer, doctor, list-agents
├── skills/               # Markdown slash commands for Claude Code
└── bin/                  # CLI binary
```

## Hook System

5 lifecycle hooks (all configurable via `disabled_hooks`):

| Hook | Event | Purpose |
|------|-------|---------|
| `todo-continuation` | Stop | Enforce todo completion before stopping |
| `elder-loop` | Stop | Self-referential completion loop |
| `comment-checker` | PostToolUse | Warn on AI-slop comments |
| `rules-injector` | PreToolUse | Inject `.elder-gods/rules/*.md` |
| `write-guard` | PreToolUse | Warn when Write used on existing file |

## Skill Commands

| Skill | Description |
|-------|-------------|
| `/cthulhu` | Activate Cthulhu orchestrator mode |
| `/shoggoth` | Activate Shoggoth search mode |
| `/yog-sothoth` | Activate Yog-Sothoth advisor mode |
| `/elder-loop` | Start completion loop |
| `/cancel-elder-loop` | Stop completion loop |
| `/old-ones-init` | Generate AGENTS.md hierarchy |
| `/invoke-shub` | Strategic planning with Shub-Niggurath |
| `/session-handoff` | Session continuation document |
| `/exorcise-ai-slop` | Purge AI code smells |

## Configuration

Config file: `~/.claude/oh-my-claudecode.jsonc` (user) or `.claude/oh-my-claudecode.jsonc` (project)

```jsonc
{
  // Override models for specific agents
  "agents": {
    "cthulhu": { "model": "opus" },
    "shoggoth": { "model": "haiku" }
  },

  // Disable agents you don't need
  "disabled_agents": ["nyarlathotep", "the-deep-one"],

  // Disable specific hooks
  "disabled_hooks": ["comment-checker"],

  // Elder Loop settings
  "elder_loop": {
    "max_iterations": 15,
    "strategy": "continue"
  }
}
```

## Installation

```bash
npx oh-my-claudecode install
```

## Project-Level Rules

Place architectural rules in `.elder-gods/rules/*.md` — they are automatically injected into every agent's context via the rules-injector hook.

Example: `.elder-gods/rules/no-any.md`
```markdown
# No TypeScript `any`

NEVER use `any` type. Use `unknown` and narrow, or define a proper type.
Violating this rule is grounds for immediate plan rejection by Tsathoggua.
```

## Work Plans

Plans are stored in `.elder-gods/plans/*.md` and reviewed by Tsathoggua before execution.

Use `/invoke-shub` to start the planning flow: Shub-Niggurath interviews → creates plan → Tsathoggua reviews → Cthulhu executes.
