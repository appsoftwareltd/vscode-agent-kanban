---
title: Automatically add .gitignore
lane: done
created: 2026-03-09T08:03:21.606Z
updated: 2026-03-09T20:05:47.048Z
---

## Conversation

[user]

We need the extension to add it's own .gitignore under the .agentkanban directory. This gets added when the .agentkanban directory is created. This currently only needs to cover the tools internal logging 

[agent]

## Plan

### Context

The extension stores its data under `.agentkanban/` in the workspace root. The `logs/` subdirectory contains diagnostic rolling log files managed by `LogService`. These log files should not be committed to version control.

Currently, there is no `.agentkanban/.gitignore`. The repo-level `.gitignore` ignores `.agentkanban/` entirely, but users of the extension in their own projects may want to commit their task files while ignoring logs.

### Approach

Create an `ensureGitignore()` helper function in `BoardConfigStore` (since it already owns directory initialisation of `.agentkanban/`). This function will:

1. Check if `.agentkanban/.gitignore` exists
2. If not, create it with a default content that ignores `logs/`
3. Call this during `BoardConfigStore.init()` — the earliest point where `.agentkanban/` is guaranteed to exist

### .gitignore Content

```
# Agent Kanban — auto-generated
logs/
```

Only `logs/` needs to be covered for now. The file is kept minimal and can be extended later.

### Implementation Details

- **Where**: `BoardConfigStore.ts` — add `ensureGitignore()` private method, call it in `init()`
- **Template**: No bundled template needed — the content is a two-line string constant
- **Idempotent**: Only writes if the file doesn't already exist (like `ensureInstructionFile()`)
- **Tests**: Add tests in `BoardConfigStore.test.ts` — verify `.gitignore` is created on `init()`, verify it's not overwritten if already present
- **TECHNICAL.md**: Update documentation to mention the `.gitignore` auto-creation

### Files to Change

1. `src/BoardConfigStore.ts` — add `ensureGitignore()`, call from `init()`
2. `src/test/BoardConfigStore.test.ts` — add tests for gitignore creation
3. `TECHNICAL.md` — document the behaviour
4. `assets/INSTRUCTION.md` — update directory structure to show `.gitignore`

[user]

implement

[agent]

## Implementation Summary

Implemented auto-creation of `.agentkanban/.gitignore` during `BoardConfigStore.init()`.

### Changes

1. **`src/BoardConfigStore.ts`** — Added `GITIGNORE_PATH` and `GITIGNORE_CONTENT` constants. Added private `ensureGitignore()` method that checks for `.agentkanban/.gitignore` via `stat()` and creates it with `logs/` ignore entry if missing. Called from `init()` after directory creation, before config loading.

2. **`src/test/BoardConfigStore.test.ts`** — Added `ensureGitignore (via init)` describe block with two tests:
   - Creates `.gitignore` when it does not exist (verifies `writeFile` called with content containing `logs/`)
   - Does not overwrite existing `.gitignore` (verifies no `.gitignore` write when `stat()` succeeds)

3. **`TECHNICAL.md`** — Updated BoardConfigStore section to document `ensureGitignore()` behaviour.

4. **`assets/INSTRUCTION.md`** — Added `.gitignore` to the directory structure listing.

5. **`README.md`** — Added `.gitignore` to the storage directory tree.

### Test Results

All 81 tests pass. Lint clean. Build succeeds.

[user]