import type { AgentConfig, AgentMode, AgentPromptMetadata } from "./types.js"
import type { AvailableAgent, AvailableSkill, AvailableCategory } from "./types.js"

const MODE: AgentMode = "primary"

/**
 * Azathoth — First-Message Planner
 *
 * Model tier:  Opus
 *
 * Azathoth, the Blind Idiot God at the center of ultimate chaos — yet all reality
 * flows from its dreaming. Azathoth is the first contact when you enter a session.
 * Before Cthulhu takes over, Azathoth makes the initial context sweep and plan.
 */

export const AZATHOTH_PROMPT_METADATA: AgentPromptMetadata = {
  category: "orchestration",
  cost: "EXPENSIVE",
  promptAlias: "Azathoth",
  keyTrigger: "First message in session → Azathoth activates for initial context gathering",
  triggers: [
    { domain: "Session start", trigger: "Initial context gathering and planning for the session" },
  ],
  useWhen: ["Very start of a new session with complex task"],
  avoidWhen: ["Mid-session (Cthulhu handles continuation)"],
}

function buildAzathothPrompt(
  availableAgents: AvailableAgent[],
  availableSkills: AvailableSkill[],
  _availableCategories: AvailableCategory[],
): string {
  const agentList = availableAgents
    .filter(a => a.name !== "azathoth")
    .map(a => `- **${a.metadata.promptAlias ?? a.name}**: ${a.description}`)
    .join("\n")

  const skillList = availableSkills
    .map(s => `- **${s.name}**: ${s.description}`)
    .join("\n")

  return `You are "Azathoth" — the First Dreaming, the initial context gatherer of the oh-my-claudecode system.

**Your role**: You activate at the VERY BEGINNING of complex sessions to:
1. Quickly understand what the user needs
2. Survey the relevant codebase context
3. Make a lightweight plan
4. Hand off to the appropriate specialist

## Phase 1: Intent Classification (IMMEDIATE)

Read the user's first message and classify:
- **Trivial** (single file, known location) → Skip to direct execution
- **Exploratory** ("How does X work?", "Find Y") → Survey codebase quickly, answer
- **Implementation** (explicit implementation request) → Plan + handoff to Cthulhu
- **Ambiguous** → Ask ONE clarifying question

## Phase 2: Context Sweep (for non-trivial)

Launch 2-3 parallel searches to understand the relevant codebase area:
- Read AGENTS.md or CLAUDE.md if it exists
- Find key files related to the user's request
- Identify patterns to follow

**Always parallel. Never sequential.**

## Phase 3: Lightweight Plan

For implementation requests:
- Create a brief todo list (3-5 items max)
- Identify which agents/skills to involve
- Note any risks or ambiguities

## Phase 4: Execution or Handoff

- For trivial tasks: execute directly
- For complex tasks: hand off to Cthulhu with full context
- For ambiguous tasks: clarify first

## Available Specialists

${agentList || "No specialists loaded — operating solo."}

## Available Skills

${skillList || "No skills loaded."}

## Communication Style

- No preamble or acknowledgments
- Start immediately with context sweep or clarifying question
- Terse status updates
- Plan via todos, not prose

## Constraints

- This is the FIRST message. Do not assume prior context.
- Do not implement without planning (unless trivial)
- Do not skip intent classification
`
}

export function createAzathothAgent(
  model: string,
  availableAgents: AvailableAgent[] = [],
  _availableToolNames: string[] = [],
  availableSkills: AvailableSkill[] = [],
  availableCategories: AvailableCategory[] = [],
): AgentConfig {
  return {
    name: "azathoth",
    description:
      "The First Dreaming — initial context gatherer activated at session start. Surveys codebase, classifies intent, makes lightweight plan, hands off to appropriate specialist. (Azathoth — oh-my-claudecode)",
    mode: MODE,
    model,
    thinking: { type: "enabled", budgetTokens: 16000 },
    maxTokens: 32000,
    prompt: buildAzathothPrompt(availableAgents, availableSkills, availableCategories),
    color: "#FF8C00",
  }
}
createAzathothAgent.mode = MODE

export const azathothMetadata: AgentPromptMetadata = AZATHOTH_PROMPT_METADATA
