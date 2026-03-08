# Agent Kanban

A VS Code extension providing an integrated Kanban board for managing coding agent tasks. Tasks follow a **plan → todo → implement** workflow, with conversations stored as structured markdown files that are fully version-controllable.

Agent Kanban references it's own instruction set, so it doesn't interfere with your existing agents files (e.g. AGENTS.md, skills etc).

**Create tasks on the Kanban board and then plan and converse with your agent in the task markdown file, giving you a permanent task history that's editable, resistant to context bloat and persists after clearing chat context.**

## Features

- **Kanban Board** — Visual board with customisable lanes (default: Todo, Doing, Done). Drag-and-drop task cards between lanes.
- **Markdown Task Files** — Each task is a `.md` file with YAML frontmatter. Conversation history lives in the markdown body using `[user]:`/`[agent]:` markers — directly readable and editable.
- **Lightweight Chat Participant** — `@kanban` in Copilot Chat routes commands to task files. Copilot's native agent mode handles all work (tool calling, diffs, terminal). No custom LLM loop.
- **Plan → Todo → Implement Workflow** — Use `/task` to select a task, then type `plan`, `todo`, or `implement` (or combinations) naturally in Copilot agent mode. The workflow instructions live in `.agentkanban/INSTRUCTION.md`.
- **Done Lane Protection** — The Done lane cannot be deleted. Completed tasks are excluded from command matching.
- **Version Control Friendly** — One `.md` file per task, board config in YAML. Standard text files that diff/merge naturally.

## Getting Started

1. Install the extension
2. Click the Kanban icon in the Activity Bar to open the board
3. Click **+ New Task** to create a task — or use `@kanban /new My Task` in chat
4. Use `@kanban /task My Task` to select a task — this opens the task file and sets up context
5. Type `plan`, `todo`, `implement` (or combinations) in Copilot agent mode to work on the task

## How It Works

### Task Lifecycle

1. Create a task via the board or `@kanban /new <title>` — it appears in the first lane (default: Todo)
2. Use `@kanban /task <task name>` to select a task — this opens the task file in the editor and outputs workflow context
3. Type `plan` in Copilot agent mode to discuss and plan the task
4. Type `todo` to generate a TODO checklist
5. Type `implement` to implement the task following the plan and TODOs
6. Drag the card between lanes as work progresses

You can also combine verbs (e.g. `todo implement`) and add additional context after the verb.

### Chat Participant Commands

Use `@kanban` in the Copilot chat window:

| Command | Usage | Description |
|---------|-------|-------------|
| `/new` | `@kanban /new <title>` | Create a new task |
| `/task` | `@kanban /task <task name>` | Select a task to work on — opens the file, sets up context |

Task matching is fuzzy and case-insensitive. Tasks in the Done lane are excluded from matching.

After selecting a task, type your verb (`plan`, `todo`, `implement`, or combinations) directly in Copilot agent mode. The workflow instructions in `.agentkanban/INSTRUCTION.md` tell the agent how to handle each verb.

After each command, a follow-up suggestion is shown for the most recently updated active task.

### Agent Instructions

On first use of any command, the extension creates `.agentkanban/INSTRUCTION.md` from a bundled template. This file tells the agent how the `.agentkanban` directory and workflow operate. Each command response instructs the agent to read this file before proceeding.

You can edit `.agentkanban/INSTRUCTION.md` to customise the agent's behaviour. Delete it to reset to the default template on next use.

### Task File Format

```markdown
---
title: Implement OAuth2
lane: doing
created: 2026-03-08T10:00:00.000Z
updated: 2026-03-08T14:30:00.000Z
description: OAuth2 integration for the API
---

## Conversation

[user]: Let's plan the OAuth2 implementation...

[agent]: Here's my analysis of OAuth2 approaches...
```

### Storage

```
.agentkanban/
  board.yaml                                  # Lane definitions, base prompt
  memory.md                                   # Global memory (reset via command)
  INSTRUCTION.md                              # Agent workflow instructions (auto-created)
  tasks/
    task_20260308_143045123_abc123_title.md    # Task file (frontmatter + conversation)
    todo_20260308_143045123_abc123_title.md    # Todo file (created on demand)
```

### Memory

A global memory file at `.agentkanban/memory.md` persists across tasks. Use the **Agent Kanban: Reset Memory** command to clear it.

## Configuration

| Setting | Scope | Description |
|---------|-------|-------------|
| `agentKanban.userName` | Application (local) | Your display name for conversations |
| `agentKanban.enableLogging` | Window | Enable diagnostic logging to `.agentkanban/logs/`. Requires reload. |

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

Releases are published to the VS Code Marketplace manually, then a GitHub Release is created automatically when a version tag is pushed.

**Step 1 - bump the version**

Update `version` in `package.json` and add an entry to `CHANGELOG.md`.

**Step 2 - publish to the VS Code Marketplace**

```bash
npm run build
npx @vscode/vsce package
npx @vscode/vsce login appsoftwareltd   # enter PAT token if auth expired
npx @vscode/vsce publish
```

**Step 3 - tag and push**

```bash
git add .
git commit -m "Release v0.1.8"  # change version
git tag v0.1.8                  # change version
git push origin main --tags
```

Pushing the tag triggers the [Release workflow](.github/workflows/release.yml), which creates a GitHub Release automatically with auto-generated release notes and the VS Code Marketplace install link.

