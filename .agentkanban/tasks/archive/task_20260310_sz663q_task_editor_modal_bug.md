---
title: Task editor modal bug
lane: done
created: 2026-03-10T15:20:01.291Z
updated: 2026-03-15T14:08:32.250Z
description: |-
  The task editor modal will close if any mouse event occurs outside its boundary.

  - The cloak / background should not handle any click events so as to not close the task editor modal
  - A confirm dialogue should be displayed before closing without saving changes
  - The cancel button still closes
priority: critical
slug: task_editor_modal_bug
---


## Conversation

[user]

The task editor modal will close if any mouse event occurs outside its boundary.

- The cloak / background should not handle any click events so as to not close the task editor modal
- A confirm dialogue should be displayed before closing without saving changes
- The cancel button still closes

[agent]

## Plan

**File:** `src/webview/board.ts`

### Root cause

In `handleClick()` (line ~398), clicking on `modal-backdrop` directly calls `closeModal()`. This means any click outside the inner modal panel closes it immediately with no warning.

### Changes required

**1. Remove backdrop-closing behaviour**  
Delete the `if (id === 'modal-backdrop') { closeModal() }` guard so the backdrop is inert to clicks.

**2. Track "dirty" state**  
Capture the initial form values when a modal opens (title, description, lane, priority, assignee, due date, labels) into a `modalSnapshot` object. A helper `isModalDirty()` compares current form values to the snapshot.

**3. X-button close — guarded by confirm**  
`modal-close` (the ×) calls a new `tryCloseModal()` function. If `isModalDirty()` returns true, show a "Discard unsaved changes?" confirm dialog. If not dirty, close immediately.

**4. Cancel button — closes directly**  
`modal-cancel` continues to call `closeModal()` unconditionally (user explicitly chose to cancel).

**5. Discard confirm dialog**  
Add a small modal-level confirm overlay (`modal-discard-backdrop`) with "Keep editing" and "Discard" buttons, rendered inside `buildModalHtml()`. Reuse the existing confirm-backdrop CSS pattern.

**6. Clear snapshot on save/close**  
`closeModal()` and `saveModal()` clear `modalSnapshot` so dirty state resets cleanly.

### Summary of behaviour after fix

| Action | Behaviour |
|---|---|
| Click backdrop | Nothing (modal stays open) |
| Click × | Dirty? → confirm dialog. Clean? → close |
| Click Cancel | Always closes immediately |
| Click Save | Saves and closes, no confirm |

[user]

(todo implement)

[agent]

## Implementation complete

All changes made to `src/webview/board.ts`. Build passes, no TypeScript errors.

**What changed:**

- **Backdrop click removed** — `modal-backdrop` click no longer closes the modal; it is inert.
- **`ModalSnapshot` interface + `modalSnapshot` state** — captures form values (title, description, lane, priority, assignee, dueDate, labels) when a modal opens.
- **`captureModalSnapshot()`** — called at the end of `openModal()` and `openCreateModal()` after all fields are populated.
- **`isModalDirty()`** — compares current DOM values to snapshot; returns `false` if no snapshot exists.
- **`tryCloseModal()`** — called by the × button. Dirty → shows discard confirm; clean → closes immediately.
- **`buildDiscardConfirmHtml()`** — new function generating a "You have unsaved changes. Discard them?" overlay with *Keep editing* / *Discard* buttons; rendered alongside `buildModalHtml()` in `buildBoardHtml()`.
- **Cancel button** — unchanged; still calls `closeModal()` directly (no confirm needed).
- **`closeModal()`** — now also clears `modalSnapshot` and hides the discard confirm.

[user]

