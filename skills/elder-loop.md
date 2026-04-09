---
name: elder-loop
description: Activate the Elder Loop — self-referential completion mechanism. Like Cthulhu dreaming in R'lyeh, the loop continues until a completion promise is met.
---

Activate the Elder Loop.

**Usage**: `/elder-loop [completion promise]`

**What this does**: Creates a `.claude/elder-loop-state.json` file that the Stop hook monitors. Each time the session would stop with incomplete work, the hook injects a reminder to continue.

**Set up the loop**:

1. Create the loop state file:

```json
{
  "active": true,
  "iteration": 0,
  "maxIterations": 10,
  "completionPromise": "[INSERT YOUR COMPLETION PROMISE HERE]",
  "strategy": "continue"
}
```

Write this to `.claude/elder-loop-state.json`.

2. Set the completion promise to a specific, testable condition:
   - BAD: "finish the task"
   - GOOD: "all tests pass and lsp_diagnostics returns no errors on changed files"
   - GOOD: "the authentication flow works end-to-end with curl returning 200"

3. Proceed with work. The Elder Loop will keep you going until the promise is met or max iterations is reached.

**To stop the loop**: Run `/cancel-elder-loop`

**Current request**: What should the completion promise be for the current task?

Identify the completion promise from context, write the state file, and begin work.
