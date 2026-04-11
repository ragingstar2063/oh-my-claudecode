import { createRequire } from "node:module"

/**
 * Single source of truth for the CLI version string displayed by
 * `oh-my-claudecode --version`. Reads from `package.json` at module
 * load time so the value stays in sync with whatever `npm version`
 * or a manual release commit has set — no more hardcoded `0.1.0`
 * drift like the bug this module was created to fix.
 *
 * Implementation note: uses `createRequire` instead of the ESM
 * `import ... with { type: "json" }` attribute syntax. Both work on
 * Node 22+, but createRequire avoids a subtle TypeScript emit
 * footgun where NodeNext resolution may or may not inject the
 * attribute depending on the target module format. createRequire
 * has been stable since Node 12 and needs zero compile-time
 * coordination.
 *
 * Path resolution: `import.meta.url` for this module is
 * `file:///.../dist/cli/version.js` after compilation, and
 * `file:///.../src/cli/version.ts` when run via tsx in tests. The
 * relative path `../../package.json` resolves from `cli/` back to
 * the package root in both layouts — TypeScript's `rootDir: ./src`
 * and npm's install-time preservation of `dist/` under the package
 * root keep the two-up traversal correct either way.
 */
const require = createRequire(import.meta.url)
const pkg = require("../../package.json") as { version: string }

export const CLI_VERSION: string = pkg.version
