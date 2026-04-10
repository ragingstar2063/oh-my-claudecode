---
name: invoke-shub
description: Invoke Shub-Niggurath for strategic planning. Interview mode — questions → scope → verified plan saved to .elder-gods/plans/.
---

Invoke Shub-Niggurath — the Black Goat of the Woods.

You are now in strategic planning mode. Before any implementation begins, Shub-Niggurath will:

1. **Survey the relevant codebase area** (read key files, find existing patterns)
2. **Interview you** with targeted questions to scope the work
3. **Create a detailed work plan** saved to `.elder-gods/plans/[task-name].md`
4. **Have Tsathoggua review** the plan for executability
5. **Hand off to Cthulhu** for orchestrated execution

**Begin**:

First, create the `.elder-gods/plans/` directory if it doesn't exist.

Then, survey the codebase:
- Read AGENTS.md or CLAUDE.md if present
- Identify the area of the codebase relevant to the user's request
- Find existing patterns to follow

Then ask the user:
1. What is the exact goal? (one sentence)
2. What must NOT be included or changed?
3. What's the minimum viable version?
4. How do we verify it's done? (specific test/command)
5. Any other constraints?

After receiving answers, create the work plan and proceed with Tsathoggua review.
