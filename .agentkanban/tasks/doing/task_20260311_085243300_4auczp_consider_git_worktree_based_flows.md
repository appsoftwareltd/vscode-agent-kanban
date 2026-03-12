---
title: Consider Git worktree based flows
created: 2026-03-11T08:52:43.300Z
updated: 2026-03-12T15:57:52.594Z
description: Consider how this could help with isolation and retention of use of a single task
sortOrder: 2
slug: "consider_git_worktree_based_flows\r"
---



## Conversation

[user]

Consider how this could help with isolation and retention of use of a single task:

Currently we keep the current task file in agent context by using /task /plan (etc) @participant commands - these commands find and reinsert the task file reference into the context. The AGENTS.md has a sentinel section that references core INSTRUCTIONS.md, and a glob reference to the task file name format. These disparate instruction sets work together to tell the agent that it a) needs to work according to the plan, todo, implement flow, and b) needs to converse in the specific task file.

The combination of files is set up like it is mainly because we can't directly edit the AGENTS.md with the task file while working in the same directory because it would prevent working on more than one task at the same time. If the agents files are version controlled, it could also affect other developers on the same team.

If we were to link the tasks on the task boards to work trees - maybe requiring dedicated work trees and branches, and assisting with the automation / creation of those work trees, then we might be free-er to edit the main AGENTs.md - with a larger sentinel section referencing the specific task file and the full INSTRUCTIONS.md set.

Look at options regarding how we could automate and enforce the use of git worktrees on a per task basis.

[agent]

## Plan: Git Worktree Integration for Agent Kanban

### Problem Analysis

The current approach has two structural tensions:

1. **Context ambiguity**: The `AGENTS.md` sentinel intentionally does not reference a specific task file (it uses a glob `tasks/**/*.md`). This avoids locking the sentinel to one task, but it means the agent has to guess which task is active and context decays in long conversations.

2. **Shared workspace constraint**: Since all tasks live in the same directory, multiple developers (or simultaneous tasks) would stomp on each other's `AGENTS.md` sentinel if it held a specific task reference.

Git worktrees elegantly solve both: each worktree is a separate checkout of the repo with its own working directory, so its `AGENTS.md` can freely name the specific task file without affecting anyone else. The agent always knows exactly which task is active because `AGENTS.md` is injected on every turn by VS Code and points directly to the task file.

---

### How Git Worktrees Help

| Problem | Current approach | With worktrees |
|---|---|---|
| Agent forgets active task | Re-inject via `/plan`, `/todo`, `/implement` | `AGENTS.md` permanently names the task file — always in system prompt |
| Multiple devs conflict | Can't name specific task in `AGENTS.md` | Each worktree has its own `AGENTS.md` — no conflict |
| Multiple simultaneous tasks | Need separate chat windows | Each worktree is a different folder — VS Code opens each separately |
| Branch isolation | Manual | Worktree creation = branch creation |

---

### Proposed Design

#### 1. Worktree Naming Conventions

- **Branch**: `agentkanban/<task-id>-<slug>` (e.g. `agentkanban/20260311_085243_4auczp_oauth2`)
- **Worktree path**: configurable; default sibling folder `../<repo-name>-tasks/<task-id>/`
- **Created from**: current HEAD of main/master (or configurable base branch)

#### 2. Enhanced `AGENTS.md` Sentinel in Worktree

When a worktree is created for a task, the sentinel in *that worktree* becomes richer:

```markdown
<!-- BEGIN AGENT KANBAN — DO NOT EDIT THIS SECTION -->
## Agent Kanban

**Active Task:** Consider Git worktree based flows
**Task File:** `.agentkanban/tasks/todo/task_20260311_085243300_4auczp_consider_git_worktree_based_flows.md`

Read the task file above before responding.
Read `.agentkanban/INSTRUCTION.md` for task workflow rules.
Read `.agentkanban/memory.md` for project context.
<!-- END AGENT KANBAN -->
```

The task file path is absolute/relative within the worktree — the `.agentkanban/tasks/` directory exists in every checkout because it is version-controlled.

#### 3. `.agentkanban/tasks/` in Git

Task files **must be committed** (or at least staged) before a worktree is created, so the new branch contains the task file. The extension should:
- Warn if the task file is not yet tracked in git
- Offer to stage + commit it automatically (with a sensible commit message)

#### 4. Worktree Metadata in Task Frontmatter

Store the worktree association in the task file's YAML frontmatter:

```yaml
worktree:
  branch: agentkanban/20260311_085243_4auczp_oauth2
  path: ../my-repo-tasks/20260311_085243_4auczp_oauth2
  created: 2026-03-11T09:00:00.000Z
```

This lets the board display a "worktree" badge on linked cards and enables cleanup.

#### 5. New Commands

| Command | Description |
|---|---|
| `@kanban /worktree` | Create a git worktree for the current task, open in new VS Code window |
| `@kanban /worktree open` | Open an existing task worktree in a new VS Code window |
| `@kanban /worktree remove` | Remove the worktree (after task is done) |

Or alternatively, integrate into existing commands — a "Open in Worktree" button appears in the follow-up options after `/task` selects a task, and on the Kanban card.

#### 6. UI: Kanban Board Badges

- Cards with an associated worktree show a small branch/worktree icon
- Clicking the icon opens the worktree in a new VS Code window (using `vscode.openFolder`)
- Cards without a worktree show an "Add worktree" action in the card menu

#### 7. Lifecycle

| Task event | Worktree action |
|---|---|
| Task created | No worktree yet — opt-in |
| `/worktree` command | Create branch + worktree; write specific `AGENTS.md`; open in new window |
| Task moved to Done | Prompt: "Remove worktree for this task?" |
| Task archived | Same as Done |
| Worktree removed manually | Extension detects missing worktree; clears frontmatter metadata |

#### 8. Non-Git Workspaces

If the workspace is not a git repo, the worktree feature is silently unavailable (no buttons, no commands). The existing flow continues to work unchanged.

---

### Options Considered

**Option A — Fully automatic (worktree on every task)**
- Every `/new` task automatically creates a worktree
- Pro: clean isolation by default
- Con: forces git discipline, heavy for small repos, surprising UX

**Option B — Opt-in per task (recommended)**
- Worktree creation is explicit via `/worktree` command or board button
- Pro: no surprises; existing flow still works; gradual adoption
- Con: one extra step

**Option C — Workspace setting: require worktrees**
- A setting `agentkanban.enforceWorktrees: true` makes worktree creation mandatory before `/plan`
- Pro: enforces team discipline
- Con: more opinionated, harder to onboard

**Recommendation:** Implement Option B with an optional setting for Option C. The extension should guide users toward worktrees but not require them.

---

### Implementation Phases

**Phase 1 — Core worktree infrastructure**
- `WorktreeService`: wraps `git worktree add`, `git worktree remove`, `git branch`
- Task frontmatter: `worktree` field (read/write via `TaskStore`)
- `syncAgentsMdSection()`: detect if running in a worktree-linked folder; write richer sentinel if so

**Phase 2 — Chat participant commands**
- `/worktree` command in `ChatParticipant`
- Opens worktree in new VS Code window after creation

**Phase 3 — Board UI**
- Worktree badge on Kanban cards
- "Open in Worktree" / "Create Worktree" card actions

**Phase 4 — Lifecycle management**
- Prompt on task completion
- Handle stale worktree metadata

---

### Key Questions to Resolve Before Implementation

1. Should the worktree directory live inside the repo (e.g. `../<repo>-tasks/`) or be configurable? [comment] It should probably be configurable - is it the root directory that would be the config option?
2. Should task files be auto-committed when creating a worktree, or just require they exist in git? [comment] They should be committed. If we can notify the user I think that is necessary
3. Should `/worktree` always open a new VS Code window, or offer to open in the current window? [comment] Default to current, but make the behaviour configurable
4. Should the enhanced `AGENTS.md` sentinel in the worktree also be written to the main repo (as a no-op fallback)?

[comment] No, and we want to avoid the AGENTS.md from being committed as it will have changes specific to the task. How do we avoid that?

---

Ready to generate TODOs and proceed to implementation. Your call on the questions above — or I can proceed with sensible defaults.

[agent]

### Responses to Comments

**Q1 — Worktree directory location:**
Agreed — configurable. The setting would be the **root directory** where all worktrees are created (e.g. `agentkanban.worktreeRoot`). Default: `../<repo-name>-worktrees/`. Each task gets a subdirectory named by task ID + slug within that root. Example:

```
Setting: agentkanban.worktreeRoot = "../my-project-worktrees"
Result:  ../my-project-worktrees/20260311_085243_4auczp_oauth2/
```

**Q2 — Auto-commit task files:**
Agreed. Before creating the worktree, the extension will:
1. Check if `.agentkanban/tasks/` files are tracked
2. If untracked/modified: stage & commit with message like `agentkanban: add task <title>`
3. Show VS Code notification: "Committed task file before creating worktree"
4. Surface errors clearly if the commit fails (e.g. merge conflicts)

**Q3 — Window behavior:**
Understood. Default: open in current window. Setting: `agentkanban.worktreeOpenBehavior: "current" | "new"`. The `/worktree` command will respect this, and the board UI button could offer both options via a quick pick.

**Q4 — Avoiding AGENTS.md being committed in the worktree:**

This is the critical design constraint. The enhanced `AGENTS.md` sentinel (with the specific task file path) must be present in the worktree's working directory for VS Code to inject it, but it **must not be committed** to the branch. Options:

**Option 4a — `.gitignore` the AGENTS.md in worktrees (not viable)**
We can't gitignore `AGENTS.md` only in worktrees — `.gitignore` is version-controlled and would affect the main repo too.

**Option 4b — `git update-index --skip-worktree AGENTS.md`**
After creating the worktree and writing the enhanced sentinel, run:
```
git update-index --skip-worktree AGENTS.md
```
This tells git to treat the local `AGENTS.md` as unchanged, even though it has task-specific content. It survives across sessions. When the worktree is removed, the flag goes with it.

- Pro: clean, no risk of accidental commit, git-native
- Con: it's a per-clone git flag — if the user runs `git status` they won't see `AGENTS.md` as modified (but that's actually what we want)

**Option 4c — Use `.git/info/exclude` in the worktree**
Each worktree has its own `.git` file pointing to the main repo's `.git/worktrees/<name>/`. We could add `AGENTS.md` to the worktree's local exclude file (`<worktree>/.git/info/exclude` or equivalent). However, worktrees share the main `.git/info/exclude`, so this gets messy.

**Option 4d — Write to a separate file (e.g. `.agents.md`) and use `.gitignore`**
Instead of modifying `AGENTS.md`, write the enhanced task-specific instructions to a separate file like `.agentkanban/.agents-worktree.md` and add it to `.gitignore`. But then VS Code won't auto-inject it — it needs to be `AGENTS.md` specifically.

**Recommendation: Option 4b — `--skip-worktree`** [comment] Agreed

This is the cleanest approach. The extension workflow becomes:
1. Create worktree + branch
2. Write enhanced `AGENTS.md` sentinel (with specific task file)
3. Run `git update-index --skip-worktree AGENTS.md`
4. Open worktree folder in VS Code

When the worktree is cleaned up:
1. Remove `--skip-worktree` flag (or just nuke the worktree — flag is local)
2. Run `git worktree remove`

The user's main repo `AGENTS.md` stays untouched. The worktree `AGENTS.md` has the task-specific sentinel but git ignores the local changes. If the user accidentally tries to commit, `AGENTS.md` won't appear in staging.

One edge case: if the main repo's `AGENTS.md` is updated (e.g. sentinel change on extension update), the worktree won't pick it up automatically because of the skip flag. We can handle this by re-syncing the sentinel whenever the extension activates in a worktree — combining the main content with the task-specific section and re-writing. [comment] Good catch

---

### Revised Design Summary

With your feedback incorporated:

| Aspect | Decision |
|---|---|
| Worktree location | Configurable root (`agentkanban.worktreeRoot`), default `../<repo>-worktrees/` |
| Task file commit | Auto-commit before worktree creation, notify user |
| Window behavior | Default: current window. Setting: `agentkanban.worktreeOpenBehavior` |
| AGENTS.md protection | `git update-index --skip-worktree AGENTS.md` in worktree |
| Adoption model | Opt-in (Option B), with optional enforce setting (Option C) |

Plan is complete. Ready for `/todo` to generate the implementation checklist.

[agent]

## TODO: Implementation Checklist

### Phase 1 — Core Infrastructure

- [x] **1.1** Add `WorktreeInfo` interface to `types.ts` (branch, path, created fields)
- [x] **1.2** Add `worktree?` optional field to `Task` interface in `types.ts`
- [x] **1.3** Update `TaskStore.serialise()` to write `worktree` field to frontmatter
- [x] **1.4** Update `TaskStore.deserialise()` to read `worktree` field from frontmatter
- [x] **1.5** Create `WorktreeService` class (`src/WorktreeService.ts`):
  - Git detection (`isGitRepo()`)
  - Auto-commit task files before worktree creation
  - `create(taskId, taskTitle)` → creates branch + worktree in configured root
  - `remove(taskId)` → removes worktree + optional branch cleanup
  - `list()` → returns active worktrees
  - `getForTask(taskId)` → returns worktree info if exists
  - `openInVSCode(worktreePath)` → opens folder in current/new window
  - `--skip-worktree` flag management for AGENTS.md
- [x] **1.6** Add VS Code settings to `package.json`:
  - `agentKanban.worktreeRoot` (string, default `"../{repo}-worktrees"`)
  - `agentKanban.worktreeOpenBehavior` (`"current"` | `"new"`, default `"current"`)
  - `agentKanban.enforceWorktrees` (boolean, default `false`)

### Phase 2 — AGENTS.md Enhancement

- [x] **2.1** Enhance `syncAgentsMdSection()` in `ChatParticipant`: detect if workspace is a task worktree, if so write richer sentinel with specific task file path + title
- [x] **2.2** On extension activation in a worktree: re-sync sentinel (handles main repo updates to AGENTS.md)

### Phase 3 — Chat Participant Commands

- [x] **3.1** Register `/worktree` command in `package.json` chat participant commands
- [x] **3.2** Add `handleWorktree()` in `ChatParticipant`:
  - No subcommand → create worktree for selected task
  - `open` → open existing worktree
  - `remove` → remove worktree
- [x] **3.3** Auto-commit task files before worktree creation (via WorktreeService)
- [x] **3.4** Show notification on commit + worktree creation
- [x] **3.5** If `enforceWorktrees` is true, verb commands (`/plan`, `/todo`, `/implement`) check for worktree and prompt to create one

### Phase 4 — Board UI

- [x] **4.1** Add `createWorktree` and `openWorktree` message types to webview ↔ extension protocol
- [x] **4.2** Handle `createWorktree` and `openWorktree` messages in `KanbanEditorPanel`
- [x] **4.3** Add worktree badge/icon to card HTML in `board.ts` (branch icon when `task.worktree` exists)
- [x] **4.4** Add "Create Worktree" / "Open Worktree" actions to card menu in `board.ts`

### Phase 5 — Lifecycle

- [x] **5.1** When task moves to Done/Archive: prompt "Remove worktree?" via VS Code notification
- [x] **5.2** On extension activation: check for stale worktree metadata (worktree path doesn't exist) → clear frontmatter

### Phase 6 — Tests

- [x] **6.1** Unit tests for `WorktreeService` (git command mocking)
- [x] **6.2** Unit tests for `TaskStore` serialise/deserialise with `worktree` field
- [x] **6.3** Unit tests for enhanced `syncAgentsMdSection()` worktree detection
- [x] **6.4** Unit tests for `/worktree` command in `ChatParticipant`

---

Proceeding to implementation.

[user]

OK, implement 5.1 - if you can detect if the work tree is there?

We need to be able to select task by title portion characters rather than full title. If the characters the user types uniquely match part of a title on case insensitive alphanumeric character match - select that task. Currently it requires the full title, or seems to to match

We also need to be able to select task by slug. We are using the slug in the task file title and likely in this git  worktree / branch workflow also. I think we should add it to the front matter so it's easy for the user to see, copy if they need to. The slug will stay fixed once the task is created.

[agent]

## Plan: Remaining items (5.1, task matching, slug frontmatter)

Three changes requested:

### A. Worktree removal prompt on task Done/Archive (item 5.1)

**Hook point:** `KanbanEditorPanel.ts` `moveTask` handler (line ~231) and `archiveTask` handler (line ~423).

When a task moves to `done` or `archive` and `task.worktree` exists:
1. Check if worktree path still exists on disk via `WorktreeService.exists()`
2. If yes, show `vscode.window.showInformationMessage` with "Yes" / "No" buttons: *"Task has a git worktree at `<path>`. Remove it?"*
3. If user clicks "Yes": call `WorktreeService.remove(task.worktree)`, clear `task.worktree`, save task
4. If user clicks "No" or dismisses: do nothing (worktree stays, metadata stays)
5. If worktree path doesn't exist: silently clear stale metadata

The prompt is non-blocking — the lane move happens immediately, the worktree removal is best-effort.

### B. Fuzzy alphanumeric task matching in `resolveTaskFromPrompt`

Current matching cascade:
1. Exact title prefix (case-insensitive)
2. Title substring (longest wins)
3. First word partial

**New matching step** — insert between step 2 and step 3:

**Alphanumeric subsequence match:** Strip both the query and each task title down to lowercase alphanumeric characters only (`[^a-z0-9]` → removed). If the stripped query is a **substring** of the stripped title, it's a match. Longest title match wins (to avoid ambiguity). If multiple titles match equally after stripping, reject (ambiguous) — fall through to next step.

Example: query `"gtwt"` matches `"Git Worktree"` → stripped forms: `gtwt` vs `gitworktree` → `gtwt` is NOT a substring of `gitworktree`. So simple substring won't work for abbreviation-style matching.

Better approach: **case-insensitive alphanumeric-only `includes` match** — the user types a portion of the title (contiguous characters after stripping non-alnum). `"worktree"` matches `"Consider Git worktree based flows"` because `"worktree"` is a substring of `"considergitworktreebasedflows"`.

This covers the core use case: user types a recognisable portion of the title without needing exact spacing/punctuation.

### C. Slug in task frontmatter

The task ID already contains the slug: `task_YYYYMMDD_HHmmssfff_XXXXXX_<slug>`. We need to:

1. Add `slug?: string` to `Task` interface in `types.ts`
2. In `createTask()`: extract the slug from the generated ID and set `task.slug = slug`
3. In `serialise()`: write `slug:` to frontmatter (only when present)
4. In `deserialise()`: read `slug:` from frontmatter
5. In `resolveTaskFromPrompt()`: add a **slug match** step early in the cascade — if the query exactly matches a task's slug (case-insensitive), select it immediately. This goes before all other matching.
6. Also add slug matching in `findByTitle()` so the suggestion fallback can find by slug too.

**Backward compatibility:** Existing tasks created before this change won't have a `slug` in frontmatter. When loading such a task, extract the slug from the task ID (everything after the 3rd `_` group). Add a `static extractSlugFromId(id: string): string` helper.

[comment] Yes and save it in the file? Following this task selection should be possible on slug match as well as title.

### Test plan

- TaskStore: serialise/deserialise round-trip with slug field
- TaskStore: `extractSlugFromId` for various ID formats
- ChatParticipant: `resolveTaskFromPrompt` with alphanumeric fuzzy match
- ChatParticipant: `resolveTaskFromPrompt` with slug match
- KanbanEditorPanel: moveTask to done prompts for worktree removal (mock WorktreeService)


[user]

See comments

Is task going to be used to create / select the worktree?

[agent]

### Responses

**Comment on C — slug in file + slug-based selection:**

Yes — the slug will be saved in frontmatter, and task selection will work by slug. The plan already covers this (C items 2-6), but to be explicit:

- `createTask()` will set `task.slug` from the generated ID
- `serialise()` writes `slug:` to frontmatter YAML
- `deserialise()` reads it back; for backward compat, `extractSlugFromId()` recovers the slug from the task ID for existing tasks that lack the field
- `resolveTaskFromPrompt()` gets a **slug match step** as the first/highest priority — if the user's query exactly matches a slug (case-insensitive), that task is selected immediately. This works in `/task`, verb commands, and anywhere `resolveTaskFromPrompt` is called
- `findByTitle()` also checks slug so the suggestion fallback can surface slug matches

After implementation, all of these will select the task: `@kanban /task consider_git_worktree_based_flows`, `@kanban /task worktree`, `@kanban /task Consider Git worktree based flows`.

**Question — "Is `/task` going to be used to create / select the worktree?"**

Currently `/task` selects the task and offers follow-up buttons (including "Create Worktree" / "Open Worktree"). The actual creation/opening is delegated to `/worktree`. The `/task` handler doesn't mention worktree status in its output at all.

I think we should enhance `/task` to be **worktree-aware** without taking over `/worktree`'s job:

1. **Show worktree status:** When `/task` selects a task that has a worktree, include it in the output: *"Worktree: `<path>` (branch `<branch>`)"*. If we're not currently in that worktree's folder, add: *"Use the follow-up button or `@kanban /worktree open` to switch to the worktree."*

2. **Follow-up buttons (already in place):** After `/task`, the follow-ups already include "Create Worktree" (when no worktree) or "Open Worktree" (when one exists). No change needed here.

3. **Enforce gate (already in place):** When `enforceWorktrees` is `true`, verb commands (`/plan`, `/todo`, `/implement`) already block and require a worktree. The `/task` command itself should NOT block — selection is always allowed. But it could add a hint: *"⚠️ Worktree enforcement is on. Create a worktree before using verb commands."*

4. **No auto-open:** `/task` should NOT automatically open the worktree folder — that would be surprising and would change the user's VS Code window unexpectedly. The explicit `/worktree open` or follow-up button keeps control with the user.

### Updated Plan

Incorporating all feedback, here's the complete implementation plan:

#### A. Worktree removal prompt on Done/Archive (item 5.1)

**Files:** `KanbanEditorPanel.ts`

- `moveTask` handler (line ~231): After `moveTaskToLane()`, if `newLane` is `done` or `archive` and `task.worktree` exists, check `WorktreeService.exists()`. If exists → show info message "Remove worktree at `<path>`?" with Yes/No. Yes → `WorktreeService.remove()` + clear `task.worktree` + save. No → keep as-is. Lane move is not blocked.
- `archiveTask` handler (line ~473): Same logic — after `moveTaskToLane('archive')`, check worktree and prompt.
- Extract a shared helper `promptWorktreeRemoval(task)` to avoid duplication.

#### B. Fuzzy alphanumeric task matching

**Files:** `ChatParticipant.ts`

New step in `resolveTaskFromPrompt()` cascade, inserted between step 2 (title substring) and step 3 (first word partial):

- Strip both query and title to lowercase alphanumeric only (`replace(/[^a-z0-9]/g, '')`)
- Check if stripped query is a **substring** of the stripped title
- Longest stripped title match wins; if ambiguous → fall through
- Example: query `"worktree"` → stripped `"worktree"` → matches `"considergitworktreebasedflows"` ✓

Also update `findByTitle()` to use the same alphanumeric matching logic so suggestions work consistently.

#### C. Slug in frontmatter + slug-based selection

**Files:** `types.ts`, `TaskStore.ts`, `ChatParticipant.ts`

1. Add `slug?: string` to `Task` interface
2. `createTask()`: extract slug from generated ID, set `task.slug`
3. `serialise()`: write `slug:` to frontmatter
4. `deserialise()`: read `slug:`; if missing, recover via `extractSlugFromId()`
5. Add `extractSlugFromId(id: string): string` static helper
6. `resolveTaskFromPrompt()`: add slug match as **first step** in cascade (exact slug match, case-insensitive)
7. `findByTitle()`: also check slug field

#### D. `/task` worktree awareness

**Files:** `ChatParticipant.ts`

In `handleTask()`, after the "Working on task" output (line ~455):

1. If `task.worktree` exists: output worktree path and branch
2. If `enforceWorktrees` is on and no worktree: add hint about needing one
3. No auto-open, no blocking — just informational

#### E. Tests

- **TaskStore:** slug serialise/deserialise, `extractSlugFromId`, backward compat (no slug in frontmatter)
- **ChatParticipant:** `resolveTaskFromPrompt` with slug match, alphanumeric fuzzy match, ambiguous cases
- **ChatParticipant:** `/task` worktree status in output
- **KanbanEditorPanel:** moveTask/archiveTask worktree removal prompt (mock WorktreeService + `vscode.window.showInformationMessage`)

---

Ready for `/todo` to generate the implementation checklist, or `/implement` to begin.

[agent]

## TODO: Iteration 2 — Checklist

### A. Slug in frontmatter

- [x] **A.1** Add `slug?: string` to `Task` interface in `types.ts`
- [x] **A.2** Add `extractSlugFromId(id: string): string` static helper to `TaskStore`
- [x] **A.3** `createTask()`: set `task.slug` from generated ID
- [x] **A.4** `serialise()`: write `slug:` to frontmatter
- [x] **A.5** `deserialise()`: read `slug:` from frontmatter; fall back to `extractSlugFromId()` for backward compat

### B. Task matching improvements

- [x] **B.1** Add slug match as **first step** in `resolveTaskFromPrompt()` (exact slug, case-insensitive)
- [x] **B.2** Add alphanumeric fuzzy match step (after title substring, before first-word partial)
- [x] **B.3** Update `findByTitle()` to also match against slug

### C. `/task` worktree awareness

- [x] **C.1** In `handleTask()`: show worktree status when task has a worktree
- [x] **C.2** In `handleTask()`: show enforce hint when `enforceWorktrees` is on and no worktree

### D. Worktree removal prompt (5.1)

- [x] **D.1** Add `promptWorktreeRemoval()` helper to `KanbanEditorPanel`
- [x] **D.2** Hook into `moveTask` handler: prompt when moving to `done`/`archive`
- [x] **D.3** Hook into `archiveTask` handler: prompt on archive

### E. Tests

- [x] **E.1** TaskStore: `extractSlugFromId`, slug serialise/deserialise round-trip, backward compat
- [x] **E.2** ChatParticipant: `resolveTaskFromPrompt` slug match + alphanumeric fuzzy match
- [x] **E.3** ChatParticipant: `/task` worktree status output
- [x] **E.4** KanbanEditorPanel: moveTask/archiveTask worktree removal prompt

---

Proceeding to implementation.

[user]

Test feedback:

The work tree can created via the task command or via the button on the task, however:

- With an uncommitted task file, the user was not prompted to commit it, nor was it committed
- The AGENTS.md in the resulting worktree looked unchanged and did not reference the specific task file.
- We shold no longer need /plan /todo /implement @kanband commands once this works

[agent]

## Plan: Fixing the Three Issues

I investigated the full worktree creation flow end-to-end. Here's what I found:

### Issue 1: Task file not auto-committed

The `WorktreeService.create()` **does** call `autoCommitTaskFiles()` which runs `git status --porcelain -- .agentkanban/` and commits if there are changes. However, there are two possible failure modes:

- **Git identity not configured**: `git commit` will fail silently if `user.name`/`user.email` aren't set. The error is caught and logged but the user gets no feedback.
- **The task file may not have been saved to disk yet**: If the task was just created in memory and `save()` hasn't flushed to disk, `git status` won't detect it.

**Debugging needed**: I need to check if the issue is that `autoCommitTaskFiles` is failing silently, or if there's a timing issue. Was this tested via the chat command (`@kanban /worktree`) or the board button? The board button path (`KanbanEditorPanel.createWorktree`) calls `WorktreeService.create()` which calls `autoCommitTaskFiles()`, so both paths should auto-commit.

**Likely root cause**: The `autoCommitTaskFiles()` error handling catches all exceptions silently. If git operations fail, the worktree is created anyway without the commit. We should surface errors instead.

### Issue 2: AGENTS.md not task-specific in worktree

**Root cause found**: The `KanbanEditorPanel` `'createWorktree'` handler **does NOT call `writeWorktreeAgentsMd()`**. Only the ChatParticipant `handleWorktreeCreate()` path writes the enhanced AGENTS.md. So:

- `@kanban /worktree` → ✅ Writes task-specific AGENTS.md  
- Board button → ❌ Does NOT write task-specific AGENTS.md

Additionally, even via the chat path, there's a sequencing issue:
1. `WorktreeService.create()` sets `--skip-worktree` on AGENTS.md
2. Then `writeWorktreeAgentsMd()` tries to write the enhanced AGENTS.md
3. But `--skip-worktree` only prevents git from tracking changes — it doesn't prevent writing. So that should work.
4. **However**, the `--skip-worktree` is set on the AGENTS.md **as it exists in the new worktree at checkout time** (i.e. the base branch version). The `writeWorktreeAgentsMd` writes a modified version. But `--skip-worktree` needs to be set **after** writing, not before, because the flag tells git "treat the current working copy as unchanged". The current order should actually be fine since write happens after the flag — git won't see the change. Let me check if the flag survives a file write...

Actually, `--skip-worktree` is a git index flag — it persists regardless of file content changes. So the order doesn't matter for the flag itself. The real problem is the board button path not calling `writeWorktreeAgentsMd()` at all.

There's also a second issue: `syncWorktreeAgentsMd()` runs on extension activation (in `extension.ts`), which should fix AGENTS.md when VS Code opens the worktree folder. BUT this only works if the task's `worktree.path` matches the current workspace path. This should work **if** the task is loaded (which it should be, since `.agentkanban/tasks/` is in the worktree checkout).

**Fix needed**:
1. Move `writeWorktreeAgentsMd` logic to be accessible from `KanbanEditorPanel` (or call it from both places)
2. Ensure `syncWorktreeAgentsMd()` is also triggering correctly on activation in the worktree workspace

### Issue 3: /plan /todo /implement should become unnecessary

The user's point is that once the worktree AGENTS.md correctly references the specific task file, the agent always has context — so the verb commands are just re-injecting context that's already permanently injected via AGENTS.md.

This is correct for worktree-mode. However:
- Verb commands still serve a purpose in **non-worktree** workflows (the default)
- We should keep them but make them optional in worktree mode
- In the near term, the fix is just making the worktree AGENTS.md work correctly — the verb commands continue to work alongside it

**No code changes needed for this issue** — once issues 1 and 2 are fixed, the worktree AGENTS.md will always reference the task file, making verb commands redundant (but still available) in worktree mode.

### Summary of Required Fixes

1. **Auto-commit**: Improve error handling in `autoCommitTaskFiles()` — surface errors to user, don't silently swallow failures
2. **Board button path**: Extract `writeWorktreeAgentsMd` into a shared utility so both ChatParticipant and KanbanEditorPanel can call it after worktree creation
3. **Activation sync**: Verify `syncWorktreeAgentsMd()` correctly detects worktree workspaces — add logging to trace the path matching

[user] Agreed

However we can consolidate /plan /todo /implement down to "/refresh" as they all essentially do the same thing - remind the agent of the working file - so the output from the command can be more generic too for refresh

Implement and document the alternate workflows in README.md

[agent]

## Plan: Iteration 3 — Fix Worktree Bugs + /refresh Command

Four work areas:

### 1. Fix: Board button doesn't write task-specific AGENTS.md

The `KanbanEditorPanel` `createWorktree` handler (line ~492) calls `WorktreeService.create()` but never calls `writeWorktreeAgentsMd()`. That method lives on `ChatParticipant` and is private.

**Fix**: Move the AGENTS.md writing logic so `KanbanEditorPanel` can use it. Two options:
- **Option A**: Move `writeWorktreeAgentsMd` and `buildWorktreeAgentsMdSection` to a shared module (e.g. export from `ChatParticipant.ts` or a new utility).
- **Option B**: Move the function to `WorktreeService` itself — after all, writing the enhanced AGENTS.md is part of worktree lifecycle.

**Recommendation**: Option B — `WorktreeService` already handles worktree creation and `--skip-worktree`. Adding the AGENTS.md write there keeps the lifecycle in one place. The sentinel constants (`AGENTS_MD_BEGIN`, `AGENTS_MD_END`) and `buildWorktreeAgentsMdSection()` should move to a shared location (or be exported from `ChatParticipant.ts`).

Actually, better: extract the sentinel constants and `buildWorktreeAgentsMdSection` into a small shared module (or export them from `ChatParticipant.ts`), then have `WorktreeService.create()` call the AGENTS.md write as the final step. This way both the chat and board paths get it for free — it happens inside `create()`.

**Implementation**:
1. Export `AGENTS_MD_BEGIN`, `AGENTS_MD_END`, `AGENTS_MD_REL_PATH`, `buildWorktreeAgentsMdSection` from `ChatParticipant.ts` (or move to a shared module)
2. Add a `writeWorktreeAgentsMd(taskTitle, taskRelPath)` method to `WorktreeService`
3. Call it at the end of `WorktreeService.create()`, passing the task title and rel path
4. `WorktreeService.create()` signature gains `taskRelPath: string` parameter
5. Remove the `writeWorktreeAgentsMd` call from `ChatParticipant.handleWorktreeCreate()` (it's now handled by `create()`)
6. Update `KanbanEditorPanel.createWorktree` handler to pass `taskRelPath` to `create()`

### 2. Fix: Auto-commit error handling

`autoCommitTaskFiles()` doesn't propagate errors — if `git add` or `git commit` fails, the worktree is created without the task files being committed.

**Fix**: Let errors propagate from `autoCommitTaskFiles()`. If the commit fails, the worktree creation should fail too — or at minimum warn the user clearly.

**Implementation**:
1. Wrap `autoCommitTaskFiles()` in a try/catch at the call site in `create()`, but re-throw with a user-friendly message
2. Add error details to the notification (e.g. "git commit failed: ...")

### 3. New: `/refresh` command (consolidates /plan /todo /implement)

The verb commands all do the same thing: re-inject the task file + INSTRUCTION.md into context. In worktree mode this is redundant since AGENTS.md permanently references the task. But for non-worktree mode, a generic "refresh context" is still useful.

**Implementation**:
1. Add `refresh` command to `package.json` `chatParticipants` commands
2. Add `case 'refresh':` in `handleRequest` routing → calls `handleVerb(['refresh'], prompt, response)`
3. The `handleVerb` method already works generically — just adjust the output text. When `verbs` contains `'refresh'`, use a generic label like "REFRESH" instead of "PLAN + TODO + IMPLEMENT"
4. Keep `/plan`, `/todo`, `/implement` as aliases for now (backward compat) — they all route to the same `handleVerb` logic
5. Update the `Verb` type to include `'refresh'`

### 4. README.md updates

**Add Git Worktree section**:
- Explain the worktree workflow: `@kanban /task <name>` → `@kanban /worktree` → VS Code opens worktree → AGENTS.md auto-references the task file → agent always has context
- Explain that `/refresh` (or the legacy `/plan`, `/todo`, `/implement`) re-injects context on demand
- Document the three settings: `worktreeRoot`, `worktreeOpenBehavior`, `enforceWorktrees`
- Explain `--skip-worktree` protection of AGENTS.md

**Update Chat Commands table**: Add `/refresh` and `/worktree` rows

**Update Getting Started**: Mention worktree as an alternative workflow

[user] Agree with recommendations

[user]

Test feedback:

I do not want to keep `/plan`, `/todo`, `/implement`

Update the README accordingly.

Task files are still not committed in the new work tree. AGENTS.md remains unchanged in the new worktree


[user]

> Re: the worktree bugs (task files not committed, AGENTS.md unchanged): the code is correct — investigation in the prior session found zero worktreeService log entries, meaning the extension wasn't reloaded after the last build. After this build, please run Developer: Reload Window (Ctrl+Shift+P → "Reload Window") to pick up the new extension code, then test /worktree again.

OK - I can see the agent file is updated now

The uncommited task file is still not committed

If we are in a worktree with the agents.md modifications applied - /task should run, but remind the user that they dont need to run it unless they temporarilily want to switch to another task (say in another copilot thread)

[agent]

## Plan: Iteration 4 — Fix Auto-Commit + Worktree-Aware /task + INSTRUCTION.md Update

### Investigation Summary

I traced through the full auto-commit code path and investigated the git state:

- `git status --porcelain -- .agentkanban/` **does** show modified task files in the current workspace
- git identity is configured (user.name + user.email)
- No staged conflicts
- `.agentkanban/` is NOT gitignored (only `logs/` within it)
- **No** `agentkanban:` commit messages exist in the log — the auto-commit has **never succeeded**

The existing worktree at `worktree-test` was created at commit `3219ccf` (before the worktree feature code existed), so it was never a valid test of the auto-commit path.

### Root Cause Analysis: Auto-Commit

The code looks correct on paper but there are three likely failure modes I identified:

1. **Race condition with task file save:** When the user creates a task and immediately runs `/worktree`, the task file may not yet be flushed to disk by VS Code's filesystem layer. `git status` then sees nothing new.

2. **Swallowed commit failure:** `autoCommitTaskFiles` logs warnings via `this.logger.warn()` — but if logging isn't enabled, these vanish. The caller catches the error and shows a `showWarningMessage`, but VS Code warning messages can be easily missed (they appear briefly in the corner).

3. **git add .agentkanban/ is too broad:** Staging the entire `.agentkanban/` directory means the commit could include INSTRUCTION.md, board.yaml, memory.md, and other managed files that happen to be dirty. If those files are currently being written by the extension (race), `git add` could stage a partial write.

### Fix Plan

#### A. Make auto-commit more targeted and robust

**Files:** `WorktreeService.ts`

1. **Target the specific task file:** Instead of `git add .agentkanban/`, add only the specific task file and its todo file. Pass `taskRelPath` to `autoCommitTaskFiles()`.
2. **Explicit save-and-flush before checking status:** Before running `git status`, call `taskStore.save(task)` to ensure the file is on disk. The caller already has the task — pass it through.
3. **Verify commit succeeded:** After `git commit`, run `git log --oneline -1` and log the result. If the commit message doesn't match, surface an error.
4. **Make the warning impossible to miss:** If the commit fails, show an **error** message (not warning), and include a "Retry" button that re-runs the commit.

Actually, the cleaner approach for #1 and #2: change the `create()` method signature to accept the task's relative path, which it already does. Then have `autoCommitTaskFiles()` target THAT file specifically:

```typescript
async autoCommitTaskFiles(taskTitle: string, taskRelPath?: string): Promise<boolean> {
    const pathSpec = taskRelPath ? taskRelPath : '.agentkanban/';
    const { stdout: status } = await this.git([
        'status', '--porcelain', '-uall', '--', pathSpec,
    ]);
    if (!status.trim()) {
        this.logger.info('worktreeService', 'No uncommitted task file changes');
        return false;
    }
    // Stage just the task file and .agentkanban/tasks/
    await this.git(['add', '--', pathSpec]);
    // Also stage the todo file if it exists
    if (taskRelPath) {
        const todoPath = taskRelPath.replace(/\/task_/, '/todo_');
        try { await this.git(['add', '--', todoPath]); } catch { /* may not exist */ }
    }
    const message = `agentkanban: add task "${taskTitle}"`;
    await this.git(['commit', '-m', message]);
    ...
}
```

Key changes:
- Add `-uall` flag to `git status` to ensure untracked files in new/untracked directories are individually listed
- Target the specific task file path instead of the whole `.agentkanban/` directory
- Pass the task path through from `create()`

#### B. `/task` worktree awareness

**Files:** `ChatParticipant.ts`

Current `handleTask()` shows worktree info but doesn't detect whether we're INSIDE the worktree. Need to:

1. After selecting a task, detect if the current workspace IS the task's worktree (compare `workspaceFolder.uri.fsPath` with `task.worktree.path`)
2. If we ARE in the worktree: show a message like *"You're working in the worktree for this task. AGENTS.md already injects the task context permanently. You only need `/task` if switching to a different task temporarily (e.g. in another Copilot thread)."*
3. If we are NOT in the worktree but the task HAS a worktree: add *"Use `@kanban /worktree open` to switch to the worktree."*
4. If the task has no worktree: current behaviour (show normal output)

Implementation: add a `isInWorktree()` check:

```typescript
private isInTaskWorktree(task: Task): boolean {
    if (!task.worktree) return false;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return false;
    return this.normalisePath(workspaceFolder.uri.fsPath) === this.normalisePath(task.worktree.path);
}
```

Then in `handleTask()`, after showing basic info:

```typescript
if (this.isInTaskWorktree(task)) {
    response.markdown('ℹ️ You are in the worktree for this task. AGENTS.md permanently injects context — no need for `/task` or `/refresh` unless switching tasks temporarily.\n\n');
}
```

#### C. Update `assets/INSTRUCTION.md` — remove old verb commands

**Files:** `assets/INSTRUCTION.md`

The bundled INSTRUCTION.md still references `/plan`, `/todo`, `/implement` commands:

```markdown
Use `@kanban /plan`, `@kanban /todo`, or `@kanban /implement` in chat...
### Verbs
...```

These need to be updated to reference `/refresh` only. The verb concepts (plan, todo, implement) remain as workflow *phases*, but they're no longer separate commands. The agent should understand:
- **Plan** → discuss and plan in the task file
- **Todo** → create/update TODO checklist
- **Implement** → write code per plan/TODOs

But the mechanism to refresh context is `/refresh` (or nothing, in worktree mode where AGENTS.md does it permanently).

Update the "Command Rules" section:
- Replace verb command references with `/refresh`
- Keep the plan/todo/implement workflow descriptions as guidance for the agent, not as commands
- Add mention of worktree mode where context is permanent

#### D. Tests

- **WorktreeService:** Test `autoCommitTaskFiles` with specific task path (targeted staging)
- **ChatParticipant:** Test `handleTask` detects worktree workspace and shows appropriate message
- **ChatParticipant:** Test `handleTask` in non-worktree workspace shows standard output

[user]

OK agreed. Add logging so I can report logs for you if there are further issues

[agent]

## Implementation: Iteration 4

All three items implemented and validated (206 tests pass, build succeeds).

### A. Fix autoCommitTaskFiles (WorktreeService.ts)

- Added `taskRelPath?: string` parameter to `autoCommitTaskFiles()`
- When `taskRelPath` is provided, targets only that file and its sibling `todo_` file instead of entire `.agentkanban/`
- Added `-uall` flag to `git status` so individual files in untracked directories are properly detected
- Updated `create()` to pass `taskRelPath` through to `autoCommitTaskFiles()`
- Logging already present via `this.logger.info/warn` calls

### B. Worktree-aware /task (ChatParticipant.ts)

- Added `isInTaskWorktree(task)` private method — compares normalised workspace path with `task.worktree.path`
- Updated `handleTask()` to show "ℹ️ You are in the worktree for this task..." message when the workspace IS the worktree
- Reminds user that `/task` and `/refresh` aren't needed since AGENTS.md permanently injects context

### C. INSTRUCTION.md template update (assets/INSTRUCTION.md)

- Replaced "### Verbs" section with "### Phases" — plan/todo/implement remain as workflow guidance, not commands
- Updated "### Flow" to reference `@kanban /refresh` instead of `/plan /todo /implement`
- Added worktree mode mention: "In a worktree workspace, AGENTS.md permanently contains the task reference"

### D. Tests

- **WorktreeService.test.ts:** Updated `autoCommitTaskFiles` tests to verify `-uall` flag; added test for specific `taskRelPath` targeting (verifies pathspecs include both task and todo file)
- **ChatParticipant.test.ts:** Added two tests: "in-worktree hint when workspace IS the task worktree" and "NOT show in-worktree hint when workspace differs"

[user]

Test feed back. I have tested and something is preventing the git autocommit. I was able to capture this notification (screenshot) before the change of workspace. No logs are being produced - I would expect the logs folder to be under .agentkanban/logs - logging is enabled in the settings

Can we set up a launch setting to ensure the debug flag is on and have that checked in debugging.

```
{
    "version": "0.2.0",
    "configurations": [
        {
            ...
            "preLaunchTask": "${defaultBuildTask}",
            "env": {
                "VSCODE_AGENT_KANBAN_DEBUG": "1"
            }
        }
    ]
}
```

[agent]

## Iteration 4 Bugfix — Auto-commit "pathspec did not match" 

**Root cause:** `git add -- task_file.md todo_file.md` fails fatally when the `todo_` sibling file doesn't exist yet (`fatal: pathspec 'todo_...' did not match any files`). `git status` handles missing paths silently, but `git add` does not.

**Fix:** Instead of passing the raw pathSpecs array to `git add`, we now parse the actual changed file paths from the `git status --porcelain` output and pass **only those** to `git add`. This way:
- Status still queries both task file + todo sibling (catches either)
- Add only stages files that actually have changes (no fatal errors)

**Changes:**
- `WorktreeService.ts` — `autoCommitTaskFiles()`: parse `changedFiles` from status output, use those for `git add`
- `WorktreeService.test.ts` — added "only add files reported by status (skip missing todo file)" test; updated existing tests for new add behaviour
- `.vscode/launch.json` — added `AGENT_KANBAN_DEBUG=1` env to "Run Extension" configuration for out-of-the-box debug logging (note: the actual env var is `AGENT_KANBAN_DEBUG`, not `VSCODE_AGENT_KANBAN_DEBUG`)

207 tests pass, build succeeds.

[user]

I have pasted the logs. The first worktree create from one task appeared to succeed, and I can see the task file in the commit history - but when the new workspace opened, the commit was not present in the workspace branch.

On the second attempt it reported it could not find the file.

This appears to be a race condition. Can we block until we can confirm that the file is present in the commit history from the recent commit (by hash) ... and only then create the new workspace

[agent]

## Iteration 4 Bugfix 2 — Race condition: worktree branch missing committed task files

**Root cause:** `git worktree add -b <branch> <path>` creates a new branch from HEAD — but if the commit from `autoCommitTaskFiles` hasn't fully propagated to HEAD (or another process touches the ref), the new branch may be based on a stale HEAD.

**Fix — commit-hash pinning:**

1. `autoCommitTaskFiles()` now returns the commit hash (`git rev-parse HEAD`) after committing, or `undefined` if nothing to commit
2. After commit, verifies the task file exists in the commit via `git cat-file -e <hash>:<path>`
3. `create()` captures the hash and passes it as an **explicit start-point** to `git worktree add -b <branch> <path> <commit>` — ensuring the worktree branch is based on *exactly* the commit that includes the task files
4. If no commit was made (files already committed), falls back to current HEAD

**Changes:**
- `WorktreeService.ts` — `autoCommitTaskFiles()` returns `string | undefined` (commit hash); adds `rev-parse HEAD` + `cat-file -e` verification; `create()` captures hash and uses as start-point
- `WorktreeService.test.ts` — updated all tests: commit returns hash, create verifies start-point argument

207 tests pass, build succeeds.

[user]

Test feedback. The commit issue is resolved now.

When I create the new work tree and VS code switches over, I find that AGENTS.md is not modified for the specific task file (see C:\Users\Gareth\src\as-notes-demo-notes-worktrees\20260312_085929032_tzsgiu_test_task_7\AGENTS.md)

If the user types /task or /refresh while in a work tree, they should be reminded that in worktree directories they do not need to

[agent]

## Implementation: Iteration 5 — Fix Worktree AGENTS.md + Reminders

### Root Cause Found

The AGENTS.md was being correctly written by `writeWorktreeAgentsMd()` during worktree creation, but then **overwritten by the standard sentinel sync on activation**:

1. `extension.ts` line 199: `syncAgentsMdSection()` called WITHOUT params → wrote standard sentinel, overwriting the enhanced one
2. `extension.ts` line 201: `syncWorktreeAgentsMd()` tried to find task via `worktree.path` in frontmatter → **failed** because the task file in the worktree was committed BEFORE `task.worktree` was saved to frontmatter → did nothing

Additionally, the `handleTask()` handler also calls `syncAgentsMdSection()` without params, which would overwrite on every `/task` command.

### Fixes Applied

**A. `syncAgentsMdSection()` preserves enhanced sentinel** (`ChatParticipant.ts`)

When called WITHOUT `worktreeTask` params, the method now checks if the existing AGENTS.md already contains `**Active Task:**` within the sentinel block. If so, it returns early without writing — preserving the worktree-enhanced sentinel. When called WITH `worktreeTask` params (explicit worktree sync), it always updates.

**B. Task file synced to worktree after creation** (`ChatParticipant.ts` + `KanbanEditorPanel.ts`)

Both worktree creation paths (chat command and board button) now copy the updated task file (containing `worktree` metadata in frontmatter) into the worktree directory after saving. This ensures:
- `syncWorktreeAgentsMd()` can find the linked task on subsequent activations
- `isInTaskWorktree()` correctly detects the worktree association

**C. `/refresh` worktree reminder** (`ChatParticipant.ts`)

Added the same `isInTaskWorktree()` check and message to the `/refresh` handler that `/task` already had. Users in a worktree now see the reminder on both commands.

### Tests Added (212 total, all passing)

- `syncAgentsMdSection`: preserve worktree-enhanced sentinel when called without params
- `syncAgentsMdSection`: overwrite standard sentinel normally
- `syncAgentsMdSection`: overwrite enhanced sentinel when called WITH worktreeTask params
- `/refresh`: show in-worktree hint when in task worktree
- `/refresh`: NOT show hint when not in worktree


[user]

The AGENTS.md looks OK.

There is no reminder message from the particpant commands that the user is in a worktree branch

/task
/refresh
/worktree 

Should all finish with a message reminding the user that they are in a work tree and they do not need to use these commands (Unless they use /task in which case /task and /refresh would then be appropriate - but phrase this sccinctly)

[agent]

## Implementation: Iteration 6 — Worktree Auto-Detection + Reminder Messages

### Root Cause

When VS Code opens a worktree workspace, the extension activates fresh — `lastSelectedTaskId` is `undefined` (in-memory state). So `/refresh`, `/task` (no args), and `/worktree` all hit "No task selected" early returns before reaching any worktree detection logic. The worktree hint existed in code but was unreachable.

### Fixes Applied

**A. `findLinkedWorktreeTask()` method** (`ChatParticipant.ts`)

Extracted the task-by-worktree-path matching logic (previously duplicated in `syncWorktreeAgentsMd()`) into a reusable method. Scans all tasks for one whose `worktree.path` matches the current workspace folder.

**B. Auto-detection in all three handlers** (`ChatParticipant.ts`)

- `/refresh`: Before "No task selected" early return, calls `findLinkedWorktreeTask()`. If found, auto-selects and proceeds with full refresh.
- `/task` (no args): Detects linked task in worktree, shows task name + reminder instead of listing tasks.
- `/worktree`: Before "No task selected" early return, calls `findLinkedWorktreeTask()`. If found, auto-selects and proceeds with subcommand.

**C. Consistent worktree reminder** (`ChatParticipant.ts`)

All commands use a shared `WORKTREE_WORKSPACE_HINT` constant:
> ℹ️ **Worktree workspace** — AGENTS.md permanently provides task context. You don't need these commands unless you use `/task` to switch tasks.

Shown on: `/task` (worktree detected), `/refresh` (worktree detected), `/worktree` create (already exists + in worktree), `/worktree open` (in worktree).

**D. Refactored `syncWorktreeAgentsMd()`** now uses `findLinkedWorktreeTask()`.

### Tests Added (216 total, all passing)

- `/refresh` auto-detects worktree task when `lastSelectedTaskId` is unset
- `/task` (no args) auto-detects worktree task and shows reminder
- `/worktree` auto-detects worktree task when `lastSelectedTaskId` is unset
- `/worktree open` shows reminder when already in worktree

[user]