import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "node:fs"
import { dirname } from "node:path"

/**
 * YithKV — file-backed in-process key/value store for the Yith Archive.
 *
 * Scopes partition the keyspace (e.g. "memories", "observations", "lessons").
 * Data is persisted lazily via persist(); call it after mutation batches
 * or from a shutdown handler.
 *
 * Shape-compatible with the old StateKV wrapper so function modules that
 * accept `kv: StateKV` still work after a type rename.
 */
export class YithKV {
  private store = new Map<string, Map<string, unknown>>()

  constructor(private persistPath?: string) {
    if (persistPath && existsSync(persistPath)) {
      try {
        const data = JSON.parse(readFileSync(persistPath, "utf-8"))
        for (const [scope, entries] of Object.entries(data)) {
          const map = new Map<string, unknown>()
          for (const [key, value] of Object.entries(
            entries as Record<string, unknown>,
          )) {
            map.set(key, value)
          }
          this.store.set(scope, map)
        }
      } catch (err) {
        // store.json exists but couldn't be parsed — almost certainly means
        // a previous process was killed mid-write back when persist() wasn't
        // atomic. Announce loudly on stderr so the user knows they lost data
        // rather than silently starting fresh; atomic writes (below) should
        // prevent this from ever happening again.
        process.stderr.write(
          `[yith] WARNING: persist file ${persistPath} could not be parsed ` +
            `(${err instanceof Error ? err.message : String(err)}) — ` +
            `starting with empty archive. Previous data is preserved at ` +
            `${persistPath} — inspect manually or delete to silence this.\n`,
        )
      }
    }
  }

  async get<T = unknown>(scope: string, key: string): Promise<T | null> {
    return (this.store.get(scope)?.get(key) as T) ?? null
  }

  async set<T = unknown>(scope: string, key: string, data: T): Promise<T> {
    if (!this.store.has(scope)) this.store.set(scope, new Map())
    this.store.get(scope)!.set(key, data)
    return data
  }

  async delete(scope: string, key: string): Promise<void> {
    this.store.get(scope)?.delete(key)
  }

  async list<T = unknown>(scope: string): Promise<T[]> {
    const entries = this.store.get(scope)
    return entries ? (Array.from(entries.values()) as T[]) : []
  }

  /**
   * Persist the full store to disk synchronously. Atomic: writes to a tmp
   * file, then renames into place. POSIX rename(2) on the same filesystem
   * is guaranteed atomic, so a crash mid-write leaves either the old file
   * intact or the new file complete — never a partial write.
   *
   * Call from shutdown or on a timer. Safe to call concurrently with
   * itself (last call wins; earlier tmp files get cleaned up by rename).
   */
  persist(): void {
    if (!this.persistPath) return
    const tmpPath = `${this.persistPath}.tmp`
    try {
      const dir = dirname(this.persistPath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const data: Record<string, Record<string, unknown>> = {}
      for (const [scope, entries] of this.store) {
        data[scope] = Object.fromEntries(entries)
      }
      writeFileSync(tmpPath, JSON.stringify(data), "utf-8")
      renameSync(tmpPath, this.persistPath)
    } catch (err) {
      // Best-effort cleanup of the tmp file if the write succeeded but the
      // rename failed; avoids leaving orphaned .tmp files around the data dir.
      if (existsSync(tmpPath)) {
        try {
          unlinkSync(tmpPath)
        } catch {
          /* swallow — the tmp file isn't critical */
        }
      }
      process.stderr.write(
        `[yith] Persist failed: ${err instanceof Error ? err.message : String(err)}\n`,
      )
    }
  }
}

/** Backwards-compat alias for modules that still reference StateKV by name. */
export { YithKV as StateKV }
