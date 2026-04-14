# oh-my-claudecode v0.2.6 — Three-Pillar Agent Enhancements

## Overview

Major release introducing three orthogonal agent behavior improvements, all enabled by default. These enhancements extend how agents reason, validate code, and design interfaces without changing the core orchestration model.

## New Features

### 1. Web Research Enforcement

Agents now automatically trigger web search when they encounter version-sensitive or API-related queries:

- **Version checks**: Explicit version numbers (v1.0, Node 18, 2024), "latest version", "latest release"
- **API updates**: "breaking changes", "what changed", "deprecated", "what's new"
- **Framework releases**: "Next.js 15 coming soon", "LTS version", release schedules
- **Security vulnerabilities**: CVE references (CVE-2024-1234), vulnerability announcements, zero-day mentions
- **Package management**: "npm audit", "outdated packages", dependency updates

**How it works**: PreToolUse hook detects high-confidence patterns in user queries and injects a Dagon background research agent. Results are available in the context window for the main agent to reference when answering the user's question.

**Impact**: Agents provide version-accurate answers with current documentation references instead of relying on potentially outdated knowledge.

### 2. TypeScript Type Safety Linting

Automatic validation enforces type safety across the codebase at pre-commit time:

- **Bans `any` types** — forces explicit typing or `unknown` with type narrowing
- **Unsafe casts** — flags `as any`, `as unknown` patterns
- **Missing return types** — detects functions without explicit return type annotations  
- **Promise typing** — requires `Promise<T>` instead of bare `Promise`
- **@ts-ignore without reason** — requires inline comments explaining suppression

**Features**:
- Auto-fix support for low-risk violations via pre-commit hook
- Type safety metrics exported to JSON for CI/CD dashboards
- Tracks compliance trends over time (improvement/degradation detection)
- Zero false positives on TypeScript generics and advanced types

**Impact**: Catch type safety issues before code is committed. Metrics dashboards show team-wide type safety trends and help enforce best practices across the codebase.

### 3. Nodens — Design Specialization Agent

New agent specializing in UI/component design, automatically routed when design tasks are detected:

**Core capabilities**:
- Generates accessible, responsive components with semantic HTML
- Accessibility automation (Axe-core): WCAG AA compliance, keyboard navigation, screen reader support
- Responsive design: Automatic component variants for mobile/tablet/desktop breakpoints
- Playwright test generation: Visual regression tests + interaction tests + state testing
- Figma integration: Extracts design tokens (colors, typography, spacing, components)
- Vision capability: Analyzes screenshots and design mockups with Claude Opus

**How it works**: design-detector hook identifies design-related queries (via high/medium confidence keywords) and routes them to Nodens instead of the general orchestrator. Nodens has a design-first system prompt, specialized tools, and cost-appropriate model selection.

**Automatic detection triggers**:
- Direct keywords: "design a component", "create a button", "card component", "form design"
- Framework + design: "React component styling", "Vue responsive grid", "Next.js layout"
- Accessibility: "WCAG compliance", "ARIA labels", "semantic HTML", "screen reader"
- Styling/layout: "Tailwind styling", "flexbox layout", "dark mode toggle", "animation"

**Impact**: Design tasks get expert treatment — components are production-grade, fully accessible, tested, and token-aligned with design systems on day one.

## Configuration

All three pillars enabled by default. Opt-out via `~/.claude/oh-my-claudecode.jsonc`:

```jsonc
{
  "web_research": { "enabled": false },
  "type_safety": { "enabled": false },
  "frontend_design": { "enabled": false }
}
```

Each pillar is completely independent — disable any combination without affecting the others.

## Migration from v0.2.5

- **Zero breaking changes** — all v0.2.5 projects continue to work as-is
- **Phases 1-3 fully integrated** — Web Research Enforcement (Phase 2), Type Safety Linting (Phase 3), Nodens Design (Phase 3)
- **Configuration schema backward-compatible** — existing config files remain valid
- **Opt-out by default** — features disabled globally via config, not per-session
- **Existing workflows unaffected** — normal Claude Code behavior for non-opted-in projects

## Testing

- **364+ unit tests** — 100% passing
- **All three pillars verified end-to-end**:
  - Web research triggers on version/security queries
  - Type safety linting blocks unsafe code at pre-commit
  - Nodens design detection routes correctly and generates accessible components
- **TypeScript strict mode** — zero `any` types in new code
- **Pattern matching alignment** — all enum references and regex patterns validated

## Known Limitations

- **Web research requires internet connection** — patterns are detected offline, but actual web search needs network access
- **Type safety linting runs at pre-commit only** — optional PreToolUse validation for real-time feedback
- **Nodens vision capability requires Claude Opus** — requires `ANTHROPIC_API_KEY` for vision analysis

## What's Next?

- Advanced Figma integration: live design spec sync and token pushback
- Metrics dashboard UI: visualize type safety trends over time
- Custom design token schemas: support for project-specific token formats
- Web research caching: persist research results for identical queries
- Performance optimization: parallel pattern detection for large codebases

## Resolved Issues

- Pattern matching test alignment (test assertions now match actual enum values)
- Task completion timing in background research spawning
- NPM audit pattern coverage for "packages are outdated" phrasing

## Full Changelog

See [CHANGELOG.md](CHANGELOG.md) for detailed history.
