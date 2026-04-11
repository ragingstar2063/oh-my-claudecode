import { test } from "node:test"
import assert from "node:assert/strict"

import {
  buildPreflightSection,
  type PreflightInput,
} from "../src/hooks/cthulhu-preflight.js"

/**
 * Tests for buildPreflightSection — the pure function that takes a
 * snapshot of bind state + pending-compression counts and returns
 * the preflight text block the cthulhu-auto hook injects into the
 * session prompt.
 *
 * Keeping this separate from the shell-script generation lets us
 * exercise every branch without spawning a shell or running jq.
 */

test("preflight reports 'bound and ready' when every phase is complete and nothing is pending", () => {
  const input: PreflightInput = {
    bindStateExists: true,
    allPhasesComplete: true,
    pendingCompressionCount: 0,
    failedPhases: [],
  }
  const out = buildPreflightSection(input)
  assert.match(out, /bound/i)
  assert.ok(!out.includes("/necronomicon-bind"), "no prompt to re-bind")
  assert.ok(
    !out.match(/pending compression/i),
    "no compression nag when count is 0",
  )
})

test("preflight tells user to run /necronomicon-bind when bindState is missing", () => {
  const out = buildPreflightSection({
    bindStateExists: false,
    allPhasesComplete: false,
    pendingCompressionCount: 0,
    failedPhases: [],
  })
  assert.match(out, /\/necronomicon-bind/)
  assert.match(out, /not been bound/i)
})

test("preflight surfaces pending-compression count with next-step instructions", () => {
  const out = buildPreflightSection({
    bindStateExists: true,
    allPhasesComplete: true,
    pendingCompressionCount: 342,
    failedPhases: [],
  })
  assert.match(out, /342/)
  assert.match(out, /compress/i)
  // Should tell Claude how to drain the queue.
  assert.match(out, /mem::compress-batch-step|yith_trigger/)
})

test("preflight flags failed phases so the user knows about retryable errors", () => {
  const out = buildPreflightSection({
    bindStateExists: true,
    allPhasesComplete: false,
    pendingCompressionCount: 0,
    failedPhases: ["opencode_import", "sisyphus_migrate"],
  })
  assert.match(out, /opencode_import/)
  assert.match(out, /sisyphus_migrate/)
  assert.match(out, /failed/i)
  // Suggest retry path.
  assert.match(out, /\/necronomicon-bind|bind --resume/)
})

test("preflight includes progress hint when phases are in progress", () => {
  const out = buildPreflightSection({
    bindStateExists: true,
    allPhasesComplete: false,
    pendingCompressionCount: 0,
    failedPhases: [],
    pendingPhases: ["opencode_import", "sisyphus_migrate"],
  })
  // Should mention that binding is partial
  assert.match(out, /partial|in progress|pending/i)
})
