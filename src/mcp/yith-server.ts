/**
 * yith-mcp — stdio MCP server that exposes the Yith Archive to Claude Code.
 *
 * Boots createYithArchive() in-process, registers MCP tools that wrap the
 * archive's convenience API + sdk.trigger dispatcher, and handles graceful
 * shutdown so in-memory state flushes to disk before the session ends.
 *
 * Transport: stdio. stdout is reserved exclusively for MCP JSON-RPC frames.
 * Every log path in this process must go to stderr — see the console.log
 * override below for the defensive guard against third-party stdout writes.
 */

// Defensive guard: route any stray console.log to stderr BEFORE loading any
// other module. stdout belongs to the MCP transport; any rogue write would
// corrupt JSON-RPC framing. The SDK's StdioServerTransport writes via
// process.stdout.write() directly (stdio.js:66), so this override does not
// affect protocol traffic.
const _origConsoleLog = console.log.bind(console)
console.log = (...args: unknown[]) => {
  console.error(...args)
}
// Export in case a future tool explicitly needs the original; silences the
// unused-var lint that strict mode would otherwise raise.
void _origConsoleLog

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

import { createYithArchive, type YithArchiveHandle } from "../features/yith-archive/index.js"
import { VERSION as YITH_VERSION } from "../features/yith-archive/version.js"
import { logger } from "../features/yith-archive/state/logger.js"
import { registerYithTools } from "./yith-tools.js"

/** Grace period for handle.shutdown() before we force-exit. */
const SHUTDOWN_TIMEOUT_MS = 5000

async function main(): Promise<void> {
  logger.info(`yith-mcp starting (archive v${YITH_VERSION})`)

  // Boot the in-process archive. This creates ~/.oh-my-claudecode/yith/ if
  // missing and loads any persisted state.
  const archive: YithArchiveHandle = createYithArchive()

  // Construct the high-level MCP server and register the six Yith tools.
  const server = new McpServer(
    {
      name: "yith-archive",
      version: YITH_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        "Yith Archive — persistent cross-session memory for this Claude Code project. " +
        "Tools prefixed `yith_` read and write the archive. Call `yith_search` before " +
        "re-exploring the codebase; call `yith_remember` to save durable memories. " +
        "Use `yith_trigger` for advanced ops beyond the five core tools.",
    },
  )

  registerYithTools(server, archive)
  logger.info(
    "yith-mcp tools registered: yith_remember, yith_search, yith_recall, yith_context, yith_observe, yith_commit_work, yith_trigger",
  )

  // Connect the transport and begin serving. Resolves once the transport is
  // wired up; the process then sits waiting for MCP frames on stdin.
  const transport = new StdioServerTransport()
  await server.connect(transport)
  logger.info("yith-mcp ready — awaiting MCP requests on stdio")

  // Graceful shutdown. SIGINT fires when the parent (Claude Code) sends an
  // interrupt; SIGTERM fires when it terminates the server cleanly. Both
  // must flush the archive to disk before exiting, or we lose in-memory
  // writes that haven't been persisted yet.
  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info(`yith-mcp received ${signal} — flushing archive`)

    const timeout = setTimeout(() => {
      logger.error(
        `yith-mcp shutdown timeout after ${SHUTDOWN_TIMEOUT_MS}ms — force-exiting`,
      )
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)
    timeout.unref()

    try {
      await archive.shutdown()
      await server.close()
      logger.info("yith-mcp shutdown complete")
      process.exit(0)
    } catch (err) {
      logger.error("yith-mcp shutdown error", err)
      process.exit(1)
    }
  }

  process.on("SIGINT", () => {
    void shutdown("SIGINT")
  })
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM")
  })

  // Parent disconnect via stdin close. Claude Code (and any conformant MCP
  // host) terminates stdio servers by closing stdin rather than sending a
  // signal; without this handler we'd exit without flushing the KV, losing
  // any writes since the last persist. This is the same shutdown path as
  // SIGINT/SIGTERM — idempotent via the `shuttingDown` guard.
  process.stdin.on("end", () => {
    void shutdown("stdin-end")
  })
}

main().catch((err: unknown) => {
  logger.error("yith-mcp fatal error", err)
  process.exit(1)
})
