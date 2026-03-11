---
title: Ensure that logging is off by default
created: 2026-03-11T08:51:01.595Z
updated: 2026-03-11T08:54:24.778Z
sortOrder: 1
---

## Conversation

[user]

We need to ensure that logging is off by default for new extension installs and activations

[agent]

## Analysis

**Current state — logging is already off by default:**

- `LogService` constructor: `this.enabled = options?.enabled ?? false` ✓
- `package.json`: `agentKanban.enableLogging` declared with `"default": false` ✓
- `extension.ts`: `config.get<boolean>('enableLogging', false)` uses `false` fallback ✓
- `isInitialised` guard prevents log directory creation on fresh workspaces ✓

**What is missing:** No tests verify the `LogService` constructor's default-disabled contract when called with no options or empty options. This is the coverage gap that could allow a future regression.

## Plan

1. Add test: `new LogService(logDir)` (no options) — `isEnabled === false`, no directory created
2. Add test: `new LogService(logDir, {})` (empty options) — `isEnabled === false`, no directory created
3. Run tests to confirm green (implementation already correct, tests are gap-filling verification)

No changes to `LogService.ts`, `extension.ts`, or `package.json` are required.

[user]