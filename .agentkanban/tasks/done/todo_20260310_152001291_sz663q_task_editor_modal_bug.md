---
task: task_20260310_152001291_sz663q_task_editor_modal_bug
---

## TODO

- [x] Remove `modal-backdrop` click → `closeModal()` handler from `handleClick()`
- [x] Add `modalSnapshot` state and `isModalDirty()` helper
- [x] Capture snapshot when modal opens (`openEditModal`, `openCreateModal`)
- [x] Clear snapshot in `closeModal()` and `saveModal()`
- [x] Add discard confirm HTML to `buildModalHtml()` (`modal-discard-backdrop`)
- [x] Wire `modal-close` (×) to `tryCloseModal()` which guards with `isModalDirty()`
- [x] Wire discard confirm "Discard" → `closeModal()` and "Keep editing" → hide confirm
- [x] Verify Cancel button still closes directly without confirm
- [x] Manual smoke test: open modal, change a field, click ×, confirm dialog appears; click backdrop, modal stays open; click Cancel, modal closes
