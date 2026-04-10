---
name: old-ones-init
description: Initialize AGENTS.md — hierarchical knowledge base generation. Creates AGENTS.md at root and key subdirectories.
---

Initialize the AGENTS.md knowledge base for this project.

**What this does**: Creates `AGENTS.md` files at the project root and in key subdirectories. These files give the Elder God agents project context without requiring repeated codebase exploration.

**Process**:

1. **Survey the project structure**:
   - Read existing README.md, CLAUDE.md, package.json (or equivalent)
   - List top-level directories and identify key ones (src/, lib/, packages/, etc.)
   - Identify the tech stack, architecture, and conventions

2. **Create root AGENTS.md** with:
   ```markdown
   # AGENTS.md — [Project Name]

   ## Project Overview
   [What this project does in 2-3 sentences]

   ## Tech Stack
   [Languages, frameworks, key dependencies]

   ## Architecture
   [How the codebase is organized — key directories and their roles]

   ## Key Conventions
   [Naming, patterns, testing approach, important rules]

   ## Agent Guidance
   [Specific instructions for AI agents working on this codebase]

   ## Important Files
   [Critical files every agent should know about]
   ```

3. **Create subdirectory AGENTS.md** for each major directory:
   - `src/AGENTS.md` — what's in src, patterns used
   - `src/components/AGENTS.md` — component patterns (if applicable)
   - etc.

4. **Parallel execution**: Read multiple directories simultaneously. Generate files in parallel where possible.

Begin the initialization now. Survey the project structure first, then create the AGENTS.md files.
