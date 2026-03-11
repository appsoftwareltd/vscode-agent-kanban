---
title: Remove agentKanban.userName setting
lane: done
created: 2026-03-09T09:05:28.419Z
updated: 2026-03-09T10:58:37.169Z
---

## Conversation

[user]

I don't think the setting agentKanban.userName has any use currently. Can we remove it?

[agent]

Confirmed — I've read README.md and investigated the codebase. The `agentKanban.userName` setting and its supporting code (`ensureUserName`, `getUserName`) are not consumed by any feature. The only effect is gating task creation behind a name prompt, which adds friction for no benefit.

## Plan

### Summary
Remove the `agentKanban.userName` setting, the `userName.ts` module, and all references across the codebase.

### Changes

1. **Delete `src/userName.ts`** — the entire module (`ensureUserName`, `getUserName`) is unused
2. **`src/extension.ts`** — remove import of `ensureUserName`; remove the username check that blocks `agentKanban.newTask`
3. **`src/BoardViewProvider.ts`** — remove import of `ensureUserName`; remove the `await ensureUserName()` call in the `newTask` message handler
4. **`package.json`** — remove the `agentKanban.userName` configuration property
5. **`README.md`** — remove the userName row from the Configuration table
6. **`TECHNICAL.md`** — remove the `userName.ts` line from the architecture listing
7. **Tests** — verify no tests import from `userName.ts`; run full test suite + build

[user]

todo implement

[agent]

Done. All changes implemented:

- Deleted `src/userName.ts`
- Removed `ensureUserName` import and username gate from `src/extension.ts`
- Removed `ensureUserName` import and call from `src/BoardViewProvider.ts`
- Removed `agentKanban.userName` property from `package.json`
- Removed userName row from `README.md` configuration table
- Removed `userName.ts` line from `TECHNICAL.md` architecture listing

Lint clean, 86/86 tests passed, build succeeded.