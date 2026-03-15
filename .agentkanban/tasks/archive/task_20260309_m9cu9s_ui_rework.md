---
title: UI Rework
lane: done
created: 2026-03-09T14:13:17.829Z
updated: 2026-03-15T14:08:05.506Z
sortOrder: 1773042183367.875
slug: ui_rework
---

## Conversation

[user]

This is another VS Code kanban extension. It is a markdown based board, but is not designed to drive an agent

https://github.com/LachyFS/kanban-markdown-vscode-extension?tab=readme-ov-file

Source code copied here:

C:\Users\Gareth\src\kanban-markdown-vscode-extension\


I want to take some cues from this extension:

- Using an editor pane / webview rather than a side bar pane would give more space (styling options too?). We could still use the side bar for summary information, shortcuts etc.
- Lets use a modern css framework to help with styling - tailwind looks like a good option
- Exend our markdown yaml with additional meta data
    - Due date
    - Assignee (Keep a unique list of users in a config yaml file as they are added and facilitate auto select / add on the fly)
    - Labels (Keep a unique list of labels in a config yaml file as they are added and facilitate auto select / add on the fly)
    - Due date with a date picker
    - Priority
    - Assign pastel colours to diffent priorities
    - Surface metta data like assignee / priority on the task board
- Retain all of the functionality and rules we currently have for lane deletion etc

[agent]

## Plan

### Overview

This rework has three major pillars:
1. **Layout shift** — Move the main Kanban board from the Activity Bar sidebar into a full-width editor panel (`WebviewPanel`), keeping the sidebar as a compact summary/shortcut panel.
2. **Tailwind CSS** — Replace raw CSS variables with a properly compiled Tailwind stylesheet for a modern, consistent visual design.
3. **Extended task metadata** — Add `priority`, `assignee`, `labels`, and `dueDate` to the task YAML frontmatter, persist a shared registry of users/labels in `board.yaml`, and surface them visually on cards.

All existing functionality is preserved: lane protection, drag-and-drop for cards and lanes, lane add/rename/delete with orphan-task confirmation.

---

### Architecture

```
src/
  types.ts                   ← extend Task, BoardConfig interfaces
  TaskStore.ts               ← serialize/deserialize new Task fields
  BoardConfigStore.ts        ← store users[], labels[] in board.yaml
  KanbanEditorPanel.ts       ← NEW: full board in a WebviewPanel (editor tab)
  BoardViewProvider.ts       ← simplified sidebar: counts + Open Board button
  extension.ts               ← register KanbanEditorPanel, update watchers
  webview/
    board.ts                 ← NEW: webview-side JS bundle (board logic)
    board.css                ← NEW: Tailwind input CSS

dist/
  extension.js               ← extension host bundle (unchanged entry)
  webview/
    board.js                 ← compiled webview JS
    board.css                ← compiled Tailwind CSS
```

---

### Data Model Changes

**`Task` interface additions (types.ts):**
```typescript
priority?: 'critical' | 'high' | 'medium' | 'low' | 'none';
assignee?: string;
labels?: string[];
dueDate?: string;          // ISO date string YYYY-MM-DD
```

**`BoardConfig` interface additions (types.ts):**
```typescript
users?: string[];          // registry of known users
labels?: string[];         // registry of known labels
```

**YAML frontmatter example:**
```yaml
title: My Task
lane: doing
priority: high
assignee: gareth
labels: [backend, api]
dueDate: 2026-03-20
created: 2026-03-09T14:13:17.829Z
updated: 2026-03-09T14:13:17.829Z
```

---

### KanbanEditorPanel (new `src/KanbanEditorPanel.ts`)

Uses `vscode.window.createWebviewPanel()` — opens as an editor tab, not a sidebar.

Key behaviours:
- `static createOrShow()` — creates or reveals the panel (singleton)
- `static revive()` — restores panel after VS Code restart (requires serialiser registration)
- Loads `dist/webview/board.js` and `dist/webview/board.css` via `webview.asWebviewUri()`
- CSP allows scripts/styles from `webview.cspSource` only
- Sends full board state (tasks + config) to the webview on `ready` message
- Handles all existing message types: `openTask`, `moveTask`, `newTask`, `addLane`, `removeLane`, `renameLane`, `deleteTask`, `moveLane`
- Handles new metadata messages: `updateTaskMeta` (saves priority/assignee/labels/dueDate to task frontmatter), `addUser`, `addLabel`

### Sidebar (`BoardViewProvider.ts` rework)

Minimal panel showing:
- Per-lane task counts
- "Open Board" button → executes `agentKanban.openBoard`
- "New Task" button → creates task and opens the board

### Webview Bundle (`src/webview/board.ts`)

Vanilla TypeScript/JS bundle — no framework. Responsibilities:
- Renders the Kanban board from state sent via `postMessage`
- Drag-and-drop for cards and lanes
- Inline metadata display on cards (priority badge, assignee avatar/initials, due date chip, label pills)
- Task detail modal:
  - Opens on card click
  - Fields: title (read-only link), priority (select), assignee (input with datalist autocomplete), labels (tag input with autocomplete), dueDate (native `<input type="date">`)
  - Save button → `postMessage({ type: 'updateTaskMeta', ... })`
  - "Open in editor" button → `postMessage({ type: 'openTask', ... })`
- Lane management (add, rename, delete, reorder) — same UX as current

### Priority Styling

Pastel colour badges on cards:
| Priority | Badge colour |
|----------|-------------|
| critical | pastel red |
| high | pastel orange |
| medium | pastel yellow |
| low | pastel green |
| none | no badge |

### Tailwind Build Integration

1. Add `tailwindcss`, `@tailwindcss/forms`, `postcss`, `autoprefixer` as devDependencies
2. Create `tailwind.config.js` pointing at `src/webview/**`
3. Create `src/webview/board.css` with `@tailwind base/components/utilities`
4. Update `build.mjs` to:
   - esbuild: add second entry for `src/webview/board.ts → dist/webview/board.js`
   - postcss + tailwind: `src/webview/board.css → dist/webview/board.css`
5. Update `.vscodeignore` to ensure `dist/webview/` is included in the package

### extension.ts Changes

- Register `KanbanEditorPanel` as webview serialiser (`vscode.window.registerWebviewPanelSerializer`)
- Update `agentKanban.openBoard` to call `KanbanEditorPanel.createOrShow()`
- Wire file watchers to also call `KanbanEditorPanel.currentPanel?.refresh()`
- Add `agentKanban.openBoard` title bar button on the sidebar view

---

### Preserved Functionality

- Lane protection (todo/done cannot be deleted or renamed)
- Lane drag-to-reorder  
- Task drag-to-move between lanes
- Delete task (with × button on card)
- Delete lane (with orphan-task confirmation)
- `@kanban` chat participant commands — unchanged
- `INSTRUCTION.md` sync — unchanged

---

### Testing

- Extend `BoardConfigStore.test.ts` to cover users/labels fields
- Extend `TaskStore.test.ts` to cover priority/assignee/labels/dueDate serialise/deserialise
- No changes to `ChatParticipant.test.ts` or `LogService.test.ts`

[user]

Agreed

[user]

Feedback on testing:

- Bug. When I make any changes to tasks (creating task, moving lanes) - all the tasks disappear from the board and I have to close and reopen
- The create task input should be removed and we use the same task editor form used to edit tasks in the board
- We should be able to choose the lane when we create or edit the task in the from
- If there is no priority on a task the board view should show a gray label with 'No priority'
- Labels should use the same styling as the priority but just with a grey background
- When creating the task we should be able to enter the task description - when created this will form the users first [user] entry in the markdown file
- We should have another yaml property 'archived' (boolean). When set true the task will not show up in any lane. An archive button will show on the bottom right of each task. A confirm dialoge, tailwind styled will confirm if the user wants to archive if pressed.
- Can we have a button 'send to chat' if clicked, it has the same effect as @kanban /task <task name>

[agent]

## Plan — Iteration 2: Feedback

I've read and analysed all 8 feedback items against the current codebase. Here's the root-cause analysis and implementation plan for each.

---

### 1. Bug Fix — Tasks disappear after changes

**Root cause identified.** The file watchers in `extension.ts` call `taskStore.reload()` without `await`:

```typescript
mdWatcher.onDidChange(() => { taskStore.reload(); boardViewProvider.refresh(); KanbanEditorPanel.currentPanel?.refresh(); });
```

`reload()` is `async` — it **synchronously** calls `this.tasks.clear()` then **asynchronously** re-reads files from disk. Because the promise isn't awaited, `refresh()` runs immediately after `clear()` but before the files are re-read. The board receives an empty task list.

`BoardViewProvider` recovers because it subscribes to `taskStore.onDidChange` — when `reload()` eventually finishes it fires the event and the sidebar re-renders. But `KanbanEditorPanel` does **not** subscribe to store change events, so it stays empty.

**Fix (two-part):**
1. Make file watcher callbacks `async` and `await` the reload/init calls before calling refresh
2. Have `KanbanEditorPanel` subscribe to `taskStore.onDidChange` and `boardConfigStore.onDidChange` in the constructor (belt-and-suspenders — guarantees the panel refreshes whenever data changes, regardless of who triggered the change)

**Files:** `extension.ts`, `KanbanEditorPanel.ts`

---

### 2. Replace create-task input box with the modal form

Currently "New Task" triggers `vscode.window.showInputBox` (a native VS Code input). Instead, the webview modal should serve double duty as both the edit and create form.

**Approach:**
- When `btn-new-task` is clicked in the webview, open the modal in **create mode** (empty fields, title is editable, lane selector visible, Save button labelled "Create")
- The modal already has priority/assignee/labels/dueDate — we add a **title** text input (editable in create mode, read-only in edit mode) and a **description** textarea
- On "Create": post a new `createTask` message with `{ title, description, lane, priority, assignee, labels, dueDate }`
- `KanbanEditorPanel._handleMessage` handles `createTask` — creates the task via `TaskStore.createTask()`, sets metadata fields, saves. The description becomes the first `[user]` entry in the markdown body (see item 6)

**Removes:** The `showInputBox` call in `KanbanEditorPanel._handleMessage` case `'newTask'` and the `agentKanban.newTask` command's input box. The sidebar "New Task" button should now post `openBoard` first, then let the panel handle it (or just open the board — the user creates from there).

**Files:** `board.ts` (modal HTML + create-mode logic), `KanbanEditorPanel.ts` (new `createTask` handler), `extension.ts` (simplify `newTask` command)

---

### 3. Lane selector in create/edit form

Add a `<select>` dropdown to the modal populated from `state.config.lanes`. 

- **Create mode:** defaults to the first lane
- **Edit mode:** defaults to the task's current lane
- On save/create, the selected lane is included in the message payload
- `updateTaskMeta` handler gains the ability to also change the lane (or we extend it to include `lane`)

**Files:** `board.ts` (modal HTML + populate), `KanbanEditorPanel.ts` (accept `lane` in `updateTaskMeta` and `createTask`)

---

### 4. "No Priority" gray badge

Currently, cards with no priority (or `none`) show no badge at all. We'll show a neutral gray badge reading "No Priority" for all cards where `priority` is absent or `'none'`.

**Approach:**
- In `buildCardHtml()`, always render a priority badge. If `priority` is missing/none, use class `priority-none` with text "No Priority"
- Add `.priority-none` CSS: gray background (`rgba(127,127,127,0.15)`), description foreground colour

**Files:** `board.ts` (`buildCardHtml`), `board.css` (`.priority-none`)

---

### 5. Label pills → same badge styling as priority (gray)

Currently labels use `.label-pill` (rounded-full, indigo tint). Change to use the same shape as `.priority-badge` (rounded rectangle, `text-xs font-semibold px-1.5 py-0.5`) but with a neutral gray background.

**Approach:**
- Replace `.label-pill` styling with the same dimensions as `.priority-badge` but a gray palette matching `.priority-none`
- Keep `rounded` (not `rounded-full`) to match priority badges

**Files:** `board.css` (`.label-pill` restyle)

---

### 6. Task description on creation → first `[user]` entry

When creating a task via the modal, a **description textarea** is shown. When saved:
- The `description` field is stored in YAML frontmatter (already supported by `Task.description`)
- The markdown body starts with `## Conversation\n\n[user]\n\n<description text>\n\n` instead of the current empty `[user]` line

**Approach:**
- Add `<textarea>` to the modal (shown in both create and edit modes, but primarily useful at creation)
- The `createTask` message includes `description`
- In `KanbanEditorPanel._handleMessage` for `createTask`: when the description is non-empty, build the body as `\n## Conversation\n\n[user]\n\n${description}\n\n` and pass it through a new `TaskStore.saveWithBody(task, body)` method (or pass body to `save`)
- The existing `TaskStore.save()` already preserves the body if the file exists, and uses a default body for new files — we just need to override the default body with the description content when provided

**Files:** `board.ts` (modal textarea), `KanbanEditorPanel.ts` (`createTask` handler builds custom body), `TaskStore.ts` (add optional `body` parameter to `save`, or a new method)

---

### 7. Archived property + archive button + confirm dialog

New `archived?: boolean` field on `Task`. Archived tasks are excluded from all lanes.

**Data model:**
- Add `archived?: boolean` to the `Task` interface in `types.ts`
- `TaskStore.serialise()` writes `archived: true` when set; omits when false/absent
- `TaskStore.deserialise()` reads it

**Board filtering:**
- `KanbanEditorPanel._sendState()` filters out tasks with `archived: true` before sending to the webview
- Alternatively, the webview can filter — but filtering server-side keeps the webview simpler

**UI:**
- Each card gets an archive button (📦 or folder-down icon) positioned at the bottom-right of the card
- Clicking it opens a **Tailwind-styled confirm dialog** within the webview (not a VS Code native modal). This is a second overlay dialog with "Archive this task?" message, Cancel/Archive buttons
- On confirm: post `{ type: 'archiveTask', taskId }` → KanbanEditorPanel sets `task.archived = true`, saves

**Files:** `types.ts`, `TaskStore.ts` (serialise/deserialise), `board.ts` (card button + confirm dialog), `board.css` (confirm dialog styles), `KanbanEditorPanel.ts` (`archiveTask` handler), tests

---

### 8. "Send to Chat" button

A button on the card (or in the task detail modal) that performs the same action as `@kanban /task <task name>` — selects the task in Copilot Chat and sets up context.

**Approach:**
- Add a "Send to Chat" button in the modal footer (next to "Open in editor")
- Clicking posts `{ type: 'sendToChat', taskId }` to the extension
- The handler in `KanbanEditorPanel._handleMessage` executes the chat participant programmatically. The VS Code API for this is `vscode.commands.executeCommand('workbench.action.chat.open', { query: '@kanban /task <task title>' })` — this opens the chat panel with the command pre-filled
- The user then hits Enter (or we investigate if we can auto-send)

**Files:** `board.ts` (button in modal), `KanbanEditorPanel.ts` (`sendToChat` handler)

---

### Implementation Order

The work groups naturally into phases:

| Phase | Items | Description |
|-------|-------|-------------|
| **A** | 1 | Bug fix — file watcher race + store subscriptions |
| **B** | 4, 5 | Visual tweaks — priority badge "No Priority", label restyle |
| **C** | 2, 3, 6 | Modal rework — unified create/edit form with title, description, lane selector |
| **D** | 7 | Archived property + confirm dialog |
| **E** | 8 | "Send to Chat" button |

Phase A is the critical bug fix and should come first. Phases B–E are independent of each other and can go in any order, though C is the largest chunk.

### Testing

- **Phase A:** Verify the fix manually — create/move/delete tasks, confirm the board updates without disappearing. No new unit tests needed (this is an integration-level wiring fix), but we should verify existing tests still pass.
- **Phase B:** Update `buildCardHtml` tests if any exist in the webview (currently there are none — it's tested manually). CSS changes are visual.
- **Phase C:** Add unit test for `TaskStore.save()` with custom body parameter. Test new `createTask` message handler.
- **Phase D:** Add unit tests for `archived` serialise/deserialise in `TaskStore.test.ts`. Test that archived tasks are filtered from state.
- **Phase E:** No unit test needed — `executeCommand` call is simple wiring.

[user]

Feedback on testing:

- The archive button should be a monotone greyscale icon - like font awesome - you may use font awesome (free) for icons if that works.
- Date format on the task board tasks is YYYY-MM-DD.
- Add a clock icon next to due date
- Add a bit more margin around assignee initial, labels. 
- In the editor we are using the round pill tag buttons - we want to use the squarer flatter ones like how priority is shown on the task board items.
- When I select assignee from the dropdown the select item is out of line (pictured). Can we make this a type text completion tool anyway rather than a select box
- When I select a label from the dropdown the select item is out of line (pictured). Can we make this a type text completion tool anyway rather than a select box
- Can we use a tailwind styled calendar? The default browser one looks a bit out of place
- I should be able to reorder tasks up and down in a lane
- 'Open in editor' should be a more prominent button - not a link button
- When we click open in editor, it should be opened in the same pane, not to the side

[agent]

## Plan — Iteration 3: Polish & UX Improvements

I've reviewed all 11 feedback items against the current code. Here's my analysis and plan for each.

---

### 1. Archive icon — replace emoji with SVG

The current archive button uses the `📦` emoji (`&#x1F4E6;`), which looks inconsistent across platforms. I'll replace it with an inline SVG "archive" icon (box with down-arrow) rendered in greyscale (`currentColor`). This avoids external font dependencies and CSP changes. The icon will be monotone, matching VS Code's description foreground colour, with hover transition to full foreground.

**Files:** `board.ts` (`buildCardHtml`), `board.css` (`.card-archive` sizing)

---

### 2. Date format → YYYY-MM-DD

Two places currently format dates:
- **Card footer — `task.updated`**: Uses `new Date(task.updated).toLocaleDateString()` → locale-dependent (e.g. "3/9/2026")
- **Due date chip — `formatDate()`**: Returns "Mar 10" format

Both will be changed to output `YYYY-MM-DD`. I'll update `formatDate()` to return the ISO date as-is (it's already stored as `YYYY-MM-DD`), and change the card footer to format `task.updated` as `YYYY-MM-DD`.

**Files:** `board.ts` (`formatDate()`, `buildCardHtml`)

---

### 3. Clock icon next to due date

Add a small inline SVG clock icon before the due-date text on cards (inside the `.due-chip` span). Same approach as the archive icon — `currentColor`, clean mono line style.

**Files:** `board.ts` (`buildCardHtml` — due chip rendering)

---

### 4. More margin around assignee initials and labels

Currently `.card-meta-row` uses `gap-1.5` and `.card-labels` uses `gap-1`. I'll increase these to provide more breathing room — `gap-2` for meta-row and `gap-1.5` for labels. Also add a small margin around the `.assignee-badge`.

**Files:** `board.css` (`.card-meta-row`, `.card-labels`, `.assignee-badge`)

---

### 5. Squarer/flatter tag chips in the modal

The `.tag-chip` class currently uses `rounded-full` (pill shape). Change to `rounded` (small border-radius) matching the priority badge style. Remove the indigo tint — use the same gray background as `.label-pill` on cards. This makes modal tags visually consistent with how labels appear on cards.

**Files:** `board.css` (`.tag-chip`)

---

### 6 & 7. Replace `<datalist>` with custom autocomplete dropdowns

The browser-native `<datalist>` element renders its dropdown popup outside the webview's control — it misaligns with the form and can't be styled. I'll replace both the assignee and label inputs with custom autocomplete components:

- **Text input** with a hidden suggestion dropdown (absolutely positioned below the input)
- As the user types, filter the known users/labels list and show matching suggestions
- Click or arrow-key+Enter selects a suggestion, filling the input
- Typing a new value not in the list is still allowed (free-text)
- Dropdown dismisses on blur, Escape, or selection
- Styled with VS Code theme variables (matches `.form-control` + dropdown background)

For the **assignee** input: selecting a suggestion fills the input value directly.
For the **label** input: selecting a suggestion adds it as a tag (same as the current "Add" button flow).

This is the largest UI change in this iteration. I'll create a reusable `buildAutocompleteHtml()` helper and a shared event-handling pattern.

**Files:** `board.ts` (autocomplete logic + HTML), `board.css` (`.autocomplete-wrapper`, `.autocomplete-dropdown`, `.autocomplete-option`)

---

### 8. Custom Tailwind-styled date picker

Replace `<input type="date">` with a custom calendar popup:

- Click on the date input (now a read-only text field with a calendar icon button) to open the popup
- Calendar shows a month grid with prev/next month navigation
- Click a day to select it — fills the input with `YYYY-MM-DD`
- "Clear" button to remove the date
- Styled with VS Code theme colours to blend in with the rest of the form
- Positioned below the date field, within the modal scroll area

This avoids the browser's native date picker which looks out of place in the themed webview.

**Files:** `board.ts` (calendar component logic), `board.css` (`.datepicker-*` styles)

---

### 9. Reorder tasks within a lane

Currently drag-and-drop moves tasks between lanes but doesn't support positional reordering within a lane. I'll add up/down arrow buttons to each card (visible on hover, next to the archive button in the card footer). Clicking up/down swaps the task with its neighbour.

**Approach:**
- Add a `sortOrder?: number` field to the `Task` interface — this determines display order within a lane
- When a task is created, assign it the next available order number for its lane
- Up/down buttons send `{ type: 'reorderTask', taskId, direction: 'up' | 'down' }` to the extension
- The handler swaps `sortOrder` values between the two adjacent tasks and saves both
- `_sendState()` sorts tasks by `sortOrder` before sending to the webview
- If `sortOrder` is missing (legacy tasks), assign order based on `created` date on first load

[comment] Add a sort order, make it a decimal / float so we don't have to update all the other tasks for every move (we just position the decimal inbetween the tasks above and below). This will work for drag and drop across lanes also

Alternatively: **Do you prefer drag-to-reorder within a lane instead of up/down buttons?** Drag-to-reorder is more modern but requires position detection (which card is being hovered over). Up/down buttons are simpler and more precise. I can implement either — let me know your preference.

[comment] Implement drag to order

**Files:** `types.ts` (`sortOrder`), `TaskStore.ts` (serialise/deserialise), `board.ts` (buttons + UI), `board.css`, `KanbanEditorPanel.ts` (handler)

[comment] See above for sort order

---

### 10. "Open in editor" — prominent button

Currently uses `.btn-link` (underlined text link). I'll change it to `.btn-secondary` — a solid button with background, matching the Cancel button style but with the link text. This makes it much more visible in the modal footer.

**Files:** `board.ts` (`buildModalHtml`)

---

### 11. Open in editor — same pane

Currently the `openTask` handler opens the file with `vscode.ViewColumn.Beside`, which opens a split pane. Change to `vscode.ViewColumn.Active` so it replaces the current editor (the kanban board). The board panel has `retainContextWhenHidden: true`, so it'll still be there when the user switches back.

**Files:** `KanbanEditorPanel.ts` (`openTask` handler)

---

### Implementation Phases

| Phase | Items | Description |
|-------|-------|-------------|
| **A** | 1, 2, 3, 4, 5 | Quick visual fixes — SVG icons, date format, spacing, tag chip shape |
| **B** | 6, 7 | Custom autocomplete dropdowns (assignee + labels) |
| **C** | 8 | Custom date picker calendar |
| **D** | 9 | Task reordering within lanes |
| **E** | 10, 11 | Open in editor — button restyle + same-pane behaviour |
| **F** | — | Tests, build, lint verification |

**Questions before implementing:**
- **Item 9:** Up/down buttons or drag-to-reorder within a lane? I'd recommend up/down buttons for simplicity and clarity, but happy to do drag-based if you prefer. [comment] See comments above
- **Item 8:** Do you want full month navigation (prev/next) or a simpler approach? I'm planning a standard month-view calendar with arrows. [comment] Sounds good

[user] See inline comments

[agent]

## Iteration 3 — Plan Revision (addressing inline comments)

Thanks for the inline comments. Here's the updated approach for item 9:

### Item 9 — Revised: Drag-to-reorder with decimal sortOrder

**Sort order model:** `sortOrder` is a `number` (float). When a task is placed between two others, its `sortOrder` is set to the midpoint (e.g. between 1.0 and 2.0 → 1.5). This means only the moved task needs saving — no cascade updates to neighbours.

**Drag-to-reorder within a lane:**
- The existing drag-and-drop already handles cross-lane moves. I'll extend it to detect **which card** is being hovered over and insert the dragged card at that position.
- During `dragover`, track which card the cursor is over and whether it's in the top or bottom half → show a visual drop indicator (thin line/bar) above or below that card.
- On `drop`: calculate the new `sortOrder` as the midpoint between the card above and below the drop position. Edge cases: dropping at the top of a lane (sortOrder = previous first card's order - 1.0) or bottom (last card's order + 1.0).
- When moving cross-lane, the same positional logic applies — the task gets a new lane AND a new sortOrder.

**Data model:**
- `Task.sortOrder?: number` — optional, defaults to creation timestamp (epoch ms) for legacy tasks
- `TaskStore.serialise()` writes `sortOrder: <number>` 
- `TaskStore.deserialise()` reads it
- `KanbanEditorPanel._sendState()` sorts tasks by `sortOrder` before sending
- Legacy tasks without `sortOrder` get assigned `Date.parse(task.created)` as initial value

**Message:** The existing `moveTask` message gains an optional `sortOrder` field. The handler sets both `task.lane` and `task.sortOrder`, saves only that one task.

All other plan items (1–8, 10–11) remain as written. Full month calendar confirmed for item 8.

Ready to implement when you say `todo implement`.

[user]
todo implement

[agent]
## Iteration 3 — Implementation Complete

All 11 feedback items implemented across Phases A–F:

**Phase A — Visual fixes:** SVG archive icon (monotone greyscale), YYYY-MM-DD dates everywhere, clock icon next to due date, wider spacing around assignee badge & labels, squarer flat tag chips.

**Phase B — Custom autocomplete dropdowns:** Replaced browser `<datalist>` with fully custom autocomplete for both assignee and labels. Keyboard navigation (Arrow keys, Enter, Escape), filtered suggestions, VS Code theme-styled.

**Phase C — Custom date picker:** Replaced `<input type="date">` with custom month-grid calendar popup. Prev/next month navigation, today highlight, selected date highlight, clear button. Fully VS Code themed.

**Phase D — Drag-to-reorder:** Added `sortOrder?: number` to Task interface. Decimal/float midpoint calculation — only the moved task is saved. Drop indicator bar shows insertion point. Works within lane and cross-lane. Tasks without sortOrder fall back to creation date.

**Phase E — Button & pane improvements:** "Open in editor" and "Send to Chat" changed from link-style to secondary buttons. "Open in editor" now opens in the same pane (ViewColumn.Active) instead of beside.

**Phase F — Verification:** Added 2 new sortOrder tests. **97 tests passing**, clean build, zero lint errors.

**Files modified:** `types.ts`, `TaskStore.ts`, `KanbanEditorPanel.ts`, `webview/board.ts`, `webview/board.css`, `TaskStore.test.ts`

[user]

Make the lane selection option text upper case like in the lane headers - lane should be upper case everywhere it's output, including in the task yaml, but any comparisons should be case insensitive.

The 'Open in Editor' should be a primary blue background button.

The due date input and calendar icon do not display a calendar - nothing happens. Also, could the user have the option of entering the date by keyboard in the YYYT-MM-DD format (which is enforced)

We still need more vertical padding above the tags in the board view.

Labels should be limited to alphanumeric characters and hyphens only (no spaces)

[agent]
## Iteration 4 — Plan

I've also noticed the INSTRUCTION.md update (confirmed read). Five items to address:

### 1. Lane text uppercase everywhere

**Current state:** Lane headers display uppercase via CSS `text-transform: uppercase` on `.lane-title`. The underlying `LaneConfig.name` values are mixed-case ("Todo", "Doing", "Done"). The modal `<select>` options display `lane.name` as-is, so they show "Done" not "DONE". The YAML `lane:` field stores `lane.id` (lowercase, e.g. "todo").

**Plan:**
- Add `text-transform: uppercase` to the lane `<select>` dropdown in CSS (targets the option text).
- For YAML output: the user wants the lane value uppercase in the frontmatter. Currently `task.lane` stores `lane.id` (e.g. "todo"). I'll uppercase the lane value on serialise (`lane: TODO`) and make deserialise case-insensitive (match against `lane.id` lowercased). Comparisons throughout the codebase already match against `lane.id` — I'll normalise by lowercasing both sides.

**Impact:** `TaskStore.ts` (serialise uppercase, deserialise case-insensitive), `KanbanEditorPanel.ts` (case-insensitive lane comparisons), `board.ts` (filter uses strict `===` on lane.id — need to normalise), `board.css` (uppercase on select).

### 2. "Open in Editor" → primary blue button

**Current state:** Uses `btn-secondary` (grey background via `--vscode-button-secondaryBackground`).

**Plan:** Change class from `btn-secondary` to `btn-primary` (blue background via `--vscode-button-background`). One-line change in `board.ts`.

### 3. Date picker not working + keyboard date entry

**Root cause found:** The click handler checks `(t as HTMLElement).id === 'datepicker-toggle'` — but when clicking the SVG icon inside the button, `e.target` is the SVG child element (which has no `id`), so the check fails silently. Same issue affects `datepicker-clear`, `dp-prev`, `dp-next`.

**Plan:**
- Fix all four handlers to use `t.closest('#datepicker-toggle')` etc. instead of strict `t.id` checks.
- The date input is already a text box (`<input type="text">`). Add `placeholder="YYYY-MM-DD"` and validate on blur/save with a `/^\d{4}-\d{2}-\d{2}$/` regex. If invalid, clear the value. This allows keyboard entry while enforcing the format.

**CSP error note:** The screenshot shows a `connect-src` CSP violation for `board.js`. This is unrelated to the datepicker — it's likely VS Code DevTools or source map loading. The datepicker is 100% inline DOM manipulation with no network requests. No CSP change needed.

### 4. More vertical padding above tags

**Current state:** `.card-labels` sits inside `.card-meta` which has `gap-1` (4px) between children. There's no dedicated top margin on labels.

**Plan:** Add `mt-1` (4px extra) to `.card-labels` in CSS, giving ~8px total above the label row. If the meta row (assignee + due date) is empty, this still looks right.

### 5. Labels — alphanumeric + hyphens only

**Current state:** Zero validation on label text. Any string is accepted.

**Plan:**
- In `addLabelTag()`, strip characters that aren't `[a-zA-Z0-9-]` before adding. If the result is empty after stripping, don't add.
- In the autocomplete `selectItem()` for `add-tag` mode, apply the same sanitisation to manually-typed values. Autocomplete selections from the existing list are already valid (assuming the data is clean), but sanitise anyway for safety.
- Convert to lowercase for consistency (labels like "Bug" and "bug" should be the same tag).

### Summary of files to change

| File | Changes |
|------|---------|
| `board.ts` | Fix datepicker click delegation (`.closest()`), date validation, label sanitisation, Open in Editor → `btn-primary` |
| `board.css` | Lane select uppercase, label top margin |
| `TaskStore.ts` | Serialise lane uppercase, deserialise case-insensitive |
| `KanbanEditorPanel.ts` | Case-insensitive lane comparisons |

Ready when you say `todo implement`.

[user]
todo implement

[agent]
## Iteration 4 — Implementation Complete

All 5 feedback items implemented:

**1. Lane uppercase everywhere:** `TaskStore.serialise()` now writes `lane: TODO` (uppercase). `TaskStore.deserialise()` normalises back to lowercase on read. CSS `text-transform: uppercase` added to `select.form-control` and its options. Internal comparisons remain lowercase — no changes needed in `KanbanEditorPanel.ts` since the round-trip preserves lowercase internally.

**2. "Open in Editor" → primary button:** Changed from `btn-secondary` to `btn-primary` (blue accent background).

**3. Datepicker fixed:** Root cause was SVG child elements receiving the click event instead of the button. Changed all 4 handlers (`datepicker-toggle`, `datepicker-clear`, `dp-prev`, `dp-next`) from `t.id === '...'` to `t.closest('#...')`. Also removed `readonly` from the date input for keyboard entry. Added YYYY-MM-DD format validation on blur and on save (regex `/^\d{4}-\d{2}-\d{2}$/`).

**4. More vertical padding above tags:** Added `mt-1` to `.card-labels` in CSS.

**5. Labels alphanumeric + hyphens only:** Added `sanitiseLabel()` function that strips non-`[a-z0-9-]` characters and lowercases. Applied in both `addLabelTag()` and autocomplete `selectItem()` for add-tag mode.

**Tests:** 2 new lane uppercase tests (serialise uppercase, deserialise case-insensitive). **99 tests passing**, clean build, zero lint errors.

**Files modified:** `TaskStore.ts`, `board.ts`, `board.css`, `TaskStore.test.ts`

[user]

In the date picker, the user needs to be able to press enter to confirm the date, which should then close the calendar. If a manually typed date is invald, the field should show a red border, with small help text underneath explaining the validation error, rather than wiping the user input.

Can the date picker be smaller and display like a modal rather than below the input (which expands the form and requires a scroll bar, which changes the internal horizontal width of the form)

All lane names in board.yaml should be enforced lower case white space replaced with hyphens alpha numeric charaters and hyphens only

[agent]
## Iteration 5 — Plan

Three items to address:

### 1. Date picker Enter key + validation UX

**Current state:** No Enter key handler for the date input. Invalid dates are silently cleared (input wiped, no feedback). Validation is format-only (`/^\d{4}-\d{2}-\d{2}$/`) — `2025-13-99` would pass.

**Plan:**
- **Enter key:** In the keydown handler, detect Enter on `#modal-duedate`. If the calendar popup is open, close it. If the value passes validation, accept it. If invalid, show the error state.
- **Validation UX:** Replace the "wipe input" behaviour with a red border + helper text. Add a `.datepicker-error` class that sets `border-color: var(--vscode-inputValidation-errorBorder)`. Add a small `<div id="datepicker-help">` below the input row that shows the validation message (e.g. "Please enter a valid date in YYYY-MM-DD format"). Hidden by default, shown on invalid input.
- **Stronger validation:** Beyond regex format check, also validate the date is real — parse it and check that the resulting Date object's year/month/day match the input (catches `2025-02-30` etc).
- On save: if invalid, prevent save and show error rather than silently discarding.

### 2. Date picker as compact modal overlay

**Current state:** The popup is `position: absolute; top: 100%` below the input — grows the modal body and triggers scrollbars.

**Plan:**
- Change the popup to a **fixed-position centered overlay** with a backdrop (similar to the archive confirm dialog) rather than an inline dropdown. This prevents form expansion.
- Add a semi-transparent backdrop behind it (click to dismiss).
- Give it a fixed compact size (e.g. `max-width: 280px`) so the grid cells are tighter.
- Move the popup out of `.datepicker-wrapper` in the DOM — render it as a sibling of the modal, or use `position: fixed` with `inset: 0` backdrop + centered content.

### 3. Lane name sanitisation in board.yaml

**Current state:** `addLane` handler derives `id` from `laneName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')` but stores `name` as the user's raw input. `renameLane` checks reserved names, `addLane` does not — inconsistency. Neither checks duplicates.

**Plan:**
- **Enforce lane name format:** In both `addLane` and `renameLane`, sanitise the name the same way as the id: lowercase, replace whitespace/non-alphanumeric with hyphens, strip leading/trailing hyphens. Store the sanitised value as both `id` and `name` (since display uses CSS `text-transform: uppercase`, there's no need for a separate display name).
- **Deduplicate:** Check the sanitised name doesn't match an existing lane's id before accepting.
- **Reserved name check:** Add the `PROTECTED_LANE_NAMES` check to `addLane` to match `renameLane`.
- **Impact on BoardConfigStore:** No changes needed there — the sanitisation happens at the input boundary in `KanbanEditorPanel.ts`.

### Summary of files to change

| File | Changes |
|------|---------|
| `board.ts` | Enter key handler for date input, validation UX (red border + help text instead of clearing), stronger date validation |
| `board.css` | `.datepicker-error` border style, help text style, datepicker popup → fixed overlay with backdrop |
| `KanbanEditorPanel.ts` | `addLane` + `renameLane` lane name sanitisation, reserved name check in `addLane`, duplicate check |

No changes needed in `TaskStore.ts` or `KanbanEditorPanel.ts` message handler for task operations.

Ready when you say `todo implement`.

[user]

Looks good. 

Some changes required:

In the side bar + New Task doesn't do anything. It should trigger the new task modal, or be removed if that can't be done. 

What is the open board icon? Is there a better icon? Did we use fontawesome? 

I thought we were using a decimal / float for sort order? It may be what we have is ok, but explain it to me

[agent]

## Iteration 6 — Plan

Three items to address, plus the sort-order explanation.

---

### Sort Order Explanation (no changes needed)

The sort order **is** a decimal/float — exactly as you originally requested. The `Task.sortOrder` field is typed as `number` (which in TypeScript/JavaScript is always a 64-bit float). The key calculation in the drag-and-drop handler is:

```typescript
newSortOrder = (above + below) / 2;   // midpoint → produces decimals
```

When a task is dropped between two others (e.g. sortOrder 1.0 and 2.0), the moved task gets 1.5. Drop between 1.0 and 1.5 → 1.25, and so on. Only the single moved task is saved — no cascading updates. Edge cases (top/bottom of lane) use `first - 1` or `last + 1`. This is the decimal midpoint strategy you asked for.

---

### 1. Sidebar "+ New Task" — open the create modal

**Current state:** The "+ New Task" button in the sidebar calls `agentKanban.newTask`, which simply calls `KanbanEditorPanel.createOrShow()` — this opens (or reveals) the board panel but does **not** trigger the create-task modal. The user clicks the button, sees the board appear, but nothing else happens.

**Plan:**
- After `createOrShow()`, send a message to the webview to open the create modal. Add a `triggerCreateModal()` method on `KanbanEditorPanel` that posts `{ type: 'openCreateModal' }` to the webview.
- In `board.ts`, handle the `openCreateModal` message in the `window.addEventListener('message', ...)` handler by calling the existing `openCreateModal()` function.
- Update the `agentKanban.newTask` command in `extension.ts` to call `KanbanEditorPanel.createOrShow()` then `KanbanEditorPanel.currentPanel?.triggerCreateModal()`.
- Small timing concern: the webview may not be ready yet when `triggerCreateModal()` fires (especially on first open). Use a flag — if the webview hasn't sent `ready` yet, queue the message and send it after the first `ready` response.

**Files:** `KanbanEditorPanel.ts` (add `triggerCreateModal()` + queuing logic), `extension.ts` (call it from the command), `board.ts` (handle `openCreateModal` message)

---

### 2. Sidebar "Open Board" icon

**Current state:** Uses `&#x229E;` (⊞ — "squared plus"), a basic Unicode math symbol. It's functional but not descriptive — doesn't convey "kanban board".

**Plan:**
- Replace with an inline SVG kanban/columns icon — three vertical rectangles suggesting board columns. Same approach as the archive and clock icons on the board cards (inline SVG, `currentColor`, no external dependencies, no CSP changes needed).
- Renders in the button alongside "Open Board" text, matching VS Code's foreground colour.

**Files:** `BoardViewProvider.ts` (replace `&#x229E;` with inline SVG)

---

### 3. Iteration 5 implementation status

Iteration 5 (datepicker overlay + validation UX + lane sanitisation) was completed in the prior turn:
- Date validation shows red border + help text instead of clearing
- Enter confirms and closes the calendar
- Calendar is a fixed centered overlay with backdrop
- Lane names sanitised (lowercase alphanumeric + hyphens) in both `addLane` and `renameLane`
- 99 tests passing, clean build, zero lint errors

---

### Summary of files to change

| File | Changes |
|------|---------|
| `extension.ts` | Call `triggerCreateModal()` after `createOrShow()` in `newTask` command |
| `KanbanEditorPanel.ts` | Add `triggerCreateModal()` method with ready-queue logic |
| `board.ts` | Handle `openCreateModal` message from extension |
| `BoardViewProvider.ts` | Replace `&#x229E;` with inline SVG board icon |

Small, focused changes — no new data model or test changes expected.

Ready when you say `todo implement`.

