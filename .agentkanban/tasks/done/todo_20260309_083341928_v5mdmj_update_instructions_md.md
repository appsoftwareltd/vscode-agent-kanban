---
task: task_20260309_083341928_v5mdmj_update_instructions_md
---

## TODO

- [x] Update tests: rename `ensureInstructionFile` describe → `syncInstructionFile`, flip "already exists" test to expect overwrite
- [x] Rename `ensureInstructionFile()` → `syncInstructionFile()` in ChatParticipant.ts, remove stat guard
- [x] Update internal callers (`handleNew`, `handleTask`) to use `syncInstructionFile()`
- [x] Call `syncInstructionFile()` at extension activation in `extension.ts`
- [x] Update README.md Agent Instructions section (extension-managed, not user-editable)
- [x] Run lint, tests, build
