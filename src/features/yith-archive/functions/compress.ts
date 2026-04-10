import type { FakeSdk } from "../state/fake-sdk.js"
import { logger } from "../state/logger.js"
import type {
  RawObservation,
  CompressedObservation,
  ObservationType,
  MemoryProvider,
} from "../types.js";
import { KV, STREAM } from "../state/schema.js";
import { StateKV } from "../state/kv.js";
import {
  COMPRESSION_SYSTEM,
  buildCompressionPrompt,
} from "../prompts/compression.js";
import { getXmlTag, getXmlChildren } from "../prompts/xml.js";
import { getSearchIndex } from "./search.js";
import { CompressOutputSchema } from "../eval/schemas.js";
import { validateOutput } from "../eval/validator.js";
import { scoreCompression } from "../eval/quality.js";
import { compressWithRetry } from "../eval/self-correct.js";
import type { MetricsStore } from "../eval/metrics-store.js";
import {
  createWorkPacket,
  type StepInput,
  type StepResult,
} from "../state/work-packets.js";

const VALID_TYPES = new Set<string>([
  "file_read",
  "file_write",
  "file_edit",
  "command_run",
  "search",
  "web_fetch",
  "conversation",
  "error",
  "decision",
  "discovery",
  "subagent",
  "notification",
  "task",
  "other",
]);

function parseCompressionXml(
  xml: string,
): Omit<CompressedObservation, "id" | "sessionId" | "timestamp"> | null {
  const rawType = getXmlTag(xml, "type");
  const title = getXmlTag(xml, "title");
  if (!rawType || !title) return null;
  const type = VALID_TYPES.has(rawType) ? rawType : "other";

  return {
    type: type as ObservationType,
    title,
    subtitle: getXmlTag(xml, "subtitle") || undefined,
    facts: getXmlChildren(xml, "facts", "fact"),
    narrative: getXmlTag(xml, "narrative"),
    concepts: getXmlChildren(xml, "concepts", "concept"),
    files: getXmlChildren(xml, "files", "file"),
    importance: Math.max(
      1,
      Math.min(10, parseInt(getXmlTag(xml, "importance") || "5", 10) || 5),
    ),
  };
}

export function registerCompressFunction(
  sdk: FakeSdk,
  kv: StateKV,
  provider: MemoryProvider,
  metricsStore?: MetricsStore,
): void {
  sdk.registerFunction(
    {
      id: "mem::compress",
      description: "Compress a raw observation using LLM",
    },
    async (data: {
      observationId: string;
      sessionId: string;
      raw: RawObservation;
    }) => {
      const startMs = Date.now();
      const prompt = buildCompressionPrompt({
        hookType: data.raw.hookType,
        toolName: data.raw.toolName,
        toolInput: data.raw.toolInput,
        toolOutput: data.raw.toolOutput,
        userPrompt: data.raw.userPrompt,
        timestamp: data.raw.timestamp,
      });

      try {
        const validator = (response: string) => {
          const parsed = parseCompressionXml(response);
          if (!parsed) return { valid: false, errors: ["xml_parse_failed"] };
          const result = validateOutput(
            CompressOutputSchema,
            parsed,
            "mem::compress",
          );
          return result.valid
            ? { valid: true }
            : { valid: false, errors: result.result.errors };
        };

        const { response, retried } = await compressWithRetry(
          provider,
          COMPRESSION_SYSTEM,
          prompt,
          validator,
          1,
        );

        const parsed = parseCompressionXml(response);
        if (!parsed) {
          const latencyMs = Date.now() - startMs;
          if (metricsStore) {
            await metricsStore.record("mem::compress", latencyMs, false);
          }
          logger.warn("Failed to parse compression XML", {
            obsId: data.observationId,
            retried,
          });
          return { success: false, error: "parse_failed" };
        }

        const qualityScore = scoreCompression(parsed);

        const compressed: CompressedObservation = {
          id: data.observationId,
          sessionId: data.sessionId,
          timestamp: data.raw.timestamp,
          ...parsed,
          confidence: qualityScore / 100,
        };

        await kv.set(
          KV.observations(data.sessionId),
          data.observationId,
          compressed,
        );

        getSearchIndex().add(compressed);

        sdk.triggerVoid("stream::set", {
          stream_name: STREAM.name,
          group_id: STREAM.group(data.sessionId),
          item_id: data.observationId,
          data: { type: "compressed", observation: compressed },
        });

        sdk.triggerVoid("stream::set", {
          stream_name: STREAM.name,
          group_id: STREAM.viewerGroup,
          item_id: data.observationId,
          data: {
            type: "compressed",
            observation: compressed,
            sessionId: data.sessionId,
          },
        });

        const latencyMs = Date.now() - startMs;
        if (metricsStore) {
          await metricsStore.record(
            "mem::compress",
            latencyMs,
            true,
            qualityScore,
          );
        }

        logger.info("Observation compressed", {
          obsId: data.observationId,
          type: compressed.type,
          importance: compressed.importance,
          qualityScore,
          retried,
        });

        return { success: true, compressed, qualityScore };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const latencyMs = Date.now() - startMs;
        if (metricsStore) {
          await metricsStore.record("mem::compress", latencyMs, false);
        }
        logger.error("Compression failed", {
          obsId: data.observationId,
          error: msg,
        });
        return { success: false, error: "compression_failed" };
      }
    },
  );
}

interface CompressArgs {
  observationId: string
  sessionId: string
  raw: RawObservation
}

interface CompressStepState {
  originalArgs: CompressArgs
  packetId: string
  startMs: number
}

/**
 * Work-packet variant of mem::compress. Single attempt — no self-correct
 * retry loop, because retrying would require another LLM round. If the
 * parse or validation fails, the terminal result surfaces the error so
 * the caller can re-invoke yith_trigger to try again.
 */
export function registerCompressStepFunction(
  sdk: FakeSdk,
  kv: StateKV,
  metricsStore?: MetricsStore,
): void {
  sdk.registerFunction(
    { id: "mem::compress-step" },
    async (
      input: StepInput<CompressArgs, CompressStepState>,
    ): Promise<StepResult> => {
      const { step, originalArgs, intermediateState, completions } = input

      if (step === 0) {
        const prompt = buildCompressionPrompt({
          hookType: originalArgs.raw.hookType,
          toolName: originalArgs.raw.toolName,
          toolInput: originalArgs.raw.toolInput,
          toolOutput: originalArgs.raw.toolOutput,
          userPrompt: originalArgs.raw.userPrompt,
          timestamp: originalArgs.raw.timestamp,
        })

        const packet = createWorkPacket({
          kind: "compress",
          systemPrompt: COMPRESSION_SYSTEM,
          userPrompt: prompt,
          purpose: `compress observation ${originalArgs.observationId}`,
        })

        return {
          done: false,
          nextStep: 1,
          intermediateState: {
            originalArgs,
            packetId: packet.id,
            startMs: Date.now(),
          },
          workPackets: [packet],
          instructions:
            "Run the compression prompt through your LLM and commit the " +
            "XML result. Single-round flow.",
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

        const parsed = parseCompressionXml(response)
        const latencyMs = Date.now() - intermediateState.startMs
        if (!parsed) {
          if (metricsStore) {
            await metricsStore.record("mem::compress", latencyMs, false)
          }
          logger.warn("Failed to parse compression XML (step)", {
            obsId: intermediateState.originalArgs.observationId,
          })
          return { done: true, result: { success: false, error: "parse_failed" } }
        }

        const validation = validateOutput(
          CompressOutputSchema,
          parsed,
          "mem::compress",
        )
        if (!validation.valid) {
          if (metricsStore) {
            await metricsStore.record("mem::compress", latencyMs, false)
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

        const qualityScore = scoreCompression(parsed)
        const { observationId, sessionId, raw } = intermediateState.originalArgs
        const compressed: CompressedObservation = {
          id: observationId,
          sessionId,
          timestamp: raw.timestamp,
          ...parsed,
          confidence: qualityScore / 100,
        }

        await kv.set(KV.observations(sessionId), observationId, compressed)
        getSearchIndex().add(compressed)

        sdk.triggerVoid("stream::set", {
          stream_name: STREAM.name,
          group_id: STREAM.group(sessionId),
          item_id: observationId,
          data: { type: "compressed", observation: compressed },
        })
        sdk.triggerVoid("stream::set", {
          stream_name: STREAM.name,
          group_id: STREAM.viewerGroup,
          item_id: observationId,
          data: {
            type: "compressed",
            observation: compressed,
            sessionId,
          },
        })

        if (metricsStore) {
          await metricsStore.record(
            "mem::compress",
            latencyMs,
            true,
            qualityScore,
          )
        }

        logger.info("Observation compressed (step)", {
          obsId: observationId,
          type: compressed.type,
          importance: compressed.importance,
          qualityScore,
        })

        return {
          done: true,
          result: { success: true, compressed, qualityScore },
        }
      }

      return {
        done: true,
        result: { success: false, error: `unknown step ${step}` },
      }
    },
  )
}
