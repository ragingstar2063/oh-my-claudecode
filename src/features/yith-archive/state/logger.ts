/**
 * Shared lightweight logger for yith-archive internals.
 * Replaces the ctx.logger.* calls that previously came from iii-sdk's getContext().
 */

export interface YithLogger {
  info(message: string, ...rest: unknown[]): void
  warn(message: string, ...rest: unknown[]): void
  error(message: string, ...rest: unknown[]): void
  debug(message: string, ...rest: unknown[]): void
}

const PREFIX = "[yith]"

// All diagnostic output goes to stderr. stdout is reserved for MCP JSON-RPC
// frames when the archive is driven by yith-mcp; any stray stdout write would
// corrupt the protocol stream. Non-MCP callers still see the logs on stderr.
export const logger: YithLogger = {
  info: (msg, ...rest) => console.error(PREFIX, msg, ...rest),
  warn: (msg, ...rest) => console.error(PREFIX, msg, ...rest),
  error: (msg, ...rest) => console.error(PREFIX, msg, ...rest),
  debug: (msg, ...rest) => {
    if (process.env["YITH_DEBUG"]) console.error(PREFIX, "[debug]", msg, ...rest)
  },
}
