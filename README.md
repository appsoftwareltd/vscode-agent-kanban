# VS Code Agent Kanban

By [appsoftware.com](https://www.appsoftware.com)

[![CI](https://github.com/appsoftwareltd/vscode-agent-kanban/actions/workflows/ci.yml/badge.svg)](https://github.com/appsoftwareltd/vscode-agent-kanban/actions/workflows/ci.yml)

**VS Code Agent Kanban is available on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=AppSoftwareLtd.vscode-agent-kanban)**

A VS Code extension providing an integrated Kanban board for managing coding agent tasks designed to work with **GitHub Copilot Chat**. Tasks are managed as structured markdown files that are fully version-controllable.

**Create tasks on the Kanban board and then plan and converse with your agent in the task markdown file, giving you a permanent task history that's editable, resistant to context bloat and persists after clearing chat context.**

Agent Kanban references its own instruction set, so it doesn't interfere with your existing agent files (e.g. AGENTS.md, skills etc).

![VS Code Agent Kanban](https://github.com/appsoftwareltd/vscode-agent-kanban/blob/main/images/icon.png?raw=true)

[Youtube (Quick Demo)](https://www.youtube.com/watch?v=Y4a3FnFftKw) (Note that the image below shows the updated UI, the video needs an update but illustrates the workflow)

<img width="1042" height="632" alt="image" src="https://github.com/user-attachments/assets/19bfc5ac-1ed2-4c10-bc5e-8338fbb95922" />

## Features

- **Kanban Board** — Visual board with customisable lanes (default: Todo, Doing, Done). Drag-and-drop task cards between lanes.
- **Markdown Task Files** — Each task is a `.md` file with YAML frontmatter. Conversation history uses `[user]`/`[agent]` markers — directly readable, editable, and version-control friendly.
- **Chat Participant** — `@kanban` in Copilot Chat routes commands to task files. Copilot's native agent mode handles all work (tool calls, diffs, terminal). No custom LLM loop.
- **Context Refresh** — Use `@kanban /task` to select a task, then `@kanban /refresh` to re-inject context if the agent drifts in a long conversation. Context injection is automatic and keeps the agent on track.
- **Version Control Friendly** — One `.md` file per task, board config in YAML. Standard text files that diff/merge naturally meaning that this folder can be version controlled and shared among the team using your standard Git workflow.


## Getting Started

1. Install the extension and click the Kanban icon in the Activity Bar
2. Click **+ New Task** (or `@kanban /new My Task` in chat)
3. Use `@kanban /task My Task` to select a task — opens the task file and sets up context
4. Type **go** in agent mode to begin working — the agent reads the task file and follows the workflow
5. Use `@kanban /refresh` any time the agent loses track, to re-inject context
6. The task file accumulates the full conversation — edit it directly to steer the agent or add context
7. Drag cards between lanes as work progresses
8. *(Optional)* Use `@kanban /worktree` to create an isolated git worktree for the task — the agent gets its own branch and working directory (see [Git Worktrees](#git-worktrees))

## Chat Commands

| Command | Usage | Description |
|---------|-------|-------------|
| `/new` | `@kanban /new <title>` | Create a new task |
| `/task` | `@kanban /task <task name>` | Select a task — opens the file, sets up context |
| `/refresh` | `@kanban /refresh [context]` | Re-inject agent context for the selected task |
| `/worktree` | `@kanban /worktree` | Create a git worktree for the selected task |
| | `@kanban /worktree open` | Open the task worktree in VS Code |
| | `@kanban /worktree remove` | Remove the task worktree |

Task matching is fuzzy and case-insensitive. Tasks in the Done lane are excluded.

`/refresh` re-injects the full agent context (INSTRUCTION.md, task file, AGENTS.md section) without implying a specific workflow phase. Use it any time the agent drifts in a long conversation.

## Agent Instructions

Agent Kanban uses a layered approach to keep the agent on track, even in long conversations:

1. **AGENTS.md managed section** — On activation and every command, Agent Kanban writes a small sentinel-delimited section into `AGENTS.md` at the workspace root. VS Code re-injects AGENTS.md into the system prompt on **every agent mode turn**, so the agent always knows to read `INSTRUCTION.md` and `memory.md`. User content outside the sentinel markers (`<!-- BEGIN/END AGENT KANBAN -->`) is never modified.

2. **`response.reference()`** — Each `/task` and `/refresh` command attaches the INSTRUCTION.md and task file URIs to the chat response. This gives the agent a direct, per-thread reference to the active files.

3. **`/refresh` command** — On-demand context refresh. Re-syncs INSTRUCTION.md, updates the AGENTS.md section, and re-references the task file. Use this when the agent drifts in a long conversation.

4. **Editor tab** — `/task` and `/refresh` commands open the task file in the editor. While the tab is open, the agent can see it as context.

`.agentkanban/INSTRUCTION.md` is managed automatically — synced from the bundled template on every activation and command. **Do not edit it directly**; changes are overwritten on update. To customise agent behaviour, use your own agent configuration files (`AGENTS.md` outside the sentinels, `CLAUDE.md`, skills, etc.).

> **Note:** If your workspace already has an `AGENTS.md`, Agent Kanban only modifies content between its sentinel comments. Your own instructions are preserved.

### Why a layered approach?

In long Copilot chat conversations, earlier messages gradually scroll out of the model's context window. A single one-shot instruction injection (e.g. "read INSTRUCTION.md") works initially but the agent eventually forgets the workflow rules (context decay). We explored several mechanisms in isolation — `response.reference()`, `.instructions.md` with `applyTo` globs, MCP tool calls — and found that none completely solved the problem alone. Of these, `AGENTS.md` is the strongest because VS Code re-injects it at the system-prompt level on every agent turn — it never decays. The other layers (per-thread references, `/refresh` command, open editor tabs) provide complementary safety nets, giving the agent multiple independent paths back to the workflow rules and the active task file.

## Two Workflows

Agent Kanban supports two ways of working, depending on whether you want to stay in your main workspace or give the agent a fully isolated environment.

### Main-workspace workflow (no worktree)

This is the default. You work directly in your main workspace:

1. `@kanban /task My Task` — select the task
2. Type **go** in agent mode to begin — the agent reads the task file and follows the workflow
3. Use `@kanban /refresh` any time the agent loses track — it re-injects context

This works well for small-to-medium tasks where you're comfortable with the agent editing files directly in your working tree.

### Worktree workflow (isolated branch)

For larger or riskier tasks, create a **git worktree** so the agent works on its own branch in a separate directory, leaving your main workspace untouched:

1. `@kanban /task My Task` — select the task
2. Optionally plan and discuss in the task file first
3. `@kanban /worktree` — create the worktree (or click the branch icon on the Kanban card)
4. VS Code opens the worktree folder. The agent already knows which task file to read because AGENTS.md in the worktree contains a task-specific sentinel.
5. Use `@kanban /refresh` to re-inject context if the agent drifts
6. When done, merge the worktree branch back into your main branch via your normal git workflow.

### Why two workflows?

The main-workspace flow is simpler and works for most tasks. The worktree flow adds isolation: the agent can make sweeping changes, run tests, and even break things without affecting your working tree. It also means you can continue working in the main workspace while the agent operates in the worktree.

Both workflows share the same underlying context-injection mechanism (AGENTS.md sentinel, `response.reference()`, `/refresh` command). The difference is scope: in the main workspace you work directly; in a worktree, the agent has its own branch and `/refresh` keeps it on track.

## Git Worktrees — Details

### What `/worktree` does

When you run `@kanban /worktree` (or click the branch icon on a Kanban card), Agent Kanban:

1. **Auto-commits** any uncommitted `.agentkanban/` files so the worktree has the latest task data
2. **Creates a new branch** `agentkanban/<task-slug>` and a worktree directory
3. **Writes a task-specific AGENTS.md** into the worktree — this tells the agent exactly which task file to read, so it starts with full context without any manual setup
4. **Sets `--skip-worktree`** on AGENTS.md so the worktree's version stays independent from the main branch (changes to AGENTS.md in the worktree won't pollute commits)
5. **Opens the worktree** in VS Code

### Managing worktrees

- `@kanban /worktree open` — Re-open an existing worktree
- `@kanban /worktree remove` — Remove the worktree and delete the branch
- Moving a task to Done or Archive prompts you to clean up its worktree

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `agentKanban.worktreeRoot` | `../{repo}-worktrees` | Root directory for worktrees. `{repo}` is replaced with the repository name. |
| `agentKanban.worktreeOpenBehavior` | `current` | Open worktree in `current` window or a `new` window. |

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
git commit -m "Release v1.0.5"
git tag v1.0.5
git push origin main --tags
```

## LICENCE

Elastic License 2.0 (ELv2)
