/**
 * Yith MCP tools — the thin mapping layer between MCP tool calls and the
 * in-process YithArchiveHandle API.
 *
 * Five core tools (remember/search/recall/context/observe) wrap the matching
 * convenience methods on the archive handle. They're pure data plumbing over
 * KV + hybrid search; none of them need an LLM, so they work with zero config.
 *
 * One escape-hatch tool (yith_trigger) dispatches arbitrary registered memory
 * functions via sdk.trigger(name, args). Advanced functions that need an LLM
 * will throw when the lazy provider can't resolve credentials — this is the
 * "dumb dispatch" shape agreed for step 3a. Step 3b will replace the passthrough
 * with a work-packet protocol so LLM ops route through the parent session's
 * own auth instead of requiring an API key.
 *
 * The yith_trigger tool's description field will be extended in step 4 with a
 * curated catalog of the most useful advanced function names. For now it
 * carries a placeholder.
 */

import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import type { YithArchiveHandle } from "../features/yith-archive/index.js"
import type {
  NeedsWorkResponse,
  PendingWork,
  StepInput,
  StepResult,
} from "../features/yith-archive/state/work-packets.js"
import { buildTriggerDescription, LLM_REQUIRED_FUNCTIONS } from "./yith-catalog.js"

/**
 * Map of direct function IDs → state-machine variants. When
 * yith_trigger is called on one of these in work-packet mode (no LLM
 * provider resolved), it dispatches the `-step` variant with step=0
 * instead of the direct function. Every entry here MUST have a
 * matching registered function in src/features/yith-archive/functions/
 * that conforms to the StepInput/StepResult shape.
 *
 * Grows as more functions are ported to state machines (3b-8, 3b-9).
 */
const LLM_FUNCTION_REGISTRY: Readonly<Record<string, string>> = {
  "mem::crystallize": "mem::crystallize-step",
  "mem::consolidate-pipeline": "mem::consolidate-pipeline-step",
  "mem::compress": "mem::compress-step",
  "mem::summarize": "mem::summarize-step",
  "mem::flow-compress": "mem::flow-compress-step",
  "mem::graph-extract": "mem::graph-extract-step",
  "mem::expand-query": "mem::expand-query-step",
  "mem::skill-extract": "mem::skill-extract-step",
  "mem::enrich-window": "mem::enrich-window-step",
  "mem::temporal-graph-extract": "mem::temporal-graph-extract-step",
  "mem::consolidate": "mem::consolidate-step",
  "mem::reflect": "mem::reflect-step",
  "mem::enrich-session": "mem::enrich-session-step",
}

// Consistency check at module load: LLM_FUNCTION_REGISTRY and
// LLM_REQUIRED_FUNCTIONS (in yith-catalog.ts) MUST agree on which
// functions are LLM-requiring. A drift silently causes "function not
// found" errors in work-packet mode, so fail loudly at startup.
{
  const registryKeys = new Set(Object.keys(LLM_FUNCTION_REGISTRY))
  const missing: string[] = []
  const extra: string[] = []
  for (const name of LLM_REQUIRED_FUNCTIONS) {
    if (!registryKeys.has(name)) missing.push(name)
  }
  for (const name of registryKeys) {
    if (!LLM_REQUIRED_FUNCTIONS.has(name)) extra.push(name)
  }
  if (missing.length > 0 || extra.length > 0) {
    const parts: string[] = []
    if (missing.length > 0) {
      parts.push(
        `missing from LLM_FUNCTION_REGISTRY: ${missing.join(", ")}`,
      )
    }
    if (extra.length > 0) {
      parts.push(
        `missing from LLM_REQUIRED_FUNCTIONS: ${extra.join(", ")}`,
      )
    }
    throw new Error(
      "yith-tools: LLM_FUNCTION_REGISTRY and LLM_REQUIRED_FUNCTIONS " +
        "are out of sync — " +
        parts.join("; ") +
        ". Update src/mcp/yith-tools.ts and src/mcp/yith-catalog.ts " +
        "together, then rebuild.",
    )
  }
}

/** Default instructions text attached to NeedsWorkResponse if the
 *  function didn't provide its own. */
const DEFAULT_INSTRUCTIONS =
  "This Yith operation needs an LLM completion that Yith can't make " +
  "itself (no API key configured). Run each workPacket's prompts through " +
  "your own LLM access — you can either (a) answer the userPrompt inline " +
  "using your own reasoning and the systemPrompt as a guide, or (b) " +
  "dispatch a Task subagent with the prompts if the work is large or " +
  "needs isolation. Then call yith_commit_work with the continuation " +
  "token and the completed text for each packet ID. Yith will resume " +
  "the paused function — expect either a terminal `success` response " +
  "or another `needs_llm_work` response for the next round. Loop until " +
  "terminal."

/**
 * Convert a StepResult from a state-machine function into the tool
 * response text the parent agent will see, and persist any needed
 * continuation state. Shared between yith_trigger (initial dispatch)
 * and yith_commit_work (step advancement) so both paths produce
 * identical response shapes.
 *
 * @param functionId  the -step function to dispatch on future commits
 * @param originalArgs  the user's original args from yith_trigger
 * @param result  what the state-machine function just returned
 * @param archive  the YithArchiveHandle for store access
 * @param continuation  existing continuation token if this is an update
 *                      (empty string on first step so save() generates one)
 */
async function handleStepResult(
  functionId: string,
  originalArgs: unknown,
  result: StepResult,
  archive: YithArchiveHandle,
  continuation: string,
): Promise<unknown> {
  if (result.done) {
    // Terminal — clean up any pending state and return the result.
    if (continuation) {
      await archive.workPacketStore.delete(continuation)
    }
    return { status: "success" as const, result: result.result }
  }

  // Non-terminal — save the updated state and emit a NeedsWorkResponse.
  const saved = await archive.workPacketStore.save({
    continuation: continuation || undefined,
    functionId,
    currentStep: result.nextStep,
    originalArgs,
    intermediateState: result.intermediateState,
    workPackets: result.workPackets,
  })

  const response: NeedsWorkResponse = {
    status: "needs_llm_work",
    workPackets: result.workPackets,
    continuation: saved.continuation,
    commitTool: "yith_commit_work",
    instructions: result.instructions ?? DEFAULT_INSTRUCTIONS,
  }
  return response
}

/** Wrap an arbitrary result in the MCP CallToolResult content shape. */
function textResult(result: unknown): {
  content: Array<{ type: "text"; text: string }>
} {
  const text =
    typeof result === "string" ? result : JSON.stringify(result, null, 2)
  return { content: [{ type: "text" as const, text }] }
}

/** Wrap an error as an MCP CallToolResult with isError flag set. */
function errorResult(err: unknown): {
  content: Array<{ type: "text"; text: string }>
  isError: true
} {
  const message = err instanceof Error ? err.message : String(err)
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  }
}

/**
 * Registers the five core tools plus the yith_trigger escape hatch on the
 * given MCP server. Callbacks dispatch into the provided archive handle.
 */
export function registerYithTools(
  server: McpServer,
  archive: YithArchiveHandle,
): void {
  // yith_remember — save a durable memory.
  server.registerTool(
    "yith_remember",
    {
      description:
        "Save a durable cross-session memory. Use for non-obvious facts, " +
        "decisions, preferences, constraints, past incidents — anything a " +
        "future session would benefit from knowing but cannot derive from " +
        "the current code or git history.",
      inputSchema: {
        content: z
          .string()
          .describe("The memory content — what should be remembered."),
        type: z
          .string()
          .optional()
          .describe(
            "Category: user, feedback, project, reference, decision, etc.",
          ),
        concepts: z
          .array(z.string())
          .optional()
          .describe("Concept tags for retrieval and graph linking."),
        files: z
          .array(z.string())
          .optional()
          .describe("Related file paths — anchors the memory to code."),
        ttlDays: z
          .number()
          .optional()
          .describe("Days until auto-expiry. Omit for permanent."),
        sourceObservationIds: z
          .array(z.string())
          .optional()
          .describe("Observation IDs this memory was crystallized from."),
      },
    },
    async (args) => {
      try {
        const result = await archive.remember(args)
        return textResult(result)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // yith_search — semantic + lexical hybrid search over stored memories.
  server.registerTool(
    "yith_search",
    {
      description:
        "Search the memory archive by semantic + lexical hybrid ranking. " +
        "Call this BEFORE re-exploring the codebase for context a prior " +
        "session may already have captured.",
      inputSchema: {
        query: z.string().describe("Natural-language query."),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Max results to return. Default 10."),
      },
    },
    async (args) => {
      try {
        const result = await archive.search(args)
        return textResult(result)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // yith_recall — alias of search, semantically distinguished for "remind me"
  // style queries. Same underlying dispatch (mem::smart-search).
  server.registerTool(
    "yith_recall",
    {
      description:
        "Recall memories matching a query. Alias of yith_search — use " +
        "whichever reads more naturally for your intent.",
      inputSchema: {
        query: z.string().describe("Natural-language query."),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Max results to return. Default 10."),
      },
    },
    async (args) => {
      try {
        const result = await archive.recall(args)
        return textResult(result)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // yith_context — assemble the memory bundle relevant to the current project.
  server.registerTool(
    "yith_context",
    {
      description:
        "Assemble a context bundle for the given project — the most " +
        "relevant memories, profile info, and recent observations packed " +
        "into a token-budgeted payload ready to drop into a session.",
      inputSchema: {
        project: z
          .string()
          .describe("Project identifier — usually the absolute repo path."),
        sessionId: z
          .string()
          .optional()
          .describe("Current session ID for session-scoped context."),
      },
    },
    async (args) => {
      try {
        const result = await archive.context(args)
        return textResult(result)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // yith_observe — log a raw observation for later compression/crystallization.
  server.registerTool(
    "yith_observe",
    {
      description:
        "Log a raw observation from the current session. Observations are " +
        "intermediate — they get compressed and eventually crystallized into " +
        "durable memories by the background pipeline.",
      inputSchema: {
        sessionId: z.string().describe("Current session ID."),
        project: z
          .string()
          .describe("Project identifier — usually the absolute repo path."),
        cwd: z.string().describe("Current working directory."),
        timestamp: z
          .string()
          .describe("ISO 8601 timestamp when the observation was made."),
        data: z
          .unknown()
          .describe("Arbitrary payload — the observation content."),
      },
    },
    async (args) => {
      try {
        const result = await archive.observe(
          args as Parameters<YithArchiveHandle["observe"]>[0],
        )
        return textResult(result)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // yith_commit_work — feeds LLM completions back into a paused Yith
  // state machine. Parent agents receive a `needs_llm_work` response
  // from yith_trigger when Yith couldn't run an LLM call itself (no
  // API key present); they execute the prompts with their own auth
  // and then call this tool to deliver the results. The Yith function
  // resumes from where it paused, either finishing or requesting
  // another round. Stub implementation in 3b-2; real dispatch wired
  // in 3b-4 alongside the yith_trigger intercept.
  server.registerTool(
    "yith_commit_work",
    {
      description:
        "Deliver LLM completions for a pending Yith work-packet flow.\n\n" +
        "When you call yith_trigger on an advanced memory function and Yith " +
        "has no LLM provider configured, it returns a response with " +
        '`status: "needs_llm_work"`, a `continuation` token, and one or more ' +
        "`workPackets` (each with a systemPrompt + userPrompt). Execute each " +
        "packet's prompt using your own LLM access — either inline in your " +
        "current context or via a Task subagent — and then call this tool " +
        "with the continuation token and an array of " +
        "`{id, completion}` results (one per packet). Yith will resume the " +
        "paused function and either return a terminal `success` response " +
        "with the final result, or another `needs_llm_work` response " +
        "requesting the next round of packets. Loop until the response is " +
        "terminal.",
      inputSchema: {
        continuation: z
          .string()
          .describe(
            "Opaque token from the needs_llm_work response that identifies " +
              "which paused flow to resume.",
          ),
        packetResults: z
          .array(
            z.object({
              id: z
                .string()
                .describe("The WorkPacket.id from the needs_llm_work response."),
              completion: z
                .string()
                .describe(
                  "The LLM's completion text for this packet's prompts.",
                ),
            }),
          )
          .describe(
            "One entry per packet in the needs_llm_work response. Order " +
              "doesn't matter — they're matched by id.",
          ),
      },
    },
    async ({ continuation, packetResults }) => {
      try {
        // 1. Load the paused state. load() returns null for missing
        //    OR expired tokens (expired entries are auto-deleted on
        //    load, so a retry after expiry looks the same as a bogus
        //    token from the caller's perspective).
        const pending: PendingWork | null =
          await archive.workPacketStore.load(continuation)
        if (!pending) {
          return errorResult(
            new Error(
              `yith_commit_work: no pending work for continuation '${continuation}'. ` +
                "Either the token is wrong, or the flow expired (24h TTL), " +
                "or it was already successfully completed. Re-run the " +
                "original yith_trigger call to start a fresh flow.",
            ),
          )
        }

        // 2. Convert the flat packetResults array into the
        //    {packetId → completion} map the step functions expect.
        const completions: Record<string, string> = {}
        for (const r of packetResults) {
          completions[r.id] = r.completion
        }

        // 3. Dispatch the state-machine function at step = currentStep.
        //    (save() writes the NEXT step to expect, so the pending
        //    record's currentStep is already pointing at the right one.)
        const stepInput: StepInput = {
          step: pending.currentStep,
          originalArgs: pending.originalArgs,
          intermediateState: pending.intermediateState,
          completions,
        }
        const result = (await archive.sdk.trigger(
          pending.functionId,
          stepInput,
        )) as StepResult

        // 4. Handle terminal vs needs-more-work uniformly.
        const response = await handleStepResult(
          pending.functionId,
          pending.originalArgs,
          result,
          archive,
          continuation,
        )
        return textResult(response)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // yith_trigger — escape hatch for the ~90 advanced memory functions that
  // aren't surfaced as first-class MCP tools. The description embeds the
  // curated top-20 catalog from yith-catalog.ts so subagents see useful
  // names inline. Dumb dispatch in step 3a; step 3b will intercept
  // LLM-requiring functions and route them through a work-packet protocol.
  server.registerTool(
    "yith_trigger",
    {
      description: buildTriggerDescription(),
      inputSchema: {
        name: z
          .string()
          .describe(
            "Registered function name, typically prefixed 'mem::' " +
              "(e.g. 'mem::consolidate-pipeline', 'mem::auto-forget').",
          ),
        args: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Arguments object passed through to the function."),
      },
    },
    async ({ name, args }) => {
      try {
        const callArgs = args ?? {}

        // Work-packet interception: if the function is one we've ported
        // to a state machine AND no LLM provider is resolved, dispatch
        // the -step variant with step=0 instead of the direct function.
        // This lets sessions with no API keys still use LLM-requiring
        // ops through the work-packet → commit flow.
        const stepFunctionId = LLM_FUNCTION_REGISTRY[name]
        if (stepFunctionId && !archive.hasLLMProvider) {
          const stepInput: StepInput = {
            step: 0,
            originalArgs: callArgs,
          }
          const result = (await archive.sdk.trigger(
            stepFunctionId,
            stepInput,
          )) as StepResult
          const response = await handleStepResult(
            stepFunctionId,
            callArgs,
            result,
            archive,
            "",
          )
          return textResult(response)
        }

        // Direct-path: either the function has no state-machine variant,
        // or the provider is resolved and can run the LLM call in-process.
        const result = await archive.sdk.trigger(name, callArgs)
        return textResult(result)
      } catch (err) {
        return errorResult(err)
      }
    },
  )
}
