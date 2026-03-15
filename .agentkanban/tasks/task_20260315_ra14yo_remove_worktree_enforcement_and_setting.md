---
title: Remove worktree enforcement and setting
lane: todo
created: 2026-03-15T19:50:47.393Z
updated: 2026-03-15T20:02:54.207Z
description: The setting that requires worktree creation on /refresh is not required.
priority: high
sortOrder: 1773053948947
slug: remove_worktree_enforcement_and_setting
worktree:
  branch: agentkanban/20260315_ra14yo_remove_worktree_enforcement_and_setting
  path: c:\Users\Gareth\src\vscode-agent-kanban-worktrees\20260315_ra14yo_remove_worktree_enforcement_and_setting
  created: 2026-03-15T20:02:54.207Z
---

## Conversation

### user

The setting that enforces worktree creation on /refresh is not required. Remove it

### agent

Removed the `agentKanban.enforceWorktrees` setting and all associated enforcement logic.

**Changes made:**

- `package.json` — removed the `agentKanban.enforceWorktrees` configuration entry
- `src/agents/ChatParticipant.ts` — removed the enforce hint in `handleTask()` and the enforce gate (early return) in `handleRefresh()`
- `src/test/ChatParticipant.test.ts` — removed the `enforceWorktrees` describe block (2 tests) and the stray enforce-hint test in the `/task worktree awareness` suite
- `README.md` — removed `agentKanban.enforceWorktrees` row from the configuration table
- `TECHNICAL.md` — removed step 4 from the /refresh flow and the `agentKanban.enforceWorktrees` row from the configuration table

All 219 tests pass.

### user

An addtional task. I want to add shorthand for the `plan` `todo` `implement` verbs that the user writes in the chat window. These can be:

- `plan` - 'p'
- `todo`  - 't'
- `implement` - 'i'

So if the user types `ti` or `t i` in the chat window, that is `todo implement`. All of the shorthand letters can be used in any combination or order. Add that to INSTRUCTION.md so the agent will be aware and to README.md for the user.

### agent

Added shorthand verb aliases to both `assets/INSTRUCTION.md` and `README.md`.

**Changes made:**

- `assets/INSTRUCTION.md` — added a shorthand table (`p`/`t`/`i`) with a usage note in the Command Verbs section
- `README.md` — added a shorthand summary line in the Getting Started section

### user

An addtional task. I want to add shorthand for the `plan` `todo` `implement` verbs that the user writes in the chat window. These can be:

- `plan` - 'p'
- `todo`  - 't'
- `implement` - 'i'

So if the user types `ti` or `t i` in the chat window, that is `todo implement`. All of the shorthand letters can be used in any combination or order. Add that to INSTRUCTION.md so the agent will be aware and to README.md for the user.

