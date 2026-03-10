# VS Code Agent Kanban

[![CI](https://github.com/appsoftwareltd/vscode-agent-kanban/actions/workflows/ci.yml/badge.svg)](https://github.com/appsoftwareltd/vscode-agent-kanban/actions/workflows/ci.yml)

**VS Code Agent Kanban is available on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=AppSoftwareLtd.vscode-agent-kanban)**

A VS Code extension providing an integrated Kanban board for managing coding agent tasks designed to work with **GitHub Copilot Chat**. Tasks follow a **plan → todo → implement** workflow, with conversations stored as structured markdown files that are fully version-controllable.

**Create tasks on the Kanban board and then plan and converse with your agent in the task markdown file, giving you a permanent task history that's editable, resistant to context bloat and persists after clearing chat context.**

Agent Kanban references its own instruction set, so it doesn't interfere with your existing agent files (e.g. AGENTS.md, skills etc).

![VS Code Agent Kanban](https://github.com/appsoftwareltd/vscode-agent-kanban/blob/main/images/icon.png?raw=true)

[Youtube (Quick Demo)](https://www.youtube.com/watch?v=Y4a3FnFftKw)

<img width="1888" height="1024" alt="image" src="https://github.com/user-attachments/assets/b7ebe7a8-87a8-41bb-84c9-f7f298408ee7" />

## Features

- **Kanban Board** — Visual board with customisable lanes (default: Todo, Doing, Done). Drag-and-drop task cards between lanes.
- **Markdown Task Files** — Each task is a `.md` file with YAML frontmatter. Conversation history uses `[user]`/`[agent]` markers — directly readable, editable, and version-control friendly.
- **Chat Participant** — `@kanban` in Copilot Chat routes commands to task files. Copilot's native agent mode handles all work (tool calls, diffs, terminal). No custom LLM loop.
- **Plan → Todo → Implement** — Use `@kanban /task` to select a task, then `@kanban /plan`, `/todo`, or `/implement` to set up context and type **go** to begin. Verb commands refresh agent context automatically, keeping long conversations on track.
- **Version Control Friendly** — One `.md` file per task, board config in YAML. Standard text files that diff/merge naturally meaning that this folder can be version controlled and shared among the team using your standard Git workflow.


## Getting Started

1. Install the extension and click the Kanban icon in the Activity Bar
2. Click **+ New Task** (or `@kanban /new My Task` in chat)
3. Use `@kanban /task My Task` to select a task — opens the task file and sets up context
4. Use `@kanban` verb commands to work on the task:
   - `@kanban /plan` — discuss and plan the task; the agent reads the task file and writes a plan into it
   - `@kanban /todo` — generate a TODO checklist from the plan, written into a companion `todo_*.md` file
   - `@kanban /implement` — implement the task following the plan and TODOs
   - Combine verbs with `#` tags (e.g. `@kanban /todo #implement`) and append extra context (e.g. `@kanban /plan focus on error handling`)
   - Then type **go** in agent mode to begin
5. The task file accumulates the full conversation — edit it directly to steer the agent or add context
6. Drag cards between lanes as work progresses

## Chat Commands

| Command | Usage | Description |
|---------|-------|-------------|
| `/new` | `@kanban /new <title>` | Create a new task |
| `/task` | `@kanban /task <task name>` | Select a task — opens the file, sets up context |
| `/plan` | `@kanban /plan [context]` | Plan the selected task (refreshes context) |
| `/todo` | `@kanban /todo [context]` | Generate TODOs for the selected task |
| `/implement` | `@kanban /implement [context]` | Implement the selected task |

Task matching is fuzzy and case-insensitive. Tasks in the Done lane are excluded.

Verb commands (`/plan`, `/todo`, `/implement`) operate on the last task selected via `/task`. They re-inject INSTRUCTION.md and the task file into the chat context, keeping the agent on track in long conversations. Combine verbs with `#` tags: `@kanban /plan #todo #implement`. After each command, follow-up buttons offer the next natural verb action.

> **Tip:** You can also type `plan`, `todo`, or `implement` directly in agent mode without `@kanban`. This works for short conversations, but in longer sessions the agent may lose track of the workflow instructions. Use the `@kanban` verb commands to re-inject context and keep the agent on track.

## Agent Instructions

Agent Kanban uses a layered approach to keep the agent on track, even in long conversations:

1. **AGENTS.md managed section** — On activation and every command, Agent Kanban writes a small sentinel-delimited section into `AGENTS.md` at the workspace root. VS Code re-injects AGENTS.md into the system prompt on **every agent mode turn**, so the agent always knows to read `INSTRUCTION.md` and `memory.md`. User content outside the sentinel markers (`<!-- BEGIN/END AGENT KANBAN -->`) is never modified.

2. **`response.reference()`** — Each `/task` and verb command attaches the INSTRUCTION.md and task file URIs to the chat response. This gives the agent a direct, per-thread reference to the active files.

3. **Verb commands** (`@kanban /plan`, `/todo`, `/implement`) — On-demand context refresh checkpoints. Each one re-syncs INSTRUCTION.md, updates the AGENTS.md section, and re-references the task file. Use these when the agent drifts in a long conversation.

4. **Editor tab** — `/task` and verb commands open the task file in the editor. While the tab is open, the agent can see it as context.

`.agentkanban/INSTRUCTION.md` is managed automatically — synced from the bundled template on every activation and command. **Do not edit it directly**; changes are overwritten on update. To customise agent behaviour, use your own agent configuration files (`AGENTS.md` outside the sentinels, `CLAUDE.md`, skills, etc.).

> **Note:** If your workspace already has an `AGENTS.md`, Agent Kanban only modifies content between its sentinel comments. Your own instructions are preserved.

### Why a layered approach?

In long Copilot chat conversations, earlier messages gradually scroll out of the model's context window. A single one-shot instruction injection (e.g. "read INSTRUCTION.md") works initially but the agent eventually forgets the workflow rules (context decay). We explored several mechanisms in isolation — `response.reference()`, `.instructions.md` with `applyTo` globs, MCP tool calls — and found that none completely solved the problem alone. Of these, `AGENTS.md` is the strongest because VS Code re-injects it at the system-prompt level on every agent turn — it never decays. The other layers (per-thread references, verb commands, open editor tabs) provide complementary safety nets, giving the agent multiple independent paths back to the workflow rules and the active task file.

## Task File Format

```markdown
---
title: Implement OAuth2
created: 2026-03-08T10:00:00.000Z
updated: 2026-03-08T14:30:00.000Z
description: OAuth2 integration for the API
---

## Conversation

[user] Let's plan the OAuth2 implementation...

[agent] Here's my analysis of OAuth2 approaches...
```

The lane a task belongs to is determined by its directory (e.g. `tasks/doing/`), not by a frontmatter field.

## Storage

```
.agentkanban/
  .gitignore          # Auto-generated — ignores logs/
  board.yaml          # Lane definitions (slug list), base prompt
  memory.md           # Global memory (reset via Agent Kanban: Reset Memory command)
  INSTRUCTION.md      # Agent workflow instructions (managed by extension)
  tasks/
    todo/             # Lane directory — one per lane
      task_<timestamp>_<id>_<title>.md
      todo_<timestamp>_<id>_<title>.md
    doing/
      task_<timestamp>_<id>_<title>.md
    done/
      task_<timestamp>_<id>_<title>.md
    archive/          # Hidden from the board
      task_<timestamp>_<id>_<title>.md
```

Tasks are stored in subdirectories matching their lane slug. Moving a task between lanes moves the file to the corresponding directory. Empty lane directories are preserved and shown as empty lanes on the board. The `archive/` directory is reserved for archived tasks and never appears as a lane.

## Configuration

| Setting | Scope | Description |
|---------|-------|-------------|
| `agentKanban.enableLogging` | Window | Enable diagnostic logging to `.agentkanban/logs/`. Requires reload. |
| `agentKanban.customInstructionFile` | Resource | Path to a custom instruction file injected into the `/task` workflow. Relative paths resolve from workspace root. |

## Development

```bash
npm install
npm run build      # Bundle with esbuild
npm run watch      # Watch mode
npm run lint       # TypeScript type check
npm test           # Run tests
```

Press F5 in VS Code to launch the Extension Development Host.

## Publishing

Releases are published to the VS Code Marketplace manually; pushing a version tag triggers the [Release workflow](.github/workflows/release.yml) to create a GitHub Release automatically.

```bash
# 1. Bump version in package.json and update CHANGELOG.md

# 2. Publish to VS Code Marketplace
npm run build
npx @vscode/vsce package
npx @vscode/vsce login appsoftwareltd   # enter PAT if auth expired
npx @vscode/vsce publish

# 3. Tag and push
git add .
git commit -m "Release v1.0.0"
git tag v1.0.0
git push origin main --tags
```

## LICENCE

Elastic License 2.0 (ELv2)
