# Agent Kanban

A VS Code extension providing an integrated Kanban board for managing coding agent tasks. Tasks follow a **plan → todo → implement** workflow, with persistent, version-controllable conversations stored as YAML files.

## Features

- **Kanban Board** — Visual board with customisable lanes (default: Todo, Doing, Done). Drag-and-drop task cards between lanes.
- **Task Conversations** — Each task has a conversation thread where users and AI agents collaborate. Messages are stored per-task in YAML files.
- **Agent Integration** — Built-in GitHub Copilot Chat Participant (`@kanban`) with plan/todo/implement slash commands. Agents receive full task conversation history as context.
- **Multi-User** — Multiple team members can converse on the same task via version control sync. Each user sets their display name locally.
- **Version Control Friendly** — One YAML file per task under `.agentkanban/tasks/`. Board configuration in `.agentkanban/board.yaml`. Append-only conversations minimise merge conflicts.
- **Pluggable Agent Providers** — `AgentProvider` interface designed for future CLI agent integration (Claude Code, Aider, etc.).

## Getting Started

1. Install the extension
2. Set your display name when prompted (or via `Settings > Agent Kanban > User Name`)
3. Click the Kanban icon in the Activity Bar to open the board
4. Click **+ New Task** to create a task
5. Click a task card to open the detail view
6. Select an action (Plan / Todo / Implement) and send a message to the agent

## How It Works

### Task Lifecycle

1. Create a task — it appears in the first lane (default: Todo)
2. Open the task to set requirements and start a conversation
3. Use **Plan** to discuss and analyse the task with the agent
4. Use **Todo** to generate actionable TODO items
5. Use **Implement** to have the agent write code
6. Drag the card between lanes as work progresses

### Agent Context

When you send a message, the agent receives:
- **Workspace instructions** — auto-discovered from `AGENTS.md`, `.github/copilot-instructions.md`, `.github/AGENTS.md`, or `CLAUDE.md` (first found wins)
- The board's base prompt (configurable in `.agentkanban/board.yaml`)
- The task title and description
- The full conversation history for the task
- The action type (plan/todo/implement) with role-specific instructions

The YAML conversation **is** the persistent context — every interaction rebuilds from it, so the agent always has the full picture.

### Model Selection

Each task can use a different language model. Set a default with `agentKanban.defaultModel`, or use the model dropdown in the task detail view to override per-task. Leave both empty to auto-detect the first available model.

### Tool Calling (Implement Mode)

When you use **Implement**, the agent has access to tools that let it modify your codebase:

| Tool | What it does |
|------|-------------|
| `readFile` | Read file contents |
| `writeFile` | Create or overwrite files (requires your confirmation) |
| `listFiles` | List files matching a pattern |
| `runTerminal` | Run shell commands (requires your confirmation) || editFile | Surgical text replacement in a file (requires your confirmation) |
| searchFiles | Search file contents across the workspace by text or regex |

In **Plan** and **Todo** modes, the agent has read-only access (readFile, listFiles, searchFiles) so it can explore your codebase while planning.
The agent operates within your workspace root by default. Destructive actions (file writes, terminal commands) always prompt for confirmation before executing. Set `agentKanban.allowExternalPaths` to `true` if you need the agent to access files outside the workspace (e.g. monorepo setups).

### Storage

```
.agentkanban/
  board.yaml          # Lane definitions, base prompt
  tasks/
    task-<id>.yaml    # One file per task with full conversation
```

### Chat Participant

Use `@kanban` in the Copilot chat window with commands:
- `@kanban /plan` — Plan the active task
- `@kanban /todo` — Generate TODOs for the active task
- `@kanban /implement` — Implement the active task

## Configuration

| Setting | Scope | Description |
|---------|-------|-------------|
| `agentKanban.userName` | Application (local) | Your display name for conversations |
| `agentKanban.enableLogging` | Window | Enable diagnostic logging to `.agentkanban/logs/`. Requires reload. |
| `agentKanban.allowExternalPaths` | Window | Allow the agent to read/write files outside the workspace root. || `agentKanban.defaultModel` | Window | Default language model ID. Leave empty to auto-detect. Can be overridden per-task via the model dropdown. |
## Development

```bash
npm install
npm run build      # Bundle with esbuild
npm run watch      # Watch mode
npm run lint       # TypeScript type check
npm test           # Run tests
```

Press F5 in VS Code to launch the Extension Development Host.
