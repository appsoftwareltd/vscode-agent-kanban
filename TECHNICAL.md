# Technical Documentation

## Architecture

```
src/
├── extension.ts              # Extension entry point — activation, registration
├── types.ts                  # Core type definitions (Task, BoardConfig)
├── LogService.ts             # Pure Node.js rolling file logger
├── TaskStore.ts              # Markdown task file read/write/watch (YAML frontmatter)
├── BoardConfigStore.ts       # Board configuration persistence
├── BoardViewProvider.ts      # Sidebar webview — kanban board UI
├── userName.ts               # User display name management
├── agents/
│   └── ChatParticipant.ts    # Lightweight @kanban chat command router
└── test/
    ├── __mocks__/vscode.ts   # VS Code API mock for unit tests
    ├── LogService.test.ts    # Log writing, rotation, no-op tests
    ├── TaskStore.test.ts     # Frontmatter round-trip, slug, ID, findByTitle tests
    ├── BoardConfigStore.test.ts # Board config serialisation tests
    └── ChatParticipant.test.ts  # Command routing, task resolution, action tests
```

## Core Types

### Task (`types.ts`)

```typescript
interface Task {
    id: string;           // e.g. task_20260308_143045123_abc123_my_task
    title: string;
    lane: string;         // Lane ID the task is in
    created: string;      // ISO 8601 timestamp
    updated: string;      // ISO 8601 timestamp (auto-updated on save)
    description: string;
}
```

Conversation history is stored in the markdown body of the task file (not in the Task interface). Uses `[user]:`/`[agent]:` markers.

### BoardConfig (`types.ts`)

```typescript
interface BoardConfig {
    lanes: LaneConfig[];  // Ordered lane definitions
    basePrompt: string;   // System-level prompt prepended to all agent requests
}

interface LaneConfig {
    id: string;           // URL-safe identifier
    name: string;         // Display name
}
```

## Persistence Layer

### TaskStore (`TaskStore.ts`)

- Reads/writes `.md` files with YAML frontmatter under `.agentkanban/tasks/`
- Task filenames: `task_YYYYMMDD_HHmmssfff_XXXXXX_slug.md` (ID derived from filename minus `.md`)
- `reload()` scans for `task_*.md` files, parses YAML frontmatter only, derives ID from filename
- `save()` preserves existing markdown body (conversation), only updates frontmatter
- `createTask()` generates IDs via `generateId()` using timestamp + random + slugified title
- `getTaskUri(id)` / `getTodoUri(taskId)` — construct URIs for task/todo files
- `findByTitle(query, excludeLane?)` — case-insensitive title search, optionally filtering by lane
- `delete()` removes both the task file and its associated `todo_*.md` file
- Static methods: `serialise()`, `deserialise()`, `splitFrontmatter()`, `slugify()`, `generateId()`
- `splitFrontmatter()` skips the `\n` immediately after the closing `---` fence to prevent blank-line accumulation on round-trips (since `serialise()` adds its own `\n` after `---`)
- Uses the `yaml` npm package (v2.x) for frontmatter parsing/stringifying with `lineWidth: 0`
- In-memory cache with `Map<string, Task>`, `onDidChange` event for UI refresh

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

[agent]: Here's my analysis...
```

Frontmatter fields: `title` (required), `lane` (defaults to `todo`), `created`, `updated`, `description` (omitted if empty).

### Todo File Format

Created on demand by `/todo` command. Filename mirrors task: `todo_YYYYMMDD_HHmmssfff_XXXXXX_slug.md`.

```markdown
---
task: task_20260308_143045123_abc123_oauth2
---

## TODO

- [ ] Item one
- [x] Item two (completed)
```

### BoardConfigStore (`BoardConfigStore.ts`)

- Reads/writes `.agentkanban/board.yaml`
- Creates default config (3 lanes: Todo, Doing, Done; empty base prompt) if file doesn't exist
- `update()` accepts partial config for incremental changes
- Fires `onDidChange` event

## Webview Architecture

### BoardViewProvider (`BoardViewProvider.ts`)

- Registered as `WebviewViewProvider` for the `agentKanban.boardView` sidebar view
- Renders HTML with CSS variables mapped to VS Code theme tokens
- Drag-and-drop via native HTML5 drag events
- Card click opens the task's `.md` file directly via `vscode.workspace.openTextDocument()`
- **Done lane protection**: Remove button hidden for the Done lane; `removeLane` handler blocks deletion with a warning
- Communication via `postMessage`/`onDidReceiveMessage`:
  - `newTask` — prompts for title, creates markdown file
  - `openTask` — opens task `.md` file in editor
  - `moveTask` — updates task lane in frontmatter
  - `addLane` / `removeLane` / `renameLane` — updates board config
  - `deleteTask` — removes task and todo files
- CSP: nonce-based script/style, `default-src 'none'`

## Chat Participant

### ChatParticipant (`agents/ChatParticipant.ts`)

Lightweight `@kanban` chat participant that routes commands to task markdown files. Does **not** run its own LLM loop — all agent work is handled by Copilot's native agent mode.

#### Command Routing

| Command | Handler | Description |
|---------|---------|-------------|
| `/new` | `handleNew()` | Creates a new task file, reports its path |
| `/task` | `handleTask()` | Selects a task, opens file in editor, outputs context |
| (none) | default | Shows available commands; handles verb followup clicks |

#### Task Resolution

`resolveTaskFromPrompt(prompt)` matches the prompt against active (non-Done) task titles:

1. **Exact prefix match** (case-insensitive) — prompt starts with task title
2. **Contains match** — longest title found anywhere in prompt
3. **Partial first-word match** — first word of prompt appears in a task title

Returns `{ task, freeText }` where `freeText` is any remaining prompt after the matched title.

#### /task Flow

1. If no prompt: lists active tasks
2. Resolve task from prompt via `resolveTaskFromPrompt()`
3. Ensure `.agentkanban/INSTRUCTION.md` exists (copy from bundled template if missing)
4. Set `lastSelectedTaskTitle` for verb followups
5. Open the task file in the editor via `vscode.window.showTextDocument()`
6. Output INSTRUCTION.md reference, task title, task file path
7. Guide user to type `plan`, `todo`, or `implement` in Copilot agent mode

#### /new Flow

1. Clear `lastSelectedTaskTitle` (resets verb followups)
2. Ensure `.agentkanban/INSTRUCTION.md` exists
3. Create the task file
4. Report path and suggest `@kanban /task <title>` to start working

#### Verb Handling (Default Case)

When the default handler receives a prompt matching a verb (`plan`, `todo`, `implement`) and `lastSelectedTaskTitle` is set, it shows a guidance message reminding the user to type the verb in Copilot agent mode (without `@kanban`). This handles clicks on verb followup buttons.

### Helper: `getActiveTaskTitles()`

Returns titles of all non-Done tasks. Used in the default (no command) response to show available tasks.

### INSTRUCTION.md — Agent Context Injection

`ensureInstructionFile()` checks for `.agentkanban/INSTRUCTION.md` in the workspace. If missing, copies the bundled template from `assets/INSTRUCTION.md` (shipped with the extension). Called at the start of every action command.

The instruction file reference is injected into the chat response as: `Read .agentkanban/INSTRUCTION.md first for workflow instructions.`

The file is editable by the user. Deleting it causes it to be re-created from the template on next command use.

### Followup Provider

`getFollowups()` provides context-aware suggestions:

- **After `/task` selects a task**: Returns verb followups — Plan, Todo, Implement — labelled with the selected task title. Tracks state via `lastSelectedTaskTitle`. When clicked, these go through the default handler which shows guidance.
- **Otherwise**: Returns a single `ChatFollowup` suggesting `/task` for the most recently updated active (non-Done) task.

Tasks are sorted by `updated` timestamp (descending), falling back to `created`.

Registered on the chat participant in `extension.ts` via `participant.followupProvider`.

## Extension Entry Point (`extension.ts`)

### Activation

1. Resolve workspace folder
2. Initialise logger (if `enableLogging` or `AGENT_KANBAN_DEBUG`)
3. Create and init `TaskStore`, `BoardConfigStore`
4. Register `BoardViewProvider` for sidebar
5. Register `ChatParticipant` as `@kanban` with followup provider
6. Register commands: `openTask`, `resetMemory`
7. Create file watchers: `.agentkanban/tasks/**/*.md` and `.agentkanban/board.yaml`

### Commands

| Command | Description |
|---------|-------------|
| `agentKanban.openTask` | Opens a task's `.md` file in the editor |
| `agentKanban.resetMemory` | Resets `.agentkanban/memory.md` to `# Memory\n` |

## Build System

- **esbuild** via `build.mjs` — bundles `src/extension.ts` to `dist/extension.js`
- **TypeScript** config: ES2022 target, Node16 modules, strict mode
- **Vitest** for unit tests with vscode module mocked via alias
- Scripts: `build`, `watch`, `lint` (tsc --noEmit), `test`, `test:watch`

## Security

- Webview CSP: `default-src 'none'`, nonce-based script/style execution
- HTML output escaped via `escapeHtml()` / `escapeAttr()` helpers
- No external resource loading in webviews
- User name stored in local (application-scope) settings only

## Logging

### LogService (`LogService.ts`)

Pure Node.js rolling file logger with no VS Code dependency.

- **Log file**: `.agentkanban/logs/agent-kanban.log`
- **Rolling**: When file exceeds 10 MB, rotates to `agent-kanban.1.log` ... `agent-kanban.5.log`; oldest is deleted
- **Log levels**: `INFO`, `WARN`, `ERROR`
- **API**: `info(tag, message)`, `warn(tag, message)`, `error(tag, message)`, `time(tag, label)` (returns timer callback)
- **No-op mode**: `NO_OP_LOGGER` singleton — all methods are no-ops when logging is disabled

### Activation

Two paths (requires VS Code reload after changing):
1. Setting: `agentKanban.enableLogging` (boolean, default `false`)
2. Environment variable: `AGENT_KANBAN_DEBUG=1` (for Extension Development Host)

### Injection Pattern

All services accept an optional `logger?: LogService` constructor parameter, defaulting to `NO_OP_LOGGER`:
- `TaskStore` — task file CRUD, cache reload
- `BoardConfigStore` — config loading/saving
- `BoardViewProvider` — webview lifecycle, message handling
- `ChatParticipant` — command routing, task resolution

### Tag Convention

| Tag | Source |
|-----|--------|
| `extension` | Extension activation/lifecycle |
| `taskStore` | Task CRUD operations |
| `boardConfig` | Board config operations |
| `boardView` | Board webview events |
| `chatParticipant` | Chat participant command handling |

### Log Format

```
[2026-03-08T14:30:45.123Z] [INFO] taskStore: Loaded 12 tasks
[2026-03-08T14:30:46.001Z] [INFO] chatParticipant: /plan on task: task_001 (My Task)
```

Note: `.agentkanban/logs/` should be added to `.gitignore` — logs are not intended for version control.
