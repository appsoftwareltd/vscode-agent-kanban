---
title: Extension should add modify files in the workspace until initialised
lane: done
created: 2026-03-10T18:39:35.963Z
updated: 2026-03-15T14:07:31.107Z
description: The extension should not immediately add or modify meta data files (.agentkanban, AGENTS.md, task folder structure - anything) until the user has ran an initialise command
priority: critical
sortOrder: 1773042102151
slug: extension_should_add_modify_files_in_the_workspace
---

## Conversation

[user]

The extension should not immediately add or modify meta data files (.agentkanban, AGENTS.md, task folder structure - anything) until the user has ran an initialise command

[agent]

## Plan

### Problem

On `activate()` (`onStartupFinished`), the extension currently:

1. Calls `boardConfigStore.init()` → creates `.agentkanban/`, `.agentkanban/.gitignore`, writes `board.yaml`, creates lane directories
2. Calls `taskStore.init()` → creates `.agentkanban/tasks/` directory
3. Calls `chatParticipantHandler.syncInstructionFile()` → writes `.agentkanban/INSTRUCTION.md`
4. Calls `chatParticipantHandler.syncAgentsMdSection()` → creates/modifies `AGENTS.md`

This happens immediately in any workspace — even ones that have never been set up for Agent Kanban. The user never consented to having their workspace modified.

### Initialization Signal

Use the presence of `.agentkanban/board.yaml` as the "this workspace has been initialized" signal.
- If it exists → full startup as normal (backwards compatible)
- If it doesn't exist → minimal startup; no files written

### Changes Required

#### 1. `src/extension.ts`
- After creating stores/participant, check if `.agentkanban/board.yaml` exists before calling `init()` methods and sync calls
- Register a new `agentKanban.initialise` command that performs the full first-time setup, then wires up watchers and triggers a board refresh
- Pass `isInitialised` state to `BoardViewProvider` so it can show the correct UI

#### 2. `src/BoardConfigStore.ts`
- Rename current `init()` to `initialise()` (creates dirs/files, first-time setup)
- Add a new `init()` that only reads an existing config (no writes, no dir creation); if the file is absent, stays with defaults but doesn't write anything
- Keep `initialise()` for the explicit command path

#### 3. `src/TaskStore.ts`
- Same split: `initialise()` creates the tasks directory; `init()` only reads existing task files (no dir creation)

#### 4. `src/BoardViewProvider.ts`
- Accept an `isInitialised` flag
- When not initialised, render an "Initialize Agent Kanban" button in the webview instead of the board
- The button fires the `agentKanban.initialise` command

#### 5. `src/agents/ChatParticipant.ts`
- Guard `syncInstructionFile` and `syncAgentsMdSection` so they are only called from the `initialise` command path and on verb commands (not at plain startup)
- On `/new`, `/task`, and verb commands, if the workspace is not yet initialised, auto-initialise first (or prompt — TBD)

#### 6. `package.json`
- Register the new `agentKanban.initialise` command with a user-facing title

### Sequence

**Before initialise (first open):**
- Extension activates; detects `.agentkanban/board.yaml` is absent
- Registers all commands, registers webview provider
- Board webview shows an "Initialize Agent Kanban" invite panel — no files written
- Chat participant registers but writes no files

**After user clicks "Initialize" or runs `agentKanban.initialise`:**
1. `boardConfigStore.initialise()` — creates dirs, writes `board.yaml`, `.gitignore`
2. `taskStore.initialise()` — creates `tasks/` dir and lane subdirs
3. `syncInstructionFile()` — writes `INSTRUCTION.md`
4. `syncAgentsMdSection()` — writes AGENTS.md section
5. Watchers are registered
6. Board view refreshes showing empty board

**Subsequent activations (already initialised):**
- Exactly as today — `init()` reads config, `taskStore.init()` reads tasks, syncs run to keep files up to date

### Files to change

- `src/extension.ts`
- `src/BoardConfigStore.ts`
- `src/TaskStore.ts`
- `src/BoardViewProvider.ts`
- `src/agents/ChatParticipant.ts`
- `src/webview/board.ts` (add initialized/uninitialised UI state handling)
- `package.json`

### Tests to add/update

- `BoardConfigStore.test.ts` — `init()` on absent config should not write files; `initialise()` should create them
- `TaskStore.test.ts` — `init()` on empty workspace should not create directories
- New: `extension` activation integration test (if feasible) or unit tests for the initialise guard logic

[user]

todo implement

[agent]

## Implementation

All changes implemented with TDD (failing tests written first, then implementation):

### What was changed

**`src/BoardConfigStore.ts`**
- `init()` is now read-only: loads `board.yaml` if it exists, migrates old format if needed (update to existing data is acceptable), stays on defaults if absent — no `createDirectory`, no gitignore write, no defaults write
- New `initialise()` method: does everything the old `init()` did (creates `.agentkanban/` dir, ensures `.gitignore`, writes `board.yaml` defaults, creates lane directories)

**`src/TaskStore.ts`**
- `init()` is now read-only: just calls `migrateFlat()` + `reload()` with no `createDirectory`
- New `initialise()` method: creates the tasks directory then calls `init()`

**`src/extension.ts`**
- On activation: checks for the presence of `.agentkanban/board.yaml` as the initialisation signal
- If absent (fresh workspace): registers all commands and watchers but writes **nothing** to the filesystem; board view shows the uninitialised UI
- If present (already initialised): calls `boardConfigStore.init()`, `taskStore.init()`, syncs instruction/AGENTS.md files, starts housekeeping — exactly as before
- New `agentKanban.initialise` command: runs `doInitialise()` which calls `boardConfigStore.initialise()`, `taskStore.initialise()`, syncs files, sets `isInitialised = true`, refreshes board view
- Passes `isInitialised` to `BoardViewProvider` and `() => isInitialised` closure to `ChatParticipant`

**`src/BoardViewProvider.ts`**
- Constructor gains an `isInitialised: boolean` parameter
- New `setInitialised(flag: boolean)` method triggers a refresh
- `refresh()` renders uninitialised HTML when `!_isInitialised`
- New `_getUninitHtml()`: shows an "Initialise Agent Kanban" button that posts `{ type: 'initialise' }` to the extension, which executes `agentKanban.initialise`

**`src/agents/ChatParticipant.ts`**
- Constructor gains an optional `getIsInitialised: () => boolean` callback (defaults to `() => true` for backwards compatibility with tests)
- `handleNew`: auto-executes `agentKanban.initialise` if workspace is uninitialised before creating the task (using `@kanban /new` implies consent)
- `handleTask` and `handleVerb`: sync calls (`syncInstructionFile`, `syncAgentsMdSection`) are guarded — only called when `getIsInitialised()` returns true

**`package.json`**
- New `agentKanban.initialise` command registered with title "Agent Kanban: Initialise"

**`src/test/BoardConfigStore.test.ts`**
- Renamed `ensureGitignore (via init)` → `ensureGitignore (via initialise)` and updated calls to `store.initialise()`
- Added `read-only init` group: verifies `init()` writes nothing when `board.yaml` absent, loads correctly when present
- Added `initialise` group: verifies dirs are created and `board.yaml` written on fresh workspace; not overwritten on an existing one

**`src/test/TaskStore.test.ts`**
- Added `read-only init` group: verifies `init()` does not call `createDirectory`
- Added `initialise` group: verifies `initialise()` creates the tasks directory

### Test results
141 tests pass, build succeeds, no TypeScript errors.

[user]

I tested - the side bar correctly shows a button prompting the user to initialise, but I was still able to see the board, and add a task, which created the .agentkanban directory.

Instead the task board should show a message prompting the user to initialise (they can use the button in the side bar or we could duplicate the button in the editor tab)

[agent]

## Plan — Editor panel uninitialised state

### Problem
`KanbanEditorPanel` is separate from `BoardViewProvider`. It has no concept of `isInitialised`, so the editor tab always renders the full board and still allows task creation (which writes to disk) even on an uninitialised workspace.

### Approach
Pass `isInitialised` through to the editor panel and include it in every `stateUpdate` message sent to the webview. The webview (`board.ts`) checks the flag and renders an "Initialise" prompt instead of the board when false.

**No prompt/dialog needed** — the editor panel shows the same button as the sidebar. Both trigger `agentKanban.initialise`.

### Changes

#### `src/KanbanEditorPanel.ts`
- Add `private _isInitialised: boolean` field (default `true` for existing callers / deserialization)
- Add optional `isInitialised` param to `createOrShow()` and `revive()`
- Include `isInitialised: this._isInitialised` in the `stateUpdate` message payload in `_sendState()`
- Handle `{ type: 'initialise' }` message from webview → `vscode.commands.executeCommand('agentKanban.initialise')`
- Add `public setInitialised(flag: boolean)` method that updates the field and calls `_sendState()`

#### `src/webview/board.ts`
- Add `isInitialised?: boolean` to the `BoardState` interface
- In `renderBoard()`: if `state.isInitialised === false`, render a simple "Initialise Agent Kanban" panel instead of the board (with a button that posts `{ type: 'initialise' }`)

#### `src/extension.ts`
- Pass `isInitialised` to `KanbanEditorPanel.createOrShow()` in the `openBoard` and `newTask` command handlers
- In `doInitialise()`, call `KanbanEditorPanel.currentPanel?.setInitialised(true)` so any open editor panel refreshes

No new tests needed beyond verifying the build — the webview is not unit-tested.

[user]

todo implement

[agent]

## Implementation — Editor panel uninitialised state

**`src/KanbanEditorPanel.ts`**
- Added `private _isInitialised: boolean` field
- `createOrShow()` and `revive()` gain optional `isInitialised = true` param (backwards-compatible)
- Constructor accepts and stores `isInitialised`
- `_sendState()` now includes `isInitialised: this._isInitialised` in the `stateUpdate` payload
- Added `public setInitialised(flag: boolean)` that sets the field and calls `_sendState()`
- Added `case 'initialise'` message handler that executes `agentKanban.initialise`

**`src/webview/board.ts`**
- Added `isInitialised?: boolean` to `BoardState`
- `renderBoard()`: when `state.isInitialised === false`, renders a centred "Initialise Agent Kanban" panel with a button that posts `{ type: 'initialise' }` — returns early, board is never rendered

**`src/webview/board.css`**
- Added `.uninit-panel`, `.uninit-title`, `.uninit-desc`, `.uninit-btn` styles for the uninitialised state UI

**`src/extension.ts`**
- `agentKanban.openBoard` and `agentKanban.newTask` handlers now pass `isInitialised` to `KanbanEditorPanel.createOrShow()`
- `doInitialise()` now calls `KanbanEditorPanel.currentPanel?.setInitialised(true)` so an already-open editor panel refreshes immediately

141 tests pass, build succeeds.

[user]

I had deleted the .agentkanban folder in the test project - it appeared immediately on launch. .agentkanban should not be created until explicit initialisation

[agent]

## Root cause

The `LogService` constructor calls `fs.mkdirSync(logDir, { recursive: true })` when logging is enabled (`agentKanban.enableLogging: true` or `AGENT_KANBAN_DEBUG=1`). `logDir` is `.agentkanban/logs/`, so the parent `.agentkanban/` directory was created on every activation — before any `isInitialised` check.

## Fix — `src/extension.ts`

Reordered activation code so the `isInitialised` detection (the `fs.stat(board.yaml)` check) happens **before** the `LogService` is created. `loggingEnabled` is now guarded with `&& isInitialised`, meaning:
- Fresh workspace (no `board.yaml`): `loggingEnabled = false` → `NO_OP_LOGGER` used → no directory created
- Already-initialised workspace: behaves exactly as before

141 tests pass, build succeeds.

[user]

I've cleard the folder - it still reappears. If you need to add logging for me to echo back to you, do so

[user]

Correction I was wrong. The board shows, but there is no meta data files - is this as you would expect?

[agent]

## Status Assessment

The core fix is working — no metadata files are created on a fresh workspace. That's the correct behaviour.

The remaining issue is: **the board panel still shows the full board UI** when it was previously open and VS Code restores it on restart. This happens because the webview panel serialiser calls `KanbanEditorPanel.revive()` without passing `isInitialised`, so it defaults to `true`.

## Plan — Remaining fixes                          

### 1. Panel serialiser doesn't pass `isInitialised` (bug)

In [extension.ts](src/extension.ts#L76), the `deserializeWebviewPanel` callback calls:
```ts
KanbanEditorPanel.revive(panel, context.extensionUri, taskStore, boardConfigStore, logger);
```
This omits `isInitialised`, so `revive()` defaults to `isInitialised = true` — showing the full board even on a fresh workspace.

**Fix:** Pass `isInitialised` to `revive()`:
```ts
KanbanEditorPanel.revive(panel, context.extensionUri, taskStore, boardConfigStore, logger, isInitialised);
```

### 2. Verify board state on fresh vs initialised workspaces

After the serialiser fix:
- **Fresh workspace:** Sidebar shows "Initialise" button, editor panel (if restored) shows "Initialise" prompt — no files written
- **Initialised workspace:** Everything works as before — full board, task creation, syncs

### Files to change

- `src/extension.ts` — one-line fix to pass `isInitialised` to the serialiser

### Tests

- Build + existing 141 tests pass
- Manual test: open board, close VS Code, delete `.agentkanban`, reopen — board panel should show uninit prompt

[user]

todo implement

[agent]

## Implementation

**`src/extension.ts`** — one-line fix in the webview panel serialiser:

```ts
// Before:
KanbanEditorPanel.revive(panel, context.extensionUri, taskStore, boardConfigStore, logger);
// After:
KanbanEditorPanel.revive(panel, context.extensionUri, taskStore, boardConfigStore, logger, isInitialised);
```

This ensures that when VS Code restores a previously-open board panel on a fresh workspace, it receives `isInitialised = false` and shows the "Initialise" prompt instead of the full board.

### Test results
141 tests pass, build succeeds.

### Summary of all changes across this task

| File | Change |
|------|--------|
| `src/BoardConfigStore.ts` | Split `init()` into read-only `init()` + write-capable `initialise()` |
| `src/TaskStore.ts` | Split `init()` into read-only `init()` + write-capable `initialise()` |
| `src/extension.ts` | `isInitialised` guard, `doInitialise()` command, LogService ordering, serialiser fix |
| `src/BoardViewProvider.ts` | `isInitialised` param + uninitialised UI |
| `src/KanbanEditorPanel.ts` | `isInitialised` field, `setInitialised()`, uninit state in webview |
| `src/agents/ChatParticipant.ts` | `getIsInitialised` callback + sync guards |
| `src/webview/board.ts` | `isInitialised` in `BoardState`, uninit render path |
| `src/webview/board.css` | `.uninit-panel` styles |
| `package.json` | `agentKanban.initialise` command |
| `src/test/BoardConfigStore.test.ts` | Read-only init + initialise test groups |
| `src/test/TaskStore.test.ts` | Read-only init + initialise test groups |

[user]