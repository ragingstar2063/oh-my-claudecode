import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { createFixtureHome } from "./helpers/fixture-home.js"
import {
  scanProject,
  parseGitignore,
  isIgnored,
  summarizeLanguages,
  extractReadmeSections,
  parsePackageJson,
  projectSummaryToObservations,
} from "../src/cli/project-scan.js"

/**
 * Tests for the deep project scanner — Phase D of bind. Each helper
 * is a pure function that takes fixture data and returns a summary
 * piece. The top-level `scanProject` composition test puts a fake
 * project tree in a fixture HOME and asserts the resulting
 * ProjectSummary has all the expected pieces.
 */

function buildProjectFixture(root: string): string {
  const proj = join(root, "fake-project")
  mkdirSync(proj, { recursive: true })

  writeFileSync(
    join(proj, "package.json"),
    JSON.stringify(
      {
        name: "fake-project",
        version: "1.0.0",
        description: "A fake project for scanner tests",
        main: "src/index.ts",
        dependencies: { react: "^18.0.0", zod: "^3.0.0" },
        devDependencies: { typescript: "^5.0.0" },
        scripts: { build: "tsc", test: "vitest" },
      },
      null,
      2,
    ),
  )

  writeFileSync(
    join(proj, "README.md"),
    "# Fake Project\n\nA project that does something interesting.\n\n## Usage\n\nRun `npm install` then `npm test`.\n\n## Architecture\n\nThe code lives under src/.\n",
  )

  writeFileSync(
    join(proj, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true } }),
  )

  writeFileSync(
    join(proj, ".gitignore"),
    "node_modules\ndist\n*.log\n",
  )

  mkdirSync(join(proj, "src"), { recursive: true })
  writeFileSync(
    join(proj, "src", "index.ts"),
    "export const greet = () => 'hello'\n",
  )
  writeFileSync(
    join(proj, "src", "util.ts"),
    "export const id = (x: unknown) => x\n",
  )
  writeFileSync(
    join(proj, "src", "types.ts"),
    "export type Foo = { bar: string }\n",
  )
  writeFileSync(
    join(proj, "src", "legacy.js"),
    "module.exports = function () {}\n",
  )

  // Ignored directories that the scanner should NOT walk into.
  mkdirSync(join(proj, "node_modules", "react"), { recursive: true })
  writeFileSync(
    join(proj, "node_modules", "react", "package.json"),
    "{}",
  )
  writeFileSync(join(proj, "debug.log"), "noise\n")

  return proj
}

test("parseGitignore splits lines, drops comments and blanks", () => {
  const patterns = parseGitignore("node_modules\n# comment\n\ndist/\n*.log\n")
  assert.deepEqual(patterns, ["node_modules", "dist/", "*.log"])
})

test("isIgnored matches simple patterns", () => {
  const patterns = ["node_modules", "dist", "*.log"]
  assert.equal(isIgnored("node_modules", patterns), true)
  assert.equal(isIgnored("node_modules/react", patterns), true)
  assert.equal(isIgnored("debug.log", patterns), true)
  assert.equal(isIgnored("src/index.ts", patterns), false)
})

test("summarizeLanguages counts files by extension", () => {
  const stats = summarizeLanguages([
    "src/index.ts",
    "src/util.ts",
    "src/legacy.js",
    "README.md",
    "tsconfig.json",
  ])
  assert.equal(stats.byExt[".ts"], 2)
  assert.equal(stats.byExt[".js"], 1)
  assert.equal(stats.byExt[".md"], 1)
  assert.equal(stats.byExt[".json"], 1)
  assert.equal(stats.total, 5)
  assert.ok(stats.primary === ".ts", `primary should be .ts, got ${stats.primary}`)
})

test("extractReadmeSections returns title and headings", () => {
  const body = "# Fake Project\n\nA project that does something.\n\n## Usage\n\nblah\n\n## Architecture\n\nmore\n"
  const sections = extractReadmeSections(body)
  assert.equal(sections.title, "Fake Project")
  assert.deepEqual(sections.headings, ["Usage", "Architecture"])
  assert.match(sections.firstParagraph ?? "", /does something/)
})

test("parsePackageJson extracts name, description, deps, scripts", () => {
  const pkg = parsePackageJson(
    JSON.stringify({
      name: "foo",
      version: "1.2.3",
      description: "does stuff",
      dependencies: { a: "1", b: "2" },
      devDependencies: { c: "3" },
      scripts: { build: "tsc" },
    }),
  )
  assert.ok(pkg)
  assert.equal(pkg.name, "foo")
  assert.equal(pkg.version, "1.2.3")
  assert.equal(pkg.description, "does stuff")
  assert.deepEqual(pkg.runtimeDependencies, ["a", "b"])
  assert.deepEqual(pkg.devDependencies, ["c"])
  assert.deepEqual(Object.keys(pkg.scripts), ["build"])
})

test("parsePackageJson returns null on invalid JSON", () => {
  assert.equal(parsePackageJson("not json"), null)
})

test("scanProject produces a ProjectSummary covering files, langs, package.json, README", async () => {
  const f = createFixtureHome("proj-scan")
  try {
    const proj = buildProjectFixture(f.home)

    const summary = await scanProject(proj)
    assert.equal(summary.path, proj)
    // Gitignored: node_modules and *.log should be absent from file list.
    assert.ok(
      !summary.files.some((p) => p.includes("node_modules")),
      "gitignored node_modules should be skipped",
    )
    assert.ok(
      !summary.files.some((p) => p.endsWith(".log")),
      "*.log should be skipped",
    )
    // But .ts files under src/ should be present.
    assert.ok(summary.files.some((p) => p.endsWith("src/index.ts")))
    assert.ok(summary.files.some((p) => p.endsWith("src/util.ts")))

    // Language stats have .ts dominant.
    assert.equal(summary.languages.primary, ".ts")

    // package.json parsed.
    assert.ok(summary.packageInfo)
    assert.equal(summary.packageInfo.name, "fake-project")
    assert.ok(summary.packageInfo.runtimeDependencies.includes("react"))

    // README parsed.
    assert.ok(summary.readme)
    assert.equal(summary.readme.title, "Fake Project")
    assert.ok(summary.readme.headings.includes("Usage"))
  } finally {
    f.cleanup()
  }
})

test("projectSummaryToObservations emits at least one obs per major section", async () => {
  const f = createFixtureHome("proj-obs")
  try {
    const proj = buildProjectFixture(f.home)
    const summary = await scanProject(proj)
    const obs = projectSummaryToObservations(summary)

    // Expect at minimum: language summary, package.json summary,
    // README summary, structure summary. So >=4.
    assert.ok(
      obs.length >= 4,
      `expected >=4 observations, got ${obs.length}`,
    )
    // Every obs should have a unique stable ID tied to the project path
    // and source category, so re-running scanProject on the same tree
    // produces the same IDs (idempotent ingestion).
    const ids = new Set(obs.map((o) => o.id))
    assert.equal(ids.size, obs.length, "observation IDs should be unique")
    for (const o of obs) {
      assert.ok(
        o.id.startsWith("proj:"),
        `obs ID should start with 'proj:', got ${o.id}`,
      )
    }
  } finally {
    f.cleanup()
  }
})
