import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Fixture HOME helper — creates a temporary directory that looks like a
 * real user home and returns a handle with paths for the common Yith /
 * Claude Code files. Tests should call `cleanup()` in their teardown
 * (or wrap the test body in a try/finally) to remove the fixture.
 *
 * Most tests don't need to touch the filesystem at all — prefer calling
 * the functions under test directly with injected paths. This helper is
 * for integration tests that exercise the real install / bind flow
 * against a scratch HOME without risking the user's real state.
 */
export interface FixtureHome {
  /** Absolute path to the temp HOME directory. */
  home: string
  /** `~/.claude.json` path (Claude Code user state file). */
  claudeJson: string
  /** `~/.claude/settings.json` path. */
  claudeSettings: string
  /** `~/.claude/projects/` path. */
  claudeProjectsDir: string
  /** `~/.oh-my-claudecode/yith/` path. */
  yithDataDir: string
  /** `~/.oh-my-claudecode/yith/necronomicon.json` path. */
  necronomicon: string
  /** `~/.local/share/opencode/` path (for backward-compat tests). */
  opencodeDataDir: string
  /** Remove the entire fixture directory. Idempotent. */
  cleanup(): void
}

/**
 * Create a fresh fixture HOME. Every test should create its own — they
 * must not share state. The returned object carries paths to the
 * canonical files this codebase cares about; all of them are absolute
 * so the caller can pass `home` as `process.env.HOME` and the paths
 * still resolve correctly.
 *
 * @param label  Optional short prefix for the temp dir name so a
 *               failed test's leftover dir is easy to identify.
 */
export function createFixtureHome(label = "omc-fixture"): FixtureHome {
  const home = mkdtempSync(join(tmpdir(), `${label}-`))
  mkdirSync(join(home, ".claude"), { recursive: true })
  mkdirSync(join(home, ".claude", "projects"), { recursive: true })
  mkdirSync(join(home, ".oh-my-claudecode", "yith"), { recursive: true })

  return {
    home,
    claudeJson: join(home, ".claude.json"),
    claudeSettings: join(home, ".claude", "settings.json"),
    claudeProjectsDir: join(home, ".claude", "projects"),
    yithDataDir: join(home, ".oh-my-claudecode", "yith"),
    necronomicon: join(home, ".oh-my-claudecode", "yith", "necronomicon.json"),
    opencodeDataDir: join(home, ".local", "share", "opencode"),
    cleanup() {
      if (existsSync(home)) {
        rmSync(home, { recursive: true, force: true })
      }
    },
  }
}

/**
 * Seed a fake Claude Code transcript file under the fixture's projects
 * directory. The sessionId gets the `.jsonl` extension; the sanitized
 * project name (`-home-alice-foo`) is the directory Claude Code writes
 * to for an absolute cwd `/home/alice/foo`.
 *
 * Lines are written one-per-line as JSON. The caller passes raw
 * objects; this helper handles serialization.
 */
export function seedTranscript(
  fixture: FixtureHome,
  sanitizedCwd: string,
  sessionId: string,
  lines: unknown[],
): string {
  const projectDir = join(fixture.claudeProjectsDir, sanitizedCwd)
  mkdirSync(projectDir, { recursive: true })
  const path = join(projectDir, `${sessionId}.jsonl`)
  const body = lines.map((l) => JSON.stringify(l)).join("\n") + "\n"
  writeFileSync(path, body, "utf-8")
  return path
}

/**
 * Build a minimal but well-formed transcript line for a user message.
 * Mirrors Claude Code's actual line shape so the backfill parser can
 * round-trip it without stubs.
 */
export function buildUserLine(opts: {
  uuid: string
  sessionId: string
  cwd: string
  timestamp?: string
  content: string
}): Record<string, unknown> {
  return {
    type: "user",
    uuid: opts.uuid,
    sessionId: opts.sessionId,
    cwd: opts.cwd,
    timestamp: opts.timestamp ?? new Date().toISOString(),
    message: { role: "user", content: opts.content },
  }
}

/**
 * Build a minimal assistant transcript line that contains a mix of
 * text blocks and tool_use blocks — the shape the backfill mapper
 * splits into multiple observations.
 */
export function buildAssistantLine(opts: {
  uuid: string
  sessionId: string
  timestamp?: string
  text?: string
  toolUses?: Array<{ id?: string; name: string; input: unknown }>
}): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = []
  if (opts.text) content.push({ type: "text", text: opts.text })
  for (const tu of opts.toolUses ?? []) {
    content.push({
      type: "tool_use",
      id: tu.id ?? `tu_${Math.random().toString(36).slice(2, 10)}`,
      name: tu.name,
      input: tu.input,
    })
  }
  return {
    type: "assistant",
    uuid: opts.uuid,
    sessionId: opts.sessionId,
    timestamp: opts.timestamp ?? new Date().toISOString(),
    message: { role: "assistant", content },
  }
}
