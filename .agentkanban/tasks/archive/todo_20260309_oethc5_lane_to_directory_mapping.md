---
task: task_20260309_173510283_oethc5_lane_to_directory_mapping
---

## TODO

### Iteration 1 — Core Infrastructure

- [ ] **types.ts**: Change `LaneConfig` from `{ id, name }` to just a slug string. Update `BoardConfig.lanes` to `string[]`. Update `DEFAULT_LANES` to `['todo', 'doing', 'done']`. Add `RESERVED_LANE_NAMES` with `'archive'`. Update `isProtectedLane()` to accept a slug string. Add `slugifyLane()` and `displayLane()` helper functions. Remove `archived` from Task interface.
- [ ] **BoardConfigStore.ts**: Update to handle flat slug list format. Add migration from old `{ id, name }` objects to flat slugs on `init()`. Update `serialise()`/`deserialise()` for new format. Add `reconcileWithDirectories(dirs: string[])` method that syncs board.yaml lanes with actual task directories. Create lane directories on init.
- [ ] **TaskStore.ts**: Refactor `reload()` to scan subdirectories under `tasks/` and derive lane from directory name. Add `migrateFlat()` for one-time migration of flat files to lane directories. Update `save()` to write into `tasks/<lane-slug>/`. Update `getTaskUri()`/`getTodoUri()` to use directory from cache lookup. Add `moveTaskToLane(id, newLane)` using `vscode.workspace.fs.rename()`. Update `delete()` to find files via cache. Remove `lane` from `serialise()` output. Update `deserialise()` to not read lane (caller sets from directory). Add `getDirectories()` to list task subdirectories. Handle archive directory exclusion.

### Iteration 2 — Panel & Extension Integration

- [ ] **KanbanEditorPanel.ts**: Update `moveTask` to call `moveTaskToLane()` when lane changes. Update `addLane` to create directory + add slug to config. Update `removeLane` to delete directory after tasks. Update `renameLane` to rename directory + update config. Update `createTask`/`newTask` to use slug format. Block "archive" lane creation. Update `_sendState()` to filter out archive. Update lane references from `.id`/`.name` to slug.
- [ ] **extension.ts**: Debounce file watcher reload (200ms). Add directory watcher for `.agentkanban/tasks/*/` to detect new/renamed subdirectories and trigger lane reconciliation. Pass boardConfigStore to TaskStore or coordinate reconciliation in extension.
- [ ] **ChatParticipant.ts**: Update `DONE_LANE` to still work with slugs. Update `handleNew()` to use `config.lanes[0]` (slug) instead of `config.lanes[0]?.id`. Update `getTaskUri` calls.

### Iteration 3 — Webview & Display

- [ ] **board.ts**: Update all `lane.id` references to use slug string directly. Update all `lane.name` display to use `displayLane()` logic (uppercase, hyphens→spaces). Update modal lane dropdown to show uppercase display names with slug values. Update `isProtectedLane()` calls.

### Iteration 4 — Tests & Documentation

- [ ] **TaskStore.test.ts**: Update serialise/deserialise tests (no lane in frontmatter). Add tests for `migrateFlat()`. Add tests for directory-based reload. Add tests for `moveTaskToLane()`. Update round-trip tests.
- [ ] **BoardConfigStore.test.ts**: Update for flat slug list format. Add migration tests (old format → new). Add reconciliation tests.
- [ ] **ChatParticipant.test.ts**: Update lane references from `.id` to slug.
- [ ] **TECHNICAL.md, README.md, INSTRUCTION.md**: Update directory structure, persistence docs, lane format docs.

### Iteration 5 — Build & Verify

- [ ] Run `npm run build` — zero errors
- [ ] Run `npm test` — all tests pass
