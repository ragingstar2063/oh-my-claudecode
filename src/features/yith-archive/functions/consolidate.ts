import type { FakeSdk } from "../state/fake-sdk.js"
import { logger } from "../state/logger.js"
import type {
  CompressedObservation,
  Memory,
  Session,
  MemoryProvider,
} from "../types.js";
import { KV, generateId } from "../state/schema.js";
import { StateKV } from "../state/kv.js";
import {
  createWorkPacket,
  planLoopBatches,
  type StepInput,
  type StepResult,
} from "../state/work-packets.js";
import { putMemory } from "./search.js";

const CONSOLIDATION_SYSTEM = `You are a memory consolidation engine. Given a set of related observations from coding sessions, synthesize them into a single long-term memory.

Output XML:
<memory>
  <type>pattern|preference|architecture|bug|workflow|fact</type>
  <title>Concise memory title (max 80 chars)</title>
  <content>2-4 sentence description of the learned insight</content>
  <concepts>
    <concept>key term</concept>
  </concepts>
  <files>
    <file>relevant/file/path</file>
  </files>
  <strength>1-10 how confident/important this memory is</strength>
</memory>`;

import { getXmlTag, getXmlChildren } from "../prompts/xml.js";

function parseMemoryXml(
  xml: string,
  sessionIds: string[],
): Omit<Memory, "id" | "createdAt" | "updatedAt"> | null {
  const type = getXmlTag(xml, "type");
  const title = getXmlTag(xml, "title");
  const content = getXmlTag(xml, "content");
  if (!type || !title || !content) return null;

  const validTypes = new Set([
    "pattern",
    "preference",
    "architecture",
    "bug",
    "workflow",
    "fact",
  ]);

  return {
    type: (validTypes.has(type) ? type : "fact") as Memory["type"],
    title,
    content,
    concepts: getXmlChildren(xml, "concepts", "concept"),
    files: getXmlChildren(xml, "files", "file"),
    sessionIds,
    strength: Math.max(
      1,
      Math.min(10, parseInt(getXmlTag(xml, "strength") || "5", 10) || 5),
    ),
    version: 1,
    isLatest: true,
  };
}

export function registerConsolidateFunction(
  sdk: FakeSdk,
  kv: StateKV,
  provider: MemoryProvider,
): void {
  sdk.registerFunction(
    { id: "mem::consolidate" },
    async (data: { project?: string; minObservations?: number }) => {
      const minObs = data.minObservations ?? 10;

      const sessions = await kv.list<Session>(KV.sessions);
      const filtered = data.project
        ? sessions.filter((s) => s.project === data.project)
        : sessions;

      const allObs: Array<CompressedObservation & { sid: string }> = [];
      const obsPerSession: CompressedObservation[][] = [];
      for (let batch = 0; batch < filtered.length; batch += 10) {
        const chunk = filtered.slice(batch, batch + 10);
        const results = await Promise.all(
          chunk.map((s) =>
            kv
              .list<CompressedObservation>(KV.observations(s.id))
              .catch(() => [] as CompressedObservation[]),
          ),
        );
        obsPerSession.push(...results);
      }
      for (let i = 0; i < filtered.length; i++) {
        for (const obs of obsPerSession[i]) {
          if (obs.title && obs.importance >= 5) {
            allObs.push({ ...obs, sid: filtered[i].id });
          }
        }
      }

      if (allObs.length < minObs) {
        return { consolidated: 0, reason: "insufficient_observations" };
      }

      const conceptGroups = new Map<string, typeof allObs>();
      for (const obs of allObs) {
        for (const concept of obs.concepts) {
          const key = concept.toLowerCase();
          if (!conceptGroups.has(key)) conceptGroups.set(key, []);
          conceptGroups.get(key)!.push(obs);
        }
      }

      let consolidated = 0;
      const existingMemories = await kv.list<Memory>(KV.memories);
      const existingTitles = new Set(
        existingMemories.map((m) => m.title.toLowerCase()),
      );

      const MAX_LLM_CALLS = 10;
      let llmCallCount = 0;

      const sortedGroups = [...conceptGroups.entries()]
        .filter(([, g]) => g.length >= 3)
        .sort((a, b) => b[1].length - a[1].length);

      for (const [concept, obsGroup] of sortedGroups) {
        if (llmCallCount >= MAX_LLM_CALLS) break;

        const top = obsGroup
          .sort((a, b) => b.importance - a.importance)
          .slice(0, 8);
        const sessionIds = [...new Set(top.map((o) => o.sid))];

        const prompt = top
          .map(
            (o) =>
              `[${o.type}] ${o.title}\n${o.narrative}\nFiles: ${o.files.join(", ")}\nImportance: ${o.importance}`,
          )
          .join("\n\n");

        try {
          const response = await Promise.race([
            provider.compress(
              CONSOLIDATION_SYSTEM,
              `Concept: "${concept}"\n\nObservations:\n${prompt}`,
            ),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("compress timeout")), 30_000),
            ),
          ]);
          llmCallCount++;
          const parsed = parseMemoryXml(response, sessionIds);
          if (!parsed) continue;

          const existingMatch = existingMemories.find(
            (m) => m.title.toLowerCase() === parsed.title.toLowerCase(),
          );

          const now = new Date().toISOString();
          const obsIds = [...new Set(top.map((o) => o.id))];
          if (existingMatch) {
            existingMatch.isLatest = false;
            await putMemory(kv, existingMatch);

            const evolved: Memory = {
              id: generateId("mem"),
              createdAt: now,
              updatedAt: now,
              ...parsed,
              version: (existingMatch.version || 1) + 1,
              parentId: existingMatch.id,
              supersedes: [
                existingMatch.id,
                ...(existingMatch.supersedes || []),
              ],
              sourceObservationIds: obsIds,
              isLatest: true,
            };
            await putMemory(kv, evolved);
            existingTitles.add(evolved.title.toLowerCase());
            consolidated++;
          } else {
            const memory: Memory = {
              id: generateId("mem"),
              createdAt: now,
              updatedAt: now,
              ...parsed,
              sourceObservationIds: obsIds,
              version: 1,
              isLatest: true,
            };
            await putMemory(kv, memory);
            existingTitles.add(memory.title.toLowerCase());
            consolidated++;
          }
        } catch (err) {
          logger.warn("Consolidation failed for concept", {
            concept,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      logger.info("Consolidation complete", {
        consolidated,
        totalObs: allObs.length,
      });
      return { consolidated, totalObservations: allObs.length };
    },
  );
}

/** Per-concept-group task — everything state 1 needs to finalize after
 *  the LLM completion comes back. */
interface ConsolidateTask {
  concept: string
  prompt: string
  sessionIds: string[]
  obsIds: string[]
  /** Set only while this task is in the current batch. Cleared on consume. */
  packetId?: string
}

interface ConsolidateArgs {
  project?: string
  minObservations?: number
}

interface ConsolidateStepState {
  originalArgs: ConsolidateArgs
  tasks: ConsolidateTask[]
  batchStart: number
  batchSize: number
  totalBatches: number
  totalObservations: number
  /** Running count of memories written across rounds. */
  consolidated: number
}

/**
 * Work-packet variant of mem::consolidate. Loop function — emits one
 * work packet per concept group, batched according to planLoopBatches.
 * State 1 self-loops: each round consumes the current batch's
 * completions, writes memories, and either emits the next batch or
 * returns terminal.
 *
 * Preserves the direct path's MAX_LLM_CALLS = 10 cap (applied to the
 * total task list in state 0, before batching).
 */
export function registerConsolidateStepFunction(
  sdk: FakeSdk,
  kv: StateKV,
): void {
  sdk.registerFunction(
    { id: "mem::consolidate-step" },
    async (
      input: StepInput<ConsolidateArgs, ConsolidateStepState>,
    ): Promise<StepResult> => {
      const { step, originalArgs, intermediateState, completions } = input

      if (step === 0) {
        const minObs = originalArgs.minObservations ?? 10

        const sessions = await kv.list<Session>(KV.sessions)
        const filtered = originalArgs.project
          ? sessions.filter((s) => s.project === originalArgs.project)
          : sessions

        const allObs: Array<CompressedObservation & { sid: string }> = []
        const obsPerSession: CompressedObservation[][] = []
        for (let batch = 0; batch < filtered.length; batch += 10) {
          const chunk = filtered.slice(batch, batch + 10)
          const results = await Promise.all(
            chunk.map((s) =>
              kv
                .list<CompressedObservation>(KV.observations(s.id))
                .catch(() => [] as CompressedObservation[]),
            ),
          )
          obsPerSession.push(...results)
        }
        for (let i = 0; i < filtered.length; i++) {
          for (const obs of obsPerSession[i]) {
            if (obs.title && obs.importance >= 5) {
              allObs.push({ ...obs, sid: filtered[i].id })
            }
          }
        }

        if (allObs.length < minObs) {
          return {
            done: true,
            result: { consolidated: 0, reason: "insufficient_observations" },
          }
        }

        const conceptGroups = new Map<string, typeof allObs>()
        for (const obs of allObs) {
          for (const concept of obs.concepts) {
            const key = concept.toLowerCase()
            if (!conceptGroups.has(key)) conceptGroups.set(key, [])
            conceptGroups.get(key)!.push(obs)
          }
        }

        // Cap task count at 10 to mirror the direct path's MAX_LLM_CALLS.
        // Semantic note: the direct path caps SUCCESSFUL LLM returns
        // (timeouts don't consume a slot). The step path caps TASKS
        // EMITTED — a packet whose completion is missing or unparseable
        // still uses a slot. In practice the difference is negligible
        // because the parent agent controls the completion quality,
        // and LLM credentials for this path are the parent's, not ours.
        const sortedGroups = [...conceptGroups.entries()]
          .filter(([, g]) => g.length >= 3)
          .sort((a, b) => b[1].length - a[1].length)
          .slice(0, 10)

        if (sortedGroups.length === 0) {
          return {
            done: true,
            result: { consolidated: 0, totalObservations: allObs.length },
          }
        }

        const tasks: ConsolidateTask[] = sortedGroups.map(([concept, obsGroup]) => {
          const top = obsGroup
            .sort((a, b) => b.importance - a.importance)
            .slice(0, 8)
          const sessionIds = [...new Set(top.map((o) => o.sid))]
          const obsIds = [...new Set(top.map((o) => o.id))]
          const prompt =
            `Concept: "${concept}"\n\nObservations:\n` +
            top
              .map(
                (o) =>
                  `[${o.type}] ${o.title}\n${o.narrative}\nFiles: ${o.files.join(", ")}\nImportance: ${o.importance}`,
              )
              .join("\n\n")
          return { concept, prompt, sessionIds, obsIds }
        })

        const totalBytes = tasks.reduce(
          (sum, t) => sum + t.prompt.length + CONSOLIDATION_SYSTEM.length,
          0,
        )
        const plan = planLoopBatches(tasks.length, totalBytes)

        const state: ConsolidateStepState = {
          originalArgs,
          tasks,
          batchStart: 0,
          batchSize: plan.batchSize,
          totalBatches: plan.totalBatches,
          totalObservations: allObs.length,
          consolidated: 0,
        }

        const batchPackets = buildConsolidateBatch(state)

        return {
          done: false,
          nextStep: 1,
          intermediateState: state,
          workPackets: batchPackets,
          instructions:
            `Consolidate loop — batch 1 of ${plan.totalBatches}. ` +
            `Run each of these ${batchPackets.length} prompts through your ` +
            "LLM (in parallel is fine) and commit all completions together. " +
            (plan.totalBatches > 1
              ? "Expect another needs_llm_work response for the next batch."
              : "This is the only batch — next response will be terminal."),
        }
      }

      if (step === 1) {
        if (!intermediateState) {
          return {
            done: true,
            result: { success: false, error: "missing intermediate state" },
          }
        }

        // Consume current batch.
        const existingMemories = await kv.list<Memory>(KV.memories)
        const batchEnd = Math.min(
          intermediateState.batchStart + intermediateState.batchSize,
          intermediateState.tasks.length,
        )
        for (let i = intermediateState.batchStart; i < batchEnd; i++) {
          const task = intermediateState.tasks[i]
          if (!task.packetId) continue
          const response = completions?.[task.packetId]
          // Clear the packetId BEFORE processing so a retry of the
          // same commit (with the same continuation token) is a
          // no-op rather than double-writing the memory. Idempotent
          // by construction — the `!task.packetId` guard above
          // catches any task already consumed in a prior attempt.
          task.packetId = undefined
          if (!response) continue

          const parsed = parseMemoryXml(response, task.sessionIds)
          if (!parsed) continue

          const existingMatch = existingMemories.find(
            (m) => m.title.toLowerCase() === parsed.title.toLowerCase(),
          )
          const now = new Date().toISOString()
          if (existingMatch) {
            existingMatch.isLatest = false
            await putMemory(kv, existingMatch)

            const evolved: Memory = {
              id: generateId("mem"),
              createdAt: now,
              updatedAt: now,
              ...parsed,
              version: (existingMatch.version || 1) + 1,
              parentId: existingMatch.id,
              supersedes: [
                existingMatch.id,
                ...(existingMatch.supersedes || []),
              ],
              sourceObservationIds: task.obsIds,
              isLatest: true,
            }
            await putMemory(kv, evolved)
            intermediateState.consolidated++
          } else {
            const memory: Memory = {
              id: generateId("mem"),
              createdAt: now,
              updatedAt: now,
              ...parsed,
              sourceObservationIds: task.obsIds,
              version: 1,
              isLatest: true,
            }
            await putMemory(kv, memory)
            intermediateState.consolidated++
          }
        }

        intermediateState.batchStart = batchEnd

        if (intermediateState.batchStart >= intermediateState.tasks.length) {
          logger.info("Consolidation complete (step)", {
            consolidated: intermediateState.consolidated,
            totalObs: intermediateState.totalObservations,
          })
          return {
            done: true,
            result: {
              consolidated: intermediateState.consolidated,
              totalObservations: intermediateState.totalObservations,
            },
          }
        }

        // More batches to emit.
        const nextPackets = buildConsolidateBatch(intermediateState)
        const batchNum = Math.floor(
          intermediateState.batchStart / intermediateState.batchSize,
        ) + 1
        return {
          done: false,
          nextStep: 1,
          intermediateState,
          workPackets: nextPackets,
          instructions:
            `Consolidate loop — batch ${batchNum} of ${intermediateState.totalBatches}. ` +
            `Run these ${nextPackets.length} prompts and commit all together.`,
        }
      }

      return {
        done: true,
        result: { success: false, error: `unknown step ${step}` },
      }
    },
  )
}

/** Create WorkPackets for the next batch of consolidate tasks and stamp
 *  packet IDs onto the tasks in place so the consume pass can match. */
function buildConsolidateBatch(state: ConsolidateStepState) {
  const end = Math.min(
    state.batchStart + state.batchSize,
    state.tasks.length,
  )
  const packets = []
  for (let i = state.batchStart; i < end; i++) {
    const task = state.tasks[i]
    const packet = createWorkPacket({
      kind: "compress",
      systemPrompt: CONSOLIDATION_SYSTEM,
      userPrompt: task.prompt,
      purpose: `consolidate concept "${task.concept}" (${task.obsIds.length} observations)`,
    })
    task.packetId = packet.id
    packets.push(packet)
  }
  return packets
}
