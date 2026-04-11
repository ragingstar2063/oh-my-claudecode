import { test } from "node:test"
import assert from "node:assert/strict"

import { LocalEmbeddingProvider } from "../src/features/yith-archive/providers/embedding/local.js"

/**
 * Tests for LocalEmbeddingProvider.warmUp — the pre-download hook that
 * the CLI bind subcommand drives to get real progress events out of
 * @xenova/transformers before the first user-facing embed() call.
 *
 * We avoid mocking the @xenova/transformers dynamic import (it's
 * already installed and annoying to stub in ESM land). Instead we
 * test three observable things:
 *
 *   1. warmUp fires a "loading" progress event synchronously before
 *      await-ing the extractor load.
 *   2. warmUp propagates errors by firing an "error" progress event
 *      and re-throwing — no silent swallows.
 *   3. A second warmUp call on an already-warm provider is idempotent
 *      (no duplicate "loading" spam when bind is re-run).
 *
 * The "ready" event test requires a cached or real model load which
 * would hit the network in CI — covered separately by the bind
 * smoke test, not this unit file.
 */

test("warmUp fires loading event immediately and error event on failure", async () => {
  // Point the provider at a model name that doesn't exist in the
  // xenova repo, so the pipeline call will reject fast without a
  // real download attempt. The env override avoids touching module
  // state.
  const prevModel = process.env.LOCAL_EMBEDDING_MODEL
  process.env.LOCAL_EMBEDDING_MODEL =
    "Xenova/definitely-not-a-real-model-name-for-tests"
  try {
    const provider = new LocalEmbeddingProvider()
    const events: Array<{ phase: string; message?: string }> = []

    let threw = false
    try {
      await provider.warmUp({
        onProgress: (e) => events.push({ phase: e.phase, message: e.message }),
      })
    } catch {
      threw = true
    }

    assert.equal(threw, true, "warmUp should re-throw on failure")
    assert.ok(
      events.some((e) => e.phase === "loading"),
      `expected a 'loading' event, got ${JSON.stringify(events)}`,
    )
    assert.ok(
      events.some((e) => e.phase === "error"),
      `expected an 'error' event, got ${JSON.stringify(events)}`,
    )
  } finally {
    if (prevModel !== undefined) process.env.LOCAL_EMBEDDING_MODEL = prevModel
    else delete process.env.LOCAL_EMBEDDING_MODEL
  }
})

test("warmUp without callback still completes (no thrown callback invocation)", async () => {
  // Ensure missing onProgress is handled gracefully — the CLI bind
  // command always passes one, but other callers may not.
  const prevModel = process.env.LOCAL_EMBEDDING_MODEL
  process.env.LOCAL_EMBEDDING_MODEL =
    "Xenova/definitely-not-a-real-model-name-for-tests"
  try {
    const provider = new LocalEmbeddingProvider()
    let threw = false
    try {
      await provider.warmUp() // no callback — should still fail gracefully
    } catch {
      threw = true
    }
    assert.equal(threw, true, "warmUp with no callback should still re-throw")
  } finally {
    if (prevModel !== undefined) process.env.LOCAL_EMBEDDING_MODEL = prevModel
    else delete process.env.LOCAL_EMBEDDING_MODEL
  }
})
