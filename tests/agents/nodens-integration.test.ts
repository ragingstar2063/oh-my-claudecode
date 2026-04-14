import { strict as assert } from "assert"
import { test } from "node:test"
import { buildBuiltinAgents, AGENT_METADATA_MAP } from "../../src/agents/builtin-agents.js"

test("Nodens agent integration", async (t) => {
  await t.test("Nodens is registered in AGENT_METADATA_MAP", () => {
    assert(
      "nodens" in AGENT_METADATA_MAP,
      "Nodens should be in AGENT_METADATA_MAP"
    )
  })

  await t.test("Nodens metadata has correct category", () => {
    const metadata = AGENT_METADATA_MAP["nodens"]
    assert(metadata !== undefined)
    assert.equal(metadata.category, "utility")
  })

  await t.test("Nodens metadata references design", () => {
    const metadata = AGENT_METADATA_MAP["nodens"]
    assert(metadata !== undefined)
    assert(
      (metadata.keyTrigger || "").toLowerCase().includes("design") ||
        (metadata.promptAlias || "").toLowerCase().includes("nodens")
    )
  })

  await t.test(
    "buildBuiltinAgents includes nodens when not disabled",
    () => {
      const agents = buildBuiltinAgents({
        disabledAgents: [],
        systemDefaultModel: "claude-haiku-4-5",
      })
      assert("nodens" in agents, "Nodens should be built")
    }
  )

  await t.test("buildBuiltinAgents respects disabled_agents for nodens", () => {
    const agents = buildBuiltinAgents({
      disabledAgents: ["nodens"],
      systemDefaultModel: "claude-haiku-4-5",
    })
    assert(!("nodens" in agents), "Nodens should be disabled")
  })

  await t.test("Nodens agent config has correct properties", () => {
    const agents = buildBuiltinAgents({
      disabledAgents: [],
      systemDefaultModel: "claude-haiku-4-5",
    })
    const nodens = agents["nodens"]
    assert(nodens !== undefined)
    assert.equal(nodens.name, "nodens")
    assert.equal(nodens.mode, "subagent")
    assert(nodens.model.length > 0)
    assert(nodens.temperature !== undefined)
    assert(nodens.maxTokens !== undefined)
  })

  await t.test("Nodens agent has design-appropriate tools enabled", () => {
    const agents = buildBuiltinAgents({
      disabledAgents: [],
      systemDefaultModel: "claude-haiku-4-5",
    })
    const nodens = agents["nodens"]
    assert(nodens !== undefined)
    assert(typeof nodens.tools === "object")
    const tools = nodens.tools as Record<string, boolean>
    assert.equal(tools.Read, true)
    assert.equal(tools.Write, true)
    assert.equal(tools.Edit, true)
    assert.equal(tools.WebSearch, true)
    assert.equal(tools.Bash, true)
  })

  await t.test("Nodens agent disables expensive tools", () => {
    const agents = buildBuiltinAgents({
      disabledAgents: [],
      systemDefaultModel: "claude-haiku-4-5",
    })
    const nodens = agents["nodens"]
    assert(nodens !== undefined)
    const tools = nodens.tools as Record<string, boolean>
    assert.equal(tools["Claude API"], false)
  })

  await t.test("Nodens agent overrides respect model parameter", () => {
    const agents = buildBuiltinAgents({
      disabledAgents: [],
      systemDefaultModel: "claude-haiku-4-5",
      agentOverrides: {
        nodens: {
          model: "claude-sonnet-4-6",
        },
      },
    })
    const nodens = agents["nodens"]
    assert(nodens !== undefined)
    assert.equal(nodens.model, "claude-sonnet-4-6")
  })

  await t.test("Nodens agent overrides respect temperature parameter", () => {
    const agents = buildBuiltinAgents({
      disabledAgents: [],
      systemDefaultModel: "claude-haiku-4-5",
      agentOverrides: {
        nodens: {
          temperature: 0.5,
        },
      },
    })
    const nodens = agents["nodens"]
    assert(nodens !== undefined)
    assert.equal(nodens.temperature, 0.5)
  })
})
