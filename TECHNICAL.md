# Technical Documentation

## Architecture

```
src/
├── extension.ts              # Extension entry point — activation, registration
├── types.ts                  # Core type definitions (Task, BoardConfig, WorktreeInfo)
├── LogService.ts             # Pure Node.js rolling file logger
├── TaskStore.ts              # Markdown task file read/write/watch (YAML frontmatter)
├── BoardConfigStore.ts       # Board configuration persistence
├── BoardViewProvider.ts      # Sidebar webview — kanban board UI
├── KanbanEditorPanel.ts      # Full editor panel — kanban board with worktree support
├── WorktreeService.ts        # Git worktree lifecycle management
├── agents/
│   └── ChatParticipant.ts    # Lightweight @kanban chat command router
└── test/
    ├── __mocks__/vscode.ts   # VS Code API mock for unit tests
    ├── LogService.test.ts    # Log writing, rotation, no-op tests
    ├── TaskStore.test.ts     # Frontmatter round-trip, slug, ID, findByTitle tests
    ├── BoardConfigStore.test.ts # Board config serialisation tests
    ├── ChatParticipant.test.ts  # Command routing, task resolution, worktree tests
    └── WorktreeService.test.ts  # Worktree creation, removal, git operations
```

## Core Types

### Priority (`types.ts`)

```typescript
type Priority = 'critical' | 'high' | 'medium' | 'low' | 'none';
```

### WorktreeInfo (`types.ts`)

```typescript
interface WorktreeInfo {
    branch: string;       // e.g. agentkanban/task_20260308_143045123_abc123_my_task
    path: string;         // Absolute path to worktree directory
    created: string;      // ISO 8601 timestamp
}
```

### Task (`types.ts`)

```typescript
interface Task {
    id: string;           // e.g. task_20260308_abc123_my_task
    title: string;
    lane: string;         // Lane slug — stored in frontmatter
    created: string;      // ISO 8601 timestamp
    updated: string;      // ISO 8601 timestamp (auto-updated on save)
    description: string;
    priority?: Priority;
    assignee?: string;
    labels?: string[];
    dueDate?: string;
    sortOrder?: number;
    worktree?: WorktreeInfo;
    slug?: string;
}
```

Conversation history is stored in the markdown body of the task file (not in the Task interface). Uses `### user`/`### agent` markers.

### BoardConfig (`types.ts`)

```typescript
interface BoardConfig {
    lanes: string[];      // Ordered lane slugs (e.g. ['todo', 'doing', 'done'])
    users?: string[];     // Known assignees (auto-populated from task frontmatter)
    labels?: string[];    // Known labels (auto-populated from task frontmatter)
}

const PROTECTED_LANES = ['todo', 'done'];

function slugifyLane(name: string): string     // lowercase, non-alphanumeric→hyphens
function displayLane(slug: string): string     // hyphens→spaces, UPPERCASE  
function isProtectedLane(slug: string): boolean
function isReservedLane(slug: string): boolean
```

### Lane Naming Model

- **Storage**: Lanes are slugs (lowercase, hyphen-separated). E.g. `todo`, `in-progress`, `code-review`.
- **Frontmatter**: Each task stores its lane in the `lane` YAML frontmatter field.
- **Display**: `displayLane(slug)` converts to UPPERCASE with hyphens→spaces. E.g. `in-progress` → `IN PROGRESS`.
- **Input**: User input is slugified via `slugifyLane()`. E.g. `Code Review!` → `code-review`.
- **Archive**: The `tasks/archive/` directory is reserved. Tasks in it are hidden from the board. Archived tasks retain their original lane in frontmatter.

## Persistence Layer

### TaskStore (`TaskStore.ts`)

- Reads/writes `.md` files with YAML frontmatter under `.agentkanban/tasks/` (flat) and `.agentkanban/tasks/archive/`
- All non-archived tasks live directly in `tasks/`; lane is stored in frontmatter
- Task filenames: `task_YYYYMMDD_XXXXXX_slug.md` (ID derived from filename minus `.md`)
- `init()` calls `migrateFromDirectories()` (moves legacy lane-directory task files into flat `tasks/`, adds lane to frontmatter, renames from old HHmmssfff format), then `reload()`
- `reload()` reads flat `tasks/` and `tasks/archive/`, parses tasks, reads `task.lane` from frontmatter
- `save()` writes to `tasks/` (or `tasks/archive/` for archived tasks), preserves existing markdown body
- `moveTaskToLane(id, newLane)` — updates lane in frontmatter only; no file move
- `archiveTask(id)` — moves task file (and todo file) from `tasks/` to `tasks/archive/`; retains original lane in frontmatter
- `createTask()` generates IDs via `generateId()` using date + random + slugified title
- `getTaskUri(id)` / `getTodoUri(taskId)` — construct URIs using `_archivedIds` set to determine location
- `findByTitle(query, excludeLane?)` — case-insensitive title search, optionally filtering by lane
- `isArchived(task)` — checks if a task is in the archive directory (via `_archivedIds` set)
- `delete()` removes both the task file and its associated `todo_*.md` file
- Static methods: `serialise()`, `deserialise()`, `splitFrontmatter()`, `slugify()`, `generateId()`, `extractSlugFromId()`, `migrateFileName()`
- `serialise()` writes `lane` to frontmatter
- `deserialise()` reads `lane` from frontmatter
- Uses the `yaml` npm package (v2.x) for frontmatter parsing/stringifying with `lineWidth: 0`
- In-memory cache with `Map<string, Task>`, `onDidChange` event for UI refresh

#### Migration from Directory Layout

`migrateFromDirectories()` runs on `init()` and handles the transition from the old lane-subdirectory layout:

1. Scans for subdirectories under `tasks/` (excluding `archive/`)
2. For each task file in a lane subdirectory:
   - Reads the file, adds `lane: <directory-name>` to frontmatter
   - Renames from old format (`task_YYYYMMDD_HHmmssfff_XXXXXX_slug.md`) to new format (`task_YYYYMMDD_XXXXXX_slug.md`)
   - Moves the file to flat `tasks/`
   - Moves corresponding `todo_` files similarly
3. Removes empty lane subdirectories after migration
4. Also renames any flat files that still use the old naming format

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

### user

Let's plan the OAuth2 implementation...

### agent

Here's my analysis...
```

Frontmatter fields: `title` (required), `lane`, `created`, `updated`, `description` (omitted if empty). Optional metadata: `priority`, `assignee`, `labels`, `dueDate`, `sortOrder`, `worktree` (auto-managed by the extension — `branch`, `path`, `created`), `slug`.

**Note**: The `lane` field determines which board lane the task appears in. Archived tasks live in `tasks/archive/` and retain their original lane.

### Todo File Format

Created on demand by `/todo` command. Filename mirrors task: `todo_YYYYMMDD_XXXXXX_slug.md`.

```markdown
---
task: task_20260308_abc123_oauth2
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
- **Lane removal with task archiving**: Removing a non-protected lane archives all tasks in that lane. If tasks exist, a confirmation dialog is shown first.
- **Archiving**: Archive moves a task to the `archive/` directory via `archiveTask()`. Archived tasks retain their original lane in frontmatter and are hidden from the board. A confirmation dialog is shown before archiving.
- **Lane drag-and-drop reordering**: Lane headers are draggable. Dropping a lane on another lane reorders the `config.lanes` array via a `moveLane` message. Uses a separate data transfer type (`application/x-lane-id`) to distinguish from card drags.
- Communication via `postMessage`/`onDidReceiveMessage`:
  - `newTask` — prompts for title, creates markdown file
  - `openTask` — opens task `.md` file in editor
  - `openTodo` — opens the task's todo `.md` file in editor (shows info message if file doesn't exist)
  - `moveTask` — updates task lane in frontmatter
  - `addLane` / `removeLane` / `renameLane` / `moveLane` — updates board config
  - `deleteTask` — removes task and todo files
- `_sendState()` filters out archived tasks before sending to the webview — the board only shows tasks in the flat `tasks/` directory
- CSP: nonce-based script/style, `default-src 'none'`

## Chat Participant

### ChatParticipant (`agents/ChatParticipant.ts`)

Lightweight `@kanban` chat participant that routes commands to task markdown files. Does **not** run its own LLM loop — all agent work is handled by Copilot's native agent mode.

#### Command Routing

| Command | Handler | Description |
|---------|---------|-------------|
| `/new` | `handleNew()` | Creates a new task file, reports its path |
| `/task` | `handleTask()` | Selects a task, opens file in editor, outputs context |
| `/refresh` | `handleRefresh()` | Re-injects full workflow context for the selected task |
| `/worktree` | `handleWorktree()` | Create, open, or remove a git worktree for the selected task |
| (none) | default | Shows available commands |

#### Task Resolution

`resolveTaskFromPrompt(prompt)` matches the prompt against active (non-Done) task titles:

1. **Slug match** — exact slug, case-insensitive (highest priority)
2. **Exact prefix match** (case-insensitive) — prompt starts with task title
3. **Contains match** — longest title found anywhere in prompt
4. **Alphanumeric fuzzy** — character-stripped comparison
5. **Partial first-word match** — first word of prompt appears in a task title

Returns `{ task, freeText }` where `freeText` is any remaining prompt after the matched title.

#### /task Flow

1. If no prompt and in a worktree workspace: auto-detect linked task via `findLinkedWorktreeTask()`, show task name and `WORKTREE_WORKSPACE_HINT`
2. If no prompt: list active tasks
3. Resolve task from prompt via `resolveTaskFromPrompt()`
4. Sync `.agentkanban/INSTRUCTION.md` and AGENTS.md managed section from bundled templates
5. Set `lastSelectedTaskId` for followup commands
6. Attach INSTRUCTION.md and task file as `response.reference()` URIs for persistent context
7. Open the task file in the editor via `vscode.window.showTextDocument()`
8. Output INSTRUCTION.md reference, custom instruction file reference (if configured), task title, task file path, worktree status
9. Guide user to type **plan**, **todo**, **implement** (or a combination) to proceed

##### Custom Instruction File

When `agentKanban.customInstructionFile` is set, `handleTask()` resolves the path (relative to workspace root or absolute), verifies the file exists via `workspace.fs.stat()`, and injects `Read <path> for additional instructions.` between the INSTRUCTION.md reference and the task context. If the file does not exist, the reference is silently skipped with a log warning.

#### /new Flow

1. Clear `lastSelectedTaskId` (resets followups)
2. Auto-initialise via `agentKanban.initialise` if workspace not yet set up
3. Ensure `.agentkanban/INSTRUCTION.md` exists
4. Create the task file
5. Report path and suggest `@kanban /task <title>` to start working

#### /refresh Flow

1. If `lastSelectedTaskId` is not set: auto-detect linked task via `findLinkedWorktreeTask()` (worktree workspace support)
2. If still no task: list active tasks and prompt user to run `/task` first
3. Look up task; if done/missing, clear selection and prompt re-selection
4. Check `enforceWorktrees` setting — block if enabled and no worktree exists
5. Sync INSTRUCTION.md and AGENTS.md (uses worktree-enhanced sentinel if task has a worktree)
6. Attach INSTRUCTION.md and task file as `response.reference()` URIs for persistent context
7. Open the task file in editor (preserveFocus keeps cursor in chat input)
8. Output: INSTRUCTION.md reference, **REFRESH** label + task title, task file path, worktree hint (if applicable), additional context

#### /worktree Flow

1. Verify git repository and `WorktreeService` availability
2. If `lastSelectedTaskId` is not set: auto-detect linked task via `findLinkedWorktreeTask()`
3. If still no task: prompt user to run `/task` first
4. Route to subcommand handler based on prompt:
   - `(empty)` → `handleWorktreeCreate()` — create worktree, save metadata, copy task file, open in VS Code
   - `open` → `handleWorktreeOpen()` — reopen existing worktree, show `WORKTREE_WORKSPACE_HINT` if already in it
   - `remove` → `handleWorktreeRemove()` — remove worktree + delete branch, clear metadata

#### Worktree Auto-Detection

`findLinkedWorktreeTask()` scans all tasks for one whose `worktree.path` matches the current workspace folder (normalised for Windows path comparison). This enables seamless task selection in worktree workspaces without requiring the user to re-select via `/task`.

`isInTaskWorktree(task)` checks if the current workspace IS the worktree for a specific task.

`WORKTREE_WORKSPACE_HINT` is a shared constant shown in worktree workspaces:
> ℹ️ **Worktree workspace** — AGENTS.md permanently provides task context. You don't need these commands unless you use `/task` to switch tasks.

### Helper: `getActiveTaskTitles()`

Returns titles of all non-Done tasks. Used in the default (no command) response to show available tasks.

### Helper: `buildWorktreeAgentsMdSection()`

Exported function that builds the enhanced AGENTS.md sentinel for worktree workspaces. Contains `**Active Task:**`, `**Task File:**`, and optionally `**Todo File:**` directives so the agent knows exactly which task file to read. Accepts an optional `todoRelPath` parameter. Used by both `ChatParticipant.syncAgentsMdSection()` and `WorktreeService.writeWorktreeAgentsMd()`.

### INSTRUCTION.md — Agent Context Injection

`syncInstructionFile()` syncs `.agentkanban/INSTRUCTION.md` in the workspace from the bundled template (`assets/INSTRUCTION.md`). Always overwrites — this file is managed by the extension, not user-editable. Called at the start of every action command.

The instruction file reference is injected into the chat response as: `Read .agentkanban/INSTRUCTION.md for workflow instructions.`

### AGENTS.md — Managed Section

`syncAgentsMdSection(worktreeTask?)` manages a sentinel-delimited section in the workspace's `AGENTS.md`. VS Code re-injects `AGENTS.md` into the system prompt on **every agent mode turn**, making it the most reliable context injection mechanism.

The section is delimited by `<!-- BEGIN AGENT KANBAN — DO NOT EDIT THIS SECTION -->` and `<!-- END AGENT KANBAN -->` sentinel comments. The method:

1. Reads existing `AGENTS.md` (or starts with empty string if the file doesn't exist)
2. If called without `worktreeTask` and the existing sentinel contains `**Active Task:**`, preserves the worktree-enhanced sentinel (avoids downgrading)
3. Finds the sentinel block (if present) and replaces it, or appends the block at the end
4. Writes the file back — user content outside the sentinels is never modified

**Standard sentinel** (main workspace):
```markdown
<!-- BEGIN AGENT KANBAN — DO NOT EDIT THIS SECTION -->
## Agent Kanban

Read `.agentkanban/INSTRUCTION.md` for task workflow rules.
Read `.agentkanban/memory.md` for project context.

If a task file (`.agentkanban/tasks/**/*.md`) was referenced earlier in this conversation, re-read it before responding.
<!-- END AGENT KANBAN -->
```

**Worktree-enhanced sentinel** (worktree workspace):
```markdown
<!-- BEGIN AGENT KANBAN — DO NOT EDIT THIS SECTION -->
## Agent Kanban

**Active Task:** Implement OAuth2
**Task File:** `.agentkanban/tasks/task_xxx.md`
**Todo File:** `.agentkanban/tasks/todo_xxx.md`

Read the task file above before responding.
Read `.agentkanban/INSTRUCTION.md` for task workflow rules.
Read `.agentkanban/memory.md` for project context.
<!-- END AGENT KANBAN -->
```

Called on activation and by every command. This ensures:
- The agent always knows INSTRUCTION.md and memory.md exist (every turn, all threads)
- In worktree workspaces, the sentinel names the exact task file — no manual selection needed
- The "re-read task file" directive prompts the agent to actively recover its task context

`syncWorktreeAgentsMd()` is called on extension activation. It checks if the current workspace is a task worktree (via `findLinkedWorktreeTask()`) and writes the enhanced sentinel if so.

The layered approach combines AGENTS.md (system-prompt level, every turn), `response.reference()` (per-thread URIs), `/refresh` command (on-demand refresh), and editor tabs (persistent while open) to eliminate context decay.

### Followup Provider

`getFollowups()` provides context-aware suggestions:

- **When a task is selected** (`lastSelectedTaskId` is set): Returns a `/refresh` followup and a `/worktree` followup (create or open, depending on whether the task already has a worktree).
- **Otherwise**: Returns a single `ChatFollowup` suggesting `/task` for the most recently updated active (non-Done) task.
- If the selected task has been moved to Done or deleted, the selection is cleared and falls through to the `/task` suggestion.

Tasks are sorted by `updated` timestamp (descending), falling back to `created`.

Registered on the chat participant in `extension.ts` via `participant.followupProvider`.

## Extension Entry Point (`extension.ts`)

### Activation

1. Resolve workspace folder
2. Detect initialisation state (presence of `.agentkanban/board.yaml`) — prevents log directory creation on fresh workspaces
3. Initialise logger (if `enableLogging` or `AGENT_KANBAN_DEBUG`, and workspace is initialised)
4. Create and init `TaskStore`, `BoardConfigStore`, `WorktreeService`
5. Register `BoardViewProvider` for sidebar
6. Register `KanbanEditorPanel` serialiser and `openBoard`/`newTask` commands
7. Register `ChatParticipant` as `@kanban` with followup provider
8. Register commands: `openTask`, `resetMemory`, `initialise`
9. Create file watchers: `.agentkanban/tasks/**/*.md` (debounced 200ms) and `.agentkanban/board.yaml`
10. Register `SlashCommandProvider` for `/` completions in task markdown files
10. Register `SlashCommandProvider` for `/` completions in task markdown files
11. If already initialised: load config/tasks, sync INSTRUCTION.md, sync AGENTS.md, sync worktree AGENTS.md (if in worktree workspace), clean stale worktree metadata, run housekeeping
12. Start 10-minute housekeeping interval for ongoing reconciliation

### Commands

| Command | Description |
|---------|-------------|
| `agentKanban.openBoard` | Opens the Kanban board editor panel |
| `agentKanban.newTask` | Opens the board and triggers the create-task modal |
| `agentKanban.openTask` | Opens a task's `.md` file in the editor |
| `agentKanban.resetMemory` | Resets `.agentkanban/memory.md` to `# Memory\n` |
| `agentKanban.initialise` | Full first-time setup — creates dirs, writes config & instruction files |

### Stale Worktree Cleanup

`cleanStaleWorktreeMetadata()` runs once on activation. Scans all tasks with `worktree` metadata and checks if the worktree directory still exists on disk. If not, clears the `worktree` field from the task frontmatter.

## WorktreeService (`WorktreeService.ts`)

Manages git worktree lifecycle for Agent Kanban tasks. Wraps `git worktree add`, `git worktree remove`, and related operations. All git commands run in the workspace root directory.

### Key Methods

| Method | Description |
|--------|-------------|
| `isGitRepo()` | Checks if the workspace is a git repository |
| `getRepoName()` | Gets the repository name from the git root |
| `create(taskId, taskTitle, taskRelPath?)` | Creates a worktree + branch, returns `WorktreeInfo` |
| `remove(worktreeInfo)` | Removes worktree and deletes branch |
| `list()` | Lists all active worktrees (parses `git worktree list --porcelain`) |
| `exists(worktreePath)` | Checks if a worktree directory still exists on disk |
| `openInVSCode(worktreePath)` | Opens worktree folder respecting `worktreeOpenBehavior` setting |
| `autoCommitTaskFiles(taskTitle, taskRelPath?)` | Stages and commits task files, returns commit hash |
| `writeWorktreeAgentsMd(worktreePath, taskTitle, taskRelPath)` | Writes enhanced AGENTS.md sentinel into worktree directory (derives `todoRelPath` from task path) |
| `getWorktreeRoot()` | Resolves configured root directory with `{repo}` placeholder |

### Worktree Creation Flow

1. **Auto-commit** — `autoCommitTaskFiles()` parses `git status --porcelain -uall` output, stages only actually-changed files, commits with descriptive message, returns commit hash. Verifies the task file exists in the commit.
2. **Create worktree** — `git worktree add -b <branch> <path> <commit-hash>`. Commit-hash pinning ensures the worktree starts from the exact commit containing the task data (avoids race with other commits).
3. **Set `--skip-worktree`** — `git update-index --skip-worktree AGENTS.md` so the worktree's AGENTS.md stays independent from the main branch.
4. **Write AGENTS.md** — `writeWorktreeAgentsMd()` writes the enhanced sentinel into the worktree, using the same logic as `syncAgentsMdSection()`.

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `agentKanban.worktreeRoot` | `../{repo}-worktrees` | Root directory for worktrees. `{repo}` is replaced with the repository name. |
| `agentKanban.worktreeOpenBehavior` | `current` | Open worktree in `current` window or a `new` window. |
| `agentKanban.enforceWorktrees` | `false` | Require a git worktree before using `/refresh`. |

### Branch Naming

All worktree branches use the `agentkanban/` prefix followed by the task slug (derived from the task ID, truncated and sanitised).

## SlashCommandProvider (`SlashCommandProvider.ts`)

Provides `/` slash command completions in task markdown files (`.agentkanban/tasks/**/*.md`). Implements `vscode.CompletionItemProvider` and is registered with `/` as the trigger character.

### Commands

| Command | Insert Text |
|---------|-------------|
| `/user` | `### user` block with cursor positioned inside |
| `/agent` | `### agent` block with cursor positioned inside |
| `/comment` | `[comment: ...]` inline marker with cursor inside |

Completions are suppressed inside YAML frontmatter (between `---` delimiters) and fenced code blocks. Uses `vscode.SnippetString` for cursor placement. The replacement range covers the `/` trigger character.

## KanbanEditorPanel (`KanbanEditorPanel.ts`)

Full editor panel providing the Kanban board UI with worktree support. Registered as a webview panel serialiser so it survives window reloads.

### Worktree Integration

The `createWorktree` message handler:

1. Calls `WorktreeService.create()` to create the worktree
2. Saves the task with `worktree` metadata
3. Copies the updated task file (with worktree metadata) into the worktree directory so the extension can detect the association when it activates there
4. Calls `WorktreeService.openInVSCode()` to open the worktree

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
- `WorktreeService` — git worktree operations

### Tag Convention

| Tag | Source |
|-----|--------|
| `extension` | Extension activation/lifecycle |
| `taskStore` | Task CRUD operations |
| `boardConfig` | Board config operations |
| `boardView` | Board webview events |
| `chatParticipant` | Chat participant command handling |
| `worktreeService` | Git worktree operations |

### Log Format

```
[2026-03-08T14:30:45.123Z] [INFO] taskStore: Loaded 12 tasks
[2026-03-08T14:30:46.001Z] [INFO] chatParticipant: /plan on task: task_001 (My Task)
```

Note: `.agentkanban/logs/` should be added to `.gitignore` — logs are not intended for version control.
