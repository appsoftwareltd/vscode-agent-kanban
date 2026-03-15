---
title: Setting for custom AGENT instruction file
lane: done
created: 2026-03-09T08:51:30.721Z
updated: 2026-03-15T14:08:19.831Z
slug: setting_for_custom_agent_instruction_file
---

## Conversation

[user]

The extension needs a an extension setting for a custom instruction path and filename that can be sepecified by the user. When set, the /task command will 

```
Read .agentkanban/INSTRUCTION.md for workflow instructions.

Read <file from user setting> for additional instructions.

... 

<Rest of injected prompt>
```

I think this is the best way to inject the instruction - advise if otherwise

[agent]

I've read the README, TECHNICAL.md, INSTRUCTION.md, ChatParticipant.ts, the test file, and package.json. Here's the plan:

## Analysis

The `/task` command currently outputs:

```
Read .agentkanban/INSTRUCTION.md for workflow instructions.

Working on task: **<title>**

Task file: <path>

...
```

The user wants a new VS Code setting that, when populated, injects an additional `Read <file> for additional instructions.` line immediately after the INSTRUCTION.md reference. This is a clean approach — the custom instruction file is separate from the managed INSTRUCTION.md, so it won't be overwritten on extension updates.

Your proposed injection point is good. Placing it right after the INSTRUCTION.md line and before the task context gives the agent both sets of instructions up front.

## Plan

### 1. Add setting to `package.json`

Add `agentKanban.customInstructionFile` under `contributes.configuration.properties`:

```json
"agentKanban.customInstructionFile": {
    "type": "string",
    "default": "",
    "description": "Path to a custom instruction file. When set, its path is included in /task output so the agent reads it alongside the built-in instructions. Relative paths are resolved from the workspace root.",
    "scope": "resource"
}
```

Using `resource` scope so it can be set per-workspace (most likely use case — different projects have different agent instructions).

### 2. Update `ChatParticipant.handleTask()`

After the INSTRUCTION.md reference line, read the `agentKanban.customInstructionFile` setting. If non-empty:
- Resolve relative paths against workspace root
- Verify the file exists (skip silently with a log warning if not)
- Output: `Read \`<resolved relative path>\` for additional instructions.\n\n`

### 3. Add tests to `ChatParticipant.test.ts`

- Test that when `customInstructionFile` is set and file exists, the additional read line appears in output
- Test that when `customInstructionFile` is empty/unset, no additional line appears
- Test that when the file doesn't exist, the line is skipped (no error shown to user)
- Test relative path resolution

### 4. Update `README.md` Configuration table

Add the new setting to the table.

### 5. Update `TECHNICAL.md`

Document the custom instruction file injection in the Chat Participant / `/task` flow section.

## File Changes

| File | Change |
|------|--------|
| `package.json` | Add `agentKanban.customInstructionFile` setting |
| `src/agents/ChatParticipant.ts` | Read setting in `handleTask()`, inject custom instruction reference |
| `src/test/ChatParticipant.test.ts` | Add tests for new behaviour |
| `README.md` | Add setting to Configuration table |
| `TECHNICAL.md` | Document custom instruction file in /task flow |

[user] Add a note on the setting comment to clarify that standard agents files as per the users tool set up will continue to be read

I also want to be sure that the addition of the file doesn't dilute the instruction around the working task file e.g.

Task file: .agentkanban/tasks/task_20260309_085130721_27z77h_setting_for_custom_agent_instruction_file.md

[agent]

Good points both. Updated plan:

### Setting description clarification

The setting description will note that standard agent configuration files (AGENTS.md, .github/copilot-instructions.md, CLAUDE.md, etc.) still function normally — this setting is for *additional* instructions injected specifically into the Agent Kanban `/task` workflow.

Updated description:

```
"Path to a custom instruction file injected into the /task workflow. Standard agent files (AGENTS.md, copilot-instructions.md, etc.) are unaffected and continue to work as normal. Relative paths resolve from the workspace root."
```

### Preserving task file focus

The current `/task` output ends with a strong directive:

```
The conversation for this task happens in the task file above.

Type `plan`, `todo`, or `implement` (or a combination) in the chat...
```

The custom instruction reference will be placed *between* the INSTRUCTION.md reference and the task context — **not** after the task file reference. So the final output order is:

```
Read `.agentkanban/INSTRUCTION.md` for workflow instructions.

Read `<custom file>` for additional instructions.

Working on task: **<title>**

Task file: `<path>`

The conversation for this task happens in the task file above.

Type `plan`, `todo`, or `implement`...
```

This keeps the task file as the last thing mentioned before the action prompt, preserving its prominence. The custom instruction is just another "read this first" alongside INSTRUCTION.md, not competing with the task file directive.

No other plan changes needed — the 5 files and their changes remain the same.

[user] todo implement

[agent]

Implementation complete. All changes:

**package.json** — Added `agentKanban.customInstructionFile` setting (resource scope) with description noting standard agent files are unaffected.

**src/agents/ChatParticipant.ts** — In `handleTask()`, after the INSTRUCTION.md reference: reads the setting, resolves relative/absolute paths, verifies file exists via `workspace.fs.stat()`, outputs `Read <path> for additional instructions.` between INSTRUCTION.md and task context. Silently skips with log warning if file doesn't exist.

**src/test/ChatParticipant.test.ts** — 4 new tests:
- Custom instruction reference appears when setting is configured
- No reference when setting is empty
- Silently skips when file doesn't exist
- Correct ordering (after INSTRUCTION.md, before task context)

**README.md** — Added setting to Configuration table.

**TECHNICAL.md** — Documented custom instruction file injection in /task flow with new subsection.

Lint, 86 tests, and build all pass.

[user]