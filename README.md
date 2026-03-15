# VS Code Agent Kanban

By [appsoftware.com](https://www.appsoftware.com)

[![CI](https://github.com/appsoftwareltd/vscode-agent-kanban/actions/workflows/ci.yml/badge.svg)](https://github.com/appsoftwareltd/vscode-agent-kanban/actions/workflows/ci.yml)

**VS Code Agent Kanban is available on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=AppSoftwareLtd.vscode-agent-kanban)**

A VS Code extension providing an integrated Kanban board and the formalisation of a markdown based `plan` / `todo` / `implement` workflow all within VS Code. VS Code Agent Kanban is designed to work with **GitHub Copilot Chat** and provides tools for keeping workflow instructions fresh in context, and per-task **Git Worktree** integration support.

> **The key concept: A `plan` / `todo` / `implement` workflow with markdown files that form a permanent record of design choices and actions makes for a robust 'human-in-the-loop' workflow that produces high quality agent assisted code implementations, even on long complex problems.**

Task files are designed to be version control friendly, so they can be shared with your team. 

Agent Kanban references its own instruction set, so it doesn't interfere with your existing agent files (e.g. AGENTS.md, skills etc).

![VS Code Agent Kanban](https://github.com/appsoftwareltd/vscode-agent-kanban/blob/main/images/icon.png?raw=true)

[Youtube (Quick Demo)](https://www.youtube.com/watch?v=Y4a3FnFftKw) (Note (2026-03-12) that the video and image need updating for recent releases, but have retained for now as a basic illustration of the key ideas)

<img width="1042" height="632" alt="image" src="https://github.com/user-attachments/assets/19bfc5ac-1ed2-4c10-bc5e-8338fbb95922" />

## Features

- **Kanban Board** — Visual board with customisable lanes (default: Todo, Doing, Done). Drag-and-drop task cards between lanes.
- **Markdown Task Files** — Each task is a `.md` file with YAML frontmatter. Conversation history uses `### user` / `### agent` / `[comment: user comment]` markers — directly readable, editable, and version-control friendly.
- **Chat Participant** — `@kanban` in Copilot Chat routes commands to task files. Copilot's native agent mode handles all work (tool calls, diffs, terminal). No custom LLM loop.
- **Context Refresh** — Use `@kanban /task` to select a task, then `@kanban /refresh` to re-inject context if the agent drifts in a long conversation. Context injection is automatic and keeps the agent on track.
- **Version Control Friendly** — One `.md` file per task, board config in YAML. Standard text files that diff/merge naturally meaning that this folder can be version controlled and shared among the team using your standard Git workflow.

## Getting Started

1. Install the extension and click the Kanban icon in the Activity Bar
2. Click **+ New Task** (or `@kanban /new My Task` in chat)
3. Choose a workflow (below)
4. The task file accumulates the full conversation - edit it directly to steer the agent or add context
5. Drag cards between lanes as work progresses

### Workflow option 1 - `/task` `/refresh` based flow

- Use `@kanban /task My Task` to select a task — opens the task file and sets up context
- In agent mode, type **plan**, **todo**, **implement** (or a combination) to begin — the agent reads the task file and follows the iterative workflow
- Use `@kanban /refresh` any time the agent loses track, to re-inject context

### Workflow option 2 - Git Worktree based flow

- For larger tasks, use `@kanban /worktree` (or create the worktree directly from the taskboard) to give the agent its own branch and working directory - it can make sweeping changes without touching your main workspace (see [Git Worktrees](#git-worktrees))

**In Git Worktree based flow - there is no need to use `/task` `/refresh` to keep the instructions fresh in context, as `AGENTS.md` is enhanced to reference the task file and extension instructions (we don't modify your `AGENTS.md`, we use `--skip-worktree` in the Worktree branch so that modifications are not committed back to your repository). `AGENTS.md` is sent with every agent turn, which makes it the best place to set task specific instruction.

## Chat Commands

| Command | Usage | Description |
|---------|-------|-------------|
| `/new` | `@kanban /new <title>` | Create a new task |
| `/task` | `@kanban /task <task name>` | Select a task — opens the file, sets up context *|
| `/refresh` | `@kanban /refresh [context]` | Re-inject agent context for the selected task |
| `/worktree` | `@kanban /worktree` | Create a git worktree for the selected task |
| `@kanban /worktree open` | Open the task worktree in VS Code |
| `@kanban /worktree remove` | Remove the task worktree |

\* Task name matching is fuzzy and case-insensitive. Tasks in the Done lane are excluded.

`/refresh` re-injects the full agent context (INSTRUCTION.md, task file, AGENTS.md section) without implying a specific workflow phase. Use it any time the agent drifts in a long conversation when using non Git Worktree base workflow.

## Agent Instructions

Agent Kanban uses a layered approach to keep the agent on track, even in long conversations:

1. **AGENTS.md managed section** — On activation and every command, Agent Kanban writes a small sentinel-delimited section into `AGENTS.md` at the workspace root. VS Code re-injects AGENTS.md into the system prompt on **every agent mode turn**, so the agent always knows to read `INSTRUCTION.md` and `memory.md`. User content outside the sentinel markers (`<!-- BEGIN/END AGENT KANBAN -->`) is never modified.

2. **Per-thread context** — Two mechanisms depending on the workflow:
   - **a) `response.reference()`** (main workspace) — Each `/task` and `/refresh` command attaches the INSTRUCTION.md and task file URIs to the chat response, giving the agent a direct, per-thread reference to the active files.
   - **b) Task-specific AGENTS.md sentinel** (worktree) — In worktree workspaces, the AGENTS.md sentinel names the exact task file (`**Active Task:**`, `**Task File:**`), so the agent knows which task to work on from the system prompt alone — no per-thread setup needed.

3. **`/refresh` command** — On-demand context refresh. Re-syncs INSTRUCTION.md, updates the AGENTS.md section, and re-references the task file. Use this when the agent drifts in a long conversation.

`.agentkanban/INSTRUCTION.md` is managed automatically — synced from the bundled template on every activation and command. **Do not edit it directly**; changes are overwritten on update. To customise agent behaviour, use your own agent configuration files (`AGENTS.md` outside the sentinels, `CLAUDE.md`, skills, etc.).

> **Note:** If your workspace already has an `AGENTS.md`, Agent Kanban only modifies content between its sentinel comments. Your own instructions are preserved.

### Agent Kanban Instruction Approach

In long Copilot chat conversations, earlier messages gradually scroll out of the model's context window. A single one-shot instruction injection (e.g. "read INSTRUCTION.md") works initially but the agent eventually forgets the workflow rules (context decay). We explored several mechanisms in isolation — `response.reference()`, `.instructions.md` with `applyTo` globs, MCP tool calls — and found that none completely solved the problem alone. Of these, `AGENTS.md` is the strongest because VS Code re-injects it at the system-prompt level on every agent turn — it never decays. The other layers (per-thread references, `/refresh` command, open editor tabs) provide complementary safety nets, giving the agent multiple independent paths back to the workflow rules and the active task file.

The worktree approach takes this further: because the worktree's AGENTS.md names the exact task file, the agent receives task-specific context on every turn — not just generic "read INSTRUCTION.md" pointers. This makes context recovery essentially automatic, without relying on per-thread references or manual `/refresh` commands.

## Two Workflows

Agent Kanban supports two ways of working, depending on whether you want to stay in your main workspace or give the agent a fully isolated environment.

### Main-workspace workflow (no worktree)

This is the default. You work directly in your main workspace:

1. `@kanban /task My Task` — select the task
2. In agent mode, type **plan**, **todo**, **implement** (or a combination) to begin — the agent reads the task file and follows the iterative workflow
3. Use `@kanban /refresh` any time the agent loses track — it re-injects context

This works well for small-to-medium tasks where you're comfortable with the agent editing files directly in your working tree.

### Worktree workflow (isolated branch)

For larger or riskier tasks, create a **git worktree** so the agent works on its own branch in a separate directory, leaving your main workspace untouched:

1. `@kanban /task My Task` — select the task
2. Optionally plan and discuss in the task file first
3. `@kanban /worktree` — create the worktree (or click the branch icon on the Kanban card)
4. VS Code opens the worktree folder. The agent already knows which task file to read because AGENTS.md in the worktree contains a task-specific sentinel.
5. In agent mode, type **plan**, **todo**, **implement** (or a combination) to begin. Commands like `/task` and `/refresh` auto-detect the linked task in worktree workspaces, so you don't need to re-select the task.
6. When done, merge the worktree branch back into your main branch via your normal git workflow.

### Why two workflows?

The main-workspace flow is simpler and works for most tasks. The worktree flow adds isolation: the agent can make sweeping changes, run tests, and even break things without affecting your working tree. It also means you can continue working in the main workspace while the agent operates in the worktree.

Both workflows share the same underlying context-injection mechanism (AGENTS.md sentinel, `response.reference()`, `/refresh` command). The difference is scope: in the main workspace you work directly; in a worktree, the agent has its own branch and `/refresh` keeps it on track.

## Git Worktrees — Details

### What `/worktree` does

When you run `@kanban /worktree` (or click the branch icon on a Kanban card), Agent Kanban:

1. **Auto-commits** the task file (and its todo sibling, if any) so the worktree has the latest task data
2. **Creates a new branch** `agentkanban/<task-slug>` and a worktree directory, pinned to the exact commit containing the task data
3. **Writes a task-specific AGENTS.md** into the worktree — this tells the agent exactly which task file to read, so it starts with full context without any manual setup
4. **Copies the task file** (with worktree metadata) into the worktree so the extension can detect the association when it activates there
5. **Sets `--skip-worktree`** on AGENTS.md so the worktree's version stays independent from the main branch (changes to AGENTS.md in the worktree won't pollute commits)
6. **Opens the worktree** in VS Code

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
lane: doing
created: 2026-03-08T10:00:00.000Z
updated: 2026-03-08T14:30:00.000Z
description: OAuth2 integration for the API
priority: high
assignee: alice
labels:
  - backend
  - auth
dueDate: 2026-03-15
worktree:
  branch: agentkanban/task_20260308_abc123_implement_oauth2
  path: /home/alice/projects/myrepo-worktrees/task_20260308_abc123_implement_oauth2
  created: 2026-03-08T14:35:00.000Z
---

## Conversation

### user

Let's plan the OAuth2 implementation...

### agent

Here's my analysis of OAuth2 approaches...
```

The lane a task belongs to is stored in its YAML frontmatter `lane` field. Archived tasks are moved to `tasks/archive/` and retain their original lane in frontmatter.

Optional frontmatter fields: `description`, `priority` (critical/high/medium/low/none), `assignee`, `labels`, `dueDate`, `sortOrder`, `worktree` (auto-managed by the extension).

### Conversation Markers

Within the `## Conversation` section, three markers structure the dialogue:

| Marker | Meaning |
|--------|---------|
| `### user` | A user turn — instructions, context, or questions directed at the agent |
| `### agent` | An agent turn — the agent's response or output |
| `[comment: your text]` | An inline annotation that is visible in the file but ignored by the agent |

**Slash command shortcuts** — When editing a task file, type `/` to trigger completions:

| Slash command | Inserts |
|---------------|---------|
| `/User Turn` | `### user` conversation marker |
| `/Agent Turn` | `### agent` conversation marker |
| `/Comment` | `[comment: ]` annotation with cursor inside |

These completions are suppressed inside YAML frontmatter and fenced code blocks.

## Storage

```
.agentkanban/
  .gitignore          # Auto-generated — ignores logs/
  board.yaml          # Lane definitions (slug list), base prompt
  memory.md           # Global memory (reset via Agent Kanban: Reset Memory command)
  INSTRUCTION.md      # Agent workflow instructions (managed by extension)
  tasks/
    task_<date>_<id>_<title>.md    # Task files (lane stored in frontmatter)
    todo_<date>_<id>_<title>.md    # Corresponding TODO files
    archive/          # Hidden from the board
      task_<date>_<id>_<title>.md
```

All tasks live flat in `tasks/`. The lane is stored in frontmatter, not in the directory structure. Only `tasks/archive/` is used as a subdirectory. When a lane is removed from the board, its tasks are archived (not deleted).

## Configuration

| Setting | Scope | Description |
|---------|-------|-------------|
| `agentKanban.enableLogging` | Window | Enable diagnostic logging to `.agentkanban/logs/`. Requires reload. |
| `agentKanban.customInstructionFile` | Resource | Path to a custom instruction file injected into the `/task` workflow. Relative paths resolve from workspace root. |
| `agentKanban.enforceWorktrees` | Resource | Require a git worktree before using `/refresh`. Prompts to create a worktree if one doesn't exist. |

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
git commit -m "Release v2.1.0"
git tag v2.1.0
git push origin main --tags
```

## LICENCE

Elastic License 2.0 (ELv2)
