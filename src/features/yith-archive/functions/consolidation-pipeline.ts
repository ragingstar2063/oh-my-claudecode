import type { FakeSdk } from "../state/fake-sdk.js"
import { logger } from "../state/logger.js"
import type {
  SemanticMemory,
  ProceduralMemory,
  SessionSummary,
  Memory,
  MemoryProvider,
} from "../types.js";
import { KV, generateId } from "../state/schema.js";
import type { StateKV } from "../state/kv.js";
import {
  SEMANTIC_MERGE_SYSTEM,
  buildSemanticMergePrompt,
  PROCEDURAL_EXTRACTION_SYSTEM,
  buildProceduralExtractionPrompt,
} from "../prompts/consolidation.js";
import { recordAudit } from "./audit.js";
import { getConsolidationDecayDays, isConsolidationEnabled } from "../config.js";
import {
  createWorkPacket,
  type StepInput,
  type StepResult,
} from "../state/work-packets.js";

function applyDecay(
  items: Array<{
    strength: number;
    lastAccessedAt?: string;
    updatedAt: string;
  }>,
  decayDays: number,
): void {
  if (decayDays <= 0 || !Number.isFinite(decayDays)) return;
  const now = Date.now();
  for (const item of items) {
    const lastAccess = item.lastAccessedAt || item.updatedAt;
    const daysSince =
      (now - new Date(lastAccess).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > decayDays) {
      const decayPeriods = Math.floor(daysSince / decayDays);
      item.strength = Math.max(
        0.1,
        item.strength * Math.pow(0.9, decayPeriods),
      );
    }
  }
}

export function registerConsolidationPipelineFunction(
  sdk: FakeSdk,
  kv: StateKV,
  provider: MemoryProvider,
): void {
  sdk.registerFunction(
    { id: "mem::consolidate-pipeline" },
    async (data?: { tier?: string; force?: boolean; project?: string }) => {
      if (!data?.force && !isConsolidationEnabled()) {
        return { success: false, skipped: true, reason: "CONSOLIDATION_ENABLED is not set to true" };
      }
      const tier = data?.tier || "all";
      const decayDays = getConsolidationDecayDays();
      const results: Record<string, unknown> = {};

      if (tier === "all" || tier === "semantic") {
        const summaries = await kv.list<SessionSummary>(KV.summaries);
        const existingSemantic = await kv.list<SemanticMemory>(KV.semantic);

        if (summaries.length >= 5) {
          const recentSummaries = summaries
            .sort(
              (a, b) =>
                new Date(b.createdAt).getTime() -
                new Date(a.createdAt).getTime(),
            )
            .slice(0, 20);

          const prompt = buildSemanticMergePrompt(
            recentSummaries.map((s) => ({
              title: s.title,
              narrative: s.narrative,
              concepts: s.concepts,
            })),
          );

          try {
            const response = await provider.summarize(
              SEMANTIC_MERGE_SYSTEM,
              prompt,
            );

            const factRegex = /<fact\s+confidence="([^"]+)">([^<]+)<\/fact>/g;
            let match;
            let newFacts = 0;
            const now = new Date().toISOString();

            while ((match = factRegex.exec(response)) !== null) {
              const parsedConf = parseFloat(match[1]);
              const confidence = Number.isNaN(parsedConf) ? 0.5 : parsedConf;
              const fact = match[2].trim();

              const existing = existingSemantic.find(
                (s) => s.fact.toLowerCase() === fact.toLowerCase(),
              );
              if (existing) {
                existing.accessCount++;
                existing.lastAccessedAt = now;
                existing.updatedAt = now;
                existing.confidence = Math.max(existing.confidence, confidence);
                await kv.set(KV.semantic, existing.id, existing);
              } else {
                const sem: SemanticMemory = {
                  id: generateId("sem"),
                  fact,
                  confidence,
                  sourceSessionIds: recentSummaries.map((s) => s.sessionId),
                  sourceMemoryIds: [],
                  accessCount: 1,
                  lastAccessedAt: now,
                  strength: confidence,
                  createdAt: now,
                  updatedAt: now,
                };
                await kv.set(KV.semantic, sem.id, sem);
                newFacts++;
              }
            }
            results.semantic = { newFacts, totalSummaries: summaries.length };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error("Semantic consolidation failed", { error: msg });
            results.semantic = { error: msg };
          }
        } else {
          results.semantic = {
            skipped: true,
            reason: "fewer than 5 summaries",
          };
        }
      }

      if (tier === "all" || tier === "reflect") {
        try {
          const reflectResult = await sdk.trigger("mem::reflect", {
            maxClusters: 10,
            project: data?.project,
          });
          results.reflect = reflectResult;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn("Reflect tier failed", { error: msg });
          results.reflect = { error: msg };
        }
      }

      if (tier === "all" || tier === "procedural") {
        const memories = await kv.list<Memory>(KV.memories);
        const patterns = memories
          .filter((m) => m.isLatest && m.type === "pattern")
          .map((m) => ({
            content: m.content,
            frequency: m.sessionIds.length || 1,
          }))
          .filter((p) => p.frequency >= 2);

        if (patterns.length >= 2) {
          const prompt = buildProceduralExtractionPrompt(patterns);

          try {
            const response = await provider.summarize(
              PROCEDURAL_EXTRACTION_SYSTEM,
              prompt,
            );

            const procRegex =
              /<procedure\s+name="([^"]+)"\s+trigger="([^"]+)">([\s\S]*?)<\/procedure>/g;
            let match;
            let newProcs = 0;
            const now = new Date().toISOString();
            const existingProcs = await kv.list<ProceduralMemory>(
              KV.procedural,
            );

            while ((match = procRegex.exec(response)) !== null) {
              const name = match[1];
              const trigger = match[2];
              const stepsBlock = match[3];
              const steps: string[] = [];

              const stepRegex = /<step>([^<]+)<\/step>/g;
              let stepMatch;
              while ((stepMatch = stepRegex.exec(stepsBlock)) !== null) {
                steps.push(stepMatch[1].trim());
              }

              const existing = existingProcs.find(
                (p) => p.name.toLowerCase() === name.toLowerCase(),
              );
              if (existing) {
                existing.frequency++;
                existing.updatedAt = now;
                existing.strength = Math.min(1, existing.strength + 0.1);
                await kv.set(KV.procedural, existing.id, existing);
              } else {
                const proc: ProceduralMemory = {
                  id: generateId("proc"),
                  name,
                  steps,
                  triggerCondition: trigger,
                  frequency: 1,
                  sourceSessionIds: [],
                  strength: 0.5,
                  createdAt: now,
                  updatedAt: now,
                };
                await kv.set(KV.procedural, proc.id, proc);
                newProcs++;
              }
            }
            results.procedural = {
              newProcedures: newProcs,
              patternsAnalyzed: patterns.length,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error("Procedural extraction failed", { error: msg });
            results.procedural = { error: msg };
          }
        } else {
          results.procedural = {
            skipped: true,
            reason: "fewer than 2 recurring patterns",
          };
        }
      }

      if (tier === "all" || tier === "decay") {
        const semantic = await kv.list<SemanticMemory>(KV.semantic);
        applyDecay(semantic, decayDays);
        for (const s of semantic) {
          await kv.set(KV.semantic, s.id, s);
        }

        const procedural = await kv.list<ProceduralMemory>(KV.procedural);
        applyDecay(procedural, decayDays);
        for (const p of procedural) {
          await kv.set(KV.procedural, p.id, p);
        }

        results.decay = {
          semantic: semantic.length,
          procedural: procedural.length,
        };
      }

      if (process.env["OBSIDIAN_AUTO_EXPORT"] === "true") {
        try {
          await sdk.trigger("mem::obsidian-export", {});
          results.obsidianExport = { success: true };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn("Obsidian auto-export failed", { error: msg });
          results.obsidianExport = { success: false, error: msg };
        }
      }

      await recordAudit(kv, "consolidate", "mem::consolidate-pipeline", [], {
        tier,
        results,
      });

      logger.info("Consolidation pipeline complete", { tier, results });
      return { success: true, results };
    },
  );
}

/**
 * Arguments for both mem::consolidate-pipeline and mem::consolidate-pipeline-step.
 */
interface ConsolidationPipelineArgs {
  tier?: string
  force?: boolean
  project?: string
}

/**
 * Intermediate state for the consolidate-pipeline state machine.
 *
 * The flow has up to two LLM round-trips (semantic merge, then procedural
 * extraction). Each is conditionally gated, so the step count is not fixed
 * — state 0 may go directly to state 2 if the semantic tier is skipped,
 * or terminate immediately if both tiers are skipped. The phase field
 * names which completion we're currently awaiting; packet IDs are stored
 * so state N can pull the matching completion out of the completions map.
 */
interface ConsolidationPipelineStepState {
  originalArgs: ConsolidationPipelineArgs
  tier: string
  decayDays: number
  /** Accumulated per-tier results. Grows as each state completes.
   *  Contents match the direct function's `results` object shape so
   *  both variants produce indistinguishable terminal values. */
  results: Record<string, unknown>
  /** Session IDs of the summaries the semantic prompt was built from —
   *  needed to record provenance on new SemanticMemory entries. */
  semanticSourceSessionIds?: string[]
  /** Packet whose completion state 1 is waiting on. */
  semanticPacketId?: string
  /**
   * Sub-state machine bookkeeping for the nested mem::reflect-step flow.
   * Populated when state 2 dispatches reflect-step, cleared once reflect
   * reaches its terminal. The pipeline doesn't interpret the inner state —
   * it just round-trips it through commits.
   */
  reflectSub?: {
    originalArgs: { maxClusters?: number; project?: string }
    nextStep: number
    state: unknown
  }
  /** Packet whose completion state 3 is waiting on. */
  proceduralPacketId?: string
  /** Count of recurring patterns the procedural prompt was built from —
   *  used by parseAndWriteProcedural to populate results.procedural
   *  without muddying the results object with a transient field. */
  proceduralPatternsAnalyzed?: number
  /** Count of session summaries the semantic prompt was built from —
   *  same role as proceduralPatternsAnalyzed but for the semantic tier.
   *  Kept off results.* so error paths don't leak a transient field
   *  into the user-visible terminal value. */
  semanticTotalSummaries?: number
}

/**
 * State-machine variant of mem::consolidate-pipeline for the work-packet
 * protocol. The full pipeline is a multi-phase state machine:
 *
 *   Step 0: gate checks, load summaries, emit semantic packet (→ 1),
 *           or skip to reflect / procedural / terminal if no LLM work.
 *   Step 1: consume semantic completion, write semantic memories, then
 *           advance into the nested reflect sub-machine (→ 2) or past it.
 *   Step 2: reflect loop. Consumes completions for the nested
 *           mem::reflect-step sub-state, re-dispatches it, and either
 *           emits reflect's next batch (stays on 2) or advances past
 *           reflect once it terminates.
 *   Step 3: consume procedural completion, write procedural memories,
 *           finalize and return terminal.
 *
 * Reflect runs between semantic and procedural — matching the direct
 * function's ordering — so it sees freshly-written semantic facts. If
 * reflect has no clusters or its own gate fails, it terminates at its
 * own step 0 and the pipeline advances directly to procedural.
 */
export function registerConsolidationPipelineStepFunction(
  sdk: FakeSdk,
  kv: StateKV,
): void {
  sdk.registerFunction(
    { id: "mem::consolidate-pipeline-step" },
    async (
      input: StepInput<
        ConsolidationPipelineArgs,
        ConsolidationPipelineStepState
      >,
    ): Promise<StepResult> => {
      const { step, originalArgs, intermediateState, completions } = input

      if (step === 0) {
        if (!originalArgs.force && !isConsolidationEnabled()) {
          return {
            done: true,
            result: {
              success: false,
              skipped: true,
              reason: "CONSOLIDATION_ENABLED is not set to true",
            },
          }
        }

        const tier = originalArgs.tier || "all"
        const decayDays = getConsolidationDecayDays()
        const state: ConsolidationPipelineStepState = {
          originalArgs,
          tier,
          decayDays,
          results: {},
        }

        // Try to emit the semantic packet first.
        if (tier === "all" || tier === "semantic") {
          const summaries = await kv.list<SessionSummary>(KV.summaries)
          if (summaries.length >= 5) {
            const recentSummaries = summaries
              .sort(
                (a, b) =>
                  new Date(b.createdAt).getTime() -
                  new Date(a.createdAt).getTime(),
              )
              .slice(0, 20)

            const prompt = buildSemanticMergePrompt(
              recentSummaries.map((s) => ({
                title: s.title,
                narrative: s.narrative,
                concepts: s.concepts,
              })),
            )

            const packet = createWorkPacket({
              kind: "summarize",
              systemPrompt: SEMANTIC_MERGE_SYSTEM,
              userPrompt: prompt,
              purpose: `consolidate-pipeline: merge ${recentSummaries.length} session summaries into semantic facts`,
            })
            state.semanticSourceSessionIds = recentSummaries.map(
              (s) => s.sessionId,
            )
            state.semanticPacketId = packet.id
            state.semanticTotalSummaries = summaries.length

            return {
              done: false,
              nextStep: 1,
              intermediateState: state,
              workPackets: [packet],
              instructions:
                "First of up to two rounds for consolidate-pipeline. Run the " +
                "semantic-merge prompt through your LLM, commit the result, " +
                "and expect either a terminal success OR another " +
                "needs_llm_work response for the procedural extraction round.",
            }
          }
          state.results.semantic = {
            skipped: true,
            reason: "fewer than 5 summaries",
          }
        }

        // Semantic was skipped (or not in scope). Advance into the
        // reflect phase next; if reflect terminates immediately, fall
        // through to procedural / finalize.
        return await advanceAfterSemantic(sdk, kv, state)
      }

      if (step === 1) {
        if (!intermediateState) {
          return {
            done: true,
            result: {
              success: false,
              error:
                "consolidate-pipeline-step: missing intermediate state for step 1",
            },
          }
        }
        const packetId = intermediateState.semanticPacketId
        if (!packetId) {
          return {
            done: true,
            result: {
              success: false,
              error:
                "consolidate-pipeline-step: no semanticPacketId in state at step 1",
            },
          }
        }
        const completion = completions?.[packetId]
        if (!completion) {
          return {
            done: true,
            result: {
              success: false,
              error: `consolidate-pipeline-step: no completion for packet ${packetId}`,
            },
          }
        }

        // Parse + write semantic memories.
        const existingSemantic = await kv.list<SemanticMemory>(KV.semantic)
        const factRegex = /<fact\s+confidence="([^"]+)">([^<]+)<\/fact>/g
        let match
        let newFacts = 0
        const now = new Date().toISOString()
        const sourceSessionIds =
          intermediateState.semanticSourceSessionIds ?? []

        while ((match = factRegex.exec(completion)) !== null) {
          const parsedConf = parseFloat(match[1])
          const confidence = Number.isNaN(parsedConf) ? 0.5 : parsedConf
          const fact = match[2].trim()

          const existing = existingSemantic.find(
            (s) => s.fact.toLowerCase() === fact.toLowerCase(),
          )
          if (existing) {
            existing.accessCount++
            existing.lastAccessedAt = now
            existing.updatedAt = now
            existing.confidence = Math.max(existing.confidence, confidence)
            await kv.set(KV.semantic, existing.id, existing)
          } else {
            const sem: SemanticMemory = {
              id: generateId("sem"),
              fact,
              confidence,
              sourceSessionIds,
              sourceMemoryIds: [],
              accessCount: 1,
              lastAccessedAt: now,
              strength: confidence,
              createdAt: now,
              updatedAt: now,
            }
            await kv.set(KV.semantic, sem.id, sem)
            newFacts++
          }
        }
        intermediateState.results.semantic = {
          newFacts,
          totalSummaries: intermediateState.semanticTotalSummaries,
        }
        intermediateState.semanticTotalSummaries = undefined
        // Packet consumed — clear the ID so a stale commit retry can't
        // re-enter the parse path.
        intermediateState.semanticPacketId = undefined

        // Semantic writes are in KV. Advance into reflect.
        return await advanceAfterSemantic(sdk, kv, intermediateState)
      }

      if (step === 2) {
        // Reflect loop. We always enter here with completions for the
        // reflect sub-state's current round.
        if (!intermediateState || !intermediateState.reflectSub) {
          return {
            done: true,
            result: {
              success: false,
              error:
                "consolidate-pipeline-step: missing reflectSub at step 2",
            },
          }
        }

        const sub = intermediateState.reflectSub
        // Wrap the sub-trigger in try/catch so a reflect-step throw
        // doesn't leak to the caller with unresolved pending state.
        // The direct pipeline treats reflect failures as soft errors —
        // record the failure into results.reflect and advance. Matches
        // the parity spec in plans/yith-work-packet-protocol.md.
        //
        // Treats both throws AND contract violations (malformed
        // StepResult shape) as soft errors. The sub-result could in
        // principle be missing workPackets/nextStep/intermediateState
        // if reflect-step is ever changed incorrectly; rather than
        // trust the type declaration, we validate defensively here.
        let subResult: StepResult
        try {
          subResult = (await sdk.trigger("mem::reflect-step", {
            step: sub.nextStep,
            originalArgs: sub.originalArgs,
            intermediateState: sub.state,
            completions,
          })) as StepResult
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          logger.warn("Reflect sub-step failed mid-loop, skipping reflect tier", { error: msg })
          intermediateState.results.reflect = { error: msg }
          intermediateState.reflectSub = undefined
          return await advancePastReflect(sdk, kv, intermediateState)
        }

        if (!subResult.done) {
          // Defensive shape validation on the non-terminal branch.
          // A malformed subResult (missing workPackets array or
          // missing nextStep) would crash later — recover by treating
          // it as a soft failure.
          if (
            !Array.isArray(subResult.workPackets) ||
            subResult.workPackets.length === 0 ||
            typeof subResult.nextStep !== "number"
          ) {
            logger.warn(
              "Reflect sub-step returned malformed non-terminal StepResult, skipping reflect tier",
            )
            intermediateState.results.reflect = {
              error: "malformed non-terminal sub-result",
            }
            intermediateState.reflectSub = undefined
            return await advancePastReflect(sdk, kv, intermediateState)
          }
          // Reflect has more batches — emit them and stay on step 2.
          intermediateState.reflectSub = {
            originalArgs: sub.originalArgs,
            nextStep: subResult.nextStep,
            state: subResult.intermediateState,
          }
          return {
            done: false,
            nextStep: 2,
            intermediateState,
            workPackets: subResult.workPackets,
            instructions:
              "Nested reflect — another cluster batch. " +
              (subResult.instructions ?? ""),
          }
        }

        // Reflect terminated. Record its result and advance to procedural.
        intermediateState.results.reflect = subResult.result
        intermediateState.reflectSub = undefined
        return await advancePastReflect(sdk, kv, intermediateState)
      }

      if (step === 3) {
        if (!intermediateState) {
          return {
            done: true,
            result: {
              success: false,
              error:
                "consolidate-pipeline-step: missing intermediate state for step 2",
            },
          }
        }
        const packetId = intermediateState.proceduralPacketId
        if (!packetId) {
          return {
            done: true,
            result: {
              success: false,
              error:
                "consolidate-pipeline-step: no proceduralPacketId in state at step 2",
            },
          }
        }
        const completion = completions?.[packetId]
        if (!completion) {
          return {
            done: true,
            result: {
              success: false,
              error: `consolidate-pipeline-step: no completion for packet ${packetId}`,
            },
          }
        }

        await parseAndWriteProcedural(kv, intermediateState, completion)
        intermediateState.proceduralPacketId = undefined

        await runFinalizeTail(sdk, kv, intermediateState)
        return {
          done: true,
          result: { success: true, results: intermediateState.results },
        }
      }

      return {
        done: true,
        result: {
          success: false,
          error: `consolidate-pipeline-step: unknown step ${step}`,
        },
      }
    },
  )
}

/**
 * Called after semantic handling completes (either state 0 skipped
 * semantic, or state 1 consumed and wrote the semantic completion).
 * Tries to start the reflect sub-machine. If reflect has work to do,
 * returns a non-terminal StepResult advancing to pipeline state 2
 * with reflect's first batch of packets. If reflect terminates
 * immediately (no clusters) or throws, records its result and falls
 * through to the procedural phase via advancePastReflect.
 */
async function advanceAfterSemantic(
  sdk: FakeSdk,
  kv: StateKV,
  state: ConsolidationPipelineStepState,
): Promise<StepResult> {
  if (state.tier !== "all" && state.tier !== "reflect") {
    // Reflect not in scope — jump straight past it.
    return await advancePastReflect(sdk, kv, state)
  }

  const reflectArgs = {
    maxClusters: 10,
    project: state.originalArgs.project,
  }

  // Wrap the initial reflect dispatch in try/catch. Reflect is a best-
  // effort tier — if its sub-step throws (e.g. KV list failure), we
  // record the error and continue to procedural rather than leaking
  // the exception up to yith_commit_work.
  let subResult: StepResult
  try {
    subResult = (await sdk.trigger("mem::reflect-step", {
      step: 0,
      originalArgs: reflectArgs,
    })) as StepResult
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn("Reflect sub-step failed at entry, skipping reflect tier", { error: msg })
    state.results.reflect = { error: msg }
    return await advancePastReflect(sdk, kv, state)
  }

  if (subResult.done) {
    // Reflect had nothing to do (no clusters, or all skipped). Record
    // its terminal result and move on to procedural.
    state.results.reflect = subResult.result
    return await advancePastReflect(sdk, kv, state)
  }

  // Defensive shape check — same rationale as state 2 (see comment
  // there). Malformed non-terminal sub-result → soft error + advance.
  if (
    !Array.isArray(subResult.workPackets) ||
    subResult.workPackets.length === 0 ||
    typeof subResult.nextStep !== "number"
  ) {
    logger.warn(
      "Reflect sub-step returned malformed non-terminal StepResult at entry, skipping reflect tier",
    )
    state.results.reflect = {
      error: "malformed non-terminal sub-result",
    }
    return await advancePastReflect(sdk, kv, state)
  }

  // Reflect has packets — advance to pipeline state 2 with reflect's
  // sub-state stashed away for the commit round-trip.
  state.reflectSub = {
    originalArgs: reflectArgs,
    nextStep: subResult.nextStep,
    state: subResult.intermediateState,
  }
  return {
    done: false,
    nextStep: 2,
    intermediateState: state,
    workPackets: subResult.workPackets,
    instructions:
      "Nested reflect — " +
      (subResult.instructions ??
        "run each cluster prompt and commit the insights together."),
  }
}

/**
 * Called after reflect finishes (either skipped entirely or its
 * terminal state reached via state 2). Tries to emit the procedural
 * packet. If procedural is out of scope or its gate fails, runs the
 * finalize tail and returns a terminal StepResult.
 *
 * sdk is threaded through so the terminal finalize path can run the
 * Obsidian auto-export step — omitting it would silently drop the
 * export side effect on any run where procedural is skipped.
 */
async function advancePastReflect(
  sdk: FakeSdk,
  kv: StateKV,
  state: ConsolidationPipelineStepState,
): Promise<StepResult> {
  if (state.tier !== "all" && state.tier !== "procedural") {
    return await finalizeTerminal(sdk, kv, state)
  }

  const memories = await kv.list<Memory>(KV.memories)
  const patterns = memories
    .filter((m) => m.isLatest && m.type === "pattern")
    .map((m) => ({
      content: m.content,
      frequency: m.sessionIds.length || 1,
    }))
    .filter((p) => p.frequency >= 2)

  if (patterns.length < 2) {
    state.results.procedural = {
      skipped: true,
      reason: "fewer than 2 recurring patterns",
    }
    return await finalizeTerminal(sdk, kv, state)
  }

  const prompt = buildProceduralExtractionPrompt(patterns)
  const packet = createWorkPacket({
    kind: "summarize",
    systemPrompt: PROCEDURAL_EXTRACTION_SYSTEM,
    userPrompt: prompt,
    purpose: `consolidate-pipeline: extract procedures from ${patterns.length} recurring patterns`,
  })
  state.proceduralPacketId = packet.id
  state.proceduralPatternsAnalyzed = patterns.length

  return {
    done: false,
    nextStep: 3,
    intermediateState: state,
    workPackets: [packet],
    instructions:
      "Run the procedural-extraction prompt through your LLM and commit " +
      "the result. This is the final round — the next response will be " +
      "terminal.",
  }
}

/**
 * Run the finalize tail and return a terminal StepResult. Used by
 * every non-state-3 terminal path (when the pipeline completes without
 * running a procedural packet). Delegates to runFinalizeTail so the
 * same tail logic (decay + audit + obsidian export) runs regardless
 * of which terminal branch ships — no silently dropped side effects.
 */
async function finalizeTerminal(
  sdk: FakeSdk,
  kv: StateKV,
  state: ConsolidationPipelineStepState,
): Promise<StepResult> {
  await runFinalizeTail(sdk, kv, state)
  return {
    done: true,
    result: { success: true, results: state.results },
  }
}

/** Apply decay to semantic + procedural memories in place. Extracted so
 *  both finalizeTerminal() and runFinalizeTail() can call it. */
async function applyDecayTier(
  kv: StateKV,
  decayDays: number,
  results: Record<string, unknown>,
): Promise<void> {
  const semantic = await kv.list<SemanticMemory>(KV.semantic)
  applyDecay(semantic, decayDays)
  for (const s of semantic) {
    await kv.set(KV.semantic, s.id, s)
  }
  const procedural = await kv.list<ProceduralMemory>(KV.procedural)
  applyDecay(procedural, decayDays)
  for (const p of procedural) {
    await kv.set(KV.procedural, p.id, p)
  }
  results.decay = {
    semantic: semantic.length,
    procedural: procedural.length,
  }
}

/**
 * Parse a procedural-extraction completion and write ProceduralMemory
 * records. Mirrors the parse/upsert logic from the direct path exactly
 * so both variants produce identical KV state.
 */
async function parseAndWriteProcedural(
  kv: StateKV,
  state: ConsolidationPipelineStepState,
  response: string,
): Promise<void> {
  const procRegex =
    /<procedure\s+name="([^"]+)"\s+trigger="([^"]+)">([\s\S]*?)<\/procedure>/g
  let match
  let newProcs = 0
  const now = new Date().toISOString()
  const existingProcs = await kv.list<ProceduralMemory>(KV.procedural)

  while ((match = procRegex.exec(response)) !== null) {
    const name = match[1]
    const trigger = match[2]
    const stepsBlock = match[3]
    const steps: string[] = []

    const stepRegex = /<step>([^<]+)<\/step>/g
    let stepMatch
    while ((stepMatch = stepRegex.exec(stepsBlock)) !== null) {
      steps.push(stepMatch[1].trim())
    }

    const existing = existingProcs.find(
      (p) => p.name.toLowerCase() === name.toLowerCase(),
    )
    if (existing) {
      existing.frequency++
      existing.updatedAt = now
      existing.strength = Math.min(1, existing.strength + 0.1)
      await kv.set(KV.procedural, existing.id, existing)
    } else {
      const proc: ProceduralMemory = {
        id: generateId("proc"),
        name,
        steps,
        triggerCondition: trigger,
        frequency: 1,
        sourceSessionIds: [],
        strength: 0.5,
        createdAt: now,
        updatedAt: now,
      }
      await kv.set(KV.procedural, proc.id, proc)
      newProcs++
    }
  }
  state.results.procedural = {
    newProcedures: newProcs,
    patternsAnalyzed: state.proceduralPatternsAnalyzed,
  }
  state.proceduralPatternsAnalyzed = undefined
}

/**
 * Run the non-LLM finalize tail with sdk available: decay, audit,
 * optional Obsidian export. Reflect is no longer handled here — it
 * runs in its own pipeline state (state 2) before finalize.
 *
 * Used only by the state-3 terminal path (which has sdk in scope).
 * Other terminal paths use finalizeTerminal() which omits the
 * obsidian export since it can't reach sdk from those helpers.
 */
async function runFinalizeTail(
  sdk: FakeSdk,
  kv: StateKV,
  state: ConsolidationPipelineStepState,
): Promise<void> {
  const { tier, decayDays, results } = state

  if (tier === "all" || tier === "decay") {
    await applyDecayTier(kv, decayDays, results)
  }

  if (process.env["OBSIDIAN_AUTO_EXPORT"] === "true") {
    try {
      await sdk.trigger("mem::obsidian-export", {})
      results.obsidianExport = { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn("Obsidian auto-export failed", { error: msg })
      results.obsidianExport = { success: false, error: msg }
    }
  }

  // Audit write is best-effort — a failure here shouldn't nuke the
  // whole pipeline response. Matches the try/catch symmetry across
  // all terminal paths (C1's audit try/catch was asymmetric before).
  try {
    await recordAudit(
      kv,
      "consolidate",
      "mem::consolidate-pipeline-step",
      [],
      { tier, results },
    )
  } catch (err) {
    logger.warn("recordAudit failed in consolidate-pipeline-step", {
      error: err instanceof Error ? err.message : String(err),
    })
  }
  logger.info("Consolidation pipeline (step) complete", { tier, results })
}
