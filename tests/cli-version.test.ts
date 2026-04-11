import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { CLI_VERSION } from "../src/cli/version.js"

/**
 * Regression tests for the CLI version string. The bug this guards
 * against: early versions of `src/cli/index.ts` hardcoded
 * `.version("0.1.0")` into commander, so `oh-my-claudecode --version`
 * always reported 0.1.0 regardless of the actual package version.
 *
 * The fix is to read package.json at runtime via a dedicated module
 * (`src/cli/version.ts`) that exports `CLI_VERSION`. These tests
 * verify:
 *   1. CLI_VERSION is non-empty and looks like semver.
 *   2. It matches the `version` field in `package.json` exactly.
 *   3. The CLI entry point imports from version.ts rather than
 *      hardcoding a literal — catches the "someone copy-pasted
 *      .version('1.2.3') into index.ts" regression.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url))

function readPkgVersion(): string {
  const pkg = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf-8"),
  ) as { version?: string }
  return pkg.version ?? ""
}

test("CLI_VERSION is a non-empty semver-shaped string", () => {
  assert.ok(CLI_VERSION, "CLI_VERSION should not be empty")
  assert.match(
    CLI_VERSION,
    /^\d+\.\d+\.\d+(-[\w.]+)?$/,
    `CLI_VERSION "${CLI_VERSION}" should look like semver`,
  )
})

test("CLI_VERSION matches package.json version field exactly", () => {
  const pkgVersion = readPkgVersion()
  assert.equal(
    CLI_VERSION,
    pkgVersion,
    `CLI_VERSION (${CLI_VERSION}) must equal package.json.version (${pkgVersion})`,
  )
})

test("src/cli/index.ts imports from version.ts and does not hardcode a version literal", () => {
  const src = readFileSync(join(repoRoot, "src/cli/index.ts"), "utf-8")
  assert.match(
    src,
    /CLI_VERSION|from\s+["']\.\/version/,
    "src/cli/index.ts should import CLI_VERSION from ./version",
  )
  assert.ok(
    !src.match(/\.version\(["']\d+\.\d+\.\d+["']\)/),
    "src/cli/index.ts should not hardcode a version literal",
  )
})
