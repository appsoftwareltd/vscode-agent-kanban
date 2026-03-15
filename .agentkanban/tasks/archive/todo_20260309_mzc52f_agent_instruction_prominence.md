---
task: task_20260309_215747108_mzc52f_agent_instruction_prominence
---

## TODO

- [x] Add `lastSelectedTaskId` field to ChatParticipant
- [x] Register `/plan`, `/todo`, `/implement` commands in package.json
- [x] Implement `handleVerb()` with context re-injection
- [x] Implement `parseVerbs()` for #-tagged verb combinations
- [x] Implement `stripVerbTags()` for additional context extraction
- [x] Update `handleRequest()` switch to route verb commands
- [x] Update `handleNew()` to clear `lastSelectedTaskId`
- [x] Update `handleTask()` to set `lastSelectedTaskId` and reference verb commands
- [x] Update `getFollowups()` to return verb command followups when task is selected
- [x] Update default handler help text with verb commands
- [x] Update "Type **go** in the chat to begin" messaging
- [x] Add tests for verb commands, parseVerbs, lastSelectedTaskId, followups
- [x] Update README.md — Chat Commands table and Getting Started section
- [x] Update TECHNICAL.md — Chat Participant verb command documentation
- [x] Update assets/INSTRUCTION.md — Add note about using @kanban verb commands
