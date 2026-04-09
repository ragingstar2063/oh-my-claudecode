/**
 * MCP Manager
 *
 *
 * Manages the lifecycle of MCP servers that are embedded in skills.
 * When a skill with mcp_config is invoked, its MCP server is provisioned
 * on-demand and cleaned up after the task completes.
 *
 * This prevents context bloat from permanently loaded MCPs.
 */

import type { SkillMcpConfig } from "../skill-loader/index.js"

export interface McpServerInstance {
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  status: "starting" | "running" | "stopped" | "error"
  startedAt?: Date
}

export class McpManager {
  private servers = new Map<string, McpServerInstance>()

  /** Register an MCP server from a skill's mcp_config */
  registerSkillMcps(skillName: string, mcpConfig: SkillMcpConfig): string[] {
    const registered: string[] = []

    for (const [mcpName, config] of Object.entries(mcpConfig)) {
      const instanceKey = `${skillName}:${mcpName}`
      this.servers.set(instanceKey, {
        name: mcpName,
        command: config.command,
        args: config.args,
        env: config.env,
        status: "starting",
        startedAt: new Date(),
      })
      registered.push(mcpName)
    }

    return registered
  }

  /** Mark an MCP server as running */
  markRunning(skillName: string, mcpName: string): void {
    const key = `${skillName}:${mcpName}`
    const server = this.servers.get(key)
    if (server) server.status = "running"
  }

  /** Stop and remove MCP servers for a skill */
  stopSkillMcps(skillName: string): void {
    for (const [key, server] of this.servers.entries()) {
      if (key.startsWith(`${skillName}:`)) {
        server.status = "stopped"
        this.servers.delete(key)
      }
    }
  }

  /** Get all currently running MCP servers */
  getRunningServers(): McpServerInstance[] {
    return [...this.servers.values()].filter(s => s.status === "running")
  }

  /** Build .mcp.json entries for active skill MCPs */
  buildMcpJsonEntries(): Record<string, { command: string; args: string[]; env?: Record<string, string> }> {
    const entries: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {}

    for (const server of this.getRunningServers()) {
      entries[server.name] = {
        command: server.command,
        args: server.args,
        ...(server.env ? { env: server.env } : {}),
      }
    }

    return entries
  }

  /** Dispose — stop all running servers */
  async dispose(): Promise<void> {
    for (const server of this.servers.values()) {
      server.status = "stopped"
    }
    this.servers.clear()
  }
}
