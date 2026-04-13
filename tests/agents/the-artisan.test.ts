/**
 * The Artisan Agent Tests
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  createArtisanAgent,
  THE_ARTISAN_PROMPT_METADATA,
  ARTISAN_PROMPT,
} from "../../src/agents/the-artisan.js"

test("the-artisan agent", async t => {
  await t.test("agent metadata", async t => {
    await t.test("has correct category", () => {
      assert.equal(THE_ARTISAN_PROMPT_METADATA.category, "utility")
    })

    await t.test("has correct cost tier", () => {
      assert.equal(THE_ARTISAN_PROMPT_METADATA.cost, "MODERATE")
    })

    await t.test("has promptAlias", () => {
      assert.equal(THE_ARTISAN_PROMPT_METADATA.promptAlias, "The Artisan")
    })

    await t.test("has keyTrigger defined", () => {
      assert.ok(THE_ARTISAN_PROMPT_METADATA.keyTrigger)
      assert.match(THE_ARTISAN_PROMPT_METADATA.keyTrigger, /Design/)
    })

    await t.test("has useWhen cases", () => {
      assert.ok(THE_ARTISAN_PROMPT_METADATA.useWhen)
      assert.ok(Array.isArray(THE_ARTISAN_PROMPT_METADATA.useWhen))
      assert.ok(THE_ARTISAN_PROMPT_METADATA.useWhen!.length > 0)
    })

    await t.test("has avoidWhen cases", () => {
      assert.ok(THE_ARTISAN_PROMPT_METADATA.avoidWhen)
      assert.ok(Array.isArray(THE_ARTISAN_PROMPT_METADATA.avoidWhen))
      assert.ok(THE_ARTISAN_PROMPT_METADATA.avoidWhen!.length > 0)
    })

    await t.test("has design-specific triggers", () => {
      assert.ok(THE_ARTISAN_PROMPT_METADATA.triggers)
      assert.ok(Array.isArray(THE_ARTISAN_PROMPT_METADATA.triggers))
      assert.ok(THE_ARTISAN_PROMPT_METADATA.triggers!.length > 0)
    })
  })

  await t.test("system prompt", async t => {
    await t.test("defines design philosophy", () => {
      assert.match(ARTISAN_PROMPT, /design philosophy/i)
    })

    await t.test("mentions design-first methodology", () => {
      assert.match(ARTISAN_PROMPT, /Intent/)
      assert.match(ARTISAN_PROMPT, /Specification/)
      assert.match(ARTISAN_PROMPT, /Implementation/)
      assert.match(ARTISAN_PROMPT, /Polish/)
    })

    await t.test("emphasizes accessibility", () => {
      assert.match(ARTISAN_PROMPT, /Accessibility/)
      assert.match(ARTISAN_PROMPT, /WCAG/)
    })

    await t.test("mentions responsive design", () => {
      assert.match(ARTISAN_PROMPT, /responsive/)
      assert.match(ARTISAN_PROMPT, /mobile-first/)
    })

    await t.test("includes performance considerations", () => {
      assert.match(ARTISAN_PROMPT, /Performance/)
    })

    await t.test("references available tools", () => {
      assert.match(ARTISAN_PROMPT, /TOOLS/)
      assert.match(ARTISAN_PROMPT, /Read.*Write.*Edit/)
    })

    await t.test("has defer guidance for other agents", () => {
      assert.match(ARTISAN_PROMPT, /WHEN TO DEFER/)
    })
  })

  await t.test("createArtisanAgent factory", async t => {
    await t.test("creates agent with correct name", () => {
      const agent = createArtisanAgent("claude-opus-4-6")
      assert.equal(agent.name, "the-artisan")
    })

    await t.test("creates agent with subagent mode", () => {
      const agent = createArtisanAgent("claude-opus-4-6")
      assert.equal(agent.mode, "subagent")
    })

    await t.test("uses provided model", () => {
      const agent = createArtisanAgent("claude-haiku-4-5")
      assert.equal(agent.model, "claude-haiku-4-5")
    })

    await t.test("has design-appropriate temperature", () => {
      const agent = createArtisanAgent("claude-opus-4-6")
      assert.equal(agent.temperature, 0.7)
    })

    await t.test("has sufficient maxTokens", () => {
      const agent = createArtisanAgent("claude-opus-4-6")
      assert.ok(agent.maxTokens && agent.maxTokens >= 8000)
    })

    await t.test("includes system prompt", () => {
      const agent = createArtisanAgent("claude-opus-4-6")
      assert.equal(agent.prompt, ARTISAN_PROMPT)
    })

    await t.test("has design-appropriate color", () => {
      const agent = createArtisanAgent("claude-opus-4-6")
      assert.ok(agent.color)
      assert.equal(typeof agent.color, "string")
      assert.match(agent.color, /^#[0-9A-F]{6}$/i)
    })

    await t.test("enables design-relevant tools", () => {
      const agent = createArtisanAgent("claude-opus-4-6")
      assert.ok(agent.tools)
      assert.equal(agent.tools!.Read, true)
      assert.equal(agent.tools!.Write, true)
      assert.equal(agent.tools!.Edit, true)
      assert.equal(agent.tools!.WebFetch, true)
      assert.equal(agent.tools!.WebSearch, true)
      assert.equal(agent.tools!.Bash, true)
    })

    await t.test("disables expensive tools", () => {
      const agent = createArtisanAgent("claude-opus-4-6")
      assert.ok(agent.tools)
      assert.equal(agent.tools!["Claude API"], false)
      assert.equal(agent.tools!["RemoteTrigger"], false)
    })

    await t.test("includes frontend-acolyte skill", () => {
      const agent = createArtisanAgent("claude-opus-4-6")
      assert.ok(agent.skills)
      assert.ok(agent.skills.includes("frontend-acolyte"))
    })

    await t.test("has helpful description", () => {
      const agent = createArtisanAgent("claude-opus-4-6")
      assert.ok(agent.description)
      assert.ok(agent.description.length > 20)
      assert.match(agent.description, /design/i)
    })

    await t.test("accepts optional parameters without errors", () => {
      const agent = createArtisanAgent("claude-opus-4-6", [], [], [], [])
      assert.ok(agent)
      assert.equal(agent.name, "the-artisan")
    })
  })

  await t.test("agent configuration completeness", async t => {
    await t.test("has all required config properties", () => {
      const agent = createArtisanAgent("claude-opus-4-6")
      assert.ok(agent.name)
      assert.ok(agent.description)
      assert.ok(agent.mode)
      assert.ok(agent.model)
      assert.ok(agent.prompt)
    })

    await t.test("tool configuration is valid", () => {
      const agent = createArtisanAgent("claude-opus-4-6")
      if (agent.tools) {
        Object.values(agent.tools).forEach(value => {
          assert.equal(typeof value, "boolean")
        })
      }
    })

    await t.test("temperature is valid range", () => {
      const agent = createArtisanAgent("claude-opus-4-6")
      if (agent.temperature !== undefined) {
        assert.ok(agent.temperature >= 0)
        assert.ok(agent.temperature <= 2)
      }
    })
  })
})
