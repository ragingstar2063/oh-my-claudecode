/**
 * Skill Loader
 *
 *
 * Discovers and loads user-defined skills from:
 * 1. Project-level: .claude/skills/<name>/SKILL.md
 * 2. User-level: ~/.claude/skills/<name>/SKILL.md
 *
 * Skills are markdown files with YAML frontmatter. They can define:
 * - name: The skill name (used in /name)
 * - description: What the skill does
 * - mcp_config: Optional MCP server to provision with this skill
 */

import * as fs from "fs"
import * as path from "path"

export interface SkillMcpConfig {
  [mcpName: string]: {
    command: string
    args: string[]
    env?: Record<string, string>
  }
}

export interface LoadedSkill {
  name: string
  description: string
  content: string
  mcpConfig?: SkillMcpConfig
  source: "project" | "user" | "builtin"
  filePath: string
}

/** Parse YAML-like frontmatter from markdown */
function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>
  body: string
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: content }

  const frontmatter: Record<string, unknown> = {}
  const rawFm = match[1]

  for (const line of rawFm.split("\n")) {
    const colonIdx = line.indexOf(":")
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()
    frontmatter[key] = value
  }

  return { frontmatter, body: match[2] }
}

/** Load skill files from a directory */
function loadSkillsFromDir(dir: string, source: "project" | "user"): LoadedSkill[] {
  if (!fs.existsSync(dir)) return []

  const skills: LoadedSkill[] = []

  // Check for flat structure: dir/*.md
  const mdFiles = fs.readdirSync(dir)
    .filter(f => f.endsWith(".md"))
    .map(f => path.join(dir, f))

  // Check for nested structure: dir/*/SKILL.md
  const subdirs = fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(dir, d.name, "SKILL.md"))
    .filter(p => fs.existsSync(p))

  for (const filePath of [...mdFiles, ...subdirs]) {
    try {
      const content = fs.readFileSync(filePath, "utf-8")
      const { frontmatter, body } = parseFrontmatter(content)
      const name = String(frontmatter.name ?? path.basename(filePath, ".md"))
      const description = String(frontmatter.description ?? "")
      const mcpConfig = frontmatter.mcp_config as SkillMcpConfig | undefined

      skills.push({ name, description, content: body, mcpConfig, source, filePath })
    } catch {
      // Skip unparseable skill files
    }
  }

  return skills
}

/** Discover all skills from project and user directories */
export function discoverSkills(projectDirectory: string): LoadedSkill[] {
  const HOME = process.env.HOME ?? process.env.USERPROFILE ?? ""

  const projectSkillsDir = path.join(projectDirectory, ".claude", "skills")
  const userSkillsDir = path.join(HOME, ".claude", "skills")

  const projectSkills = loadSkillsFromDir(projectSkillsDir, "project")
  const userSkills = loadSkillsFromDir(userSkillsDir, "user")

  // Project skills override user skills with same name
  const skillMap = new Map<string, LoadedSkill>()

  for (const skill of [...userSkills, ...projectSkills]) {
    skillMap.set(skill.name, skill)
  }

  return [...skillMap.values()]
}

/** Get skills as AvailableSkill format for agent prompt building */
export function toAvailableSkills(
  skills: LoadedSkill[],
): Array<{ name: string; description: string }> {
  return skills.map(s => ({ name: s.name, description: s.description }))
}
