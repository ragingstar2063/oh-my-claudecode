# oh-my-claudecode

[![npm version](https://img.shields.io/npm/v/oh-my-claudecode.svg)](https://www.npmjs.com/package/oh-my-claudecode)
[![npm downloads](https://img.shields.io/npm/dw/oh-my-claudecode.svg)](https://www.npmjs.com/package/oh-my-claudecode)
[![publish npm](https://github.com/ragingstar2063/oh-my-claudecode/actions/workflows/publish.yml/badge.svg)](https://github.com/ragingstar2063/oh-my-claudecode/actions/workflows/publish.yml)
[![release](https://img.shields.io/github/v/release/ragingstar2063/oh-my-claudecode?display_name=tag)](https://github.com/ragingstar2063/oh-my-claudecode/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> *Ph'nglui mglw'nafh Cthulhu R'lyeh wgah'nagl fhtagn.*

A Cthulhu Mythos-themed agentic harness for [Claude Code](https://claude.ai/code). Provides 11 specialized Elder God agents, lifecycle hooks, a skill system, and multi-tier orchestration.

## What This Is

oh-my-claudecode extends Claude Code with a complete agentic infrastructure:

- **11 Elder God agents** each specialized for a different domain
- **5 lifecycle hooks** for todo enforcement, completion loops, code quality, and context injection
- **9 slash commands (skills)** for invoking agents and managing sessions
- **3-level config system** (defaults → user → project) with Zod validation
- **Background agent management** with circuit breaker and concurrency limits
- **Work plan system** with structured planning and review flow

## Agent Roster

| Elder God | Model | Mode | Role |
|-----------|-------|------|------|
| **Cthulhu** | Opus | primary | Main orchestrator — intent gate, delegation, parallel execution, verification |
| **Nyarlathotep** | Opus | subagent | Deep autonomous worker — end-to-end goal execution |
| **Azathoth** | Opus | primary | First-message planner — initial context sweep and routing |
| **Shub-Niggurath** | Opus | primary | Strategic planner — interview → scope → plan → Tsathoggua review |
| **Yog-Sothoth** | Opus | subagent | Architecture/debug advisor — read-only, high-reasoning consultation |
| **Hastur** | Sonnet | subagent | Lightweight sub-orchestrator for bounded tasks |
| **Ithaqua** | Sonnet | subagent | Pre-planning consultant — intent classification, anti-slop guardrails |
| **Tsathoggua** | Sonnet | subagent | Work plan reviewer — blocker-finder, not perfectionist |
| **Dagon** | Sonnet | subagent | External documentation and GitHub source research |
| **The Deep One** | Sonnet | subagent | Vision agent — images, screenshots, diagrams |
| **Shoggoth** | Haiku | subagent | Fast parallel codebase search |

## Installation

```bash
npx oh-my-claudecode install
```

The interactive wizard will:
1. Install hook scripts to `~/.claude/hooks/`
2. Register hooks in `~/.claude/settings.json`
3. Install skill files to `~/.claude/skills/`
4. Create `~/.claude/oh-my-claudecode.jsonc` config

### Non-interactive install

```bash
npx oh-my-claudecode install --no-tui
```

### Requirements

- Claude Code CLI installed (`npm install -g @anthropic-ai/claude-code` or equivalent)
- Node.js 20+
- `~/.claude/` directory writable

## Slash Commands

After installation, these are available in Claude Code sessions:

| Command | Description |
|---------|-------------|
| `/cthulhu` | Activate Cthulhu orchestrator mode |
| `/shoggoth` | Activate Shoggoth search mode |
| `/yog-sothoth` | Activate Yog-Sothoth advisor mode |
| `/elder-loop` | Start the completion loop |
| `/cancel-elder-loop` | Stop the active loop |
| `/old-ones-init` | Generate AGENTS.md hierarchy |
| `/invoke-shub` | Strategic planning flow |
| `/session-handoff` | Create session continuation doc |
| `/exorcise-ai-slop` | Purge AI code smells |

## How Agents Are Invoked

**Important difference from OpenCode**: OpenCode has a plugin API that allows registering named agents directly into its agent selector UI. Claude Code does not have an equivalent public plugin API.

Instead, oh-my-claudecode agents are invoked through:

1. **Slash commands** — `/cthulhu`, `/shoggoth`, etc. activate the named agent mode
2. **Agent tool delegation** — Cthulhu uses `Agent(subagent_type="shoggoth", ...)` to spawn specialists
3. **Skill-based dispatch** — skills installed to `~/.claude/skills/` are likely available as `subagent_type` values

The agents are additive — they don't replace Claude Code's built-in agent types.

## Configuration

Config file: `~/.claude/oh-my-claudecode.jsonc` (user-level) and/or `.claude/oh-my-claudecode.jsonc` (project-level).

Project config overrides user config for scalar/object fields. Array fields (`disabled_*`) are unioned.

```jsonc
{
  // Override models for specific agents
  "agents": {
    "cthulhu": {
      "model": "opus",
      "prompt_append": "Always write tests for every function you create."
    },
    "shoggoth": {
      "model": "haiku"
    }
  },

  // Disable agents you don't need
  "disabled_agents": ["nyarlathotep", "the-deep-one"],

  // Disable specific lifecycle hooks
  "disabled_hooks": ["comment-checker", "write-guard"],

  // Elder Loop settings (completion loop)
  "elder_loop": {
    "max_iterations": 15,
    "strategy": "continue"  // or "reset"
  },

  // Background agent limits
  "background_task": {
    "max_concurrent": 8,
    "circuit_breaker_threshold": 3
  }
}
```

### Available Models

Only Claude models are used:

| Short Alias | Full Model ID |
|-------------|--------------|
| `opus` | `claude-opus-4-6` |
| `sonnet` | `claude-sonnet-4-6` |
| `haiku` | `claude-haiku-4-5` |

## Lifecycle Hooks

6 hooks are installed into Claude Code's `settings.json`:

| Hook | Event | Description |
|------|-------|-------------|
| `cthulhu-auto` | SessionStart | Auto-activate Cthulhu orchestrator mode when `.elder-gods/` is present in the project (no `/cthulhu` needed) |
| `todo-continuation` | Stop | If incomplete todos exist when stopping, inject a reminder to continue |
| `elder-loop` | Stop | Self-referential completion loop (set promise → keeps running until met) |
| `comment-checker` | PostToolUse | Warn when AI-slop comments are written (explains obvious code) |
| `rules-injector` | PreToolUse | Auto-inject `.elder-gods/rules/*.md` into agent context |
| `write-guard` | PreToolUse | Warn when `Write` is used on an existing file (suggest `Edit`) |

Disable specific hooks in config:
```jsonc
{ "disabled_hooks": ["comment-checker", "write-guard"] }
```

### Auto-activating Cthulhu on a project

By default, Cthulhu only takes over when you explicitly type `/cthulhu`. To have every new Claude Code session in a project auto-enter Cthulhu orchestrator mode, create an `.elder-gods/` directory at the project root:

```bash
mkdir .elder-gods
```

The `cthulhu-auto` SessionStart hook walks upward from the current directory looking for `.elder-gods/`, and if it finds one, injects the Cthulhu orchestrator prompt into the session. Projects without `.elder-gods/` are left untouched, so unrelated repos keep their normal Claude Code behavior. You can also drop architectural rules into `.elder-gods/rules/*.md` and work plans into `.elder-gods/plans/*.md` — the other hooks will pick them up automatically.

Turn auto-activation off globally with:
```jsonc
{ "disabled_hooks": ["cthulhu-auto"] }
```

## Project Structure

```
oh-my-claudecode/
├── src/
│   ├── agents/               # 11 Elder God agent definitions + builder
│   ├── config/               # Zod schema — full type system
│   ├── hooks/                # Lifecycle hook scripts and configs
│   ├── features/
│   │   ├── background-agent/ # BackgroundManager (circuit breaker, concurrency)
│   │   ├── skill-loader/     # Discovers user skills from .claude/skills/
│   │   └── mcp-manager/      # Skill-scoped MCP lifecycle
│   ├── plugin-handlers/      # 5-phase config pipeline
│   ├── shared/               # Logging, deep-merge, model resolution
│   └── cli/                  # Installer, doctor, list-agents
├── skills/                   # Markdown slash commands
└── NECRONOMICON.md           # Plugin architecture reference
```

## Project-Level Setup

### Architectural Rules

Place rules in `.elder-gods/rules/*.md` — auto-injected into every agent's context:

```
.elder-gods/
└── rules/
    ├── no-any.md          # No TypeScript `any`
    ├── test-coverage.md   # Minimum test requirements
    └── naming-conv.md     # Naming conventions
```

Example `.elder-gods/rules/no-any.md`:
```markdown
# No TypeScript `any`

NEVER use `any` type. Use `unknown` and narrow appropriately, or define a proper type.
This rule is non-negotiable. Tsathoggua will reject any plan that introduces `any`.
```

### Work Plans

Plans are stored in `.elder-gods/plans/*.md` and reviewed by Tsathoggua before execution.

Use `/invoke-shub` to start the planning flow:
1. Shub-Niggurath surveys codebase
2. Interviews you with scoping questions
3. Creates plan at `.elder-gods/plans/[task].md`
4. Tsathoggua reviews for executability
5. Cthulhu orchestrates implementation

### Knowledge Base

Use `/old-ones-init` to generate `AGENTS.md` files at the root and in key subdirectories. These give all agents project context without requiring repeated exploration.

## Diagnostics

```bash
npx oh-my-claudecode doctor
```

Checks:
- `~/.claude/` directory exists
- `settings.json` present
- All hook scripts installed
- Hooks registered in settings
- Skills installed
- Plugin config valid

## Agent Detail

### Cthulhu (Main Orchestrator)

The heart of the system. Every user message passes through Cthulhu's intent gate:

1. **Verbalize intent** — explicitly classify what the user wants before acting
2. **Route accordingly** — trivial → direct tools; exploratory → parallel Shoggoth agents; implementation → plan + delegate; ambiguous → one question
3. **Plan before acting** — if 2+ steps, create detailed todos immediately
4. **Delegate aggressively** — never work alone when a specialist is available
5. **Verify before completing** — diagnostics, tests, evidence required

### Shoggoth (Codebase Search)

Fire 3+ in parallel. They're formless and free. Use for:
- Finding where X is implemented
- Discovering patterns to follow
- Cross-module structure discovery

### Yog-Sothoth (Architecture Advisor)

Consult when:
- Architecture decision requires multi-system tradeoffs
- After 2+ failed fix attempts
- Completing significant implementation for self-review

Response always includes: Bottom line (2-3 sentences), Action plan (≤7 steps), Effort estimate.

### Shub-Niggurath + Tsathoggua (Planning Flow)

Shub-Niggurath interviews → creates `.elder-gods/plans/task.md` → Tsathoggua reviews it → OKAY or REJECT with max 3 blocking issues → Cthulhu executes.

### The Elder Loop

Activate with `/elder-loop [completion promise]`. The loop writes state to `.claude/elder-loop-state.json`. Each Stop event, the hook checks if the promise is met — if not, injects a reminder to continue.

Deactivate with `/cancel-elder-loop`.

## Development

```bash
git clone https://github.com/[your-username]/oh-my-claudecode
cd oh-my-claudecode
npm install
npm run build
```

## Philosophy

Core philosophy:

- **Delegate first** — specialists exist for a reason; use them
- **Parallel by default** — independent work always runs simultaneously  
- **Evidence required** — no task is complete without diagnostics/test proof
- **No AI slop** — no unnecessary abstractions, comments, or scope creep
- **Blocker-finding, not perfectionism** — Tsathoggua finds blockers, not nitpicks

## License

MIT
