/**
 * Block Summarizer — in-session context trimming via delegation-as-block.
 *
 * Every time Cthulhu delegates to a specialist via the Agent tool, the full
 * subagent output can be piped through `summarizeBlock()`. The full text is
 * written to `.elder-gods/blocks/<timestamp>-<slug>.md` on disk, and a short
 * summary is returned for Cthulhu to continue reasoning with. The main context
 * only carries the summary from that point on — Cthulhu can re-read the full
 * block from disk if the summary turns out to be insufficient.
 *
 * Inspiration: Microsoft's Memento paper splits chain-of-thought reasoning
 * into blocks and summaries, evicting block content from the KV cache after
 * each summary. We can't touch the KV cache from a harness, but we can apply
 * the same idea at the delegation boundary: each delegation is a block, the
 * block content lives on disk, the main thread proceeds with only the summary.
 *
 * The summarization step itself is pluggable. The default uses a cheap model
 * (Haiku) to produce 3-5 bullets. Callers can pass their own summarizer.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

/** Options for summarizing a delegation block. */
export interface SummarizeBlockOptions {
  /** Name of the agent or subagent_type that produced this block. */
  agentName: string
  /** The full textual output from the delegation. */
  fullOutput: string
  /** Optional short task description for the filename and prompt context. */
  taskDescription?: string
  /** Root of the project. Blocks land under `<projectRoot>/.elder-gods/blocks/`. */
  projectRoot?: string
  /** Override the summarizer. Default calls the Anthropic SDK with Haiku. */
  summarizer?: (fullOutput: string, hint?: string) => Promise<string>
  /** Max bullets in the summary. Default 5. */
  maxBullets?: number
}

/** Result of summarizing a delegation block. */
export interface BlockSummary {
  /** The short bullet-style summary that should be carried forward. */
  summary: string
  /** Absolute path to the file containing the full output on disk. */
  blockPath: string
  /** A short human-readable identifier for this block. */
  blockId: string
  /** ISO timestamp the block was recorded. */
  recordedAt: string
}

const SLUG_MAX_LEN = 40

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LEN)
    || "block"
}

function timestampSlug(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${d.getFullYear()}` +
    `${pad(d.getMonth() + 1)}` +
    `${pad(d.getDate())}` +
    `-${pad(d.getHours())}` +
    `${pad(d.getMinutes())}` +
    `${pad(d.getSeconds())}`
  )
}

/**
 * Write the full output to disk and return a short summary plus a handle
 * Cthulhu can re-read if the summary proves insufficient.
 */
export async function summarizeBlock(
  options: SummarizeBlockOptions,
): Promise<BlockSummary> {
  const {
    agentName,
    fullOutput,
    taskDescription = "",
    projectRoot = process.cwd(),
    summarizer = defaultSummarizer,
    maxBullets = 5,
  } = options

  const recordedAt = new Date().toISOString()
  const ts = timestampSlug()
  const slug = slugify(`${agentName}-${taskDescription || "output"}`)
  const fileName = `${ts}-${slug}.md`
  const dir = resolve(projectRoot, ".elder-gods", "blocks")

  mkdirSync(dir, { recursive: true })
  const blockPath = join(dir, fileName)

  const fileContents =
    `# Delegation Block — ${agentName}\n\n` +
    `- **Recorded**: ${recordedAt}\n` +
    `- **Agent**: ${agentName}\n` +
    (taskDescription ? `- **Task**: ${taskDescription}\n` : "") +
    `\n---\n\n${fullOutput}\n`

  writeFileSync(blockPath, fileContents, "utf-8")

  const summary = await summarizer(
    fullOutput,
    taskDescription ? `Agent: ${agentName}. Task: ${taskDescription}.` : `Agent: ${agentName}.`,
  )

  return {
    summary: trimBullets(summary, maxBullets),
    blockPath,
    blockId: `${ts}-${slug}`,
    recordedAt,
  }
}

/**
 * Trim a summary to at most `max` bullet lines. Preserves the natural
 * order and drops anything beyond the limit.
 */
function trimBullets(summary: string, max: number): string {
  const lines = summary.split("\n")
  const bullets: string[] = []
  const other: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^[-*•]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      if (bullets.length < max) bullets.push(line)
    } else if (bullets.length === 0) {
      other.push(line)
    }
  }
  if (bullets.length === 0) return summary.trim()
  return [...other, ...bullets].join("\n").trim()
}

/**
 * Default summarizer. Uses @anthropic-ai/sdk with Haiku to produce a 3-5 bullet
 * summary of the full delegation output. Falls back to a trivial character-count
 * truncation if the API key is absent or the call fails.
 */
async function defaultSummarizer(
  fullOutput: string,
  hint = "",
): Promise<string> {
  const apiKey = process.env["ANTHROPIC_API_KEY"]
  if (!apiKey) {
    return trivialFallback(fullOutput, hint)
  }
  try {
    const mod = await import("@anthropic-ai/sdk")
    const Anthropic = (mod as any).default ?? (mod as any).Anthropic
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      system:
        "You compress long subagent outputs into 3-5 bullet points for a main-thread orchestrator. " +
        "Bullets must capture facts, decisions, and actionable next steps. No filler, no preamble, no meta commentary.",
      messages: [
        {
          role: "user",
          content: `${hint}\n\nFull output to summarize:\n\n${fullOutput}\n\nReturn only the bullets.`,
        },
      ],
    })
    const first = response.content?.[0]
    if (first && first.type === "text") {
      return first.text
    }
  } catch {
    // fall through to trivial
  }
  return trivialFallback(fullOutput, hint)
}

function trivialFallback(fullOutput: string, hint: string): string {
  const firstLines = fullOutput
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .slice(0, 5)
    .map((l) => `- ${l.length > 160 ? l.slice(0, 157) + "..." : l}`)
    .join("\n")
  const prefix = hint ? `- Context: ${hint}\n` : ""
  return `${prefix}${firstLines}`
}
