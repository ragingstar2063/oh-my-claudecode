import { strict as assert } from "assert"
import { test } from "node:test"
import { buildBuiltinAgents, AGENT_METADATA_MAP } from "../../src/agents/builtin-agents.js"

test("The Artisan agent integration", async (t) => {
  await t.test("The Artisan is registered in AGENT_METADATA_MAP", () => {
    assert(
      "the-artisan" in AGENT_METADATA_MAP,
      "The Artisan should be in AGENT_METADATA_MAP"
    )
  })

  await t.test("The Artisan metadata has correct category", () => {
    const metadata = AGENT_METADATA_MAP["the-artisan"]
    assert(metadata !== undefined)
    assert.equal(metadata.category, "utility")
  })

  await t.test("The Artisan metadata references design", () => {
    const metadata = AGENT_METADATA_MAP["the-artisan"]
    assert(metadata !== undefined)
    assert(
      (metadata.keyTrigger || "").toLowerCase().includes("design") ||
        (metadata.promptAlias || "").toLowerCase().includes("design")
    )
  })

  await t.test(
    "buildBuiltinAgents includes the-artisan when not disabled",
    () => {
      const agents = buildBuiltinAgents({
        disabledAgents: [],
        systemDefaultModel: "claude-haiku-4-5",
      })
      assert("the-artisan" in agents, "The Artisan should be built")
    }
  )

  await t.test("buildBuiltinAgents respects disabled_agents for the-artisan", () => {
    const agents = buildBuiltinAgents({
      disabledAgents: ["the-artisan"],
      systemDefaultModel: "claude-haiku-4-5",
    })
    assert(!("the-artisan" in agents), "The Artisan should be disabled")
  })

  await t.test("The Artisan agent config has correct properties", () => {
    const agents = buildBuiltinAgents({
      disabledAgents: [],
      systemDefaultModel: "claude-haiku-4-5",
    })
    const artisan = agents["the-artisan"]
    assert(artisan !== undefined)
    assert.equal(artisan.name, "the-artisan")
    assert.equal(artisan.mode, "subagent")
    assert(artisan.model.length > 0)
    assert(artisan.temperature !== undefined)
    assert(artisan.maxTokens !== undefined)
  })

  await t.test("The Artisan agent has design-appropriate tools enabled", () => {
    const agents = buildBuiltinAgents({
      disabledAgents: [],
      systemDefaultModel: "claude-haiku-4-5",
    })
    const artisan = agents["the-artisan"]
    assert(artisan !== undefined)
    assert(typeof artisan.tools === "object")
    const tools = artisan.tools as Record<string, boolean>
    assert.equal(tools.Read, true)
    assert.equal(tools.Write, true)
    assert.equal(tools.Edit, true)
    assert.equal(tools.WebSearch, true)
    assert.equal(tools.Bash, true)
  })

  await t.test("The Artisan agent disables expensive tools", () => {
    const agents = buildBuiltinAgents({
      disabledAgents: [],
      systemDefaultModel: "claude-haiku-4-5",
    })
    const artisan = agents["the-artisan"]
    assert(artisan !== undefined)
    const tools = artisan.tools as Record<string, boolean>
    assert.equal(tools["Claude API"], false)
  })

  await t.test("The Artisan agent overrides respect model parameter", () => {
    const agents = buildBuiltinAgents({
      disabledAgents: [],
      systemDefaultModel: "claude-haiku-4-5",
      agentOverrides: {
        "the-artisan": {
          model: "claude-sonnet-4-6",
        },
      },
    })
    const artisan = agents["the-artisan"]
    assert(artisan !== undefined)
    assert.equal(artisan.model, "claude-sonnet-4-6")
  })

  await t.test("The Artisan agent overrides respect temperature parameter", () => {
    const agents = buildBuiltinAgents({
      disabledAgents: [],
      systemDefaultModel: "claude-haiku-4-5",
      agentOverrides: {
        "the-artisan": {
          temperature: 0.5,
        },
      },
    })
    const artisan = agents["the-artisan"]
    assert(artisan !== undefined)
    assert.equal(artisan.temperature, 0.5)
  })
})
