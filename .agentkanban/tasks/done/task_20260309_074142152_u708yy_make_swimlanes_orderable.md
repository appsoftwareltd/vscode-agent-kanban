---
title: Make swimlanes orderable
lane: done
created: 2026-03-09T07:41:42.152Z
updated: 2026-03-09T20:05:48.648Z
---

## Conversation

[user] We need the sidebar swimlanes to be orderable (drag / drop) like the tasks themselves are

Also, we need to add some rules regarding removing swimlanes:

The TODO and DONE swimlanes cannot be deleted. If any of the others are deleted, the tasks will be deleted with them. The user will be prompted to confirm that this is OK (if there are any tasks in the lane) before deletion.

[agent] I've read `README.md` and `TECHNICAL.md`. Here's the plan:

## Plan

Two features: **(A) Lane drag-and-drop reordering** and **(B) Enhanced lane removal rules**.

### A — Swimlane Drag-and-Drop Reordering

**Current state:** Lanes are rendered as `<div class="lane">` elements inside `.board`. Only task cards support drag-and-drop today (via `dragstart`/`dragend`/`dragover`/`drop` on `.card` / `.lane-cards`).

**Approach:** Make lane headers draggable. When a lane is dropped on another lane, reorder the `config.lanes` array and persist via `BoardConfigStore.update()`.

Changes:

1. **Webview HTML** ([BoardViewProvider.ts](src/BoardViewProvider.ts)) — make `<div class="lane">` elements draggable by adding `draggable="true"` to the lane header. Add a drag handle icon/grip to the lane header for visual affordance.
2. **Webview JS** — add lane-level drag-and-drop handlers separate from card drag-and-drop:
   - `dragstart` on `.lane-header` sets a lane-specific data transfer type (e.g. `application/x-lane-id`) to distinguish from card drags.
   - `dragover` / `dragleave` on `.lane` elements shows a visual drop indicator (e.g. left/right border highlight).
   - `drop` on `.lane` extracts the source lane ID and target lane ID, posts a `moveLane` message.
3. **Message handler** ([BoardViewProvider.ts](src/BoardViewProvider.ts)) — add `moveLane` case: receives `{ sourceLaneId, targetLaneId }`, reorders `config.lanes` by removing the source and inserting it at the target's position, then calls `boardConfigStore.update()`.
4. **CSS** — add `.lane.drag-over-lane` style for visual feedback during lane drag (e.g. subtle left border or background change). Add grip cursor / drag handle styling.

### B — Enhanced Lane Removal Rules

**Current state:** Only the "done" lane (by ID) is protected. Removing any other lane just removes it from config — tasks in the lane become orphaned but are not deleted.

**New rules:**
- **"todo" lane** (by ID) is also protected from deletion — same as "done". Both get no remove button and the handler blocks removal with a warning.
- **Other lanes** — when removed, all tasks in that lane are deleted. If there are tasks in the lane, prompt the user for confirmation before deletion.

[comment: I think TODO and DONE lanes (case insensitive match) should be protected by name - they cannot be renamed either]

Changes:

1. **Webview HTML** — hide the remove button for both `done` and `todo` lanes (currently only `done`).
2. **Message handler `removeLane`** — update logic:
   - Block removal for both `todo` and `done` lanes.
   - Find all tasks in the lane being removed.
   - If tasks exist: show a confirmation dialog (`vscode.window.showWarningMessage` with "Yes"/"No" items) informing the user that N tasks will be deleted.
   - If confirmed (or no tasks): delete all tasks in the lane via `taskStore.delete()`, then remove the lane from config.
3. **Tests** — add unit tests for the protected lane logic and task deletion on lane removal.

### Files Changed

| File | Changes |
|------|---------|
| [src/BoardViewProvider.ts](src/BoardViewProvider.ts) | Lane drag-and-drop (HTML, CSS, JS), `moveLane` handler, enhanced `removeLane` handler, protected lane logic updated |
| [src/test/BoardConfigStore.test.ts](src/test/BoardConfigStore.test.ts) | Possibly extend if serialisation changes (unlikely) |

### Testing Strategy

- **Unit tests:** Test `moveLane` reordering logic, `removeLane` protection for both `todo`/`done`, task deletion on lane removal.
- **Manual:** Drag lanes in sidebar, verify order persists. Attempt to remove protected lanes. Remove a lane with tasks — verify confirmation and deletion.

[user] At the same time we need to add the ability to rename the swimlanes (except for todo and done)

See inline comments

[agent] Good feedback. Updating the plan based on your comments:

### Updated Plan

**Key changes from your review:**

1. **Protected lanes matched by name (case-insensitive), not by ID.** The "Todo" and "Done" lanes are identified by checking if `lane.name.toLowerCase()` is `'todo'` or `'done'`. This means even if the ID is different, a lane named "Todo" or "Done" is protected.

2. **Protected lanes cannot be renamed either.** The `renameLane` handler (which already exists — triggered by double-clicking the lane title) will block renaming of Todo/Done lanes. Additionally, no lane can be renamed *to* "Todo" or "Done" (case-insensitive) to prevent creating duplicate protected lanes.

3. **Rename is already implemented** — double-click on lane title triggers `renameLane` message, which shows an input box. We just need to add the protection check and prevent renaming to reserved names.

### Revised Feature Summary

| Feature | Description |
|---------|-------------|
| **A. Lane reordering** | Drag-and-drop lanes to reorder. Persists to `board.yaml`. |
| **B. Lane removal rules** | Todo/Done (by name) cannot be deleted. Other lanes: tasks deleted with confirmation. |
| **C. Lane rename protection** | Todo/Done (by name) cannot be renamed. No lane can be renamed to "Todo"/"Done". |

### Helper: `isProtectedLane()`

Add a helper function that checks if a lane is protected by matching its **name** case-insensitively against `['todo', 'done']`. Used consistently across:
- HTML rendering (hide remove button, disable rename cursor)
- `removeLane` handler
- `renameLane` handler

### Files Changed

| File | Changes |
|------|---------|
| [src/BoardViewProvider.ts](src/BoardViewProvider.ts) | Lane drag-and-drop (HTML/CSS/JS), `moveLane` handler, `isProtectedLane()` helper, enhanced `removeLane`/`renameLane` handlers |
| [src/types.ts](src/types.ts) | Add `PROTECTED_LANE_NAMES` constant |

[user] todo implement

[agent] Here's the TODO and I'll start implementing:

## TODO

- [x] Add `PROTECTED_LANE_NAMES` constant to `types.ts`
- [x] Add `isProtectedLane()` helper in `types.ts`
- [x] Update lane HTML: hide remove button for protected lanes, add drag handle to lane headers
- [x] Add lane drag-and-drop CSS (drag-over indicator, grip handle)
- [x] Add lane drag-and-drop JS (separate from card drag-and-drop)
- [x] Add `moveLane` message handler
- [x] Update `removeLane` handler: protect by name, delete tasks with confirmation
- [x] Update `renameLane` handler: block protected lanes, prevent renaming to reserved names
- [x] Write tests
- [x] Build and verify