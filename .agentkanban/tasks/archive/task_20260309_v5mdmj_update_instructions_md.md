---
title: Update INSTRUCTIONS.md
lane: done
created: 2026-03-09T08:33:41.928Z
updated: 2026-03-15T14:08:15.878Z
slug: update_instructions_md
---

## Conversation

[user]

We will update the INSTRUCTION.md in this extension and release via version updates. The tool at appropriate points (extension activation / load/ install?), needs to overwrite the .agentkanban version with the extension version - to keep updated. the INSTRUCTION.md is not for the user to edit, so we are ok to overwrite it

[user]

plan

[agent]

## Plan

### Current Behaviour

`ensureInstructionFile()` in `ChatParticipant.ts` only copies the bundled template if `INSTRUCTION.md` **does not exist** (stat succeeds → early return). It's called during `/task` and `/new` commands.

### Goal

Always overwrite `.agentkanban/INSTRUCTION.md` with the extension's bundled version so that on extension update, users automatically get the latest instructions. The file is extension-managed, not user-editable.

### Changes

1. **`ChatParticipant.ts` — `ensureInstructionFile()`**  
   Remove the `stat` early-return guard. Always write the bundled template to the workspace. Rename to `syncInstructionFile()` to reflect the new intent (always sync, not "ensure exists").

    [comment] As long as this is a one way sync - we are overwriting the file INSTRUCTION.md entirely

2. **`extension.ts` — call at activation**  
   Call `syncInstructionFile()` during `activate()` so INSTRUCTION.md is updated as soon as the extension loads (covers install, update, and reload). Keep the existing calls in `/task` and `/new` as well — they're cheap (single file write) and ensure the file exists even after manual deletion.

3. **`assets/INSTRUCTION.md` — remove "editable by user" comment**  
   In the directory structure section, change `INSTRUCTION.md      # This file — agent instructions (editable by user)` to `INSTRUCTION.md      # This file — agent instructions (managed by extension)`. [comment] Good spot, I have done this one

4. **`README.md` — update Agent Instructions section**  
   Remove "You can edit `.agentkanban/INSTRUCTION.md` to customise the agent's behaviour. Delete it to reset to the default template on next use." Replace with wording that says the file is managed by the extension and auto-updated.

   [comment] Yes, lets make clear that INSTRUCTION.md is for the extension, user modifications are to be made in standard AGENTS.md files (or CLAUDE.md etc, depending on set up) and agent skills. Note that this extension co-exists with standard techniques like that without interference 

5. **Tests — `ChatParticipant.test.ts`**  
   - Update test "should skip creation when INSTRUCTION.md already exists" → should now verify that `writeFile` IS called (overwrite behaviour).
   - Rename describe block and test names to match the new method name `syncInstructionFile`.
   - Add a test that confirms the template content is read and written even when the file already exists.

### Sequence

Tests first (red), then implementation (green), then README/template doc updates.

[user] Agreed, see inline comments

[user]

plan

[agent]

### Revised Plan (incorporating comments)

All inline comments acknowledged. Updated plan:

1. **`ChatParticipant.ts` — `ensureInstructionFile()` → `syncInstructionFile()`**  
   One-way sync: always read the bundled template from `assets/INSTRUCTION.md` and overwrite `.agentkanban/INSTRUCTION.md`. Remove the `stat` guard entirely. No merging, no diffing — full overwrite every time.

2. **`extension.ts` — call at activation**  
   Call `chatParticipantHandler.syncInstructionFile()` during `activate()`, after stores are initialised. Keep existing calls in `/task` and `/new`.

3. **`assets/INSTRUCTION.md`** — Already updated by user (comment noted). No further change needed.

4. **`README.md` — Agent Instructions section**  
   Replace the "editable" wording with: INSTRUCTION.md is managed by the extension and updated automatically. User customisations should be made via standard agent configuration files (e.g. `AGENTS.md`, `CLAUDE.md`, skills) — Agent Kanban co-exists with these without interference.

5. **Tests — `ChatParticipant.test.ts`**  
   - Rename `ensureInstructionFile` describe → `syncInstructionFile`
   - "should create INSTRUCTION.md when it does not exist" — keep as-is (still valid)
   - "should skip creation when INSTRUCTION.md already exists" → flip to assert `writeFile` IS called (overwrite)
   - Add test: content written matches the template content read

Plan confirmed. Ready for `todo` or `todo implement`.

[user]

todo implement

[agent]

## Implementation Complete

All changes implemented via red/green TDD. Lint, 82 tests, and build all pass.

### Changes Made

1. **`ChatParticipant.ts`** — Renamed `ensureInstructionFile()` → `syncInstructionFile()`. Removed the `stat` early-return guard. Now always reads the bundled template and overwrites `.agentkanban/INSTRUCTION.md` (one-way sync).

2. **`extension.ts`** — Added `await chatParticipantHandler.syncInstructionFile()` at activation, after store init. INSTRUCTION.md is now synced on every extension load (install, update, reload).

3. **`README.md`** — Updated Agent Instructions section: file is extension-managed, auto-updated. User customisations via `AGENTS.md`, `CLAUDE.md`, or skills. Updated Storage section comment to "(managed by extension)".

4. **`ChatParticipant.test.ts`** — Renamed describe block to `syncInstructionFile`. Removed `stat` mocks (no longer needed). Flipped "already exists" test to expect `writeFile` IS called. Added test verifying exact template content is written.

[user]