import { z } from "zod"

// ─── Model Names ─────────────────────────────────────────────────────────────

export const ClaudeModelSchema = z.enum([
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  // short aliases
  "opus",
  "sonnet",
  "haiku",
])

export type ClaudeModel = z.infer<typeof ClaudeModelSchema>

// ─── Agent Names ──────────────────────────────────────────────────────────────

/** The 12 Elder God agents */
export const BuiltinAgentNameSchema = z.enum([
  "cthulhu",          // main orchestrator
  "nyarlathotep",     // deep autonomous worker
  "azathoth",         // first-message planner
  "shub-niggurath",   // strategic planner
  "hastur",           // lightweight orchestrator
  "yog-sothoth",      // architecture/debugging advisor
  "dagon",            // code/doc search specialist
  "ithaqua",          // pre-planning consultant
  "tsathoggua",       // code quality reviewer
  "shoggoth",         // fast codebase grepper
  "the-deep-one",     // vision agent
  "the-artisan",      // frontend design specialist
])

export type BuiltinAgentName = z.infer<typeof BuiltinAgentNameSchema>

// ─── Agent Override Schema ────────────────────────────────────────────────────

export const AgentPermissionSchema = z.record(z.string(), z.enum(["allow", "deny"]))

export const ThinkingConfigSchema = z.union([
  z.object({ type: z.literal("enabled"), budgetTokens: z.number().optional() }),
  z.object({ type: z.literal("disabled") }),
])

export const AgentOverrideConfigSchema = z.object({
  model: ClaudeModelSchema.optional(),
  skills: z.array(z.string()).optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  prompt: z.string().optional(),
  prompt_append: z.string().optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  disable: z.boolean().optional(),
  description: z.string().optional(),
  mode: z.enum(["subagent", "primary", "all"]).optional(),
  color: z.string().optional(),
  permission: AgentPermissionSchema.optional(),
  maxTokens: z.number().optional(),
  thinking: ThinkingConfigSchema.optional(),
})

export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>

export const AgentOverridesSchema = z.object({
  cthulhu: AgentOverrideConfigSchema.optional(),
  nyarlathotep: AgentOverrideConfigSchema.optional(),
  azathoth: AgentOverrideConfigSchema.optional(),
  "shub-niggurath": AgentOverrideConfigSchema.optional(),
  hastur: AgentOverrideConfigSchema.optional(),
  "yog-sothoth": AgentOverrideConfigSchema.optional(),
  dagon: AgentOverrideConfigSchema.optional(),
  ithaqua: AgentOverrideConfigSchema.optional(),
  tsathoggua: AgentOverrideConfigSchema.optional(),
  shoggoth: AgentOverrideConfigSchema.optional(),
  "the-deep-one": AgentOverrideConfigSchema.optional(),
  "the-artisan": AgentOverrideConfigSchema.optional(),
}).catchall(AgentOverrideConfigSchema)

export type AgentOverrides = z.infer<typeof AgentOverridesSchema>

// ─── Category Schema ──────────────────────────────────────────────────────────

export const BuiltinCategoryNameSchema = z.enum([
  "deep",        // Extended reasoning tasks
  "quick",       // Fast single-file tasks
  "advisor",     // Consultation and architecture
  "explorer",    // Search and discovery
  "artisan",     // Design / frontend specialization
  "watcher",     // Monitoring / verification
])

export type BuiltinCategoryName = z.infer<typeof BuiltinCategoryNameSchema>

export const CategoryConfigSchema = z.object({
  description: z.string().optional(),
  model: ClaudeModelSchema.optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().optional(),
  thinking: ThinkingConfigSchema.optional(),
  prompt_append: z.string().optional(),
  disable: z.boolean().optional(),
})

export const CategoriesConfigSchema = z
  .record(z.string(), CategoryConfigSchema)
  .optional()

export type CategoriesConfig = z.infer<typeof CategoriesConfigSchema>

// ─── Hook Name Schema ─────────────────────────────────────────────────────────

export const HookNameSchema = z.enum([
  "todo-continuation",        // Enforce todo completion before stopping
  "elder-loop",               // Self-referential completion loop
  "comment-checker",          // Remove AI-slop from comments
  "session-recovery",         // Auto-recover from API/context errors
  "background-notification",  // Notify on subagent completion
  "context-injector",         // Auto-inject AGENTS.md context
  "write-guard",              // Block writes to protected files
  "bash-read-guard",          // Warn on cat/head in bash (use Read)
  "keyword-detector",         // Detect keywords → trigger agents
  "rules-injector",           // Inject .elder-gods/rules/*.md
  "cthulhu-auto",             // Auto-activate Cthulhu when .elder-gods/ is present
  "memory-override",          // Redirect persistent memory to Yith Archive
  "yith-capture",             // Continuous Yith ingestion — fires on Stop
])

export type HookName = z.infer<typeof HookNameSchema>

// ─── Builtin Command Names ────────────────────────────────────────────────────

export const BuiltinCommandNameSchema = z.enum([
  "old-ones-init",       // Hierarchical AGENTS.md generation
  "elder-loop",          // Start elder loop
  "cancel-elder-loop",   // Stop active elder loop
  "invoke-shub",         // Begin Shub-Niggurath planning flow
  "stop-the-dreaming",   // Stop all continuation mechanisms
  "exorcise-ai-slop",    // Remove AI code smells
  "session-handoff",     // Session continuation context
])

export type BuiltinCommandName = z.infer<typeof BuiltinCommandNameSchema>

// ─── Builtin Skill Names ──────────────────────────────────────────────────────

export const BuiltinSkillNameSchema = z.enum([
  "git-keeper",        // Git workflow (git-master equivalent)
  "playwright",        // Browser automation
  "dev-browser",       // Development server browser
  "dread-reviewer",    // Code review assistant
  "slop-purge",        // AI slop removal
  "frontend-acolyte",  // Frontend design guidance
])

export type BuiltinSkillName = z.infer<typeof BuiltinSkillNameSchema>

// ─── MCP Names ────────────────────────────────────────────────────────────────

export const McpNameSchema = z.enum([
  "websearch",    // Web search (Exa / Tavily)
  "context7",     // Official documentation search
  "grep_app",     // GitHub code search
])

export type McpName = z.infer<typeof McpNameSchema>

// ─── Feature Configs ──────────────────────────────────────────────────────────

export const ElderLoopConfigSchema = z.object({
  max_iterations: z.number().min(1).max(50).default(10),
  strategy: z.enum(["reset", "continue"]).default("continue"),
  completion_prompt: z.string().optional(),
})

export const BackgroundTaskConfigSchema = z.object({
  max_concurrent: z.number().min(1).max(20).default(5),
  timeout_seconds: z.number().min(30).max(3600).default(300),
  circuit_breaker_enabled: z.boolean().default(true),
  circuit_breaker_threshold: z.number().min(1).max(10).default(3),
})

export const WebsearchConfigSchema = z.object({
  provider: z.enum(["exa", "tavily"]).default("exa"),
  api_key: z.string().optional(),
})

export const NotificationConfigSchema = z.object({
  on_background_complete: z.boolean().default(true),
  on_session_error: z.boolean().default(true),
  sound: z.boolean().default(false),
})

export const ExperimentalConfigSchema = z.object({
  safe_hook_creation: z.boolean().default(true),
  preemptive_compaction: z.boolean().default(false),
  dynamic_context_pruning: z.boolean().default(false),
})

export const CthulhuAgentConfigSchema = z.object({
  use_task_system: z.boolean().default(false),
  parallel_delegation: z.boolean().default(true),
  intent_gate_enabled: z.boolean().default(true),
})

export const GitKeeperConfigSchema = z.object({
  commit_footer: z.boolean().default(true),
  include_co_authored_by: z.boolean().default(false),
  git_env_prefix: z.string().default("ELDER_GODS=1"),
})

// ─── Three-Pillar Improvement Config Schemas ──────────────────────────────

export const WebResearchDetectorConfigSchema = z.object({
  enabled: z.boolean().default(false),
  min_confidence: z.enum(["must", "should", "maybe"]).optional(),
  trigger_types: z.array(z.string()).optional(),
})

export type WebResearchDetectorConfig = z.infer<typeof WebResearchDetectorConfigSchema>

export const TypeSafetyLinterConfigSchema = z.object({
  enabled: z.boolean().default(false),
  rules: z.record(z.string(), z.enum(["error", "warn", "info"])).optional(),
  ignore_patterns: z.array(z.string()).optional(),
})

export type TypeSafetyLinterConfig = z.infer<typeof TypeSafetyLinterConfigSchema>

export const FrontendDesignConfigSchema = z.object({
  enabled: z.boolean().default(false),
  min_confidence: z.enum(["high", "medium", "low"]).optional(),
  auto_route: z.boolean().default(false),
})

export type FrontendDesignConfig = z.infer<typeof FrontendDesignConfigSchema>

// ─── Root Config Schema ───────────────────────────────────────────────────────

export const OhMyClaudeCodeConfigSchema = z.object({
  $schema: z.string().optional(),

  /** Default agent for background runs */
  default_run_agent: z.string().default("cthulhu"),

  /** Disable specific MCP servers */
  disabled_mcps: z.array(McpNameSchema).optional(),

  /** Disable specific built-in agents */
  disabled_agents: z.array(z.string()).optional(),

  /** Disable specific built-in skills */
  disabled_skills: z.array(BuiltinSkillNameSchema).optional(),

  /** Disable specific lifecycle hooks */
  disabled_hooks: z.array(HookNameSchema).optional(),

  /** Disable specific built-in commands */
  disabled_commands: z.array(BuiltinCommandNameSchema).optional(),

  /** Disable specific tools by name */
  disabled_tools: z.array(z.string()).optional(),

  /** Environment variables forwarded to MCP servers */
  mcp_env_allowlist: z.array(z.string()).optional(),

  /** Enable model fallback on API errors (default: true) */
  model_fallback: z.boolean().default(true),

  // Per-agent overrides
  agents: AgentOverridesSchema.optional(),

  // Category-level model/parameter overrides
  categories: CategoriesConfigSchema,

  // Feature configurations
  cthulhu_agent: CthulhuAgentConfigSchema.optional(),
  elder_loop: ElderLoopConfigSchema.optional(),
  background_task: BackgroundTaskConfigSchema.optional(),
  websearch: WebsearchConfigSchema.optional(),
  notification: NotificationConfigSchema.optional(),
  git_keeper: GitKeeperConfigSchema.default({
    commit_footer: true,
    include_co_authored_by: false,
    git_env_prefix: "ELDER_GODS=1",
  }),
  experimental: ExperimentalConfigSchema.optional(),

  // Three-pillar improvements (all disabled by default)
  web_research: WebResearchDetectorConfigSchema.optional(),
  type_safety: TypeSafetyLinterConfigSchema.optional(),
  frontend_design: FrontendDesignConfigSchema.optional(),

  /** Migration tracking — prevents re-applying migrations */
  _migrations: z.array(z.string()).optional(),
})

export type OhMyClaudeCodeConfig = z.infer<typeof OhMyClaudeCodeConfigSchema>
