/**
 * Web Research Background Execution
 *
 * Spawns Dagon agent in background when high-confidence web research triggers are detected.
 * Handles background fetching and timeout management.
 */

import type { WebResearchDetectionResult } from "../../hooks/web-research-detector.js"
import { detectAdvancedPatterns } from "./advanced-patterns.js"

/**
 * Background research spawn configuration
 */
export interface BackgroundResearchConfig {
  enabled?: boolean
  timeout_ms?: number
}

/**
 * Background research task
 */
export interface BackgroundResearchTask {
  id: string
  message: string
  confidence: "must" | "should"
  timestamp: number
  results?: unknown
  completed: boolean
  error?: string
}

/**
 * Result of background research attempt
 */
export interface BackgroundResearchResult {
  success: boolean
  taskId: string
  message?: string
  timedOut: boolean
}

/**
 * Store for active background tasks (in-memory, not persisted)
 */
const activeTasks = new Map<string, BackgroundResearchTask>()

/**
 * Generate unique task ID
 */
function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).substring(7)}`
}

/**
 * Attempt to spawn background research for a message
 *
 * @param message - User message that triggered research need
 * @param result - Web research detection result
 * @param config - Background research configuration
 * @returns Background research result
 */
export async function spawnBackgroundResearch(
  message: string,
  result: WebResearchDetectionResult,
  config?: BackgroundResearchConfig,
): Promise<BackgroundResearchResult> {
  const enabled = config?.enabled !== false
  const timeoutMs = config?.timeout_ms ?? 20000 // 20 seconds default
  const taskId = generateTaskId()

  // Only spawn if enabled and confidence is high
  if (!enabled || result.confidence !== "must") {
    return {
      success: false,
      taskId,
      message: "Background research not triggered (insufficient confidence or disabled)",
      timedOut: false,
    }
  }

  // Create background task
  const task: BackgroundResearchTask = {
    id: taskId,
    message,
    confidence: result.confidence,
    timestamp: Date.now(),
    completed: false,
  }

  activeTasks.set(taskId, task)

  // Spawn background fetch with timeout
  spawnDagonBackgroundFetch(taskId, message, timeoutMs).catch(error => {
    const task = activeTasks.get(taskId)
    if (task) {
      task.error = error instanceof Error ? error.message : String(error)
    }
  })

  return {
    success: true,
    taskId,
    message: `Background research spawned (task: ${taskId})`,
    timedOut: false,
  }
}

/**
 * Spawn Dagon agent in background to fetch web research results
 *
 * This is a placeholder implementation. In production, this would:
 * 1. Spawn a background Dagon agent process
 * 2. Pass the message for web search
 * 3. Collect results and store in task
 * 4. Timeout after specified duration
 *
 * @param taskId - Unique task identifier
 * @param message - Message to research
 * @param timeoutMs - Timeout in milliseconds
 */
async function spawnDagonBackgroundFetch(
  taskId: string,
  message: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      const task = activeTasks.get(taskId)
      if (task) {
        task.completed = true
        task.error = "Timeout"
      }
      reject(new Error(`Background research timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    // Simulate async web search work
    // In production: spawn Dagon agent process with message
    // For now: mark as completed after a short delay
    setTimeout(() => {
      clearTimeout(timeoutId)
      const task = activeTasks.get(taskId)
      if (task) {
        task.completed = true
        task.results = { placeholder: "background_research_results" }
      }
      resolve()
    }, Math.min(1000, timeoutMs / 2))
  })
}

/**
 * Get status of a background research task
 *
 * @param taskId - Task identifier
 * @returns Task data or undefined if not found
 */
export function getBackgroundResearchStatus(taskId: string): BackgroundResearchTask | undefined {
  return activeTasks.get(taskId)
}

/**
 * Check if advanced patterns indicate high-confidence research need
 *
 * @param message - User message
 * @returns True if advanced patterns found
 */
export function hasAdvancedResearchPatterns(message: string): boolean {
  const patterns = detectAdvancedPatterns(message)
  return patterns.some(p => p.confidence === "must")
}

/**
 * Collect all advanced patterns and basic research triggers
 *
 * @param message - User message
 * @param basicResult - Basic web research detection result
 * @returns Combined trigger information
 */
export function collectResearchTriggers(
  message: string,
  basicResult: WebResearchDetectionResult,
): {
  basic: WebResearchDetectionResult
  advanced: ReturnType<typeof detectAdvancedPatterns>
  hasMustTrigger: boolean
} {
  const advanced = detectAdvancedPatterns(message)
  const hasMustTrigger =
    basicResult.confidence === "must" || advanced.some(a => a.confidence === "must")

  return { basic: basicResult, advanced, hasMustTrigger }
}

export { detectAdvancedPatterns } from "./advanced-patterns.js"
