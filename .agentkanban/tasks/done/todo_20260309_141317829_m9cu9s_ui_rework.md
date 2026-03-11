# Todo: UI Rework

## Iteration 1 (completed)

- [x] Extend data model (Task, BoardConfig) + stores + tests
- [x] Build pipeline (Tailwind CSS, dual esbuild entries)
- [x] KanbanEditorPanel (editor tab webview)
- [x] Simplified BoardViewProvider sidebar
- [x] Webview board.ts UI (board, cards, modal, drag-drop)
- [x] extension.ts wiring
- [x] Build & verify tests pass

## Iteration 2 — Feedback

### Phase A — Bug Fix: tasks disappear after changes
- [ ] Await `taskStore.reload()` / `boardConfigStore.init()` in file watcher callbacks (`extension.ts`)
- [ ] Subscribe `KanbanEditorPanel` to `taskStore.onDidChange` and `boardConfigStore.onDidChange`

### Phase B — Visual tweaks
- [ ] Show gray "No Priority" badge when priority is absent/none (`board.ts` + `board.css`)
- [ ] Restyle `.label-pill` to match priority badge shape with gray background (`board.css`)

### Phase C — Unified create/edit modal
- [ ] Add editable title input to modal (editable in create mode, read-only in edit)
- [ ] Add lane selector `<select>` to modal, populated from config.lanes
- [ ] Add description `<textarea>` to modal
- [ ] Introduce `modalMode` state ('create' | 'edit') in board.ts
- [ ] "New Task" toolbar button opens modal in create mode (no postMessage to extension)
- [ ] "Save/Create" button posts `createTask` message in create mode
- [ ] Handle `createTask` in `KanbanEditorPanel` — create task with metadata + description as first `[user]` entry
- [ ] `updateTaskMeta` handler also accepts `lane` field for lane changes in edit mode
- [ ] Simplify `agentKanban.newTask` command in extension.ts (open board + trigger create)

### Phase D — Archive
- [ ] Add `archived?: boolean` to `Task` interface in `types.ts`
- [ ] Serialise/deserialise `archived` in `TaskStore`
- [ ] Filter archived tasks from `_sendState()` in `KanbanEditorPanel`
- [ ] Add archive button on each card (board.ts)
- [ ] Add Tailwind-styled confirm dialog in webview (board.ts + board.css)
- [ ] Handle `archiveTask` message in `KanbanEditorPanel`
- [ ] Add tests for archived serialise/deserialise

### Phase E — Send to Chat
- [ ] Add "Send to Chat" button in modal footer (board.ts)
- [ ] Handle `sendToChat` message in `KanbanEditorPanel` — open chat with `@kanban /task` pre-filled

### Phase F — Verification
- [ ] All tests pass (`npm test`)
- [ ] Build completes (`npm run build`)
- [ ] Zero lint errors (`npm run lint`)
- [x] Verify `@kanban` chat participant is unaffected
- [x] Run `npm test` — all tests pass
- [x] Run `npm run build` — clean build
- [x] Press F5 and manually test: create task, move task, open task, add lane, delete lane, metadata edit
- [x] Update `README.md` to reflect new editor-panel layout

## Iteration 3 — Polish & UX Improvements

### Phase A — Visual fixes
- [x] Replace archive emoji with inline SVG icon (monotone greyscale)
- [x] Date format → YYYY-MM-DD (card footer + due chip)
- [x] Add clock SVG icon next to due date
- [x] More margin around assignee badge and labels
- [x] Squarer/flatter tag chips in modal (match priority badge style)

### Phase B — Custom autocomplete dropdowns
- [x] Replace assignee `<datalist>` with custom autocomplete dropdown
- [x] Replace label `<datalist>` with custom autocomplete dropdown
- [x] Style autocomplete with VS Code theme variables

### Phase C — Custom date picker
- [x] Replace `<input type="date">` with custom calendar popup
- [x] Month grid with prev/next navigation
- [x] Clear button, VS Code themed styling

### Phase D — Drag-to-reorder with decimal sortOrder
- [x] Add `sortOrder?: number` to Task interface
- [x] Serialise/deserialise sortOrder in TaskStore
- [x] Sort tasks by sortOrder in `_sendState()`
- [x] Assign sortOrder on task creation
- [x] Drag-to-reorder within lane (drop indicator, midpoint calc)
- [x] Cross-lane drag preserves positional ordering
- [x] Handle `moveTask` with sortOrder in KanbanEditorPanel

### Phase E — Open in editor improvements
- [x] Change "Open in editor" from btn-link to btn-secondary
- [x] Change ViewColumn.Beside to ViewColumn.Active
- [x] Change "Send to Chat" from btn-link to btn-secondary

### Phase F — Verification
- [x] Add sortOrder serialise/deserialise tests
- [x] All tests pass (`npm test`) — 97 passed
- [x] Build completes (`npm run build`)
- [x] Zero lint errors (`npm run lint`)

## Iteration 4 — Polish & Fixes

### Phase A — Lane uppercase
- [x] Serialise lane as uppercase in TaskStore
- [x] Deserialise lane normalised to lowercase in TaskStore
- [x] CSS uppercase on lane `<select>` dropdown

### Phase B — Button + datepicker fixes
- [x] "Open in Editor" → `btn-primary`
- [x] Fix datepicker click delegation (use `.closest()` for SVG children)
- [x] Enable keyboard date entry (remove `readonly`, add blur validation for YYYY-MM-DD)

### Phase C — Spacing + label validation
- [x] More vertical padding above `.card-labels` (`mt-1`)
- [x] Labels: strip non-alphanumeric/hyphen chars, lowercase normalisation

### Phase D — Verification
- [x] Add lane uppercase serialise/deserialise tests
- [x] All tests pass (`npm test`) — 99 passed
- [x] Build completes (`npm run build`)
- [x] Zero lint errors (`npm run lint`)

## Iteration 5 — Datepicker UX & Lane Sanitisation

### Phase A — Date validation UX
- [ ] Replace silent input clearing with red border + help text for invalid dates
- [ ] Stronger date validation (check real date, not just format)
- [ ] Show error state on save attempt with invalid date (prevent save)

### Phase B — Datepicker compact modal overlay
- [ ] Move datepicker popup from inline absolute to fixed-position centered overlay
- [ ] Add backdrop (click to dismiss)
- [ ] Compact sizing (max-width ~280px)

### Phase C — Enter key + keyboard UX
- [ ] Enter on date input: if calendar open, close it; accept valid date
- [ ] Enter on date input: if invalid, show error state

### Phase D — Lane name sanitisation
- [ ] `addLane`: sanitise name (lowercase, alphanumeric + hyphens), use as both id and name
- [ ] `addLane`: add reserved name check + duplicate check
- [ ] `renameLane`: sanitise name same way, update both id and name, migrate tasks to new id

### Phase E — Verification
- [ ] All tests pass (`npm test`)
- [ ] Build completes (`npm run build`)
- [ ] Zero lint errors (`npm run lint`)
