---
task: task_20260315_085316225_hwsri7_revert_to_single_directory_archived_folder
---

## TODO

### Phase 1 — Core data model changes
- [x] Add `lane` to `serialise()` frontmatter output (TaskStore.ts)
- [x] Read `lane` from frontmatter in `deserialise()` (TaskStore.ts)
- [x] Update `generateId()` — drop HHmmssfff timestamp portion (TaskStore.ts)
- [x] Update `extractSlugFromId()` regex for new format (TaskStore.ts)
- [x] Update tests for new ID format and lane serialisation (TaskStore.test.ts)

### Phase 2 — Flat directory structure
- [x] Rewrite `reload()` to read from flat `tasks/` + handle `tasks/archive/` (TaskStore.ts)
- [x] Rewrite `save()` / `saveWithBody()` to write to flat `tasks/` (TaskStore.ts)
- [x] Rewrite `moveTaskToLane()` — update frontmatter only, no file move (TaskStore.ts)
- [x] Rewrite archive — move file from `tasks/` to `tasks/archive/` (TaskStore.ts)
- [x] Update `getTaskUri()` / `getTodoUri()` for flat paths (TaskStore.ts)
- [x] Update `delete()` for flat paths (TaskStore.ts)
- [x] Remove `getDirectories()` method (no longer needed)
- [x] Remove `ensureLaneDirectories()` from BoardConfigStore.ts

### Phase 3 — Migration
- [x] Replace `migrateFlat()` with `migrateFromDirectories()` — scan subdirs, add lane to frontmatter, move flat, rename to new format (TaskStore.ts)
- [x] Call migration from init path (TaskStore.ts)

### Phase 4 — File watching cleanup
- [x] Remove `dirWatcher` from extension.ts
- [x] Remove `reconcileWithDirectories()` call from debouncedReload (extension.ts)
- [x] Remove `reconcileWithDirectories()` method from BoardConfigStore.ts
- [x] Simplify mdWatcher if needed (extension.ts)

### Phase 5 — Lane deletion archives tasks
- [x] Change `removeLane` handler to archive tasks instead of deleting (KanbanEditorPanel.ts)
- [x] Update confirmation message wording (KanbanEditorPanel.ts)

### Phase 6 — AGENTS.md sentinel update
- [x] Add todo file reference to `buildWorktreeAgentsMdSection()` (ChatParticipant.ts)
- [x] Update `writeWorktreeAgentsMd()` to accept and pass todo path (WorktreeService.ts)
- [x] Update sentinel task file paths for flat directory (ChatParticipant.ts)

### Phase 7 — Conversation delimiter format
- [x] Update `assets/INSTRUCTION.md` — new `### user` / `### agent` / `[comment: text]` format
- [x] Update conversation body defaults in TaskStore.ts
- [x] Update conversation body defaults in KanbanEditorPanel.ts

### Phase 8 — Slash commands
- [x] Create `SlashCommandProvider.ts` with CompletionItemProvider (3 commands)
- [x] Register provider in `extension.ts` with `/` trigger character

### Documentation and tests
- [x] Update TaskStore.test.ts for all changes
- [x] Update ChatParticipant.test.ts for sentinel changes
- [x] Update README.md
- [x] Update TECHNICAL.md
- [x] Build and verify no compile errors
