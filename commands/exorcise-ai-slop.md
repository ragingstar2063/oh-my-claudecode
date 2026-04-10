---
name: exorcise-ai-slop
description: Purge AI-generated code smells — over-engineering, unnecessary abstractions, scope creep, useless comments, boilerplate.
---

Exorcise the AI slop from this codebase.

**What to look for and remove**:

### Useless Comments
- Comments that explain obviously readable code
- "// Handle error gracefully", "// Return the result", "// Initialize the variable"
- JSDoc on trivial getters/setters
- TODO comments that will never be addressed

### Over-Engineering
- Unnecessary abstraction layers (adapter wrapping adapter)
- Factory factories
- Configuration for things that won't change
- Generic utilities used exactly once

### Scope Creep
- Features not in the original requirements
- "While we're here, let's also..." additions
- Tests for edge cases that cannot happen in production

### Boilerplate
- Empty constructors that do nothing
- Interface implementations with zero logic
- Barrel files exporting nothing useful
- Error classes that add no information

### Premature Optimization
- Caching for data that changes every request
- Parallel execution for sequential-only operations
- Memoization for pure functions called once

**Process**:

1. **Survey first** — read the files the user indicates, or do a broad survey
2. **List findings** — enumerate issues before removing anything
3. **Confirm scope** — "I found X, Y, Z — shall I remove all of these?"
4. **Remove conservatively** — one category at a time, verify after each

Begin with a survey of the codebase area indicated. List what you find.
