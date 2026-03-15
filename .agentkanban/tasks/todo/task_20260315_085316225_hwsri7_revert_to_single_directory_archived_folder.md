---
title: Revert to single directory + archived folder
created: 2026-03-15T08:53:16.225Z
updated: 2026-03-15T08:53:40.705Z
sortOrder: 1773309353061
slug: revert_to_single_directory_archived_folder
worktree:
  branch: agentkanban/20260315_085316225_hwsri7_revert_to_single_directory_archived_folder
  path: c:\Users\Gareth\src\vscode-agent-kanban-worktrees\20260315_085316225_hwsri7_revert_to_single_directory_archived_folder
  created: 2026-03-15T08:53:40.705Z
---

## Conversation

[user]

In an earlier iteration we moved to a mechanism whereby agent tasks sync directory under tasks/ with the lane name. This is making the version controlling of the tasks harder where if a user moves a task across lanes, Git merges become less reliable as it is dependent on Git's logic for determining that the file is the same with a move rather than two different files. We're going to combine several changes here:

We will instead have a lane property in the task yaml font matter that aligns with the kanban board lane.

We need a migration path for users updating from earlier versions of the app so that all tasks are moved directly under the tasks directory (unless they are archived), and the front matter modified to retain the lane. 

Clean up any file watching behaviour that supported the sync of lane to directory and vice versa

We do still need to retain the archived folder however. Archived tasks will be moved to an archived folder to keep the main task folder clean.

We're going to change the default file name for the task so that it retains the datestamp YYYYMMDD, short uuid and slugified name - but removes the timestamp portion.

The sentinal section in AGENTS.md needs to include a reference to the todo file name, which will also have the timestamp portion removed

We're going to change the format of the [user] / [agent] / [comment] conversation delimiters so they will be:

```
### user

### agent

[comment: <comment text>]
```

We need a `/` 'slash command' shortcut behaviour that is available when working in *.md files under the tasks directory. There will be 3 commands which will insert the text at the cursor position as follows:

User Turn

```
\n### user

<cursor placed here>
```

Agent Turn

```
\n### agent

<cursor placed here>
```

User Comment

```
[comment: <cursor placed here>]
```

[agent]

Confirmed I am working in task file: `task_20260315_085316225_hwsri7_revert_to_single_directory_archived_folder.md`

I've thoroughly explored the codebase. Here is my plan covering all the required changes:

---

## Plan

### Change 1: Lane stored in frontmatter instead of directory

**Current**: Lane is determined by subdirectory (`tasks/todo/`, `tasks/doing/`, etc.) and is explicitly excluded from serialized frontmatter.

**New**: Add `lane` as a YAML frontmatter property. All non-archived tasks live flat in `tasks/`. Archived tasks live in `tasks/archive/`.

**Files affected**:
- `src/types.ts` — No change needed (Task already has `lane: string`)
- `src/TaskStore.ts` — Major changes:
  - `reload()` — Read tasks from flat `tasks/` directory instead of iterating subdirectories
  - `loadTasksFromDirectory()` — Simplified to read from single directory; lane comes from frontmatter
  - `serialise()` — Include `lane` in frontmatter output
  - `deserialise()` — Read `lane` from frontmatter
  - `save()` / `create()` — Write to `tasks/` (not `tasks/<lane>/`)
  - `moveToLane()` — Update frontmatter lane property instead of moving file between directories
  - `archive()` — Move file from `tasks/` to `tasks/archive/`; set lane to original lane or 'archive' marker
  - `getTaskUri()` — Return path in flat `tasks/` directory
  - `getTodoUri()` — Same flat directory
- `src/BoardConfigStore.ts` — `reconcileWithDirectories()` may need updating since lanes no longer map to directories; lanes are now purely a board.yaml + frontmatter concept
- `src/webview/board.ts` — Archive action sends message to move to archive folder (may already work)
- `src/agents/ChatParticipant.ts` — Update task path references in sentinel and context injection

### Change 2: Migration from directory-based to flat structure

**On extension activation / task store init**:
1. Scan for legacy subdirectories under `tasks/` (excluding `archive/`)
2. For each task file found in a subdirectory:
   - Read the file, parse frontmatter
   - Add `lane: <directory-name>` to frontmatter
   - Move the file (and its todo_ sibling) to `tasks/`
   - Move any todo_ files similarly
3. Remove empty lane subdirectories after migration
4. Leave `tasks/archive/` intact

**Files affected**:
- `src/TaskStore.ts` — Add `migrateFromDirectories()` method, called from `init()` or `reload()`

### Change 3: Clean up file watching for lane-directory sync

**Current**: Three watchers in `extension.ts`:
1. `mdWatcher` — watches `tasks/**/*.md` (keep, but simplify — no directory reconciliation needed)
2. `dirWatcher` — watches `tasks/*` for directory creation/deletion (remove or repurpose — lane dirs no longer exist)
3. `yamlWatcher` — watches `board.yaml` (keep as-is)

**Changes**:
- `extension.ts` — Remove `dirWatcher` or simplify. The `debouncedReload` callback no longer needs `boardConfigStore.reconcileWithDirectories()` since lanes aren't tied to directories.
- `src/BoardConfigStore.ts` — Remove `reconcileWithDirectories()` if it becomes unnecessary. Lane list is now purely config-driven (from board.yaml), not filesystem-driven.

### Change 4: Retain archived folder

**Behaviour**: `tasks/archive/` continues to exist. When archiving a task, move the file from `tasks/` to `tasks/archive/`. When loading, skip `tasks/archive/` files from the board. Archived tasks can be loaded separately if needed.

**Files affected**: `src/TaskStore.ts` — archive logic already exists but will need adjustment for flat structure.

### Change 5: File naming — remove timestamp portion

**Current format**: `task_YYYYMMDD_HHmmssfff_XXXXXX_slug.md`
**New format**: `task_YYYYMMDD_XXXXXX_slug.md`

**Files affected**:
- `src/TaskStore.ts` — `generateId()` method: remove `_HHmmssfff` from timestamp
- `src/TaskStore.ts` — `extractSlugFromId()` — update regex to match new format
- `src/TaskStore.ts` — Todo file naming still mirrors with `todo_` prefix
- Tests — Update expected format patterns
- `assets/INSTRUCTION.md` — Update documented format
- Any regex patterns matching old format

### Change 6: AGENTS.md sentinel includes todo file reference

**Current worktree sentinel**:
```
**Active Task:** <title>
**Task File:** `<path>`
```

**New worktree sentinel** (add todo file reference):
```
**Active Task:** <title>
**Task File:** `<path>`
**Todo File:** `<todo path>`
```

**Files affected**:
- `src/agents/ChatParticipant.ts` — `buildWorktreeAgentsMdSection()` — add todo file line
- `src/WorktreeService.ts` — `writeWorktreeAgentsMd()` — pass todo path
- File name in sentinel will use new format (no timestamp)

### Change 7: Conversation delimiter format change

**Current**: `[user]`, `[agent]`, `[comment] text`
**New**: `### user`, `### agent`, `[comment: text]`

**Files affected**:
- `assets/INSTRUCTION.md` — Update documented format and examples
- `src/agents/ChatParticipant.ts` — Any code that generates or parses conversation markers
- `README.md` — Update documented format
- `TECHNICAL.md` — Update documented format
- Existing task files — Users will need to understand both formats may coexist during transition; no automated migration of existing conversation content is needed (both formats are human-readable)

### Change 8: Slash commands for markdown task files

**New feature**: Register a VS Code completion/command provider for `*.md` files under `.agentkanban/tasks/`.

Three commands triggered by `/` prefix:
1. **User Turn** — Inserts `\n### user\n\n` and places cursor
2. **Agent Turn** — Inserts `\n### agent\n\n` and places cursor
3. **User Comment** — Inserts `[comment: ]` with cursor inside brackets

**Implementation approach**: Register a `CompletionItemProvider` for markdown files matching the `.agentkanban/tasks/**/*.md` glob. When the user types `/`, offer completions for the three commands. Each completion inserts a snippet with a cursor placeholder (`$0`).

**Files affected**:
- `src/extension.ts` — Register the completion provider
- New logic (could be inline in extension.ts or a small module) for the completion items

---

## Questions / Decisions

1. **Archived task frontmatter lane**: When a task is archived, should the `lane` frontmatter retain the original lane (e.g., `done`) or be set to `archive`? I'd suggest retaining the original lane and using file location (`tasks/archive/`) as the archive indicator — this preserves history. [comment] Agreed

2. **Migration of todo files**: Todo files (`todo_*.md`) currently live alongside task files in lane directories. They should also migrate to flat `tasks/`. Confirm this is intended. [comment] Agreed yes

3. **Board.yaml lanes vs filesystem**: Currently `reconcileWithDirectories()` adds lanes discovered from filesystem directories. After this change, lanes are purely board.yaml driven. If a user adds a lane via the board UI, it's added to board.yaml. If a task's frontmatter references a lane not in board.yaml, should we auto-add it or surface a warning? [comment: Surface a warning]

4. **Existing task file rename**: Should existing task files with the old naming format (including timestamp) be renamed during migration to drop the timestamp? Or only new tasks use the new format? [comment]  - rename in migration - explain how this will work

5. **Slash command trigger**: The `/` character can trigger completions, but VS Code may need `triggerCharacters: ['/']` configured. Confirm this is the desired UX — typing `/` shows the three options. [comment] Yes agreed. We have an extension here that implements slash commands that you can reference  - the use case is simpler here but the trigger mechanism should be the same: `C:\Users\Gareth\src\as-notes\vs-code-extension`

[user]

This raises a point - if a lane is deleted, the user should be warned that all of the tasks will be moved to archived. If they confirm, move all of the files to archived rather than delete

[agent]

Confirmed I am working in task file: `task_20260315_085316225_hwsri7_revert_to_single_directory_archived_folder.md`

Thank you for the answers. I've reviewed the slash command reference implementation in `as-notes`. Here is the refined plan incorporating all decisions.

---

## Refined Plan — All Decisions Resolved

### Decisions confirmed:

1. **Archived tasks retain original lane** in frontmatter; `tasks/archive/` location is the archive indicator.
2. **Todo files migrate** alongside task files to flat `tasks/`.
3. **Frontmatter lane not in board.yaml** — surface a warning (log + UI indication).
4. **Existing task files renamed** during migration to drop the timestamp portion. Migration logic:
   - Parse existing filename `task_YYYYMMDD_HHmmssfff_XXXXXX_slug.md`
   - Extract date `YYYYMMDD`, uuid `XXXXXX`, slug
   - Rename to `task_YYYYMMDD_XXXXXX_slug.md`
   - Do the same for corresponding `todo_` files
   - Update any internal references (frontmatter `worktree.branch` etc.) — though branch names are external so those stay as-is
   - Handle collisions: if the shortened name already exists (unlikely), append a suffix
5. **`/` trigger character** — confirmed. Use `CompletionItemProvider` with `triggerCharacters: ['/']`.

### New requirement: Lane deletion archives tasks

When a lane is deleted from the board:
- Warn the user: "All N tasks in lane X will be moved to archive. Continue?"
- On confirm: move all tasks with that lane to `tasks/archive/`, retain original lane in frontmatter
- Then remove the lane from board.yaml

**Files affected**: `src/webview/board.ts` (confirmation dialog already exists for lane delete — enhance message), `src/TaskStore.ts` (bulk archive by lane), webview→extension message handling in `src/KanbanEditorPanel.ts`

---

### Implementation Summary (ordered by dependency)

**Phase 1 — Core data model changes (no UI breakage)**

| Step | Description | Files |
|------|-------------|-------|
| 1a | Add `lane` to `serialise()` output | TaskStore.ts |
| 1b | Read `lane` from frontmatter in `deserialise()` | TaskStore.ts |
| 1c | Update `generateId()` — drop timestamp portion | TaskStore.ts |
| 1d | Update `extractSlugFromId()` regex for new format | TaskStore.ts |
| 1e | Update tests for new ID format and lane serialisation | TaskStore.test.ts |

**Phase 2 — Flat directory structure**

| Step | Description | Files |
|------|-------------|-------|
| 2a | Rewrite `reload()` to read from flat `tasks/` + `tasks/archive/` | TaskStore.ts |
| 2b | Rewrite `save()` / `create()` to write to flat `tasks/` | TaskStore.ts |
| 2c | Rewrite `moveToLane()` — update frontmatter only (no file move) | TaskStore.ts |
| 2d | Rewrite `archive()` — move file to `tasks/archive/`, keep lane in frontmatter | TaskStore.ts |
| 2e | Update `getTaskUri()` / `getTodoUri()` for flat paths | TaskStore.ts |
| 2f | Update tests | TaskStore.test.ts |

**Phase 3 — Migration**

| Step | Description | Files |
|------|-------------|-------|
| 3a | Add `migrateFromDirectories()` — scan subdirs, add lane to frontmatter, move files flat, rename to new format | TaskStore.ts |
| 3b | Call migration from `reload()` or init path | TaskStore.ts |
| 3c | Add migration tests | TaskStore.test.ts |

**Phase 4 — File watching cleanup**

| Step | Description | Files |
|------|-------------|-------|
| 4a | Remove `dirWatcher` | extension.ts |
| 4b | Remove `reconcileWithDirectories()` from debounced reload | extension.ts |
| 4c | Remove `reconcileWithDirectories()` method | BoardConfigStore.ts |
| 4d | Simplify mdWatcher glob if needed | extension.ts |

**Phase 5 — Lane deletion archives tasks**

| Step | Description | Files |
|------|-------------|-------|
| 5a | Update lane-delete confirmation message in webview | board.ts |
| 5b | Handle `deleteLane` message — bulk archive tasks in that lane | KanbanEditorPanel.ts, TaskStore.ts |

**Phase 6 — AGENTS.md sentinel update**

| Step | Description | Files |
|------|-------------|-------|
| 6a | Add todo file reference to `buildWorktreeAgentsMdSection()` | ChatParticipant.ts |
| 6b | Update `writeWorktreeAgentsMd()` to pass todo path | WorktreeService.ts |
| 6c | Update sentinel path format (flat directory) | ChatParticipant.ts |
| 6d | Update tests | ChatParticipant.test.ts |

**Phase 7 — Conversation delimiter format**

| Step | Description | Files |
|------|-------------|-------|
| 7a | Update `assets/INSTRUCTION.md` — new `### user` / `### agent` / `[comment: text]` format | INSTRUCTION.md |
| 7b | Update any code that generates conversation markers | ChatParticipant.ts |
| 7c | Update README.md and TECHNICAL.md documentation | README.md, TECHNICAL.md |

**Phase 8 — Slash commands**

| Step | Description | Files |
|------|-------------|-------|
| 8a | Create `SlashCommandProvider.ts` — `CompletionItemProvider` with 3 commands (User Turn, Agent Turn, User Comment) | new: src/SlashCommandProvider.ts |
| 8b | Register provider in `extension.ts` with trigger char `/` and document selector scoped to `.agentkanban/tasks/**/*.md` | extension.ts |
| 8c | Suppress completions inside YAML frontmatter and code blocks | SlashCommandProvider.ts |
| 8d | Add tests | new: src/test/SlashCommandProvider.test.ts |

---

### Slash Command Implementation Detail

Based on the `as-notes` reference:

```typescript
// SlashCommandProvider.ts
class SlashCommandProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(doc, pos, token, ctx) {
        // Check trigger: line text at pos-1 should be '/'
        // Suppress in frontmatter / code blocks
        // Return 3 items:
        
        // 1. User Turn — insertText: new SnippetString('\n### user\n\n$0')
        // 2. Agent Turn — insertText: new SnippetString('\n### agent\n\n$0')
        // 3. User Comment — insertText: new SnippetString('[comment: $0]')
        
        // Each with range covering the '/' character
        // sortText for ordering, filterText for matching
    }
}

// Registration in extension.ts:
vscode.languages.registerCompletionItemProvider(
    { language: 'markdown', pattern: '**/agentkanban/tasks/**/*.md' },
    new SlashCommandProvider(),
    '/'
);
```

---

Plan is complete. Ready to proceed to **todo** phase on your go.

### user

todo implement

### agent

All 8 phases are complete. Summary of changes:

**Core (TaskStore.ts)**: Lane stored in YAML frontmatter. All tasks flat in `tasks/`, archived in `tasks/archive/`. New filename format `task_YYYYMMDD_XXXXXX_slug.md`. Migration from old directory layout and old naming format handled by `migrateFromDirectories()` + `migrateFileName()`.

**Extension (extension.ts)**: Removed `dirWatcher`. Simplified `debouncedReload` (no directory reconciliation). Registered `SlashCommandProvider`.

**BoardConfigStore**: Removed `ensureLaneDirectories()`, `reconcileWithDirectories()`, `RESERVED_LANES` import, `tasksUri` field.

**KanbanEditorPanel**: Lane deletion archives tasks (with warning). Lane rename updates frontmatter. Archive uses dedicated `archiveTask()`. `createTask` uses `### user` delimiter.

**ChatParticipant**: `buildWorktreeAgentsMdSection()` accepts optional `todoRelPath`, adds `**Todo File:**` to sentinel. All callers updated.

**WorktreeService**: `writeWorktreeAgentsMd()` derives and passes `todoRelPath`.

**INSTRUCTION.md**: Updated directory structure, file format, conversation delimiters, TODO format.

**SlashCommandProvider**: New `CompletionItemProvider` with `/user`, `/agent`, `/comment` commands. Suppressed in frontmatter/code blocks.

**Tests**: All 222 tests pass (5 test files). **Build**: Clean compilation.

**Docs**: README.md and TECHNICAL.md fully updated.


[user]

Update the task edit modal so the text on "Open in editor" is changed to "Open Task File", and add a button "Open TODO File" to the right of it

### agent

Done. Three changes made:

1. **Webview modal** ([board.ts](src/webview/board.ts)): Renamed "Open in editor" → "Open Task File". Added "Open TODO File" button (`btn-open-todo`, `btn-secondary` style) between it and "Send to Chat".

2. **Webview click handler** ([board.ts](src/webview/board.ts)): Added handler for `btn-open-todo` that posts `{ type: 'openTodo', taskId }` and closes the modal.

3. **Panel message handler** ([KanbanEditorPanel.ts](src/KanbanEditorPanel.ts)): Added `openTodo` case that opens the todo file via `getTodoUri()`. If the file doesn't exist yet, shows an info message: "No TODO file exists for this task yet. Use @kanban /todo to create one."

Build clean, 222 tests pass.

### user

Test feedback:

On archiving tasks, I am correctly asked if I want to remove a workspace if one exists, but the tasks are not removed from the board. I think we need to exclude anything in the archive folder from the board - so the board only shows files that are directly under the tasks directory

### agent

Confirmed I am working in task file: `task_20260315_085316225_hwsri7_revert_to_single_directory_archived_folder.md`

Root cause: `_sendState()` in KanbanEditorPanel was sending all tasks (including archived) to the webview. The `TaskStore` tracked archived IDs internally via `_archivedIds` but `isArchived()` was private.

Fix (2 changes):
1. **TaskStore.ts**: Made `isArchived(task)` public (was `private`)
2. **KanbanEditorPanel.ts**: Added `.filter(t => !this._taskStore.isArchived(t))` in `_sendState()` before sorting

Archived tasks are now excluded from the board. Build clean, 222 tests pass.

### user

I changed  the notification text to remove reference to the nonexistent /todo command.

I'm happy with the changes as they are now. Update README.md, TECHNICAL.md.

Review README.md for structure, conciseness, clarity around the problem this extension solves and how to use it, the two modes of operation (worktree / non worktree etc). The document should be implement 'phased discovery' structure - it is aimed at humans, but it should start highlevel and move down into detail.

### agent

Confirmed I am working in task file: `task_20260315_085316225_hwsri7_revert_to_single_directory_archived_folder.md`

**README.md** — Complete rewrite with phased discovery structure:
1. **The Problem** — context decay, ephemeral chat, no structured tracking
2. **How Agent Kanban Solves It** — persistent task files, auto context injection, structured workflow, kanban board, git worktrees
3. **Getting Started** — 6-step quickstart
4. **Two Workflows** — main workspace vs git worktree (side-by-side)
5. **Chat Commands** — table of all `@kanban` commands
6. **Task File Format** — frontmatter example + conversation format
7. **Storage** — directory structure diagram
8. **How Context Injection Works** — AGENTS.md mechanism, `/refresh`, worktree auto-inject
9. **Git Worktrees Details** — deeper technical details for worktree users
10. **Configuration** — unified settings table with defaults

Removed: duplicated configuration tables, deep technical "Why a layered approach?" section, redundant "Why two workflows?" section, worktree metadata from task file example. Consolidated worktree settings into single table.

**TECHNICAL.md** — Two targeted updates:
1. Added `isArchived(task)` to TaskStore method documentation (now public)
2. Added `openTodo` to webview message list; documented `_sendState()` archive filtering

Build clean, 222 tests pass.

### user