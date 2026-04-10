# Changelog

All notable changes to oh-my-claudecode are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Yith Archive** — persistent cross-session memory subsystem. 14k lines of
  TypeScript providing file-backed key/value storage, hybrid BM25 + vector
  search, consolidation pipelines, temporal graph retrieval, eviction and
  retention policies, and dozens of memory primitives. Runs entirely
  in-process with zero external dependencies or background services. Public
  API: `createYithArchive({ dataDir })` returns a handle exposing `remember`,
  `recall`, `search`, `context`, `observe`, and a raw `sdk` dispatcher for
  advanced use.
- **Block Summarizer** — in-session context trimming via
  delegation-as-block summarization. After Cthulhu delegates to a specialist
  via the Agent tool, the full output can be piped through
  `summarizeBlock()`, which writes the raw text to
  `.elder-gods/blocks/<timestamp>-<slug>.md` and returns a 3-5 bullet summary
  for the main thread to proceed with. Inspired by Microsoft's Memento paper,
  applied at the delegation boundary instead of the KV cache.
- **`memory-override` hook** — SessionStart hook that redirects persistent
  memory writes from Claude Code's built-in auto-memory system to Yith
  Archive. Fires only when `.elder-gods/` is present.
- Cthulhu's orchestrator prompt gained two new operating principles:
  "Summarize after delegation" and "Persist insights to Yith Archive."
- `LICENSE` file added at repo root (MIT) — previously declared in
  `package.json` but never materialized as a standalone file.
- New package dependencies: `@anthropic-ai/sdk`, `dotenv`. Optional:
  `@xenova/transformers` (for local embedding-based retrieval).

### Changed

- Expanded hook count from 6 to 8 (adding `memory-override` and the Yith
  Archive's SessionStart retrieval flow).
- `README.md` overhauled to reflect the larger scope: Yith Archive section,
  Block Summarizer section, updated hooks table, new architecture notes.

### Notes

This is a feature release covering both of the "context efficiency" problems
that oh-my-claudecode inherited from its architecture. Cross-session memory
via Yith Archive addresses the "every new session re-explains everything"
tax. In-session block summarization addresses the "single long session
accumulates raw tool output until context rots" tax.

The two subsystems are orthogonal and either can be disabled via
`disabled_hooks` config without affecting the other.

## [0.1.6] — 2026-04-10

### Fixed

- Installer now writes slash commands to `~/.claude/commands/` instead of
  `~/.claude/skills/`. Earlier versions dropped flat `.md` files into the
  skills directory, which matches neither Claude Code's skill layout
  (directories with `SKILL.md`) nor the commands layout (flat `.md`) and
  caused `/cthulhu`, `/shoggoth`, etc. to silently not register.
- Installer now cleans up stray command files left in
  `~/.claude/skills/` by older versions so existing users self-heal on
  reinstall.

### Changed

- Renamed the package's `skills/` source directory to `commands/` for
  semantic clarity. Same content, new name.

## [0.1.5] — 2026-04-10

### Added

- `/cthulhu` skill now creates `.elder-gods/` at the project root on first
  invocation. This marks the project as Cthulhu-enabled so the
  `cthulhu-auto` SessionStart hook activates orchestrator mode on every
  subsequent session automatically. Intentional first activation, automatic
  follow-ups.

## [0.1.4] — 2026-04-10

### Added

- `cthulhu-auto` SessionStart hook that walks up from the current working
  directory looking for a `.elder-gods/` marker. When found, injects the
  Cthulhu orchestrator prompt into the session so every user message is
  routed through the intent gate and delegation system without the user
  having to manually run `/cthulhu`. Projects without `.elder-gods/` are
  untouched.

## [0.1.3] — 2026-04-10

### Fixed

- Resolved TypeScript compilation errors from the initial port:
  - Escaped shell `${VAR:-default}` interpolations inside TypeScript
    template literals (comment-checker, elder-loop, write-guard,
    todo-continuation, rules-injector hooks).
  - Fixed premature block comment termination caused by `*/` inside doc
    comments (`parse-jsonc.ts`, `skill-loader/index.ts`).

### Changed

- Removed all external project references and cleaned up broken
  find-and-replace artifacts left by an earlier rebranding pass.

## [0.1.2] — 2026-04-10

### Added

- CI/CD workflow (`.github/workflows/publish.yml`) that runs typecheck,
  build, and smoke on every push to main, auto-bumps the patch version,
  publishes to npm, tags the release, and creates a GitHub release. Uses
  `NPM_TOKEN` secret and the GitHub Actions bot identity to avoid
  re-triggering itself.
- README badges for npm version, npm downloads, CI status, latest release,
  and license.
- `typecheck` and `smoke` npm scripts for CI.

## [0.1.1] — 2026-04-09

### Added

- Initial public release on npm with auto-publish from CI.

## [0.1.0] — 2026-04-09

### Added

- Initial release.
- 11 Cthulhu Mythos agents: Cthulhu, Nyarlathotep, Azathoth, Shub-Niggurath,
  Yog-Sothoth, Hastur, Ithaqua, Tsathoggua, Dagon, The Deep One, Shoggoth.
- 5 lifecycle hooks: `todo-continuation`, `elder-loop`, `comment-checker`,
  `rules-injector`, `write-guard`.
- 9 slash commands: `/cthulhu`, `/shoggoth`, `/yog-sothoth`, `/elder-loop`,
  `/cancel-elder-loop`, `/old-ones-init`, `/invoke-shub`, `/session-handoff`,
  `/exorcise-ai-slop`.
- 3-level config system (defaults → user → project) with Zod validation.
- Background agent manager with circuit breaker and concurrency limits.
- Work plan system with Shub-Niggurath planning flow and Tsathoggua review.
- CLI with `install`, `doctor`, and `list-agents` commands.

[Unreleased]: https://github.com/ragingstar2063/oh-my-claudecode/compare/v0.1.6...HEAD
[0.1.6]: https://github.com/ragingstar2063/oh-my-claudecode/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/ragingstar2063/oh-my-claudecode/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/ragingstar2063/oh-my-claudecode/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/ragingstar2063/oh-my-claudecode/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/ragingstar2063/oh-my-claudecode/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/ragingstar2063/oh-my-claudecode/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ragingstar2063/oh-my-claudecode/releases/tag/v0.1.0
