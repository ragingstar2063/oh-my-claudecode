/**
 * FakeSdk — minimal in-process replacement for the iii-sdk bus that agentmemory
 * was originally written against.
 *
 * The original architecture registered named handlers (via `sdk.registerFunction`)
 * and dispatched between them over a client-server bus. We don't need any of
 * that — yith-archive runs in the same Node process as oh-my-claudecode. This
 * class stores handlers in a local Map and dispatches direct in-memory calls.
 *
 * Unknown trigger names silently no-op for `triggerVoid` (e.g. `stream::set`
 * calls that used to feed the original project's web viewer) so stale plumbing
 * doesn't crash live code paths.
 */

type Handler = (data: any) => Promise<any> | any

export interface FunctionDef {
  id: string
  [key: string]: unknown
}

export interface TriggerDef {
  type?: string
  function_id?: string
  config?: Record<string, unknown>
  [key: string]: unknown
}

export class FakeSdk {
  private functions = new Map<string, Handler>()

  registerFunction(def: FunctionDef, handler: Handler): void {
    this.functions.set(def.id, handler)
  }

  /** Trigger definitions are no-ops in-process — there is no queue to bind to. */
  registerTrigger(_def: TriggerDef): void {
    // intentionally empty
  }

  async trigger<Data = unknown, Result = unknown>(
    id: string,
    data: Data,
  ): Promise<Result> {
    const fn = this.functions.get(id)
    if (!fn) {
      throw new Error(`[yith] No handler registered for "${id}"`)
    }
    return (await fn(data)) as Result
  }

  /**
   * Fire-and-forget variant. Unknown IDs silently return — used for stream/debug
   * endpoints that only exist in the original hosted variant of this codebase.
   */
  triggerVoid<Data = unknown>(id: string, data: Data): void {
    const fn = this.functions.get(id)
    if (!fn) return
    try {
      const result = fn(data)
      if (result && typeof (result as Promise<unknown>).catch === "function") {
        ;(result as Promise<unknown>).catch(() => {
          // swallow — fire-and-forget
        })
      }
    } catch {
      // swallow — fire-and-forget
    }
  }

  async shutdown(): Promise<void> {
    this.functions.clear()
  }

  /** Convenience for tests/debug: list registered handler IDs. */
  listFunctions(): string[] {
    return Array.from(this.functions.keys())
  }
}

/** Factory — for symmetry with the original `init()` entry point. */
export function createFakeSdk(): FakeSdk {
  return new FakeSdk()
}
