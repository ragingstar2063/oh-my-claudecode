const DEBUG = process.env.ELDER_GODS_DEBUG === "1" || process.env.ELDER_GODS_DEBUG === "true"

export function log(message: string, data?: unknown): void {
  if (!DEBUG) return
  const ts = new Date().toISOString()
  if (data !== undefined) {
    console.error(`[oh-my-claudecode ${ts}] ${message}`, JSON.stringify(data, null, 2))
  } else {
    console.error(`[oh-my-claudecode ${ts}] ${message}`)
  }
}

export function warn(message: string, data?: unknown): void {
  const ts = new Date().toISOString()
  if (data !== undefined) {
    console.error(`[oh-my-claudecode WARN ${ts}] ${message}`, JSON.stringify(data, null, 2))
  } else {
    console.error(`[oh-my-claudecode WARN ${ts}] ${message}`)
  }
}
