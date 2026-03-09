# Agent Kanban

*Agent Kanban is available on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=AppSoftwareLtd.vscode-agent-kanban).*

A VS Code extension providing an integrated Kanban board for managing coding agent tasks designed to work with **GitHub Copilot Chat**. Tasks follow a **plan → todo → implement** workflow, with conversations stored as structured markdown files that are fully version-controllable.

**Create tasks on the Kanban board and then plan and converse with your agent in the task markdown file, giving you a permanent task history that's editable, resistant to context bloat and persists after clearing chat context.**

Agent Kanban references its own instruction set, so it doesn't interfere with your existing agent files (e.g. AGENTS.md, skills etc).

![VS Code Agent Kanban](https://github.com/appsoftwareltd/vscode-agent-kanban/blob/main/images/icon.png?raw=true)

## Features

- **Kanban Board** — Visual board with customisable lanes (default: Todo, Doing, Done). Drag-and-drop task cards between lanes.
- **Markdown Task Files** — Each task is a `.md` file with YAML frontmatter. Conversation history uses `[user]:`/`[agent]:` markers — directly readable, editable, and version-control friendly.
- **Chat Participant** — `@kanban` in Copilot Chat routes commands to task files. Copilot's native agent mode handles all work (tool calls, diffs, terminal). No custom LLM loop.
- **Plan → Todo → Implement** — Use `/task` to select a task, then type `plan`, `todo`, or `implement` (or combinations) in Copilot agent mode.
- **Version Control Friendly** — One `.md` file per task, board config in YAML. Standard text files that diff/merge naturally meaning that this folder can be version controlled and shared among the team using your standard Git workflow.


## Getting Started

1. Install the extension and click the Kanban icon in the Activity Bar
2. Click **+ New Task** (or `@kanban /new My Task` in chat)
3. Use `@kanban /task My Task` to select a task — opens the task file and sets up context
4. In Copilot agent mode, type one or more verbs to work on the task:
   - `plan` — discuss and plan the task; the agent reads the task file and writes a plan into it
   - `todo` — generate a TODO checklist from the plan, written into a companion `todo_*.md` file
   - `implement` — implement the task following the plan and TODOs
   - You can combine verbs (e.g. `todo implement`) and append extra context (e.g. `plan focus on error handling`)
5. The task file accumulates the full conversation — edit it directly to steer the agent or add context
6. Drag cards between lanes as work progresses

## Chat Commands

| Command | Usage | Description |
|---------|-------|-------------|
| `/new` | `@kanban /new <title>` | Create a new task |
| `/task` | `@kanban /task <task name>` | Select a task — opens the file, sets up context |

Task matching is fuzzy and case-insensitive. Tasks in the Done lane are excluded. After each command, a follow-up suggestion is shown for the most recently updated active task.

## Agent Instructions

`.agentkanban/INSTRUCTION.md` is managed automatically — synced from the bundled template on every activation and command. **Do not edit it directly**; changes are overwritten on update. To customise agent behaviour, use your own agent configuration files (`AGENTS.md`, `CLAUDE.md`, skills, etc.). Agent Kanban co-exists with these without interference.

## Task File Format

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

## Storage

```
.agentkanban/
  .gitignore          # Auto-generated — ignores logs/
  board.yaml          # Lane definitions, base prompt
  memory.md           # Global memory (reset via Agent Kanban: Reset Memory command)
  INSTRUCTION.md      # Agent workflow instructions (managed by extension)
  tasks/
    task_<timestamp>_<id>_<title>.md   # Task file (frontmatter + conversation)
    todo_<timestamp>_<id>_<title>.md   # Todo file (created on demand)
```

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
git commit -m "Release v0.2.1"
git tag v0.2.1
git push origin main --tags
```

## LICENCE

Elastic License 2.0 (ELv2)