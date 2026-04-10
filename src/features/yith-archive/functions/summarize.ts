import type { FakeSdk } from "../state/fake-sdk.js"
import { logger } from "../state/logger.js"
import type {
  CompressedObservation,
  SessionSummary,
  MemoryProvider,
  Session,
} from "../types.js";
import { KV } from "../state/schema.js";
import { StateKV } from "../state/kv.js";
import { SUMMARY_SYSTEM, buildSummaryPrompt } from "../prompts/summary.js";
import { getXmlTag, getXmlChildren } from "../prompts/xml.js";
import { SummaryOutputSchema } from "../eval/schemas.js";
import { validateOutput } from "../eval/validator.js";
import { scoreSummary } from "../eval/quality.js";
import type { MetricsStore } from "../eval/metrics-store.js";
import {
  createWorkPacket,
  type StepInput,
  type StepResult,
} from "../state/work-packets.js";

function parseSummaryXml(
  xml: string,
  sessionId: string,
  project: string,
  obsCount: number,
): SessionSummary | null {
  const title = getXmlTag(xml, "title");
  if (!title) return null;

  return {
    sessionId,
    project,
    createdAt: new Date().toISOString(),
    title,
    narrative: getXmlTag(xml, "narrative"),
    keyDecisions: getXmlChildren(xml, "decisions", "decision"),
    filesModified: getXmlChildren(xml, "files", "file"),
    concepts: getXmlChildren(xml, "concepts", "concept"),
    observationCount: obsCount,
  };
}

export function registerSummarizeFunction(
  sdk: FakeSdk,
  kv: StateKV,
  provider: MemoryProvider,
  metricsStore?: MetricsStore,
): void {
  sdk.registerFunction(
    { id: "mem::summarize", description: "Generate end-of-session summary" },
    async (data: { sessionId: string }) => {
      const startMs = Date.now();

      const session = await kv.get<Session>(KV.sessions, data.sessionId);
      if (!session) {
        logger.warn("Session not found for summarize", {
          sessionId: data.sessionId,
        });
        return { success: false, error: "session_not_found" };
      }

      const observations = await kv.list<CompressedObservation>(
        KV.observations(data.sessionId),
      );
      const compressed = observations.filter((o) => o.title);

      if (compressed.length === 0) {
        logger.info("No observations to summarize", {
          sessionId: data.sessionId,
        });
        return { success: false, error: "no_observations" };
      }

      try {
        const prompt = buildSummaryPrompt(compressed);
        const response = await provider.summarize(SUMMARY_SYSTEM, prompt);
        const summary = parseSummaryXml(
          response,
          data.sessionId,
          session.project,
          compressed.length,
        );

        if (!summary) {
          const latencyMs = Date.now() - startMs;
          if (metricsStore) {
            await metricsStore.record("mem::summarize", latencyMs, false);
          }
          logger.warn("Failed to parse summary XML", {
            sessionId: data.sessionId,
          });
          return { success: false, error: "parse_failed" };
        }

        const summaryForValidation = {
          title: summary.title,
          narrative: summary.narrative,
          keyDecisions: summary.keyDecisions,
          filesModified: summary.filesModified,
          concepts: summary.concepts,
        };
        const validation = validateOutput(
          SummaryOutputSchema,
          summaryForValidation,
          "mem::summarize",
        );

        if (!validation.valid) {
          const latencyMs = Date.now() - startMs;
          if (metricsStore) {
            await metricsStore.record("mem::summarize", latencyMs, false);
          }
          logger.warn("Summary validation failed", {
            sessionId: data.sessionId,
            errors: validation.result.errors,
          });
          return { success: false, error: "validation_failed" };
        }

        const qualityScore = scoreSummary(summaryForValidation);

        await kv.set(KV.summaries, data.sessionId, summary);

        const latencyMs = Date.now() - startMs;
        if (metricsStore) {
          await metricsStore.record(
            "mem::summarize",
            latencyMs,
            true,
            qualityScore,
          );
        }

        logger.info("Session summarized", {
          sessionId: data.sessionId,
          title: summary.title,
          decisions: summary.keyDecisions.length,
          qualityScore,
          valid: validation.valid,
        });

        return { success: true, summary, qualityScore };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const latencyMs = Date.now() - startMs;
        if (metricsStore) {
          await metricsStore.record("mem::summarize", latencyMs, false);
        }
        logger.error("Summarize failed", {
          sessionId: data.sessionId,
          error: msg,
        });
        return { success: false, error: msg };
      }
    },
  );
}

interface SummarizeArgs {
  sessionId: string
}

interface SummarizeStepState {
  originalArgs: SummarizeArgs
  project: string
  compressedCount: number
  packetId: string
  startMs: number
}

/** Work-packet variant of mem::summarize. Single-call 2-state machine. */
export function registerSummarizeStepFunction(
  sdk: FakeSdk,
  kv: StateKV,
  metricsStore?: MetricsStore,
): void {
  sdk.registerFunction(
    { id: "mem::summarize-step" },
    async (
      input: StepInput<SummarizeArgs, SummarizeStepState>,
    ): Promise<StepResult> => {
      const { step, originalArgs, intermediateState, completions } = input

      if (step === 0) {
        const session = await kv.get<Session>(KV.sessions, originalArgs.sessionId)
        if (!session) {
          return {
            done: true,
            result: { success: false, error: "session_not_found" },
          }
        }
        const observations = await kv.list<CompressedObservation>(
          KV.observations(originalArgs.sessionId),
        )
        const compressed = observations.filter((o) => o.title)
        if (compressed.length === 0) {
          return {
            done: true,
            result: { success: false, error: "no_observations" },
          }
        }

        const prompt = buildSummaryPrompt(compressed)
        const packet = createWorkPacket({
          kind: "summarize",
          systemPrompt: SUMMARY_SYSTEM,
          userPrompt: prompt,
          purpose: `summarize session ${originalArgs.sessionId} (${compressed.length} observations)`,
        })

        return {
          done: false,
          nextStep: 1,
          intermediateState: {
            originalArgs,
            project: session.project,
            compressedCount: compressed.length,
            packetId: packet.id,
            startMs: Date.now(),
          },
          workPackets: [packet],
          instructions:
            "Run the summarize prompt through your LLM and commit the XML " +
            "result. Single-round flow.",
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

        const summary = parseSummaryXml(
          response,
          intermediateState.originalArgs.sessionId,
          intermediateState.project,
          intermediateState.compressedCount,
        )
        const latencyMs = Date.now() - intermediateState.startMs

        if (!summary) {
          if (metricsStore) {
            await metricsStore.record("mem::summarize", latencyMs, false)
          }
          return {
            done: true,
            result: { success: false, error: "parse_failed" },
          }
        }

        const summaryForValidation = {
          title: summary.title,
          narrative: summary.narrative,
          keyDecisions: summary.keyDecisions,
          filesModified: summary.filesModified,
          concepts: summary.concepts,
        }
        const validation = validateOutput(
          SummaryOutputSchema,
          summaryForValidation,
          "mem::summarize",
        )
        if (!validation.valid) {
          if (metricsStore) {
            await metricsStore.record("mem::summarize", latencyMs, false)
          }
          return {
            done: true,
            result: {
              success: false,
              error: "validation_failed",
              errors: validation.result.errors,
            },
          }
        }

        const qualityScore = scoreSummary(summaryForValidation)
        await kv.set(KV.summaries, intermediateState.originalArgs.sessionId, summary)

        if (metricsStore) {
          await metricsStore.record(
            "mem::summarize",
            latencyMs,
            true,
            qualityScore,
          )
        }
        logger.info("Session summarized (step)", {
          sessionId: intermediateState.originalArgs.sessionId,
          title: summary.title,
          qualityScore,
        })

        return {
          done: true,
          result: { success: true, summary, qualityScore },
        }
      }

      return {
        done: true,
        result: { success: false, error: `unknown step ${step}` },
      }
    },
  )
}
