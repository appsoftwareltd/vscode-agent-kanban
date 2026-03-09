# Agent Kanban — Instruction

You are working with the **Agent Kanban** extension. Follow these workspace structure, file format, and workflow rules strictly.

## Directory Structure

```
.agentkanban/
  .gitignore          # Auto-generated — ignores logs/
  board.yaml          # Lane definitions and base prompt
  memory.md           # Persistent memory across tasks (reset via command)
  INSTRUCTION.md      # This file — agent instructions
  tasks/
    task_<id>_<slug>.md   # Task files (YAML frontmatter + conversation)
    todo_<id>_<slug>.md   # Todo files (created on demand by /todo command)
  logs/               # Diagnostic logs (gitignored)
```

## Task File Format

Stored under `.agentkanban/tasks/` as `task_<YYYYMMdd>_<HHmmssfff>_<unique_id>_<slug>.md`. Stay working in the given task file until a new one is assigned.

Each task is a markdown file with YAML frontmatter:

```markdown
---
title: <Task Title>
lane: doing
created: <ISO 8601>
updated: <ISO 8601>
description: <Brief description>
---

Note: The task lane is managed by the extension, you do not edit the lane.

## Conversation

[user] 

<message>

[agent] 

<response>
```

**Rules:**
- Append new entries at the end — never modify or delete existing ones
- Start each message with `[user]` or `[agent]` on its own line; blank line between messages
- After your response, add `[user]` on a new line for the user's next entry
- Look for and honor inline `[comment] <text>` annotations from the user

## TODO File Format

Mirrors the task filename with `todo_` prefix - `todo_<YYYYMMdd>_<HHmmssfff>_<unique_id>_<slug>.md`. **Create it if it doesn't exist.**

```markdown
---
task: task_<YYYYMMdd>_<HHmmssfff>_<unique_id>_<slug>
---

## TODO

- [ ] Uncompleted item
- [x] Completed item
```

**Rules:** Use `- [ ]` / `- [x]` checkboxes. Keep items concise and actionable. Check off items as completed. Group under iteration headings. Append new items at the end; preserve ordering.

## Memory

`.agentkanban/memory.md` persists across tasks. Read it at the start of each task. Update it with project conventions, key decisions, and useful context for future tasks.

## Technical Document

Maintain `TECHNICAL.md` at workspace root with implementation details (for agents/LLMs and humans). Update the appropriate section when making changes.

## Command Rules

A task file name exists in the context — converse and collaborate **only** in that file for this task.

### Flow

Iterative cycle: **plan** → **todo** → **implement**

### Verbs

Verbs can be combined (e.g. `todo implement`). Without `implement`, **never write code or create files**.

#### `plan`
Discuss, analyse, and plan the task collaboratively. Read the conversation, reason about requirements, explore approaches, record decisions. Append responses using `[agent]` markers. **No code, no files, no TODOs** unless combined with `implement`.

#### `todo`
Create/update the TODO checklist based on the planning conversation. Read the task conversation for context. Write clear, actionable `- [ ]` items. **No implementation** unless combined with `implement`.

#### `implement`
Implement per the plan and TODOs. Read both task and todo files. Write clean, robust code. Check off TODO items as completed. Append a summary to the conversation. **Do not deviate** from the agreed plan without noting why.
