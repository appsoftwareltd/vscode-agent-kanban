---
title: Open board button opens editor tab
created: 2026-03-11T10:16:14.213Z
updated: 2026-03-11T13:34:52.395Z
description: I find my self clicking one then the other, so link them
labels:
  - "easy\r"
sortOrder: 1773042102151.5
---



## Conversation

[user]

I find my self clicking one then the other, so link them so that clicking the icon in the side bar opens the board in the editor tab also (there should only be one Agent Kanban editor tab at any one time).

This would mean we don't need the Open Board button in the sidebar.

[agent]

## Plan

**Goal:** When the user clicks the Activity Bar icon to reveal the Agent Kanban sidebar, automatically open (or reveal) the `KanbanEditorPanel` editor tab. Remove the now-redundant "Open Board" button from the sidebar.

### How it works now

1. Clicking the Activity Bar icon shows `BoardViewProvider` (sidebar webview).
2. There is a separate "Open Board" button in the sidebar HTML that posts a `openBoard` message → `agentKanban.openBoard` command → `KanbanEditorPanel.createOrShow()`.

### What needs to change

**`src/BoardViewProvider.ts`**
- In `resolveWebviewView`, after setting up the webview, immediately trigger `agentKanban.openBoard` so the editor panel opens the first time the sidebar is shown.
- Register a `webviewView.onDidChangeVisibility` listener: whenever `webviewView.visible` becomes `true`, execute `agentKanban.openBoard` — so clicking the Activity Bar icon on subsequent visits also reveals/re-focuses the panel.
- Remove the "Open Board" button (`btn-open`) from the `_getHtml` sidebar HTML and its script handler.

**No change to `extension.ts`, `package.json`, or `KanbanEditorPanel.ts`** — `KanbanEditorPanel.createOrShow()` already handles the "only one panel at a time" requirement (it reveals the existing panel if one exists rather than creating a new one).

### Edge cases
- The panel should only auto-open when the workspace is initialised — wrapped in the existing `_isInitialised` guard (only the `_getHtml` path matters, not `_getUninitHtml`).
- `resolveWebviewView` fires once; subsequent visibility events are handled by `onDidChangeVisibility`. Both paths are covered.

[user]

go

[agent]

## Implementation

Changed `src/BoardViewProvider.ts`:

1. **Auto-open on first reveal** — at the end of `resolveWebviewView`, added `openBoardIfInitialised()` call (guarded by `_isInitialised`) so the editor panel opens the moment the sidebar is rendered for the first time.

2. **Auto-open on subsequent reveals** — registered `webviewView.onDidChangeVisibility` listener that calls `openBoardIfInitialised()` whenever `visible` becomes `true`, so clicking the Activity Bar icon when the sidebar was previously hidden also reveals/re-focuses the panel.

3. **Removed "Open Board" button** — stripped `btn-open` and its click handler from `_getHtml()`. The "+ New Task" button remains.

No other files changed. `KanbanEditorPanel.createOrShow()` already enforces a single-panel constraint via `currentPanel`. All 143 tests pass, build is clean.

[user]

On first load my agent kanban needed initialising. On initialisation, the board editor tab should be immediately shown, but because the board hadn't been initialised it seemed it wasn't when initialisation was completed.

[agent]

## Plan

**Root cause:**

On a fresh workspace `_isInitialised` is `false`, so `openBoardIfInitialised()` (called at the end of `resolveWebviewView`) does nothing. When the user clicks "Initialise Agent Kanban", `doInitialise()` in `extension.ts` calls `boardViewProvider.setInitialised(true)`, which calls `refresh()` — but never calls `openBoardIfInitialised()`. Neither `resolveWebviewView` (already fired) nor `onDidChangeVisibility` (sidebar stays visible, no change) fire again, so the editor panel is never opened.

### Fix

**`src/BoardViewProvider.ts` — `setInitialised()`**

Add `vscode.commands.executeCommand('agentKanban.openBoard')` when `flag` is `true`:

```ts
setInitialised(flag: boolean): void {
    this._isInitialised = flag;
    this.refresh();
    if (flag) {
        vscode.commands.executeCommand('agentKanban.openBoard');
    }
}
```

That's the only change needed. `KanbanEditorPanel.createOrShow()` already handles the single-panel guard.

[user]

go

[agent]

## Implementation

Changed `src/BoardViewProvider.ts`:

1. **`window.addEventListener('focus', ...)` in `_getHtml()` script** — when the webview receives DOM focus (i.e. the Activity Bar icon is clicked in `"focus"` mode and VS Code shifts input focus to the sidebar), the webview posts a `focusSidebar` message to the extension host.

2. **`'focusSidebar'` case in `resolveWebviewView` message handler** — calls `agentKanban.openBoard` guarded by `_isInitialised`, bringing the editor panel to the foreground.

This covers the missing case: sidebar already visible, user navigates to a different editor tab, clicks the Activity Bar icon → sidebar gains focus → `window.focus` fires → board panel revealed.

All 143 tests pass.

[user]

Test feedback - that works for initialisation, but there is an issue:

If the user clicks the side nav icon, the board is correctly opened. If they click to another editor tab, the side bar is left open. When I click the side bar icon, the side nav is then removed, but I have to click again to open the side nav and board.

I think actually the correct behaviour is that if the side bar is already open when the sidebar icon is clicked, reopen the board rather than close the sidebar. If the user wants to navigate away from the Agent Kanban side bar, they click another sidebar icon. Is this possible?

[agent]

## Plan

**Root cause:**

VS Code's Activity Bar has a "toggle" behavior by default (`workbench.activityBar.iconClickBehavior = "toggle"`): clicking the already-active icon collapses the entire sidebar. Our `onDidChangeVisibility` only fires when visibility *becomes* `true`, so a toggle-closed event (visible → false) does nothing — the user must click a second time.

There is no VS Code extension API to intercept or override the Activity Bar icon click (the container toggle is handled internally by the workbench). We cannot distinguish "user clicked our icon to toggle" from "user clicked another sidebar icon to navigate away" via `onDidChangeVisibility` alone — both cause our `visible` to become `false`.

**The clean fix: `workbench.activityBar.iconClickBehavior: "focus"`**

VS Code supports a `"focus"` mode for the Activity Bar: clicking the already-active icon focuses the view *without* collapsing it. Clicking any other Activity Bar icon still navigates away normally. This is exactly the desired behaviour.

We set this in the workspace's `.vscode/settings.json` during extension initialisation (`doInitialise()`) and also on first activation when the workspace is already initialised. A merge-write is used so existing user settings are preserved.

**What changes:**

- `src/extension.ts` — extract a helper `ensureActivityBarFocusMode(workspaceFolder)` that reads `.vscode/settings.json`, sets `"workbench.activityBar.iconClickBehavior": "focus"`, and writes it back. Call it from both `doInitialise()` and the already-initialised startup path.
- No changes to `BoardViewProvider.ts` or `KanbanEditorPanel.ts`.

**Caveats:**
- This changes the Activity Bar behaviour for ALL icons (not just Agent Kanban), which is the correct and user-friendly outcome.
- The setting is visible in `.vscode/settings.json` — the user can revert it if they want the toggle behaviour back.
- If `.vscode/settings.json` doesn't exist yet, we create it.

[user]

Feedback:

That leaves the side bar open as requested, but it doesn't reopen the taskboard tab if the euser has navigated away

[agent]

## Plan

**Root cause:**

With `"focus"` mode, when the user clicks the Activity Bar icon and the sidebar is *already visible*, `onDidChangeVisibility` never fires (visibility doesn't change). So `openBoardIfInitialised()` is never triggered. The user can navigate to another editor tab while the sidebar stays open, then click the Activity Bar icon — nothing happens to the editor panel.

**Fix: use `agentKanban.openBoard` directly as the view's focus command**

VS Code `package.json` supports a `"when"` clause and a `"focusedView"` pattern, but more directly: we can register `agentKanban.openBoard` as the command that fires when the Activity Bar icon is clicked by setting it as the view container's activation command. However, the cleanest VS Code-idiomatic approach is:

Register `agentKanban.openBoard` as the **`view/title` command** for `agentKanban.boardView` using `menus` in `package.json`. But that adds a toolbar button, which we don't want.

**The right fix** is simpler: in `resolveWebviewView`, instead of only listening to `onDidChangeVisibility`, also listen to `webviewView.onDidChangeVisibility` for *focus* events. But `WebviewView` doesn't expose a focus event.

**Actual solution: register `agentKanban.openBoard` as the view's `focusedView` command via `package.json` `"onView:agentKanban.boardView"` activation event.**

Actually — the cleanest, guaranteed solution is to **also trigger `openBoard` from `onDidChangeVisibility` when `visible` stays `true` but the panel was previously revealed as hidden**. We can't do that without a focus event.

**The correct approach:** register `agentKanban.openBoard` in `package.json` under `"menus": { "view/title": [...] }` with `"group": "navigation"` — this adds an icon button to the sidebar header that reopens the board. But the user doesn't want extra buttons.

**The real correct approach:** Use `vscode.window.onDidChangeActiveTextEditor` or `vscode.window.onDidChangeWindowState` — no, those don't help.

**Simplest working solution:** Since `"focus"` mode means the sidebar stays visible, `onDidChangeVisibility` with `visible=true` only fires on the *first* click. For subsequent clicks (sidebar already visible), we need a different hook. The only available hook is registering the `agentKanban.boardView` view's **activation command** in `package.json` as `agentKanban.openBoard`. 

In `package.json`, add `"activationEvents": ["onView:agentKanban.boardView"]` — but that's an extension activation event, not a per-click event.

**Correct solution — `focusedView` command override:**

Registering [`agentKanban.openBoard`](src/extension.ts) as a command that is also bound to clicking the Activity Bar icon is not directly possible. However, VS Code *does* expose one mechanism that works: the `"workbench.action.focusActivityBarItem"` or similar — but these aren't stable APIs.

**The pragmatic fix** — after evaluating all options:

When `"focus"` mode is on, clicking the icon while the sidebar is open sends focus to the sidebar webview. The `WebviewView` API exposes `onDidChangeVisibility` but NOT a focus/activation event. However, the webview itself receives DOM focus. We can send a message from the webview's focus event to trigger `openBoard`.

**Plan:**
1. In `_getHtml()` sidebar script, add a `window.addEventListener('focus', ...)` that posts `{ type: 'focusSidebar' }`.
2. In `resolveWebviewView`, handle `'focusSidebar'` message by calling `openBoardIfInitialised()`.

This works because when the Activity Bar icon is clicked in `"focus"` mode, VS Code focuses the sidebar webview — triggering the `focus` event on the `window`.

[user]

go

[agent]

## Implementation

Changed `src/BoardViewProvider.ts`:

1. **`window.addEventListener('focus', ...)` in `_getHtml()` script** — when the webview receives DOM focus (i.e. the Activity Bar icon is clicked in `"focus"` mode and VS Code shifts input focus to the sidebar), the webview posts a `focusSidebar` message to the extension host.

2. **`'focusSidebar'` case in `resolveWebviewView` message handler** — calls `agentKanban.openBoard` guarded by `_isInitialised`, bringing the editor panel to the foreground.

This covers the missing case: sidebar already visible, user navigates to a different editor tab, clicks the Activity Bar icon → sidebar gains focus → `window.focus` fires → board panel revealed.

All 143 tests pass.

[user]

