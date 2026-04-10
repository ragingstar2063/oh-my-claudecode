import type { FakeSdk } from "../state/fake-sdk.js"
import { logger } from "../state/logger.js"
import type {
  CompressedObservation,
  EnrichedChunk,
  MemoryProvider,
} from "../types.js";
import { KV, generateId } from "../state/schema.js";
import type { StateKV } from "../state/kv.js";
import {
  createWorkPacket,
  planLoopBatches,
  type StepInput,
  type StepResult,
  type WorkPacket,
} from "../state/work-packets.js";

const SLIDING_WINDOW_SYSTEM = `You are a contextual enrichment engine. Given a primary observation and its surrounding context window (previous and next observations from the same session), produce an enriched version.

Your tasks:
1. ENTITY RESOLUTION: Replace all pronouns, implicit references ("that framework", "the file", "it", "he/she") with the explicit entity names found in the context window.
2. PREFERENCE MAPPING: Extract any user preferences, constraints, or opinions expressed directly or indirectly.
3. CONTEXT BRIDGES: Add brief contextual links that make this chunk self-contained without reading adjacent chunks.

Output EXACTLY this XML:
<enriched>
  <content>The fully enriched, self-contained text with all references resolved</content>
  <resolved_entities>
    <entity original="pronoun or reference" resolved="explicit entity name"/>
  </resolved_entities>
  <preferences>
    <preference>extracted user preference or constraint</preference>
  </preferences>
  <context_bridges>
    <bridge>contextual link to adjacent information</bridge>
  </context_bridges>
</enriched>

Rules:
- The enriched content MUST be understandable in complete isolation
- Resolve ALL ambiguous references using the context window
- Do not hallucinate entities not present in the window
- Preserve factual accuracy while adding clarity`;

function buildWindowPrompt(
  primary: CompressedObservation,
  before: CompressedObservation[],
  after: CompressedObservation[],
): string {
  const parts: string[] = [];

  if (before.length > 0) {
    parts.push("=== PRECEDING CONTEXT ===");
    for (const obs of before) {
      parts.push(`[${obs.type}] ${obs.title}: ${obs.narrative}`);
      if (obs.facts.length > 0) parts.push(`Facts: ${obs.facts.join("; ")}`);
      if (obs.concepts.length > 0)
        parts.push(`Concepts: ${obs.concepts.join(", ")}`);
    }
  }

  parts.push("\n=== PRIMARY OBSERVATION (enrich this) ===");
  parts.push(`Type: ${primary.type}`);
  parts.push(`Title: ${primary.title}`);
  if (primary.subtitle) parts.push(`Subtitle: ${primary.subtitle}`);
  parts.push(`Narrative: ${primary.narrative}`);
  if (primary.facts.length > 0)
    parts.push(`Facts: ${primary.facts.join("; ")}`);
  if (primary.concepts.length > 0)
    parts.push(`Concepts: ${primary.concepts.join(", ")}`);
  if (primary.files.length > 0)
    parts.push(`Files: ${primary.files.join(", ")}`);

  if (after.length > 0) {
    parts.push("\n=== FOLLOWING CONTEXT ===");
    for (const obs of after) {
      parts.push(`[${obs.type}] ${obs.title}: ${obs.narrative}`);
      if (obs.facts.length > 0) parts.push(`Facts: ${obs.facts.join("; ")}`);
    }
  }

  return parts.join("\n");
}

function parseEnrichedXml(xml: string): {
  content: string;
  resolvedEntities: Record<string, string>;
  preferences: string[];
  contextBridges: string[];
} | null {
  const contentMatch = xml.match(/<content>([\s\S]*?)<\/content>/);
  if (!contentMatch) return null;

  const resolvedEntities: Record<string, string> = {};
  const entityRegex =
    /<entity\s+original="([^"]+)"\s+resolved="([^"]+)"\s*\/>/g;
  let match;
  while ((match = entityRegex.exec(xml)) !== null) {
    resolvedEntities[match[1]] = match[2];
  }

  const preferences: string[] = [];
  const prefRegex = /<preference>([^<]+)<\/preference>/g;
  while ((match = prefRegex.exec(xml)) !== null) {
    preferences.push(match[1]);
  }

  const contextBridges: string[] = [];
  const bridgeRegex = /<bridge>([^<]+)<\/bridge>/g;
  while ((match = bridgeRegex.exec(xml)) !== null) {
    contextBridges.push(match[1]);
  }

  return {
    content: contentMatch[1].trim(),
    resolvedEntities,
    preferences,
    contextBridges,
  };
}

export function registerSlidingWindowFunction(
  sdk: FakeSdk,
  kv: StateKV,
  provider: MemoryProvider,
): void {
  sdk.registerFunction(
    {
      id: "mem::enrich-window",
      description:
        "Enrich observation using sliding window context for self-containment",
    },
    async (data: {
      observationId: string;
      sessionId: string;
      lookback?: number;
      lookahead?: number;
    }) => {
      const hprev = data.lookback ?? 3;
      const hnext = data.lookahead ?? 2;

      const allObs = await kv.list<CompressedObservation>(
        KV.observations(data.sessionId),
      );
      allObs.sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

      const primaryIdx = allObs.findIndex((o) => o.id === data.observationId);
      if (primaryIdx === -1) {
        return { success: false, error: "Observation not found" };
      }

      const primary = allObs[primaryIdx];
      const before = allObs.slice(Math.max(0, primaryIdx - hprev), primaryIdx);
      const after = allObs.slice(primaryIdx + 1, primaryIdx + 1 + hnext);

      if (before.length === 0 && after.length === 0) {
        return {
          success: true,
          enriched: null,
          reason: "No adjacent context available",
        };
      }

      try {
        const prompt = buildWindowPrompt(primary, before, after);
        const response = await provider.compress(
          SLIDING_WINDOW_SYSTEM,
          prompt,
        );
        const parsed = parseEnrichedXml(response);

        if (!parsed) {
          logger.warn("Failed to parse enrichment XML", {
            obsId: data.observationId,
          });
          return { success: false, error: "parse_failed" };
        }

        const enriched: EnrichedChunk = {
          id: generateId("ec"),
          originalObsId: data.observationId,
          sessionId: data.sessionId,
          content: parsed.content,
          resolvedEntities: parsed.resolvedEntities,
          preferences: parsed.preferences,
          contextBridges: parsed.contextBridges,
          windowStart: Math.max(0, primaryIdx - hprev),
          windowEnd: Math.min(allObs.length - 1, primaryIdx + hnext),
          createdAt: new Date().toISOString(),
        };

        await kv.set(
          KV.enrichedChunks(data.sessionId),
          data.observationId,
          enriched,
        );

        logger.info("Observation enriched via sliding window", {
          obsId: data.observationId,
          entitiesResolved: Object.keys(parsed.resolvedEntities).length,
          preferencesFound: parsed.preferences.length,
          bridges: parsed.contextBridges.length,
        });

        return { success: true, enriched };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("Sliding window enrichment failed", { error: msg });
        return { success: false, error: msg };
      }
    },
  );

  sdk.registerFunction(
    {
      id: "mem::enrich-session",
      description: "Enrich all observations in a session using sliding windows",
    },
    async (data: {
      sessionId: string;
      lookback?: number;
      lookahead?: number;
      minImportance?: number;
    }) => {
      const allObs = await kv.list<CompressedObservation>(
        KV.observations(data.sessionId),
      );
      const minImp = data.minImportance ?? 4;
      const toEnrich = allObs.filter((o) => o.importance >= minImp);

      let enriched = 0;
      let failed = 0;

      for (const obs of toEnrich) {
        try {
          const result = (await sdk.trigger("mem::enrich-window", {
            observationId: obs.id,
            sessionId: data.sessionId,
            lookback: data.lookback ?? 3,
            lookahead: data.lookahead ?? 2,
          })) as { success?: boolean } | undefined;
          if (result?.success) enriched++;
          else failed++;
        } catch {
          failed++;
        }
      }

      logger.info("Session enrichment complete", {
        sessionId: data.sessionId,
        total: toEnrich.length,
        enriched,
        failed,
      });

      return { success: true, total: toEnrich.length, enriched, failed };
    },
  );
}

export interface EnrichWindowArgs {
  observationId: string
  sessionId: string
  lookback?: number
  lookahead?: number
}

export interface EnrichWindowStepState {
  originalArgs: EnrichWindowArgs
  windowStart: number
  windowEnd: number
  packetId: string
}

/** Work-packet variant of mem::enrich-window. Single-call 2-state machine. */
export function registerSlidingWindowStepFunction(
  sdk: FakeSdk,
  kv: StateKV,
): void {
  sdk.registerFunction(
    { id: "mem::enrich-window-step" },
    async (
      input: StepInput<EnrichWindowArgs, EnrichWindowStepState>,
    ): Promise<StepResult> => {
      const { step, originalArgs, intermediateState, completions } = input

      if (step === 0) {
        const hprev = originalArgs.lookback ?? 3
        const hnext = originalArgs.lookahead ?? 2

        const allObs = await kv.list<CompressedObservation>(
          KV.observations(originalArgs.sessionId),
        )
        allObs.sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        )

        const primaryIdx = allObs.findIndex(
          (o) => o.id === originalArgs.observationId,
        )
        if (primaryIdx === -1) {
          return {
            done: true,
            result: { success: false, error: "Observation not found" },
          }
        }

        const primary = allObs[primaryIdx]
        const before = allObs.slice(Math.max(0, primaryIdx - hprev), primaryIdx)
        const after = allObs.slice(primaryIdx + 1, primaryIdx + 1 + hnext)

        if (before.length === 0 && after.length === 0) {
          return {
            done: true,
            result: {
              success: true,
              enriched: null,
              reason: "No adjacent context available",
            },
          }
        }

        const prompt = buildWindowPrompt(primary, before, after)
        const packet = createWorkPacket({
          kind: "compress",
          systemPrompt: SLIDING_WINDOW_SYSTEM,
          userPrompt: prompt,
          purpose: `enrich observation ${originalArgs.observationId} with context window`,
        })

        return {
          done: false,
          nextStep: 1,
          intermediateState: {
            originalArgs,
            windowStart: Math.max(0, primaryIdx - hprev),
            windowEnd: Math.min(allObs.length - 1, primaryIdx + hnext),
            packetId: packet.id,
          },
          workPackets: [packet],
          instructions:
            "Run the enrichment prompt through your LLM and commit the " +
            "XML. Single-round flow.",
        }
      }

      if (step === 1) {
        if (!intermediateState) {
          return {
            done: true,
            result: { success: false, error: "missing intermediate state" },
          }
        }
        const response = completions?.[intermediateState.packetId]
        if (!response) {
          return {
            done: true,
            result: {
              success: false,
              error: `no completion for packet ${intermediateState.packetId}`,
            },
          }
        }

        const parsed = parseEnrichedXml(response)
        if (!parsed) {
          logger.warn("Failed to parse enrichment XML (step)", {
            obsId: intermediateState.originalArgs.observationId,
          })
          return {
            done: true,
            result: { success: false, error: "parse_failed" },
          }
        }

        const { observationId, sessionId } = intermediateState.originalArgs
        const enriched: EnrichedChunk = {
          id: generateId("ec"),
          originalObsId: observationId,
          sessionId,
          content: parsed.content,
          resolvedEntities: parsed.resolvedEntities,
          preferences: parsed.preferences,
          contextBridges: parsed.contextBridges,
          windowStart: intermediateState.windowStart,
          windowEnd: intermediateState.windowEnd,
          createdAt: new Date().toISOString(),
        }

        await kv.set(
          KV.enrichedChunks(sessionId),
          observationId,
          enriched,
        )

        return { done: true, result: { success: true, enriched } }
      }

      return {
        done: true,
        result: { success: false, error: `unknown step ${step}` },
      }
    },
  )
}

interface EnrichSessionArgs {
  sessionId: string
  lookback?: number
  lookahead?: number
  minImportance?: number
}

/**
 * Intermediate state for enrich-session-step. Deliberately small:
 * we store observation IDs (short strings) plus the sub-states for
 * the CURRENT batch only, keyed by packet ID for commit-time lookup.
 *
 * Previously this carried full `WorkPacket` records (systemPrompt +
 * userPrompt, KBs each), which got serialized into store.json on
 * every round and bloated persistence. Fresh packets are now built
 * lazily per batch by re-dispatching enrich-window-step(step:0),
 * which is cheap because YithKV is in-memory.
 */
interface EnrichSessionStepState {
  originalArgs: EnrichSessionArgs
  /** Observation IDs still awaiting enrichment, in order. */
  pendingIds: string[]
  /** Sub-states for the batch currently out with the caller. Keyed
   *  by packet ID so step 1 can match completions back to the right
   *  sub-step. Cleared at the start of each new batch. */
  currentBatch: Record<string, EnrichWindowStepState>
  batchSize: number
  totalCount: number
  /** Count of observations where an EnrichedChunk was actually written. */
  enriched: number
  /** Count of observations that succeeded at the sub-step level but
   *  had no work to do (no adjacent context window). Tracked separately
   *  so callers can distinguish "I enriched 10 obs" from "I scanned 10
   *  obs and none needed enrichment." */
  skipped: number
  failed: number
  /** 1-based batch counter for user-facing progress strings only. */
  batchNum: number
}

/**
 * Build and emit the next batch of enrichment packets. Dispatches
 * enrich-window-step(step:0) for each observation dequeued from
 * `pendingIds` until `batchSize` real packets are collected or the
 * queue runs out. Sub-steps that short-circuit (no adjacent context,
 * obs not found) are counted toward enriched/failed directly and
 * don't consume a packet slot.
 *
 * Mutates state in place: appends to currentBatch, drains pendingIds,
 * bumps enriched/failed counters.
 *
 * Returns the WorkPacket array for the batch. Empty array means
 * the queue is drained AND all remaining sub-steps short-circuited —
 * the caller should return terminal.
 */
async function buildEnrichBatch(
  sdk: FakeSdk,
  state: EnrichSessionStepState,
): Promise<WorkPacket[]> {
  const packets: WorkPacket[] = []
  state.currentBatch = {}

  while (packets.length < state.batchSize && state.pendingIds.length > 0) {
    const observationId = state.pendingIds.shift()!
    try {
      const subResult = (await sdk.trigger("mem::enrich-window-step", {
        step: 0,
        originalArgs: {
          observationId,
          sessionId: state.originalArgs.sessionId,
          lookback: state.originalArgs.lookback ?? 3,
          lookahead: state.originalArgs.lookahead ?? 2,
        },
      })) as StepResult

      if (subResult.done) {
        // Terminal at step 0 — either "no adjacent context" (success
        // with enriched:null) or "observation not found" (failure).
        // Neither consumes a packet slot. Count the no-context case
        // as "skipped" rather than "enriched" so the terminal counts
        // don't overstate how much work was actually done.
        const r = subResult.result as {
          success?: boolean
          enriched?: unknown
        }
        if (r?.success) {
          if (r.enriched === null || r.enriched === undefined) {
            state.skipped++
          } else {
            state.enriched++
          }
        } else {
          state.failed++
        }
        continue
      }

      const subState = subResult.intermediateState as EnrichWindowStepState
      const packet = subResult.workPackets[0]
      state.currentBatch[packet.id] = subState
      packets.push(packet)
    } catch {
      state.failed++
    }
  }

  return packets
}

/**
 * Work-packet variant of mem::enrich-session. Nested loop: drains a
 * queue of observation IDs in batches, fanning out to
 * mem::enrich-window-step(step:0) to build each batch's packets on
 * demand, and re-entering it at step 1 with each completion when the
 * batch commits. No packet bodies are persisted between rounds.
 */
export function registerEnrichSessionStepFunction(
  sdk: FakeSdk,
  kv: StateKV,
): void {
  sdk.registerFunction(
    { id: "mem::enrich-session-step" },
    async (
      input: StepInput<EnrichSessionArgs, EnrichSessionStepState>,
    ): Promise<StepResult> => {
      const { step, originalArgs, intermediateState, completions } = input

      if (step === 0) {
        const allObs = await kv.list<CompressedObservation>(
          KV.observations(originalArgs.sessionId),
        )
        const minImp = originalArgs.minImportance ?? 4
        const toEnrich = allObs.filter((o) => o.importance >= minImp)

        if (toEnrich.length === 0) {
          return {
            done: true,
            result: {
              success: true,
              total: 0,
              enriched: 0,
              skipped: 0,
              failed: 0,
            },
          }
        }

        // Count-based batching — ignore bytes because enrich-window
        // prompts are bounded by window size and we want to avoid
        // pre-dispatching every sub-step just to size them.
        const plan = planLoopBatches(toEnrich.length, 0)

        const state: EnrichSessionStepState = {
          originalArgs,
          pendingIds: toEnrich.map((o) => o.id),
          currentBatch: {},
          batchSize: plan.batchSize,
          totalCount: toEnrich.length,
          enriched: 0,
          skipped: 0,
          failed: 0,
          batchNum: 1,
        }

        const firstBatch = await buildEnrichBatch(sdk, state)

        if (firstBatch.length === 0) {
          // Every observation short-circuited — no LLM work needed.
          logger.info("Session enrichment complete (step, zero-packet)", {
            sessionId: originalArgs.sessionId,
            total: state.totalCount,
            enriched: state.enriched,
            failed: state.failed,
          })
          return {
            done: true,
            result: {
              success: true,
              total: state.totalCount,
              enriched: state.enriched,
              skipped: state.skipped,
              failed: state.failed,
            },
          }
        }

        return {
          done: false,
          nextStep: 1,
          intermediateState: state,
          workPackets: firstBatch,
          instructions:
            `Enrich-session loop — batch ${state.batchNum}. ` +
            `Run each of these ${firstBatch.length} enrichment prompts and ` +
            "commit all completions together.",
        }
      }

      if (step === 1) {
        if (!intermediateState) {
          return {
            done: true,
            result: { success: false, error: "missing intermediate state" },
          }
        }

        // Consume the current batch: re-enter enrich-window-step(step:1)
        // with each stored sub-state and its matching completion.
        for (const [packetId, subState] of Object.entries(
          intermediateState.currentBatch,
        )) {
          const completion = completions?.[packetId]
          if (!completion) {
            intermediateState.failed++
            continue
          }
          try {
            const subResult = (await sdk.trigger("mem::enrich-window-step", {
              step: 1,
              originalArgs: subState.originalArgs,
              intermediateState: subState,
              completions: { [packetId]: completion },
            })) as StepResult

            if (subResult.done) {
              const r = subResult.result as { success?: boolean }
              if (r?.success) intermediateState.enriched++
              else intermediateState.failed++
            } else {
              // enrich-window-step should always terminate at step 1.
              intermediateState.failed++
            }
          } catch {
            intermediateState.failed++
          }
        }
        intermediateState.currentBatch = {}

        // Try to build the next batch.
        if (intermediateState.pendingIds.length === 0) {
          logger.info("Session enrichment complete (step)", {
            sessionId: intermediateState.originalArgs.sessionId,
            total: intermediateState.totalCount,
            enriched: intermediateState.enriched,
            failed: intermediateState.failed,
          })
          return {
            done: true,
            result: {
              success: true,
              total: intermediateState.totalCount,
              enriched: intermediateState.enriched,
              skipped: intermediateState.skipped,
              failed: intermediateState.failed,
            },
          }
        }

        intermediateState.batchNum++
        const nextPackets = await buildEnrichBatch(sdk, intermediateState)

        if (nextPackets.length === 0) {
          // Remaining queue all short-circuited — nothing more to ask
          // the caller for; return terminal.
          logger.info("Session enrichment complete (step, short-circuit tail)", {
            sessionId: intermediateState.originalArgs.sessionId,
            total: intermediateState.totalCount,
            enriched: intermediateState.enriched,
            failed: intermediateState.failed,
          })
          return {
            done: true,
            result: {
              success: true,
              total: intermediateState.totalCount,
              enriched: intermediateState.enriched,
              skipped: intermediateState.skipped,
              failed: intermediateState.failed,
            },
          }
        }

        return {
          done: false,
          nextStep: 1,
          intermediateState,
          workPackets: nextPackets,
          instructions:
            `Enrich-session loop — batch ${intermediateState.batchNum}. ` +
            `Run these ${nextPackets.length} enrichment prompts.`,
        }
      }

      return {
        done: true,
        result: { success: false, error: `unknown step ${step}` },
      }
    },
  )
}
