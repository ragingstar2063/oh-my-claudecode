---
name: cancel-elder-loop
description: Stop the active Elder Loop. Deactivates the completion loop mechanism.
---

Stop the Elder Loop.

Delete or deactivate `.claude/elder-loop-state.json`:

```json
{
  "active": false,
  "iteration": 0,
  "maxIterations": 0,
  "completionPromise": "",
  "strategy": "continue"
}
```

Write this to `.claude/elder-loop-state.json` to deactivate.

Confirm: "Elder Loop deactivated. The dreaming has ceased."
