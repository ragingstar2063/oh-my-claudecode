/**
 * Parse JSON with comments (JSONC). Strips line comments (//) and block comments
 * and trailing commas before parsing.
 */
export function parseJsonc<T = unknown>(content: string): T {
  // Remove line comments
  let stripped = content.replace(/\/\/[^\n]*/g, "")
  // Remove block comments
  stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, "")
  // Remove trailing commas before } or ]
  stripped = stripped.replace(/,\s*([\]}])/g, "$1")
  return JSON.parse(stripped) as T
}
