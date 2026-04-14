/**
 * Nodens Agent Tests
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  createNodenAgent,
  NODENS_PROMPT_METADATA,
  NODENS_PROMPT,
} from "../../src/agents/nodens.js"

test("nodens agent", async t => {
  await t.test("agent metadata", async t => {
    await t.test("has correct category", () => {
      assert.equal(NODENS_PROMPT_METADATA.category, "utility")
    })

    await t.test("has correct cost tier", () => {
      assert.equal(NODENS_PROMPT_METADATA.cost, "MODERATE")
    })

    await t.test("has promptAlias", () => {
      assert.equal(NODENS_PROMPT_METADATA.promptAlias, "Nodens")
    })

    await t.test("has keyTrigger defined", () => {
      assert.ok(NODENS_PROMPT_METADATA.keyTrigger)
      assert.match(NODENS_PROMPT_METADATA.keyTrigger, /Design/)
    })

    await t.test("has useWhen cases", () => {
      assert.ok(NODENS_PROMPT_METADATA.useWhen)
      assert.ok(Array.isArray(NODENS_PROMPT_METADATA.useWhen))
      assert.ok(NODENS_PROMPT_METADATA.useWhen!.length > 0)
    })

    await t.test("has avoidWhen cases", () => {
      assert.ok(NODENS_PROMPT_METADATA.avoidWhen)
      assert.ok(Array.isArray(NODENS_PROMPT_METADATA.avoidWhen))
      assert.ok(NODENS_PROMPT_METADATA.avoidWhen!.length > 0)
    })

    await t.test("has design-specific triggers", () => {
      assert.ok(NODENS_PROMPT_METADATA.triggers)
      assert.ok(Array.isArray(NODENS_PROMPT_METADATA.triggers))
      assert.ok(NODENS_PROMPT_METADATA.triggers!.length > 0)
    })
  })

  await t.test("system prompt", async t => {
    await t.test("defines design philosophy", () => {
      assert.match(NODENS_PROMPT, /design philosophy/i)
    })

    await t.test("mentions design-first methodology", () => {
      assert.match(NODENS_PROMPT, /Intent/)
      assert.match(NODENS_PROMPT, /Specification/)
      assert.match(NODENS_PROMPT, /Implementation/)
      assert.match(NODENS_PROMPT, /Polish/)
    })

    await t.test("emphasizes accessibility", () => {
      assert.match(NODENS_PROMPT, /Accessibility/)
      assert.match(NODENS_PROMPT, /WCAG/)
    })

    await t.test("mentions responsive design", () => {
      assert.match(NODENS_PROMPT, /responsive/)
      assert.match(NODENS_PROMPT, /mobile-first/)
    })

    await t.test("includes performance considerations", () => {
      assert.match(NODENS_PROMPT, /Performance/)
    })

    await t.test("references available tools", () => {
      assert.match(NODENS_PROMPT, /TOOLS/)
      assert.match(NODENS_PROMPT, /Read.*Write.*Edit/)
    })

    await t.test("has defer guidance for other agents", () => {
      assert.match(NODENS_PROMPT, /WHEN TO DEFER/)
    })
  })

  await t.test("createNodenAgent factory", async t => {
    await t.test("creates agent with correct name", () => {
      const agent = createNodenAgent("claude-opus-4-6")
      assert.equal(agent.name, "nodens")
    })

    await t.test("creates agent with subagent mode", () => {
      const agent = createNodenAgent("claude-opus-4-6")
      assert.equal(agent.mode, "subagent")
    })

    await t.test("uses provided model", () => {
      const agent = createNodenAgent("claude-haiku-4-5")
      assert.equal(agent.model, "claude-haiku-4-5")
    })

    await t.test("has design-appropriate temperature", () => {
      const agent = createNodenAgent("claude-opus-4-6")
      assert.equal(agent.temperature, 0.7)
    })

    await t.test("has sufficient maxTokens", () => {
      const agent = createNodenAgent("claude-opus-4-6")
      assert.ok(agent.maxTokens && agent.maxTokens >= 8000)
    })

    await t.test("includes system prompt", () => {
      const agent = createNodenAgent("claude-opus-4-6")
      assert.equal(agent.prompt, NODENS_PROMPT)
    })

    await t.test("has design-appropriate color", () => {
      const agent = createNodenAgent("claude-opus-4-6")
      assert.ok(agent.color)
      assert.equal(typeof agent.color, "string")
      assert.match(agent.color, /^#[0-9A-F]{6}$/i)
    })

    await t.test("enables design-relevant tools", () => {
      const agent = createNodenAgent("claude-opus-4-6")
      assert.ok(agent.tools)
      assert.equal(agent.tools!.Read, true)
      assert.equal(agent.tools!.Write, true)
      assert.equal(agent.tools!.Edit, true)
      assert.equal(agent.tools!.WebFetch, true)
      assert.equal(agent.tools!.WebSearch, true)
      assert.equal(agent.tools!.Bash, true)
    })

    await t.test("disables expensive tools", () => {
      const agent = createNodenAgent("claude-opus-4-6")
      assert.ok(agent.tools)
      assert.equal(agent.tools!["Claude API"], false)
      assert.equal(agent.tools!["RemoteTrigger"], false)
    })

    await t.test("includes frontend-acolyte skill", () => {
      const agent = createNodenAgent("claude-opus-4-6")
      assert.ok(agent.skills)
      assert.ok(agent.skills.includes("frontend-acolyte"))
    })

    await t.test("has helpful description", () => {
      const agent = createNodenAgent("claude-opus-4-6")
      assert.ok(agent.description)
      assert.ok(agent.description.length > 20)
      assert.match(agent.description, /design|craftsmanship/i)
    })

    await t.test("accepts optional parameters without errors", () => {
      const agent = createNodenAgent("claude-opus-4-6", [], [], [], [])
      assert.ok(agent)
      assert.equal(agent.name, "nodens")
    })
  })

  await t.test("agent configuration completeness", async t => {
    await t.test("has all required config properties", () => {
      const agent = createNodenAgent("claude-opus-4-6")
      assert.ok(agent.name)
      assert.ok(agent.description)
      assert.ok(agent.mode)
      assert.ok(agent.model)
      assert.ok(agent.prompt)
    })

    await t.test("tool configuration is valid", () => {
      const agent = createNodenAgent("claude-opus-4-6")
      if (agent.tools) {
        Object.values(agent.tools).forEach(value => {
          assert.equal(typeof value, "boolean")
        })
      }
    })

    await t.test("temperature is valid range", () => {
      const agent = createNodenAgent("claude-opus-4-6")
      if (agent.temperature !== undefined) {
        assert.ok(agent.temperature >= 0)
        assert.ok(agent.temperature <= 2)
      }
    })
  })
})
