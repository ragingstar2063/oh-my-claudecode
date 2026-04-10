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

export const logger: YithLogger = {
  info: (msg, ...rest) => console.log(PREFIX, msg, ...rest),
  warn: (msg, ...rest) => console.warn(PREFIX, msg, ...rest),
  error: (msg, ...rest) => console.error(PREFIX, msg, ...rest),
  debug: (msg, ...rest) => {
    if (process.env["YITH_DEBUG"]) console.log(PREFIX, "[debug]", msg, ...rest)
  },
}
