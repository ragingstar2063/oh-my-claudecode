/**
 * Background Agent Manager
 *
 *
 * Manages parallel subagent sessions spawned via the Agent tool.
 * Provides circuit breaker pattern to prevent runaway agent spawning,
 * tracks active background agents, and handles completion notifications.
 *
 * In Claude Code, background agents are spawned via:
 *   Agent({ run_in_background: true, ... })
 *
 * This manager tracks them and provides utilities for the hooks system.
 */

export interface BackgroundAgentConfig {
  max_concurrent?: number
  timeout_seconds?: number
  circuit_breaker_enabled?: boolean
  circuit_breaker_threshold?: number
}

export interface BackgroundTask {
  id: string
  agentType: string
  description: string
  startedAt: Date
  status: "running" | "completed" | "failed" | "cancelled"
  result?: string
}

export class BackgroundManager {
  private tasks = new Map<string, BackgroundTask>()
  private failureCount = 0
  private config: Required<BackgroundAgentConfig>

  constructor(config: BackgroundAgentConfig = {}) {
    this.config = {
      max_concurrent: config.max_concurrent ?? 5,
      timeout_seconds: config.timeout_seconds ?? 300,
      circuit_breaker_enabled: config.circuit_breaker_enabled ?? true,
      circuit_breaker_threshold: config.circuit_breaker_threshold ?? 3,
    }
  }

  /** Check if we can spawn a new background agent */
  canSpawn(): { allowed: boolean; reason?: string } {
    if (
      this.config.circuit_breaker_enabled &&
      this.failureCount >= this.config.circuit_breaker_threshold
    ) {
      return {
        allowed: false,
        reason: `Circuit breaker open: ${this.failureCount} consecutive failures. Tsathoggua has intervened.`,
      }
    }

    const running = [...this.tasks.values()].filter(t => t.status === "running").length
    if (running >= this.config.max_concurrent) {
      return {
        allowed: false,
        reason: `Max concurrent agents reached (${running}/${this.config.max_concurrent})`,
      }
    }

    return { allowed: true }
  }

  /** Register a newly spawned background task */
  registerTask(id: string, agentType: string, description: string): BackgroundTask {
    const task: BackgroundTask = {
      id,
      agentType,
      description,
      startedAt: new Date(),
      status: "running",
    }
    this.tasks.set(id, task)
    this.failureCount = 0 // Reset on successful spawn
    return task
  }

  /** Mark a task as completed */
  completeTask(id: string, result: string): void {
    const task = this.tasks.get(id)
    if (task) {
      task.status = "completed"
      task.result = result
    }
  }

  /** Mark a task as failed */
  failTask(id: string, error: string): void {
    const task = this.tasks.get(id)
    if (task) {
      task.status = "failed"
      task.result = error
      this.failureCount++
    }
  }

  /** Cancel a task */
  cancelTask(id: string): void {
    const task = this.tasks.get(id)
    if (task) {
      task.status = "cancelled"
    }
  }

  /** Get all running tasks */
  getRunningTasks(): BackgroundTask[] {
    return [...this.tasks.values()].filter(t => t.status === "running")
  }

  /** Get task by ID */
  getTask(id: string): BackgroundTask | undefined {
    return this.tasks.get(id)
  }

  /** Reset circuit breaker */
  resetCircuitBreaker(): void {
    this.failureCount = 0
  }

  /** Clean up completed/failed tasks older than the timeout */
  cleanup(): void {
    const now = Date.now()
    for (const [id, task] of this.tasks.entries()) {
      const age = now - task.startedAt.getTime()
      if (
        task.status !== "running" &&
        age > this.config.timeout_seconds * 1000
      ) {
        this.tasks.delete(id)
      }
    }
  }

  /** Dispose — cancel all running tasks */
  async dispose(): Promise<void> {
    for (const task of this.getRunningTasks()) {
      this.cancelTask(task.id)
    }
    this.tasks.clear()
  }
}
