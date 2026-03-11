---
title: Lane to directory mapping
created: 2026-03-09T17:35:10.283Z
updated: 2026-03-10T09:13:04.977Z
sortOrder: 1773042264583.75
---

## Conversation

[user]

We need to look at mapping the tasks to directories that match the slug of the lane name

Can we watch the directories and move the tasks if the user moves the file?

The motivation is that the single directory approach is going to get way too big.

We would need a migration path for people already using the tool

We would need to watch directories under .agentkanban for users moving files

We need to handle the scenario where the file has been edited by the human or the agent in the buffer (or would vs handle that)?

The lane will be updated in the file on move

The folder name would be the lowercase slug of the lane name

What else do we need to think about here?

[agent]

I've read the README, INSTRUCTION.md, TECHNICAL.md, and all the relevant source files. Here's my analysis and plan.

## Current State

All tasks live in a flat `.agentkanban/tasks/` directory. The lane is stored in YAML frontmatter only. The file watcher already uses a glob `.agentkanban/tasks/**/*.md` which supports subdirectories. Lane IDs are already lowercase slugs (e.g. `todo`, `doing`, `code-review`).

## Proposed Directory Structure

```
.agentkanban/tasks/
  todo/
    task_xxx_my_task.md
    todo_xxx_my_task.md
  doing/
    task_xxx_other_task.md
    todo_xxx_other_task.md
  done/
    task_xxx_finished.md
    todo_xxx_finished.md
```

**Directory name = lane ID** (which is already the lowercase slug of the lane name). Using the lane ID rather than re-slugifying the name each time means directories are stable — a lane rename doesn't force a directory rename. This is a design choice worth discussing (see below).

[comment] No - directory names need to map to sligified folder names so as to avoid confusion as to which lane they are moving files

## Plan

### 1. TaskStore Changes

**`reload()`** — Currently scans the flat `tasks/` directory. Change to:
- Enumerate subdirectories under `tasks/`
- For each subdirectory, scan for `task_*.md` files
- Derive the lane from the **directory name** (source of truth), not the frontmatter
- Also scan root `tasks/` for flat files (backward compat / migration in progress)

**`save(task)`** — Currently writes to `tasks/<id>.md`. Change to:
- Write to `tasks/<lane-id>/<id>.md`
- Ensure the lane directory exists before writing

**`getTaskUri(id)`** — Currently takes just the ID. Needs the task's lane to construct the path. Options:
- Look up the task from the in-memory cache (works if already loaded)
- Add a `lane` parameter for cases where the task isn't cached yet (e.g. new task creation)
- Overload: `getTaskUri(id: string, lane?: string)` — uses cache if lane not provided

**`getTodoUri(taskId)`** — Same approach — todo files live in the same lane directory as their task.

**New: `moveTaskToLane(id, newLane)`** — Physically move the task file (and todo file) from old lane directory to new lane directory. Use `vscode.workspace.fs.rename()` which updates open editor buffers automatically.

**`delete(id)`** — Needs to know the lane directory to find the file. Use cache lookup.

**`createTask(title, lane)`** — No change to task creation itself, but `save()` will place it in the right directory.

### 2. Lane Change via UI (Drag-and-Drop)

Currently in KanbanEditorPanel `moveTask` handler:
```typescript
task.lane = message.lane;
await this._taskStore.save(task);
```

This needs to become:
```typescript
const oldLane = task.lane;
task.lane = message.lane;
if (oldLane !== message.lane) {
    await this._taskStore.moveTaskToLane(task.id, message.lane);
} else {
    await this._taskStore.save(task);
}
```



`moveTaskToLane` would update frontmatter + physically move the file.

[comment] would this save the task as well for anything else that might have been handled in the save previously?

### 3. Detecting User File Moves (Directory Watcher)

The existing file watcher fires delete + create when a file is moved. On `reload()`:
- Scan all lane subdirectories
- If a task's frontmatter lane doesn't match its directory, **update the frontmatter** to match the directory (directory is source of truth)
- This naturally handles manual moves — user moves file in Explorer, watcher fires, reload updates frontmatter

**Important**: Need to debounce reload to avoid partial states during a move (delete event fires before create event). Consider a short delay (e.g., 200ms) to coalesce events.

[comment] Will ths update the taskboard UI also so we don't end up with tasks in a folder that doesn't match the correct lane in the UI

### 4. Migration

On `init()`:
1. Check if any `task_*.md` files exist directly in `tasks/` (flat structure)
2. If so, for each file:
   - Read frontmatter to get the lane
   - Ensure `tasks/<lane-id>/` directory exists
   - Move the file (and corresponding todo file) to the lane directory
3. Log the migration

This is a one-time, non-destructive operation. Files only move from flat → nested. Nothing is deleted.

### 5. Lane Lifecycle

**Lane creation** (`addLane`): Create the directory `tasks/<new-lane-id>/`. Can be lazy (created on first task save).

[comment] Don't make it lazy, create the directory in case the user wants to manually move

**Lane deletion** (`removeLane`): Already deletes all tasks in the lane. After that, optionally remove the empty directory. Not critical — an empty dir is harmless.

[comment] Edge case - if the user moves a task to a directory that is not represented in lanes in the UI, the lane should be added to the UI and the task shown there

**Lane rename**: The lane ID stays the same (current behaviour), so the directory doesn't change. The display name changes but the directory is tied to the ID. This means no file moves on rename.

[comment] - No - directory names need to map to sligified folder names so as to avoid confusion as to which lane they are moving files

### 6. Open Buffer Handling

`vscode.workspace.fs.rename()` is the right API for programmatic moves — VS Code updates the URI in any open editor tabs. For user-initiated moves via Explorer, VS Code handles this natively.

One concern: if Copilot or the user is actively editing a task file and a lane change triggers a file move, the move should be safe because `workspace.fs.rename()` is atomic from the editor's perspective. The editor tab updates to point at the new URI.

### 7. File Watcher Updates

The existing glob `.agentkanban/tasks/**/*.md` already covers subdirectories — no change needed to the pattern. However, we may want to add debouncing to handle move events (which appear as delete + create).

### 8. Documentation Updates

- Update INSTRUCTION.md directory structure section
- Update TECHNICAL.md
- Update README.md storage section

## Design Decisions to Discuss

1. **Lane ID vs re-slugified name for directory**: Using lane ID (stable, doesn't change on rename) vs slugifying the lane name (matches user expectation but requires directory renames). I recommend lane ID — it's simpler and more robust. The ID is already the slug of the original name.

[comment] Use re-sluggified name for directory

2. **Frontmatter lane field**: Keep it as a convenience field (useful for readability when viewing the raw file), but the directory is the source of truth. On load, directory wins if there's a mismatch.

[comment] - actually no, lets get rid of it. It's redundant now.

3. **Debounce strategy**: Short delay (100-200ms) on file watcher events to coalesce move operations (delete + create). Without this, a move could briefly appear as a deletion.

4. **Orphaned files**: If a task file is found in a subdirectory that doesn't match any lane ID, we could either ignore it, log a warning, or treat the directory name as a new lane. I'd recommend logging a warning and loading the task with the directory name as its lane.

[comment] We won't have lane ids so we would create the lane in the taskboard UI

[comment] I have realised that we should also have an archive folder - that does not show up in the taskboard. We would then no longer need the archived boolean in front matter. Migration can leave these legacy fields in task files as they will be harmless 

5. **Empty lane directories**: Leave them after lane deletion? Or clean up? I'd lean toward leaving them (harmless, avoids accidental data loss if timing is off).

[comment] We need empty lane directories, and they will be represented by empty lanes in the task board UI

## Risks

- **Breaking change for existing users**: Mitigated by automatic migration on init
- **Concurrent edits during migration**: Low risk — migration only runs once at startup before the board is interactive
- **File system race conditions**: Debouncing handles the delete+create split of a move
- **Agent tools referencing old paths**: The ChatParticipant uses `getTaskUri()` — this will automatically use the new path once TaskStore is updated

## Estimated Scope

- **TaskStore.ts**: Major refactor (reload, save, delete, URI methods, new moveTaskToLane, migration)  
- **KanbanEditorPanel.ts**: Small change (moveTask handler calls moveTaskToLane)
- **extension.ts**: Small change (debounced watcher)
- **Tests**: Need significant updates + new migration/move tests
- **Documentation**: INSTRUCTION.md, TECHNICAL.md, README.md

[user]

[agent]

Thank you for the detailed feedback. I've processed all your comments. Here's the **revised plan** incorporating every correction:

## Revised Architecture: Directory-Driven Lanes

The fundamental shift: **directories define lanes**. No more lane IDs stored in frontmatter. The file's physical location IS its lane.

### Directory Structure

```
.agentkanban/tasks/
  todo/
    task_xxx_my_task.md
    todo_xxx_my_task.md
  doing/
    task_xxx_other_task.md
  done/
    task_xxx_finished.md
  code-review/          ← slugified from "Code Review"
    task_xxx_pr_task.md
  archive/              ← special: not shown on board
    task_xxx_old_task.md
```

**Directory name = slugified lane display name** (not a separate lane ID). If the lane is "Code Review", the directory is `code-review`. This keeps it intuitive for users manually moving files.

### Key Design Changes (vs original plan)

1. **No `lane` field in frontmatter** — Removed entirely. The task's lane is determined by its parent directory. Migration leaves any existing `lane:` field in files (harmless, just ignored).

2. **No lane IDs** — Lane identity is the slugified display name (= directory name). `board.yaml` maps directory names to display names and ordering.

3. **Lane rename = directory rename** — Renaming "Doing" to "In Progress" renames `doing/` to `in-progress/` and moves all files. `vscode.workspace.fs.rename()` handles open editors.

4. **Archive folder** — Special `archive/` directory. Tasks in it don't appear on the board. Replaces the `archived` boolean in frontmatter. Migration can leave legacy `archived:` fields (harmless).

5. **Empty directories = empty lanes** — If `tasks/code-review/` exists but is empty, it appears as an empty lane on the board. This makes directories the source of truth for lane existence.

6. **Unknown directories auto-create lanes** — If a user creates `tasks/blocked/` or moves a file there, a new "Blocked" lane appears on the board. The display name is inferred by un-slugifying the directory name (capitalise words, replace hyphens with spaces).

7. **Lane creation = directory creation** — Not lazy. When a user adds a lane, the directory is created immediately so they can manually drag files into it in the Explorer.

### board.yaml Role

`board.yaml` still stores:
- **Lane ordering** — the order lanes appear left-to-right on the board
- **Display names** — human-friendly names (e.g. directory `code-review` → display "Code Review")
- **Base prompt** — unchanged
- **Users/labels** — unchanged

On startup, reconcile:
- Directories that exist but aren't in `board.yaml` → auto-add lane entries (infer display name from directory name, append to end of ordering)
- Lane entries in `board.yaml` for directories that no longer exist → remove from config (or keep as stale, with no tasks — I'd say remove; the directory IS the lane)

### Revised TaskStore Changes

**`reload()`**:
- Enumerate subdirectories under `tasks/` (excluding `archive/`)
- For each subdirectory, scan for `task_*.md` files
- Set the task's `lane` from the **directory name**
- Also scan root `tasks/` for flat (legacy) files → trigger migration
- **Fire `onDidChange`** which updates the board UI

**`save(task)`**:
- Derive directory from slugified lane name
- Write to `tasks/<slugified-lane>/<id>.md`
- Ensure directory exists before writing
- Preserve markdown body (conversation) as before
- Handles everything the old save did (updated timestamp, frontmatter serialization etc.)

**`moveTaskToLane(id, newLane)`**:
- Save the task first (so any pending changes are written)
- Physically rename/move the task file + todo file to `tasks/<slugified-new-lane>/`
- Update frontmatter in the new location (though we're removing the `lane` field, so this is just updating `updated` timestamp)
- Use `vscode.workspace.fs.rename()`

**`getTaskUri(id)` / `getTodoUri(taskId)`**:
- Look up the task's lane from the in-memory cache
- Derive directory from slugified lane name
- Return `tasks/<slugified-lane>/<id>.md`

**`delete(id)`**:
- Use cache to find the lane → directory
- Delete task file + todo file from that directory

**Serialise/Deserialise**:
- `serialise()` — remove `lane` from frontmatter output
- `deserialise()` — no longer reads `lane` from frontmatter; caller sets it from directory name

### Revised Lane Lifecycle

**Lane creation** (`addLane`):
- Create `tasks/<slugified-name>/` directory immediately
- Add to `board.yaml` with display name and ordering

**Lane deletion** (`removeLane`):
- Delete all tasks in the lane
- Remove the directory
- Remove from `board.yaml`

**Lane rename** (`renameLane`):
- Rename `tasks/<old-slug>/` to `tasks/<new-slug>/`
- Update `board.yaml` entry (display name + key)
- All task files move automatically (they're inside the renamed directory)
- Open editors update via `vscode.workspace.fs.rename()`

### Board UI Synchronisation

When the file watcher fires (debounced 200ms):
1. `taskStore.reload()` scans directories → rebuilds in-memory task list
2. Fires `onDidChange` event
3. Board UI re-renders with updated task positions
4. If new directories are found → board config is updated with new lanes → `boardConfigStore.onDidChange` fires → board re-renders lanes

This ensures the board UI always reflects the file system state.

### Migration (init-time)

1. Scan `tasks/` for `task_*.md` files directly in the root (flat/legacy)
2. For each flat file:
   - Read frontmatter to get old `lane` value
   - Slugify the lane name to get directory name
   - Ensure `tasks/<directory>/` exists
   - Move task file + todo file to that directory
3. Check for tasks with `archived: true` → move to `archive/`
4. Log migration count
5. Leave legacy fields (`lane:`, `archived:`) in files — harmless

### Risks (Updated)

- **Lane rename = file system rename** — slightly more complex than before. Need to handle the case where the new directory name already exists (error? merge?). Should block rename if target slug already exists.
- **Archive directory** — If a user creates a lane called "Archive", it would conflict with the special archive directory. Need to reserve the name.
- **Un-slugify display name inference** — `code-review` → "Code Review" is straightforward. Edge cases like `ui-ux` → "Ui Ux" (should be "UI/UX"). Acceptable for auto-inferred names; user can fix via rename.

### Scope (Updated)

- **types.ts**: Remove `lane` from Task interface? Or keep as runtime-only field (set by TaskStore on load). I'd keep it on the interface for convenience but not persist it. Remove `archived` field.
- **TaskStore.ts**: Major refactor (directory-based reload, save, delete, move, migration, slugify lane names)
- **BoardConfigStore.ts**: Reconcile directories ↔ board.yaml on init
- **KanbanEditorPanel.ts**: `moveTask` → `moveTaskToLane`, `renameLane` → directory rename, `addLane` → create directory
- **extension.ts**: Debounced watcher, directory reconciliation
- **Tests**: Significant updates + new tests for migration, directory moves, reconciliation
- **Documentation**: INSTRUCTION.md, TECHNICAL.md, README.md

### Questions

1. Should we reserve `archive` as a special name and prevent users from creating a lane called "Archive"? [comment] Yes - if they try to create it display a message, a tailwind styled modal to prevent that
2. On lane rename, if the new slug collides with an existing directory — block with an error message?[comment] Yes a tailwind styled modal / alert to inform the user
3. The `lane` field on the `Task` interface — keep as a runtime convenience property (populated by TaskStore on load from directory name) or remove entirely and have callers derive it?

[comment]? Do you mean on the create / edit task modal? Yes I would keep it and would expect changing the value to change the lane on save

[user]

Check inline comments and advise of any issues

[agent]

Good, I've processed the latest comments. A few clarifications and issues to flag:

### Your Answers — Confirmed

1. **Reserve "archive"** — Yes. Block creation of a lane called "Archive" with a styled modal/alert.
2. **Block rename collisions** — Yes. Styled modal/alert if the new slug matches an existing directory.
3. **Keep `lane` on the Task interface** — Yes, as a runtime property populated from the directory name on load. On the create/edit modal, changing the lane dropdown moves the file to the new directory on save.

### Issues / Clarifications

**1. Lane field on Task interface — runtime vs frontmatter**

Your comment says keep it on the create/edit modal and changing it should move the file. That's fully compatible with:
- `lane` stays on the `Task` TypeScript interface (runtime-only, populated from directory on load)
- `lane` is **NOT** written to YAML frontmatter
- When saving a task and the lane has changed → `moveTaskToLane()` handles the physical file move

No conflict here. The `lane` property exists in memory and in the UI — just not in the file.

**2. Tailwind-styled modals**

The current codebase uses `vscode.window.showWarningMessage()` / `showInputBox()` for all dialogs — these are native VS Code dialogs, not webview modals. The board webview uses Tailwind for styling, but the dialogs are triggered from the extension host (TypeScript), not from the webview.

Options:
- **Option A**: Use native VS Code dialogs (consistent with existing UX, simpler to implement)
- **Option B**: Build Tailwind-styled modals in the webview (prettier, more control, but significantly more work — requires new webview message types and modal components)

Current dialogs for lane add/rename/remove all use `vscode.window.showInputBox` / `showWarningMessage`. Switching to webview modals is a separate piece of work. I'd recommend keeping native dialogs for this task and adding webview modals as a follow-up enhancement. What do you prefer?

[comment] OK keep native dialogs instead then

**3. Lane rename — task `lane` field updates**

When we rename a lane (which renames the directory), any tasks cached in memory still have the old lane name. After the directory rename, `reload()` will re-scan and update all task `lane` fields from the new directory name. This works, but there's a timing window:
- Board renames directory
- File watcher fires (debounced 200ms)
- `reload()` re-scans, updates in-memory lanes
- Board UI re-renders

During the 200ms, the in-memory state is stale. This is fine — the debounce already handles this. Just flagging it.

**4. `board.yaml` lane format — needs redesign**

Currently `board.yaml` stores lanes as:
```yaml
lanes:
  - id: todo
    name: Todo
  - id: doing
    name: Doing
```

Since we're removing lane IDs and using directory names as identity, the format should change to:
```yaml
lanes:
  - dir: todo
    name: Todo
  - dir: doing
    name: Doing
```

Or even simpler, since the directory IS the identity:
```yaml
lanes:
  - todo        # dir name = display name inference
  - doing
  - done
  - code-review: Code Review   # explicit display name override
```

The first format is more explicit and easier to parse. The second is more concise. I'd recommend the first (explicit `dir` + `name`) for clarity. Thoughts?

[comment] we will have a single value for each directory / lane. To be clear from now on:

- The user enters a lane name in whatever case they like, with spaces. e.g. 'My New Lane'.
- This will be sluggified to lower case 'my-new-lane' for storage in the yaml `lanes:` property
- The sluggified lower case name will be used for the directory name 
- If the user creates a directory with non hyphen or lower case alpha numeric characters, when the file watcher detects it, it will rename it in the sluggified lower case form
- On the UI, in the Task editor controls, on the lanes - the name will ALWAYS be displayed in UPPERCASE, with hyphens replaced with spaces (to reverse the sluggification and enforce consistent display)

Confirm you understand this

**5. No issues flagged — these all align cleanly:**
- Directory = source of truth ✓
- Migration path (flat → nested) ✓
- Empty dirs = empty lanes ✓
- Unknown dirs auto-create lanes ✓
- Archive replaces archived boolean ✓
- Debounced file watcher ✓

### Summary of open items before moving to TODO

1. Native VS Code dialogs vs Tailwind webview modals — which approach?
2. `board.yaml` lane format — explicit (`dir` + `name` objects) vs shorthand?

[user]

plan

[agent]

I understand. Let me confirm the naming model:

### Lane Naming — Single-Value Model

1. **User input**: Any case, with spaces — e.g. "My New Lane"
2. **Stored value** (board.yaml `lanes:` list + directory name): Slugified lowercase — `my-new-lane`
3. **Directory name**: Same slugified form — `tasks/my-new-lane/`
4. **UI display**: UPPERCASE, hyphens replaced with spaces — `MY NEW LANE`

**There is no separate display name.** The display is always derived mechanically from the slug: `my-new-lane` → `MY NEW LANE`. This means:
- `board.yaml` stores a flat list of slugs under `lanes:`
- No `name` field, no `id` field, no `dir` field — just the slug string
- The display function is: `slug.replace(/-/g, ' ').toUpperCase()`

**board.yaml** becomes:
```yaml
lanes:
  - todo
  - doing
  - done
  - my-new-lane
basePrompt: ''
```

**Directory auto-correction**: If a user creates a directory like `My_Lane` or `CODE REVIEW`, the file watcher detects it and renames it to the slugified form (`my-lane`, `code-review`). This means the user can create directories however they like and the system normalises them.

**Lane rename** is now: rename the slug → rename the directory → update board.yaml. Since the display is always derived from the slug, there's no display name to update separately.

**Migration**: Existing `board.yaml` with `id`/`name` objects → convert to flat slug list. The `id` field was already a slug, so we just extract `id` values.

### Updated board.yaml Format

```yaml
# Before (current)
lanes:
  - id: todo
    name: Todo
  - id: doing  
    name: Doing
  - id: done
    name: Done

# After (new)
lanes:
  - todo
  - doing
  - done
```

`LaneConfig` interface changes from `{ id: string; name: string }` to just a string (the slug). Or we keep a small interface for internal use where `name` is always computed.

### Protected Lanes Update

Currently `PROTECTED_LANE_NAMES = ['todo', 'done']` and `isProtectedLane()` checks by name. This works perfectly with the new model since the slug IS the identity: `todo` and `done` are the protected slugs. `archive` is added as a reserved name (can't be created as a lane).

### All Open Items — Resolved

1. ~~Native dialogs vs webview modals~~ → Native dialogs ✓
2. ~~board.yaml format~~ → Flat slug list ✓
3. ~~Lane display name~~ → Always derived: `UPPERCASE(slug.replace(hyphens, spaces))` ✓

The plan is now complete. Ready for `todo` when you are.

[user]

Test issues:

Moving files between directories manually works well - the kanban board is updated

Creating a directory did not create a lane until I moved a task to it

Moving tasks between lanes does not work well. The tasks get duplicated between lanes. They appear in the new lane but are not removed from the old. In the UI, the task "bounces" back to it's original column

Archive works well

Renaming of directories works well - but only when a file is moved into it

[agent]

Good testing feedback. I've traced all three issues to their root causes.

## Bug Analysis

### Bug 1: Drag-and-drop lane move — task duplicates / bounces back

**Symptom**: Task appears in the new lane briefly, then bounces back to the old lane. Both lanes may show the task.

**Root cause**: The `moveTask` handler in KanbanEditorPanel updates `task.lane` in memory *before* calling `moveTaskToLane()`. But `moveTaskToLane()` reads the task from the cache to find the *old* lane's URI. By the time it reads, the cache already has `newLane`, so it constructs the old URI as `tasks/<newLane>/<id>.md` — which doesn't exist. The rename fails, falling through to the catch block which writes a *new* file in the new lane. The old file in the original lane is never deleted.

Then the debounced file watcher fires `reload()`, which scans both directories. It finds the task file in *both* the old lane (never deleted) and the new lane (just written). On the board, the task appears in both. On the next render cycle, since `reload()` iterates directories in order, whichever directory is scanned last wins in the `tasks` Map — making the task appear to jump.

**The fix**: In `moveTask` handler, do NOT set `task.lane = newLane` before calling `moveTaskToLane()`. Let `moveTaskToLane()` handle the in-memory update internally (which it already does — line `task.lane = newLane` inside `moveTaskToLane()`).

Specifically in [KanbanEditorPanel.ts](src/KanbanEditorPanel.ts) line 216:
```typescript
// CURRENT (bug):
task.lane = newLane;                                    // ← corrupts cache
await this._taskStore.moveTaskToLane(message.taskId, newLane);

// FIX:
await this._taskStore.moveTaskToLane(message.taskId, newLane);  // handles lane update internally
```

The same issue exists in `updateTaskMeta` — the meta fields (priority, assignee, etc.) are set on the task object, but if `moveTaskToLane()` fails, those changes are lost because `moveTaskToLane()` re-reads from cache. We need to save the meta fields first, then move.

### Bug 2: Creating a directory doesn't create a lane until a file is moved into it

**Symptom**: User creates an empty directory under `tasks/`, e.g. `tasks/blocked/`. No new lane appears on the board until a task file is moved into it.

**Root cause**: The debounced file watcher only fires on `.md` file events (`**/*.md` glob). Creating an empty directory doesn't trigger any `.md` file event, so the reconciliation code never runs. The watcher can't detect empty directory creation.

**The fix**: Add a separate directory watcher. VS Code's `FileSystemWatcher` can watch for directory creation too, but the glob pattern `.agentkanban/tasks/**/*.md` won't match directories. We need a second watcher with the glob `.agentkanban/tasks/*` (directories directly under tasks/) or we can use `vscode.workspace.createFileSystemWatcher` with a pattern that matches directories.

However, VS Code's `FileSystemWatcher` with `createFileSystemWatcher` actually fires on directories when using a glob like `.agentkanban/tasks/*/`. On Windows, the simplest approach is to add a separate watcher for the `tasks/` directory itself that triggers reconciliation on directory changes.

Alternative simpler approach: add a periodic reconciliation (e.g. every 2-3 seconds) that checks for new directories. This is less elegant but more reliable across platforms.

Best approach: add a watcher with glob `.agentkanban/tasks/*` in addition to the existing `.md` watcher. The `*` will match directory creation/deletion events. Both trigger the same debounced reload + reconciliation.

### Bug 3: Renaming directories only works when a file is moved into it

**Symptom**: User renames a directory (e.g. `doing/` → `in-progress/`). The board doesn't update until a task file is created or moved inside the renamed directory.

**Root cause**: Same as Bug 2 — the `.md` file watcher doesn't fire for directory rename events. The renaming is detected by `reconcileWithDirectories()`, but that code only runs when the debounced reload is triggered by `.md` file events.

**The fix**: Same as Bug 2 — a directory-level watcher will detect renames and trigger reconciliation.

## Summary of Fixes

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Task duplication on move | `task.lane` set before `moveTaskToLane` | Remove premature `task.lane = newLane` in moveTask handler |
| Empty dir not creating lane | `.md` watcher doesn't fire for dirs | Add directory-level watcher |
| Dir rename not detected | `.md` watcher doesn't fire for dirs | Add directory-level watcher |

## Additional concern: `updateTaskMeta` with lane change

When the user changes the lane AND other metadata in the edit modal, the handler sets meta fields on the task object then calls `moveTaskToLane()`. But `moveTaskToLane()` internally saves the task from cache — so the meta fields should persist since they were set on the same object reference. However, the serialised file won't include the updated fields because `moveTaskToLane()` uses `vscode.workspace.fs.rename()` (which preserves the old frontmatter) rather than writing new frontmatter. We need to save the updated frontmatter after moving, or save before moving and then rename.

The safest approach: save the task (with updated meta) in the old location first, then rename the file to the new location. `moveTaskToLane()` already tries to rename first — but the file content is stale (old frontmatter). We should write updated frontmatter before renaming, or write it at the new location after renaming.

Shall I proceed to `todo` to generate the fix checklist?

[user]

There are some bugs still - the Side bar shows an error

[user]

As a test I deleted all the lane folders and all the lanes in the yaml

The default lanes came back - that is good - is that an intentional feature or is that by accident?

We might want a couple of house keeping checks to run every 10 minutes or so or when when the extension activates. That would be to do a scan of the front matter of all of the non archived tasks, and if there are assignees or labels that do not exist in board.yaml - add them.

Anything else we should add?

What is the "basePrompt" in  board.yaml - what does it do? 

[user]

We will rely on standard AGENTS.md for system level agent prompts. I don't think we need it