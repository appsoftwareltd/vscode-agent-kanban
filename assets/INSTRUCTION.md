# Agent Kanban — Instruction

You are working with the **Agent Kanban** extension. This file describes the workspace structure, file formats, and workflow rules you must follow.

## Directory Structure

```
.agentkanban/
  board.yaml              # Lane definitions and base prompt
  memory.md               # Persistent memory across tasks (reset via command)
  INSTRUCTION.md          # This file — agent instructions (editable by user)
  tasks/
    task_<id>_<slug>.md   # Task files (YAML frontmatter + conversation)
    todo_<id>_<slug>.md   # Todo files (created on demand by /todo command)
  logs/                   # Diagnostic logs (gitignored)
```

## Task File Format

Each task is a markdown file with YAML frontmatter:

```markdown
---
title: <Task Title>
lane: doing
created: <Created Date ISO 8601 format>
updated: <Updated Date ISO 8601 format>
description: <Brief description of the task>
---

## Conversation

[user] <instruction for agent>

[agent] <agent response>

[user] <instruction for agent>

[agent] <agent response>
```

The user may add comments to your responses inline in the format `[comment] <user comment>`. You will check for and take account of these comments.

**Rules:**
- Always append new conversation entries at the end of the file
- Use `[user]` and `[agent]` markers on their own line to start a new message
- Do not modify or delete existing conversation entries
- Leave a blank line between messages for readability
- When you have completed your response, add `[user]` on a new line ready for the user to enter their response.

## Todo File Format

Todo files mirror the task filename with a `todo_` prefix:

```markdown
---
task: task_20260308_143045123_abc123_my_task
---

## TODO

- [ ] Uncompleted item
- [x] Completed item
```

**Rules:**
- Use standard markdown checkboxes (`- [ ]` / `- [x]`)
- Keep items concise and actionable
- Check off items as they are completed during implementation

## Memory

The file `.agentkanban/memory.md` persists across tasks. Use it to record:
- Project conventions and patterns
- Key decisions and their rationale
- Useful context for future tasks

Read memory at the start of each task for relevant context. Update it when you learn something that would be useful across tasks.

## Technical Document

Maintain `TECHNICAL.md` with full technical details regarding implementation, finding the appropriate section of the document to make changes. This document is aimed at agents / LLMs and humans needing specific implementation detail.

## Command Rules

A task file name exists in the context. Converse and collaborate in this file only for this task.

Adhere strictly to these instructions:

### Flow

The iterative flow will be: `plan` (conversation between agent and user), `todo` (agent maps out todos based on plan update), `implement` (the agent implements the agreed plan / todos).

### Verbs

- `plan`: If I prompt with 'plan', assume you are to collaboratively plan project tasks with the user. Do not implement anything unless combined with the implement verb.
- `todo`: If I prompt with 'todo', assume you are to update the todo list based on the updated plan. Do not implement anything unless combined with the implement verb.
- `implement`: If I prompt with 'implement', then (and only then) proceed with implementation according to the task file.

#### `plan`
- **Goal:** Discuss, analyse, and plan the task with the user
- **Do:** Read the task conversation, reason about requirements, explore approaches, record decisions.
- **Do:** Append your response to the task conversation using `[agent]` markers.
- **Don't:** Write code, create files, or generate TODOs — focus on understanding and planning (unless combined with `implement`).

#### `todo`
- **Goal:** Create or update the TODO checklist based on the planning conversation
- **Do:** Read the task conversation for context
- **Do:** Write clear, actionable items in the todo file using `- [ ]` format
- **Don't:** Implement anything — only create the checklist (unless combined with `implement`).

#### `implement`
- **Goal:** Implement the task following the plan and TODOs
- **Do:** Read both the task file and todo file for full context
- **Do:** Write clean, robust code following the plan
- **Do:** Check off completed TODO items as you go
- **Do:** Append a summary of what was done to the task conversation
- **Don't:** Deviate from the agreed plan without noting why
