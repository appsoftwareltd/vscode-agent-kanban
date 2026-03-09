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
    lane: string;         // Lane slug — determined by directory, not frontmatter
    created: string;      // ISO 8601 timestamp
    updated: string;      // ISO 8601 timestamp (auto-updated on save)
    description: string;
}
```

Conversation history is stored in the markdown body of the task file (not in the Task interface). Uses `[user]`/`[agent]` markers.

### BoardConfig (`types.ts`)

```typescript
interface BoardConfig {
    lanes: string[];      // Ordered lane slugs (e.g. ['todo', 'doing', 'done'])
    users?: string[];     // Known assignees (auto-populated from task frontmatter)
    labels?: string[];    // Known labels (auto-populated from task frontmatter)
}

const PROTECTED_LANES = ['todo', 'done'];
const RESERVED_LANES = ['archive'];

function slugifyLane(name: string): string     // lowercase, non-alphanumeric→hyphens
function displayLane(slug: string): string     // hyphens→spaces, UPPERCASE  
function isProtectedLane(slug: string): boolean
function isReservedLane(slug: string): boolean
```

### Lane Naming Model

- **Storage**: Lanes are slugs (lowercase, hyphen-separated). E.g. `todo`, `in-progress`, `code-review`.
- **Directories**: Each lane maps to a subdirectory under `.agentkanban/tasks/`. E.g. `tasks/todo/`, `tasks/in-progress/`.
- **Display**: `displayLane(slug)` converts to UPPERCASE with hyphens→spaces. E.g. `in-progress` → `IN PROGRESS`.
- **Input**: User input is slugified via `slugifyLane()`. E.g. `Code Review!` → `code-review`.
- **Archive**: The `archive/` directory is reserved. Tasks in it are hidden from the board. It replaces the old `archived` boolean flag.

## Persistence Layer

### TaskStore (`TaskStore.ts`)

- Reads/writes `.md` files with YAML frontmatter under `.agentkanban/tasks/<lane-slug>/`
- Tasks live in subdirectories matching their lane slug (e.g. `tasks/todo/`, `tasks/doing/`)
- Task filenames: `task_YYYYMMDD_HHmmssfff_XXXXXX_slug.md` (ID derived from filename minus `.md`)
- `init()` calls `migrateFlat()` (moves legacy flat task files into lane subdirectories), then `reload()`
- `reload()` enumerates subdirectories (excluding `archive`), parses tasks, sets `task.lane` from directory name
- `save()` writes to `tasks/<task.lane>/`, preserves existing markdown body
- `moveTaskToLane(id, newLane)` — moves task file (and todo file) between lane directories via `vscode.workspace.fs.rename()`
- `getDirectories()` — lists task subdirectory names for directory reconciliation
- `createTask()` generates IDs via `generateId()` using timestamp + random + slugified title
- `getTaskUri(id)` / `getTodoUri(taskId)` — construct URIs using cached lane directory
- `findByTitle(query, excludeLane?)` — case-insensitive title search, optionally filtering by lane
- `delete()` removes both the task file and its associated `todo_*.md` file
- Static methods: `serialise()`, `deserialise()`, `splitFrontmatter()`, `slugify()`, `generateId()`
- `serialise()` does NOT write `lane` to frontmatter — lane is determined by directory
- `deserialise()` does NOT read `lane` from frontmatter — sets `lane: ''` for caller to populate from directory
- Uses the `yaml` npm package (v2.x) for frontmatter parsing/stringifying with `lineWidth: 0`
- In-memory cache with `Map<string, Task>`, `onDidChange` event for UI refresh

#### Migration from Flat Layout

`migrateFlat()` runs on `init()` and handles the transition from the old flat `tasks/` layout:

1. Scans for `task_*.md` files directly in `tasks/` (not in subdirectories)
2. Reads legacy `lane` field from frontmatter to determine the target subdirectory
3. If `archived: true`, moves to `tasks/archive/`
4. Moves each file to the appropriate lane subdirectory

### Task File Format

```markdown
---
title: Implement OAuth2
created: 2026-03-08T10:00:00.000Z
updated: 2026-03-08T14:30:00.000Z
description: OAuth2 integration for the API
---

## Conversation

[user] Let's plan the OAuth2 implementation...

[agent] Here's my analysis...
```

Frontmatter fields: `title` (required), `created`, `updated`, `description` (omitted if empty). Optional metadata: `priority`, `assignee`, `labels`, `dueDate`, `sortOrder`.

**Note**: `lane` is NOT stored in frontmatter — the lane is determined by which subdirectory the file lives in.

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
- Creates default config (3 lanes: `todo`, `doing`, `done`) if file doesn't exist
- `init()` creates the `.agentkanban/` directory, ensures `.gitignore` exists, then loads or creates `board.yaml`
- On `init()`, auto-migrates old `{id, name}` object format to flat slug list
- `ensureLaneDirectories()` — creates subdirectories under `tasks/` for all configured lanes
- `reconcileWithDirectories(taskDirs)` — syncs board.yaml with actual task directories:
  - Unknown directories → added as new lanes in config
  - Non-conforming directory names → auto-renamed to slugified form
  - Reserved directories (e.g. `archive`) are skipped
- `reconcileMetadata(tasks)` — scans task assignees/labels and adds any missing values to board.yaml
- `ensureGitignore()` — creates `.agentkanban/.gitignore` (ignoring `logs/`) if it doesn't already exist. Idempotent; never overwrites a user-edited file.
- `update()` accepts partial config for incremental changes
- Fires `onDidChange` event

## Webview Architecture

### BoardViewProvider (`BoardViewProvider.ts`)

- Registered as `WebviewViewProvider` for the `agentKanban.boardView` sidebar view
- Renders HTML with CSS variables mapped to VS Code theme tokens
- Drag-and-drop via native HTML5 drag events
- Card click opens the task's `.md` file directly via `vscode.workspace.openTextDocument()`
- **Done lane protection**: Remove button hidden for the Done lane; `removeLane` handler blocks deletion with a warning
- **Protected lanes**: Lanes named "todo" or "done" cannot be removed or renamed. Uses `isProtectedLane()` from `types.ts`.
- **Lane removal with task cleanup**: Removing a non-protected lane deletes all tasks in that lane. If tasks exist, a confirmation dialog is shown first.
- **Archiving**: Archive moves a task to the `archive/` directory via `moveTaskToLane()`. Archived tasks are hidden from the board. A confirmation dialog is shown before archiving.
- **Lane drag-and-drop reordering**: Lane headers are draggable. Dropping a lane on another lane reorders the `config.lanes` array via a `moveLane` message. Uses a separate data transfer type (`application/x-lane-id`) to distinguish from card drags.
- Communication via `postMessage`/`onDidReceiveMessage`:
  - `newTask` — prompts for title, creates markdown file
  - `openTask` — opens task `.md` file in editor
  - `moveTask` — updates task lane in frontmatter
  - `addLane` / `removeLane` / `renameLane` / `moveLane` — updates board config
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
| `/plan` | `handleVerb()` | Re-injects context and starts planning for the selected task |
| `/todo` | `handleVerb()` | Re-injects context and generates TODOs for the selected task |
| `/implement` | `handleVerb()` | Re-injects context and starts implementation for the selected task |
| (none) | default | Shows available commands |

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
4. Set `lastSelectedTaskId` for verb followups
5. Open the task file in the editor via `vscode.window.showTextDocument()`
6. Output INSTRUCTION.md reference, custom instruction file reference (if configured), task title, task file path
7. Guide user to use `@kanban /plan`, `/todo`, `/implement` verb commands to begin working

##### Custom Instruction File

When `agentKanban.customInstructionFile` is set, `handleTask()` resolves the path (relative to workspace root or absolute), verifies the file exists via `workspace.fs.stat()`, and injects `Read <path> for additional instructions.` between the INSTRUCTION.md reference and the task context. If the file does not exist, the reference is silently skipped with a log warning.

#### /new Flow

1. Clear `lastSelectedTaskId` (resets verb followups)
2. Ensure `.agentkanban/INSTRUCTION.md` exists
3. Create the task file
4. Report path and suggest `@kanban /task <title>` to start working

#### Verb Commands (/plan, /todo, /implement)

1. If `lastSelectedTaskId` is not set: lists active tasks and prompts user to run `/task` first
2. Look up task from `lastSelectedTaskId`; if task is done/missing, clear selection and prompt re-selection
3. Sync INSTRUCTION.md from bundled template
4. Open the task file in editor
5. Output: INSTRUCTION.md reference, verb label + task title, task file path, additional context (if any)
6. Instruct agent to read the task file and perform the verb action

**Verb combinations**: The prompt can contain `#plan`, `#todo`, `#implement` hash tags to combine verbs. E.g. `@kanban /todo #implement` runs both todo and implement. `parseVerbs(command, prompt)` extracts all verbs in canonical order (plan → todo → implement).

### Helper: `getActiveTaskTitles()`

Returns titles of all non-Done tasks. Used in the default (no command) response to show available tasks.

### INSTRUCTION.md — Agent Context Injection

`ensureInstructionFile()` checks for `.agentkanban/INSTRUCTION.md` in the workspace. If missing, copies the bundled template from `assets/INSTRUCTION.md` (shipped with the extension). Called at the start of every action command.

The instruction file reference is injected into the chat response as: `Read .agentkanban/INSTRUCTION.md first for workflow instructions.`

The file is editable by the user. Deleting it causes it to be re-created from the template on next command use.

### Followup Provider

`getFollowups()` provides context-aware suggestions:

- **When a task is selected** (`lastSelectedTaskId` is set): Returns four verb command followups — Plan, Todo, Implement, Todo + Implement — each labelled with the selected task title. When clicked, these go through `handleVerb()` which re-injects full workflow context.
- **Otherwise**: Returns a single `ChatFollowup` suggesting `/task` for the most recently updated active (non-Done) task.
- If the selected task has been moved to Done or deleted, the selection is cleared and falls through to the `/task` suggestion.

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
7. Create file watchers: `.agentkanban/tasks/**/*.md` (debounced 200ms, with directory reconciliation), `.agentkanban/tasks/*` (directory-level) and `.agentkanban/board.yaml`
8. Run housekeeping reconciliation (sync assignees/labels from task frontmatter into board.yaml)
9. Start 10-minute housekeeping interval for ongoing reconciliation

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
