---
name: session-handoff
description: Create a session handoff document — detailed summary for continuing work in a new session.
---

Create a session handoff document for continuing this work in a new session.

**Generate a comprehensive handoff**:

1. **Summarize what was accomplished** in this session:
   - Files created/modified (with brief description of changes)
   - Features implemented
   - Bugs fixed

2. **Current state**:
   - What is working
   - What is partially done
   - What was explicitly left for later

3. **Pending work**:
   - Any incomplete todos
   - Next immediate steps
   - Known issues

4. **Context for the next session**:
   - Key files to read first
   - Important patterns discovered
   - Gotchas and non-obvious decisions made

5. **Exact commands to resume**:
   - Commands to run to verify current state
   - Commands to continue from where we left off

**Format**:

```markdown
# Session Handoff — [Date/Time]

## Accomplished
[bullet list]

## Current State
[description]

## Pending
[bullet list with priority]

## Context for Next Session
[key information]

## Resume Commands
\`\`\`bash
[exact commands]
\`\`\`
```

Generate this handoff now based on the current session history.
