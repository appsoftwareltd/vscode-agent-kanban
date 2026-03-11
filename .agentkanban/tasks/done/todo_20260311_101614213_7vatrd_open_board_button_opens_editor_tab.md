---
task: task_20260311_101614213_7vatrd_open_board_button_opens_editor_tab
---

## TODO

- [x] In `resolveWebviewView`, call `agentKanban.openBoard` immediately (guarded by `_isInitialised`) to auto-open the editor panel on first sidebar reveal
- [x] Register `webviewView.onDidChangeVisibility` listener to call `agentKanban.openBoard` whenever `visible` becomes `true`
- [x] Remove "Open Board" (`btn-open`) button from `_getHtml()` HTML and its click script
- [x] Run tests — confirm no regressions

### Iteration 2 — post-initialise auto-open

- [x] In `setInitialised(true)`, call `agentKanban.openBoard` so the editor panel opens after first-time workspace initialisation
- [x] Run tests — confirm no regressions

### Iteration 3 — Activity Bar focus mode

- [x] Add `ensureActivityBarFocusMode()` helper in `extension.ts` using `vscode.workspace.getConfiguration().update()` to set `workbench.activityBar.iconClickBehavior: "focus"` at workspace scope
- [x] Call `ensureActivityBarFocusMode()` from `doInitialise()` and the already-initialised startup block
- [x] Run tests — confirm no regressions

### Iteration 4 — window focus → re-open board

- [x] Add `window.addEventListener('focus', ...)` to `_getHtml()` script that posts `{ type: 'focusSidebar' }`
- [x] Handle `'focusSidebar'` in `resolveWebviewView` message handler by calling `agentKanban.openBoard`
- [x] Run tests — confirm no regressions
