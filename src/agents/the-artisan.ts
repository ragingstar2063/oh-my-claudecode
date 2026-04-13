/**
 * The Artisan — Frontend Design Specialization Agent
 *
 * A subagent that specializes in frontend and UI/UX design tasks.
 * Guides users through design methodology: intent → spec → implementation → polish
 */

import type { AgentConfig, AgentPromptMetadata } from "./types.js"
import type { AvailableAgent, AvailableSkill, AvailableCategory } from "./types.js"

/**
 * Prompt metadata for The Artisan — instructs Cthulhu orchestrator
 */
export const THE_ARTISAN_PROMPT_METADATA: AgentPromptMetadata = {
  category: "utility",
  cost: "MODERATE",
  promptAlias: "The Artisan",
  keyTrigger: "Design, UI/UX, component, interface, layout, accessibility",
  useWhen: [
    "User asks to design or build a component",
    "User needs UI/UX guidance or design system recommendations",
    "User wants accessibility (a11y) or responsive design help",
    "User is working on frontend architecture or design tokens",
    "User needs design methodology: intent → spec → impl → polish",
  ],
  avoidWhen: [
    "Backend-only work (databases, APIs, server logic)",
    "User explicitly asks for speed (fast, quick) — use Hastur instead",
    "Low-level infrastructure or DevOps tasks",
  ],
  triggers: [
    { domain: "component", trigger: "Design a React/Vue/Svelte/Angular component" },
    { domain: "ui", trigger: "Create a UI layout, card, button, form" },
    { domain: "interface", trigger: "Design an interface or specification" },
    { domain: "a11y", trigger: "Accessibility improvements, WCAG compliance" },
    { domain: "responsive", trigger: "Mobile-first, responsive design, breakpoints" },
    { domain: "design-tokens", trigger: "Design system, design tokens, theming" },
  ],
}

/**
 * System prompt for The Artisan
 *
 * Guides the agent through a design-first methodology:
 * 1. Intent: Understand what the user wants to build and why
 * 2. Specification: Define the design in words before implementing
 * 3. Implementation: Code the component following the spec
 * 4. Polish: Refine, add accessibility, responsive breakpoints, animations
 */
export const ARTISAN_PROMPT = `You are The Artisan — a frontend design specialization agent within oh-my-claudecode.

## DESIGN PHILOSOPHY
Your job is to help users craft beautiful, accessible, well-designed interfaces and components.
You follow a **Design-First Methodology**:

1. **Intent** — Clarify what the user wants to build and why. Ask clarifying questions.
   - What's the purpose? Who's the user? What problem does it solve?

2. **Specification** — Define the design before code. Use words, not code yet.
   - Layout structure, typography, colors, spacing, interactions, accessibility needs
   - Create a visual/textual specification that the user approves

3. **Implementation** — Write clean, accessible code following the spec.
   - Use semantic HTML, proper ARIA labels, keyboard navigation
   - Follow WCAG 2.1 accessibility standards
   - Use CSS Grid/Flexbox for layout, mobile-first responsive design
   - Consider design tokens (colors, typography, spacing scales)

4. **Polish** — Refine the component.
   - Add animations/transitions for better UX
   - Test responsive behavior across breakpoints
   - Verify accessibility with screen readers
   - Optimize performance (lazy loading, code splitting)

## KEY PRINCIPLES
- **Accessibility First** — WCAG 2.1 AA standard minimum
- **Responsive by Default** — Mobile-first approach, test on small/medium/large screens
- **Design Tokens** — Use consistent spacing, colors, typography via tokens/CSS vars
- **Performance** — Optimize bundle size, avoid unnecessary re-renders
- **Documentation** — Document component API, usage examples, edge cases
- **Component Reusability** — Design for composition and reuse

## TOOLS
You have access to:
- Read/Write/Edit — For working with component files
- WebFetch — For design inspiration, documentation
- WebSearch — For latest UI/UX patterns, accessibility best practices
- Bash — For building, testing, previewing components

## WORKFLOW FOR DESIGN TASKS
1. Ask clarifying questions about intent (audience, purpose, constraints)
2. Propose a specification (layout, colors, typography, interactions)
3. Get approval before implementing
4. Write the component code (HTML, CSS, JavaScript/TypeScript)
5. Add accessibility features (ARIA, semantic HTML, keyboard nav)
6. Ensure responsive design (test at multiple breakpoints)
7. Document the component (API, examples, accessibility notes)

## WHEN TO DEFER
- Backend/API design → refer to Yog-Sothoth (architecture advisor)
- Rapid prototyping (low quality) → refer to Hastur (fast turnaround)
- Code review/quality → refer to Tsathoggua (quality reviewer)
- Search/exploration → refer to Dagon (search specialist)

Remember: Good design is invisible. Users shouldn't think about the interface — they should just use it.
Accessibility and performance are features, not afterthoughts.`

/**
 * Factory function to create The Artisan agent configuration
 *
 * @param model - The Claude model to use for this agent
 * @param availableAgents - List of available agents (for prompt context)
 * @param availableToolNames - List of available tools (for tool config)
 * @param availableSkills - List of available skills (for skill injection)
 * @param availableCategories - List of available categories (for category context)
 * @returns AgentConfig for The Artisan
 */
export function createArtisanAgent(
  model: string,
  availableAgents?: AvailableAgent[],
  availableToolNames?: string[],
  availableSkills?: AvailableSkill[],
  availableCategories?: AvailableCategory[],
): AgentConfig {
  return {
    name: "the-artisan",
    description: "Frontend design specialist — guides users through design methodology: intent → spec → impl → polish",
    mode: "subagent",
    model,
    temperature: 0.7, // Slightly creative for design
    maxTokens: 16000,
    prompt: ARTISAN_PROMPT,
    color: "#FF6B35", // Warm orange for creative/design
    tools: {
      // Read/Write/Edit for working with files
      Read: true,
      Write: true,
      Edit: true,

      // Web tools for research and inspiration
      WebFetch: true,
      WebSearch: true,

      // Bash for building/testing components
      Bash: true,

      // Disable expensive tools
      "Claude API": false,
      RemoteTrigger: false,
    },
    skills: ["frontend-acolyte"],
  }
}

/**
 * Export metadata for registration in AGENT_METADATA_MAP
 */
export const ARTISAN_AGENT_METADATA = {
  metadata: THE_ARTISAN_PROMPT_METADATA,
  factory: createArtisanAgent,
}
