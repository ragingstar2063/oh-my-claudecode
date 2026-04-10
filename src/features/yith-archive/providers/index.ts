import type {
  MemoryProvider,
  ProviderConfig,
  FallbackConfig,
} from "../types.js";
import { AnthropicProvider } from "./anthropic.js";
import { MinimaxProvider } from "./minimax.js";
import { OpenRouterProvider } from "./openrouter.js";
import { ResilientProvider } from "./resilient.js";
import { FallbackChainProvider } from "./fallback-chain.js";
import { getEnvVar } from "../config.js";
import { logger } from "../state/logger.js";

export { createEmbeddingProvider } from "./embedding/index.js";

/**
 * Returns true if the configured provider has a usable API key in the env.
 * Lets callers decide whether to construct eagerly or defer to work-packet
 * mode without relying on throw/catch control flow.
 */
export function hasLLMCredentials(config: ProviderConfig): boolean {
  switch (config.provider) {
    case "minimax":
      return Boolean(getEnvVar("MINIMAX_API_KEY"));
    case "anthropic":
      return Boolean(getEnvVar("ANTHROPIC_API_KEY"));
    case "gemini":
      return Boolean(getEnvVar("GEMINI_API_KEY"));
    case "openrouter":
      return Boolean(getEnvVar("OPENROUTER_API_KEY"));
    case "agent-sdk":
    default:
      // "agent-sdk" is currently an alias for the anthropic provider and
      // therefore requires the same key. When Claude Code ships MCP sampling
      // (issue #1785) we'll add a real agent-sdk path that needs no key.
      return Boolean(getEnvVar("ANTHROPIC_API_KEY"));
  }
}

/**
 * Lazy LLM provider. Defers real construction until the first compress() or
 * summarize() call. The five core Yith operations (remember/search/recall/
 * context/observe) don't touch the LLM, so the archive can boot and serve
 * them with no credentials at all. Only functions that genuinely need an LLM
 * (compress, summarize, consolidate, enrich, graph extraction, etc.) trigger
 * resolution, and only when invoked.
 *
 * When credentials are missing, the resolver throws a clear error naming the
 * work-packet alternative. Step 3's MCP tool handlers will intercept the
 * error path for advanced ops and convert it into a work-packet response
 * that the parent Claude agent can execute using the session's own auth.
 */
export class LazyLLMProvider implements MemoryProvider {
  public readonly name = "lazy";
  private _real: MemoryProvider | null = null;
  private readonly _construct: () => MemoryProvider | null;

  constructor(construct: () => MemoryProvider | null) {
    this._construct = construct;
  }

  /** True if a real provider has been constructed (credentials present). */
  get isResolved(): boolean {
    return this._real !== null;
  }

  private resolve(): MemoryProvider {
    if (this._real) return this._real;
    const real = this._construct();
    if (!real) {
      throw new Error(
        "Yith: this operation requires an LLM, but no provider is configured. " +
          "Either (a) set ANTHROPIC_API_KEY / GEMINI_API_KEY / OPENROUTER_API_KEY " +
          "in ~/.oh-my-claudecode/yith/.env, or (b) route the call through the " +
          "work-packet flow so the parent Claude agent executes it using the " +
          "session's own auth.",
      );
    }
    this._real = real;
    logger.info(`LLM provider resolved on first use: ${real.name}`);
    return real;
  }

  async compress(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.resolve().compress(systemPrompt, userPrompt);
  }

  async summarize(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.resolve().summarize(systemPrompt, userPrompt);
  }
}

function requireEnvVar(key: string): string {
  const value = getEnvVar(key);
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. Set it in ~/.oh-my-claudecode/yith/.env or as an environment variable.`,
    );
  }
  return value;
}

export function createProvider(config: ProviderConfig): ResilientProvider {
  return new ResilientProvider(createBaseProvider(config));
}

export function createFallbackProvider(
  config: ProviderConfig,
  fallbackConfig: FallbackConfig,
): ResilientProvider {
  if (fallbackConfig.providers.length === 0) {
    return createProvider(config);
  }

  const providers: MemoryProvider[] = [createBaseProvider(config)];
  for (const providerType of fallbackConfig.providers) {
    if (providerType === config.provider) continue;
    try {
      const fbConfig: ProviderConfig = {
        provider: providerType,
        model: config.model,
        maxTokens: config.maxTokens,
      };
      providers.push(createBaseProvider(fbConfig));
    } catch {
      // skip unavailable fallback providers
    }
  }

  if (providers.length > 1) {
    return new ResilientProvider(new FallbackChainProvider(providers));
  }
  return new ResilientProvider(providers[0]);
}

function createBaseProvider(config: ProviderConfig): MemoryProvider {
  switch (config.provider) {
    case "minimax":
      return new MinimaxProvider(
        requireEnvVar("MINIMAX_API_KEY"),
        config.model,
        config.maxTokens,
      );
    case "anthropic":
      return new AnthropicProvider(
        requireEnvVar("ANTHROPIC_API_KEY"),
        config.model,
        config.maxTokens,
        config.baseURL,
      );
    case "gemini":
      return new OpenRouterProvider(
        requireEnvVar("GEMINI_API_KEY"),
        config.model,
        config.maxTokens,
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      );
    case "openrouter":
      return new OpenRouterProvider(
        requireEnvVar("OPENROUTER_API_KEY"),
        config.model,
        config.maxTokens,
        "https://openrouter.ai/api/v1/chat/completions",
      );
    case "agent-sdk":
    default:
      return new AnthropicProvider(
        requireEnvVar("ANTHROPIC_API_KEY"),
        config.model,
        config.maxTokens,
        config.baseURL,
      );
  }
}
