---
title: Agent Instruction Prominence
lane: done
created: 2026-03-09T21:57:47.108Z
updated: 2026-03-15T14:08:11.153Z
sortOrder: 1773042589447.25
slug: agent_instruction_prominence
---

## Conversation

[user]

Using this system where we mention the task at the top of the context, it seems that it eventually gets lost in the agent chat context. The agent stops replying in the task markdown and sometimes forgets to read it.

How do we keep the INSTRUCTION.md file fresh in the agents context?

How does this normally work? How often do agents read in standard AGENTS.md?

Should we be using our plan todo implement verbs with the @kanban participant? E.g. @kanban /plan - could that reiterate the instruction and the last used task file in the context?

[agent]

### Analysis

**How AGENTS.md works**: VS Code re-injects AGENTS.md into the system prompt on **every** agent mode turn — it never drifts out of context. INSTRUCTION.md, by contrast, is just a file the agent was told to read once in a chat participant response. As the conversation grows, that initial "Read INSTRUCTION.md" message scrolls out of the effective context window and the agent forgets the workflow.

**Root cause**: After `@kanban /task`, the user types verbs (`plan`, `todo`, `implement`) in Copilot agent mode (not through @kanban). The participant is not invoked again, so context is never refreshed. The INSTRUCTION.md reference is a one-shot injection that decays.

### Solution: Verb Commands on @kanban

Register `/plan`, `/todo`, `/implement` as @kanban chat commands. Each invocation re-injects workflow context, acting as a **context refresh checkpoint**. The workflow becomes:

1. `@kanban /task My Task` → opens file, sets up initial context  
2. `@kanban /plan` → re-injects INSTRUCTION.md + task file + plan-specific instructions  
3. Agent mode works on planning...  
4. `@kanban /todo` → re-injects context + todo-specific instructions  
5. `@kanban /implement` → re-injects context + implement instructions  

Each verb command keeps the agent "on track" by refreshing critical context at natural workflow transitions.

### Design

**1. Track last selected task** — Store `lastSelectedTaskId` in the ChatParticipant instance, set by `/task`, used by verb commands. If no task is selected, verb commands list active tasks and prompt the user to select one.

**2. Register verb commands** — Add `/plan`, `/todo`, `/implement` to `package.json` chatParticipants commands.

**3. Implement verb handlers** — Each verb command:
   - Resolves the active task from `lastSelectedTaskId` (or falls back to prompt text matching)
   - Syncs INSTRUCTION.md from the bundled template
   - Opens the task file in the editor
   - Outputs **condensed inline instructions** (not just "read INSTRUCTION.md" — key rules directly in the response so they're in the chat context)
   - Includes verb-specific semantics from INSTRUCTION.md (what plan/todo/implement mean)
   - References the task file path explicitly

**4. Condensed inline context** — Instead of just saying "Read INSTRUCTION.md", include the critical workflow rules directly in the response markdown:
   - The active task file path
   - "Converse in the task file using [agent]/[user] markers"
   - Verb-specific rules (e.g., "plan: discuss and analyse, no code unless combined with implement")
   - Reference to INSTRUCTION.md for full details

[comment] I actually don't want to pollute the response markdown - I'd rather instruct the agent to read that file in the chat each time, and leave the markdown clean if that is viable

**5. Support verb combinations** — `@kanban /implement` with prompt `plan focus on error handling` would combine implement + plan context.

**6. Keep backward compatibility** — Plain verb typing in agent mode still works (AGENTS.md tells the agent to read INSTRUCTION.md). The @kanban verb commands are an optional **reinforcement mechanism** for long conversations.

### Changes Required

| File | Change |
|------|--------|
| `package.json` | Add `/plan`, `/todo`, `/implement` commands to chatParticipants |
| `src/agents/ChatParticipant.ts` | Add `lastSelectedTaskId` field; implement `handlePlan()`, `handleTodo()`, `handleImplement()` handlers; update `handleRequest()` switch; extract shared context-injection helper |
| `src/test/ChatParticipant.test.ts` | Tests for new verb commands, last-selected-task tracking, context re-injection |
| `TECHNICAL.md` | Update Chat Participant documentation |
| `README.md` | Update Chat Commands table |
| `assets/INSTRUCTION.md` | Add note about using `@kanban /plan` etc. to refresh context |

### Questions

1. Should the verb commands also accept a task name override? e.g. `@kanban /plan Some Other Task` — or always use the last selected task? **Recommendation**: Support both. If prompt text matches a task, use that; otherwise fall back to `lastSelectedTaskId`. [comment] - No - always use the last selected task ID, unless the user changes with the /task command, anything that follows the /verb can just be taken as additional context, or if one of the verbs, implies a combination of verbs

2. Should we support combined verbs through a single @kanban command? e.g. `@kanban /plan` with extra text "todo implement" in the prompt? **Recommendation**: Yes — parse the prompt for additional verbs and combine their instructions. [comment] Yes - I'm thinking we should require that the verbs are prefixed with a # e.g. @kanban /plan #todo #implement (or another character if that collides with itHub copilot special handling)

3. The followup buttons currently show verb suggestions after `/task`. Should those become `/plan`, `/todo`, `/implement` commands instead of plain text? **Recommendation**: Yes — this makes followup clicks go through @kanban, refreshing context automatically.

[comment] Yes, lets try that

[user] See inline comments

[user] Using /plan or clicking the buttons in the chat doesn't actually start the agent working, it just adds text into the context

[agent]

### Plan — Addressing the UX Gap

#### The Problem

The verb commands (`/plan`, `/todo`, `/implement`) are implemented and working as designed — they re-inject INSTRUCTION.md + task file references into the chat context. However, they **don't trigger agent mode**. The user clicks a followup button or types `@kanban /plan`, sees the context output, but then nothing happens. The agent doesn't start reading the task file and planning.

This is a fundamental limitation: **chat participants can only output text** — they cannot programmatically trigger Copilot agent mode to start executing actions.

#### Analysis: What Actually Happens

1. User clicks "Plan: My Task" followup button
2. `@kanban /plan` fires → `handleVerb()` outputs: "Read INSTRUCTION.md... PLAN — Task file: ..."
3. **Dead end** — the user now has to manually switch to agent mode and type something to trigger work

The intended workflow was: verb commands are "context refresh checkpoints" that the user invokes between bouts of agent work. But the UX feels broken because the response looks like the agent should be doing something, but it isn't.

#### Solution Options

**Option A: Improve the response messaging (minimal change)**
Make it explicit that verb commands are context-refresh only and guide the user to type in agent mode next. E.g.: "Context refreshed. Switch to agent mode and type `plan` to begin."

**Option B: Use `response.markdown()` to craft an agent-actionable instruction (current approach, but clearer)**
The current response already says "Read the task file and plan this task." This IS visible to Copilot when the conversation continues in the same chat. The issue is that the exchange ends and nothing triggers the next agent turn. The user has to type something to continue.

**Option C: Accept the design and update messaging + documentation**
Verb commands are checkpoints. The workflow is:
1. `@kanban /task My Task` → sets up context
2. User types in agent mode: `plan` → agent works
3. After a long conversation, context drifts
4. `@kanban /plan` → refreshes context
5. User types in agent mode again: `continue planning` → agent works with fresh context

This is actually the correct mental model. The verb commands aren't "do this now" triggers — they're "remember this context" injections. The issue is just that the followup buttons and response text suggest immediate action.

#### Recommended Approach: Option C with UX Polish

1. **Update response text** — Make it clear the command refreshed context and prompt the user to continue in agent mode:
   - "Context refreshed for **plan**. Type your instructions in the chat to start."
   - Remove the imperative "Read the task file and plan this task" which sounds like an instruction to the agent

2. **Update documentation** — Clarify that verb commands are context-refresh checkpoints, not action triggers

3. **Consider the followup button UX** — The buttons work well as quick context-refresh actions. The label could say "Refresh: Plan" instead of just "Plan" to set expectations

#### Changes

| File | Change |
|------|--------|
| `src/agents/ChatParticipant.ts` | Update `handleVerb()` response text to clarify it's a context refresh, guide user to type in agent mode |
| `README.md` | Clarify verb command purpose in Getting Started / Chat Commands |
| `TECHNICAL.md` | Update verb command documentation |

[user]

On option B does that prefill the chat input for the user?

[agent]

### Clarification on Followup Buttons

No — `ChatFollowup` buttons don't "prefill" the input for the user to edit. When a user clicks a followup button, it **immediately submits** the prompt+command as a new request to the chat participant. The `ChatFollowup` interface has:

- `prompt` — text sent as the request prompt
- `command` — slash command to invoke (e.g. `'plan'`)
- `label` — display text shown on the button

So when the user clicks "Plan: My Task", it fires `@kanban /plan` with prompt `''` immediately. The response from `handleVerb()` appears in the chat, and then the exchange is over. There is no way via `ChatFollowup` to prefill text into the agent mode input box without submitting it.

### What This Means

The current design is actually the **only viable pattern**:

1. Verb commands output context-refreshing text into the chat
2. The user then types their next instruction in agent mode
3. The refreshed context (INSTRUCTION.md ref, task file path, verb label) is now visible in the recent conversation history when Copilot processes the next turn

The key insight is: **the verb command response IS the context refresh**. When the user then types `continue` or `start planning` in agent mode, Copilot sees the recent `@kanban /plan` exchange in its context window — including the INSTRUCTION.md reference and task file path. That's the whole point.

### Updated Plan

The implementation is functionally correct. What needs fixing is **messaging clarity**:

1. **`handleVerb()` response** — Change the final line from the imperative "Read the task file and plan this task" to something like:
   - `"Context refreshed. Continue in agent mode to start working."`
   - This makes it clear the command was a checkpoint, not an action

2. **Followup button labels** — Current: `"Plan: My Task"`. Better: keep as-is — "Plan" is concise and the verb label is clear enough. Users will learn that clicking it refreshes context.

3. **`/task` response** — The final guidance line says "Type `plan`, `todo`, or `implement`..." — this should clarify these are `@kanban` commands: "Use `@kanban /plan`, `@kanban /todo`, or `@kanban /implement` to refresh context, then continue in agent mode."

#### Changes

| File | Change |
|------|--------|
| `src/agents/ChatParticipant.ts` | Update `handleVerb()` final line + `handleTask()` guidance text |
| `src/test/ChatParticipant.test.ts` | Update test expectations for changed text |
| `README.md` | Minor Getting Started wording |
| `TECHNICAL.md` | Update verb command docs |

[user]

OK. Lets change the messaging so the injected text finishes with "Type 'go'" to begin. If they have to type plan todo implement again that defeats the point of the verbs

[agent]

### Plan — "Type `go` to begin" UX

Good point. The verb command already sets up all the context (INSTRUCTION.md ref, verb label, task file path). Asking the user to re-type the verb defeats the purpose. The minimal action to trigger agent mode should be just typing `go`.

#### Changes

1. **`handleVerb()` final line** — change from "Read the task file and plan this task..." to: `Type **go** in the chat to begin.`
2. **`handleTask()` guidance** — update to reference `@kanban /plan`, `/todo`, `/implement` commands instead of plain verbs, since that's the new workflow
3. **Tests** — update the `handleVerb` test that checks for the old text, and the `handleTask` guidance test
4. **README Getting Started step 4** — update to reference `@kanban /plan` etc.

[agent]

### Implementation Summary

All items complete. The code changes were already in place from previous iterations. This round completed the documentation:

1. **TECHNICAL.md** — Updated `/task` flow step 7 from "type plan/todo/implement in Copilot agent mode" to "use @kanban /plan, /todo, /implement verb commands"
2. **assets/INSTRUCTION.md** — Added a paragraph in the Flow section explaining `@kanban /plan`, `/todo`, `/implement` commands for context refresh, `#` tag combinations, and "Type **go** to begin"

Previously completed (README.md, package.json, ChatParticipant.ts, tests) were already up to date.

Build succeeds, 125/125 tests pass.

[user]

Can the user still just type 'plan' 'todo' 'implement' or a combination? If so maybe we should note that this is OK short term, but to note in the readme that to keep the agent instruction in the context they should use the correct participant verb handler (or use correct terminology) to keep the INSTRUCTIONS.md in context

[agent]

### Plan — Document Plain Verbs vs @kanban Verbs

Yes, plain verbs still work — INSTRUCTION.md tells the agent to recognise `plan`, `todo`, `implement` as workflow verbs. The difference is:

- **Plain verbs** (typed in agent mode): Work fine initially, but INSTRUCTION.md eventually scrolls out of the context window in long conversations. The agent "forgets" the workflow.
- **`@kanban` verb commands** (`@kanban /plan`, etc.): Re-inject INSTRUCTION.md and the task file reference into the chat context every time, keeping the agent on track.

#### Changes

Add a note to the README in the Getting Started section and after the Chat Commands table explaining this distinction. Something like:

> **Tip:** You can also type `plan`, `todo`, or `implement` directly in agent mode. This works for short conversations, but in longer sessions the agent may lose track of the workflow instructions. Use `@kanban /plan`, `/todo`, `/implement` to re-inject context and keep the agent on track.

| File | Change |
|------|--------|
| `README.md` | Add tip about plain verbs vs @kanban verb commands |

[user]

The state is that we're having to regularly use /plan /task etc and the use of .instructions, dependant on the file open feels janky.

I'm wondering if we can do this with MCP?

If the extension came with and started a light MCP server that somehow recieveds the task reference and reissues the instruction to read INSTRUCTION.md to the agent

[user]

How about if we were to have the extension manage a section in AGENTS.md that prompts the AGENT to read INSTRUCTION. We would just need a way to get the agent to check its context for the most recent task

[agent]

### Plan — AGENTS.md Managed Section

This is the strongest idea yet. AGENTS.md is the **only** file that VS Code re-injects into the system prompt on every agent mode turn. If we can get our instructions into AGENTS.md, the context decay problem is solved at the root.

#### How It Would Work

1. On activation and on every `/task` command, the extension writes a clearly delimited section into the workspace's AGENTS.md:

```markdown
<!-- BEGIN AGENT KANBAN — DO NOT EDIT THIS SECTION -->
## Agent Kanban

Read `.agentkanban/INSTRUCTION.md` for workflow rules.

Active task: `.agentkanban/tasks/doing/task_20260309_224930064_ei_my_task.md`

Work in the task file above. Follow the plan → todo → implement workflow.
<!-- END AGENT KANBAN -->
```

2. The extension owns everything between the sentinel comments. It reads the existing AGENTS.md, finds the section (or appends it), replaces just that block, and writes it back. User content outside the sentinels is never touched.

3. When the active task changes (`/task`), the section is updated with the new task path.

4. When there's no active task, the section is minimal — just "Read INSTRUCTION.md" without a task reference.

#### Why This Works

- **Every turn**: AGENTS.md is system-prompt-level context. The agent sees "Read INSTRUCTION.md" and the active task path on every single turn, no matter how long the conversation.
- **No file-open dependency**: Unlike `.instructions.md` with `applyTo`, this doesn't depend on which files are open or referenced.
- **No manual refresh needed**: The verb commands become truly optional — nice for explicit context-switch moments, but not required to prevent decay.
- **Minimal footprint**: A 4-5 line section. Won't crowd out user content in AGENTS.md.

#### Concerns

1. **Modifying user-owned files** — AGENTS.md may already exist with user content. We need to be surgical:
   - Use clear sentinel comments (`<!-- BEGIN/END AGENT KANBAN -->`)
   - Only touch content between sentinels
   - If AGENTS.md doesn't exist, create it with just our section
   - If it exists without our section, append our section at the end
   - Never delete or reorder user content

2. **Multiple workspaces** — Each workspace has its own AGENTS.md. No cross-workspace concerns.

3. **Git noise** — The active task path changes frequently, causing small diffs in AGENTS.md on every task switch. This is minor but worth noting. Users who version-control AGENTS.md will see these changes. We could mitigate by only writing the task path when it changes, not on every activation.

4. **Race conditions** — If the user edits AGENTS.md while we're writing, we could clobber their changes. Use a read-modify-write pattern with the sentinel parse, not a blind overwrite.

5. **Cleanup on deactivation** — Should we remove our section when the extension is disabled/uninstalled? Probably not — `deactivate()` is unreliable and we don't want to leave a broken AGENTS.md. The sentinel section is harmless if the extension isn't running.

#### What Happens to Existing Mechanisms

| Mechanism | Keep? | Rationale |
|-----------|-------|-----------|
| `response.reference()` | Yes | Still useful — gives the agent a direct URI to search for. Belt-and-suspenders with AGENTS.md. |
| `.instructions.md` with `applyTo` | Remove | Redundant now. AGENTS.md is stronger. Removing avoids overwriting user's `.instructions.md`. |
| Verb commands (`/plan`, `/todo`, `/implement`) | Keep | Still valuable for explicit workflow transitions and re-focusing the agent. But no longer *required* to prevent context decay. |
| `syncInstructionFile()` | Keep | INSTRUCTION.md itself is still the detailed instruction set. AGENTS.md just tells the agent to read it. |

#### Design Questions

1. **Should the AGENTS.md section include the full INSTRUCTION.md content or just a pointer?** Pointer is better — keeps AGENTS.md lightweight, and the agent can read the full file when needed. AGENTS.md re-injects every turn, so the pointer is always fresh.

[comment: A pointer to INSTRUCTION.md]

2. **Should we update the section on every activation, or only when the active task changes?** On activation + on `/task` command. Activation ensures the section exists after extension updates. `/task` updates the active task path.

[comment: Both]

3. **What if there's no active task?** Write the section without a task path — just the INSTRUCTION.md pointer. This still solves the base "agent forgets workflow rules" problem.

[comment: OK]

4. **Should we also reference `memory.md`?** Could add `Read .agentkanban/memory.md for project context.` — this would keep the agent's memory fresh too. Worth considering but adds to the section size.

[comment: Yes]

[user] What about the scenario where the user is working in two tasks in two chat threads though?

[agent]

### Plan — Two Tasks, Two Threads

Good catch. AGENTS.md is a single file, shared across all chat threads in the workspace. If we write `Active task: task_A.md` into AGENTS.md and the user switches to a second thread working on task_B, both threads see the same AGENTS.md — pointing at whichever task was selected last.

#### The Problem

- Thread 1: `@kanban /task Auth Feature` → AGENTS.md says "Active task: auth_feature.md"
- Thread 2: `@kanban /task Login Bug` → AGENTS.md now says "Active task: login_bug.md"
- Thread 1 continues: agent sees AGENTS.md pointing at login_bug.md, not auth_feature.md

AGENTS.md is global to the workspace — there's no per-thread variant.

#### Options

**Option A: Don't put the active task in AGENTS.md**

Only put the INSTRUCTION.md and memory.md pointers in the AGENTS.md section. These are task-agnostic — they apply to any task. The active task path stays in the chat context via `response.reference()` and verb commands, which are per-thread.

```markdown
<!-- BEGIN AGENT KANBAN — DO NOT EDIT THIS SECTION -->
## Agent Kanban

Read `.agentkanban/INSTRUCTION.md` for task workflow rules.
Read `.agentkanban/memory.md` for project context.
<!-- END AGENT KANBAN -->
```

This is safe for multi-thread use. It solves the main context decay problem (agent forgets INSTRUCTION.md exists) without the per-task issue. The active task path is still injected per-thread by `/task` and verb commands via `response.reference()`.

**Option B: Put the active task in AGENTS.md but accept last-writer-wins**

Include the task path, accept that it reflects whichever task was selected most recently. The agent in each thread also has `response.reference(taskUri)` from its own `/task` call, so there's some redundancy. The AGENTS.md task path might be wrong for one thread, but the chat-level references are correct.

Risk: the agent reads AGENTS.md, sees a task path, and switches to the wrong task file. This would be confusing.

**Option C: Put all active tasks in AGENTS.md**

List every non-done task (or every task that has been selected via `/task` in any thread). The agent would see multiple task paths and need to figure out which one is relevant. This adds noise and the agent may pick the wrong one.

#### Recommendation: Option A

Keep the AGENTS.md section task-agnostic. The section's job is to ensure the agent always knows INSTRUCTION.md and memory.md exist. The active task identity stays in the per-thread context via `response.reference()` and verb commands.

This gives us:
- **AGENTS.md** (every turn, all threads): "Read INSTRUCTION.md" + "Read memory.md" — prevents workflow rule decay
- **`response.reference()`** (per-thread): Points the agent at the specific task file — prevents task identity decay
- **Verb commands** (per-thread, on demand): Re-injects both when the user wants an explicit checkpoint

The multi-layered approach means no single mechanism needs to solve everything.

#### Updated AGENTS.md Section Template

```markdown
<!-- BEGIN AGENT KANBAN — DO NOT EDIT THIS SECTION -->
## Agent Kanban

Read `.agentkanban/INSTRUCTION.md` for task workflow rules.
Read `.agentkanban/memory.md` for project context.
<!-- END AGENT KANBAN -->
```

Written on activation. No task-specific content. Stable across task switches — no git noise from task changes either.

[user]

Is there a risk of the agent loosing track of the task from response.reference()

[agent]

### Plan — Task Identity Decay via response.reference()

Yes, there is a risk. `response.reference()` attaches the task URI to one specific chat turn. As the conversation grows, that turn scrolls toward the edge of the context window. Eventually the agent may stop seeing it.

However, INSTRUCTION.md being re-injected every turn via AGENTS.md changes the dynamics significantly. Even if the agent loses the specific `response.reference()` URI, INSTRUCTION.md contains the rule: *"A task file name exists in the context — converse and collaborate only in that file for this task."* The agent is constantly reminded to look for a task file. The question is whether it can still *find* it.

#### How the Agent Recovers the Task

Even without `response.reference()` in the visible context window, the agent has several signals:

1. **The task file is open in the editor** — `/task` and verb commands open it via `showTextDocument()`. If it stays open, the agent sees it as an open editor tab, which is always included in the context.
2. **The conversation itself mentions the task** — the `/task` response includes the task file path in markdown (``Task file: `.agentkanban/tasks/doing/...` ``). Even if `response.reference()` decays, the text mention remains.
3. **INSTRUCTION.md tells the agent to look** — via AGENTS.md, the agent reads INSTRUCTION.md every turn, which says to work in the task file that's in context.

#### Is This Good Enough?

Probably yes for most sessions. The combination of:
- AGENTS.md → INSTRUCTION.md (every turn)
- Task file open in editor (persistent while tab is open)
- `response.reference()` (per-thread, decays slowly)
- Verb commands re-inject when needed (manual fallback)

...gives multiple overlapping safety nets. The AGENTS.md addition is the strongest new layer because it ensures INSTRUCTION.md is never forgotten.

#### Where It Could Still Fail

The weak scenario is: very long session, user has closed the task file tab, and `response.reference()` has scrolled out. Now the agent sees INSTRUCTION.md (via AGENTS.md) but has no task path to work with. It would need to search for the task or ask the user.

To mitigate this, we could have INSTRUCTION.md include a note like: *"If you don't see a task file in context, search`.agentkanban/tasks/` for files in non-done lanes and ask the user which task to work on."* This gives the agent a recovery path.

#### Summary

The risk exists but is acceptable. The AGENTS.md addition makes the biggest difference — it ensures the agent always knows the workflow rules. Task identity is maintained by the editor tab + `response.reference()` + verb commands. If all three fail, the agent can be guided to recover via INSTRUCTION.md.

Shall I proceed with implementation? The changes are:

| File | Change |
|------|--------|
| `src/agents/ChatParticipant.ts` | Add `syncAgentsMdSection()` — read-modify-write AGENTS.md with sentinel markers |
| `src/extension.ts` | Call `syncAgentsMdSection()` on activation |
| `src/agents/ChatParticipant.ts` | Remove `syncDotInstructionsFile()` and the `.instructions.md` mechanism |
| `src/test/ChatParticipant.test.ts` | Tests for AGENTS.md sync (create, update, preserve user content); remove `.instructions.md` tests |
| `assets/INSTRUCTION.md` | Add recovery guidance ("if no task file in context, search and ask") |
| `README.md` | Update Agent Instructions section — document the AGENTS.md managed section; remove `.instructions.md` docs |
| `TECHNICAL.md` | Document `syncAgentsMdSection()`, remove `.instructions.md` docs |

[user] This sounds good. Could we also have the agent remind its self of the task on every turn? 

[agent]

### Plan — Agent Self-Reminder on Every Turn

The idea is to include a directive in the AGENTS.md section that tells the agent to actively check for its current task at the start of every turn, rather than passively relying on `response.reference()` to survive in context.

#### How

Add a line to the AGENTS.md managed section:

```markdown
<!-- BEGIN AGENT KANBAN — DO NOT EDIT THIS SECTION -->
## Agent Kanban

Read `.agentkanban/INSTRUCTION.md` for task workflow rules.
Read `.agentkanban/memory.md` for project context.

If a task file (`.agentkanban/tasks/**/*.md`) was referenced earlier in this conversation, re-read it before responding.
<!-- END AGENT KANBAN -->
```

The key line — *"If a task file was referenced earlier in this conversation, re-read it before responding"* — is injected on every turn via AGENTS.md. It prompts the agent to:

1. Scan the conversation for a task file reference
2. Re-read that file to refresh its understanding of the task context

This is a behavioural instruction to the agent, not a tool call or API mechanism. It works because:
- AGENTS.md is system-prompt-level: the agent sees it before it starts reasoning
- The task file reference (from `response.reference()` or the markdown text) is somewhere in the conversation history
- The agent is told to look for it and re-read it
- Even if `response.reference()` has scrolled out, the text mention `Task file: .agentkanban/tasks/doing/...` from `/task` may still be visible

#### Effectiveness

This is a "best effort" prompt-engineering approach. Its reliability depends on the model:
- Strong models (Claude, GPT-4o) will likely follow it consistently
- The instruction competes with the user's message for attention — if the user asks something unrelated, the agent might skip re-reading the task file
- In very long conversations where the task reference has fully scrolled out, the agent can't find what to re-read

But combined with the other mechanisms, it strengthens the safety net significantly. The agent is now *actively told to look for its task* rather than passively relying on context.

#### Updated AGENTS.md Template

```markdown
<!-- BEGIN AGENT KANBAN — DO NOT EDIT THIS SECTION -->
## Agent Kanban

Read `.agentkanban/INSTRUCTION.md` for task workflow rules.
Read `.agentkanban/memory.md` for project context.

If a task file (`.agentkanban/tasks/**/*.md`) was referenced earlier in this conversation, re-read it before responding.
<!-- END AGENT KANBAN -->
```

This is still compact (4 meaningful lines) and task-agnostic. Safe for multiple threads — each thread's agent scans its own conversation for the task reference.

Ready to implement all of this. Shall I proceed?

[user] Should we specifically ask the agent to echo out the task file name or does the request to read effectively do this

[agent]

### Plan — Echo the Task File Name

Good question. When the agent calls `read_file` on a task file, the tool call is visible in the chat as "Read file .agentkanban/tasks/doing/task_xxx.md" — so the user can see which task the agent is working on. That's implicit echoing.

But explicitly asking the agent to state the task file name at the start of each response has a different benefit: **it forces the agent to commit to a task identity early in its reasoning**. If it can't find one, it would say so rather than silently proceeding without context.

#### Options

**A: Don't echo — rely on the read_file tool call visibility**
Simpler. The user sees the tool call. But the agent might skip reading the file on turns where it thinks it doesn't need to (e.g. answering a quick follow-up question), silently drifting from the task context.

**B: Echo the task name — add a directive to AGENTS.md**
Something like: *"State the active task file name at the start of each response."*

Pros:
- Forces the agent to check its task identity every turn
- Makes it obvious when the agent has lost track (it'll say "I don't see a task file" instead of proceeding blindly)
- Visible confirmation for the user

Cons:
- Adds boilerplate to every response
- May feel repetitive in a focused session

**C: Echo only in INSTRUCTION.md, not AGENTS.md**
Put the directive in INSTRUCTION.md rather than AGENTS.md. The agent only echoes when it successfully reads INSTRUCTION.md. This keeps AGENTS.md lean. But if the agent forgets to read INSTRUCTION.md... that's the problem we're solving.

#### Recommendation: Add to INSTRUCTION.md, not AGENTS.md

The AGENTS.md section should stay minimal — its job is just to point the agent at INSTRUCTION.md and memory.md. The detailed behavioural rules (including "state the task file name") belong in INSTRUCTION.md.

INSTRUCTION.md already has the rule about working in the task file. We can strengthen it:

> **At the start of each response, confirm which task file you are working in.** If no task file is in context, state this and ask the user to select one with `@kanban /task`.

This way:
- AGENTS.md ensures INSTRUCTION.md is read every turn
- INSTRUCTION.md tells the agent to echo the task name
- If the agent can't find a task, it asks — providing the recovery path

Updated AGENTS.md section stays the same (no change). The echo directive goes into INSTRUCTION.md.

[user]

OK lets try that. We'll need to record this layered approach and the reason behind each in README. Remind me of the changes before we proceed

[agent]

### Plan — AGENTS.md Managed Section: Full Change List

Here is the complete set of changes required, grouped by area.

---

#### 1. New: `syncAgentsMdSection()` in ChatParticipant.ts

Add a new method that manages a sentinel-delimited section in the workspace's `AGENTS.md`:

- **Read** existing `AGENTS.md` (or start with empty string if it doesn't exist)
- **Find** the sentinel block `<!-- BEGIN AGENT KANBAN — DO NOT EDIT THIS SECTION -->` … `<!-- END AGENT KANBAN -->`
- **Replace** the block (or append it at the end) with the current template
- **Write** the file back — user content outside the sentinels is preserved

Template content:

```markdown
<!-- BEGIN AGENT KANBAN — DO NOT EDIT THIS SECTION -->
## Agent Kanban

Read `.agentkanban/INSTRUCTION.md` for task workflow rules.
Read `.agentkanban/memory.md` for project context.

If a task file (`.agentkanban/tasks/**/*.md`) was referenced earlier in this conversation, re-read it before responding.
<!-- END AGENT KANBAN -->
```

Add a constant `AGENTS_MD_REL_PATH = 'AGENTS.md'`.

---

#### 2. Remove: `.instructions.md` mechanism

| Item | Action |
|------|--------|
| `DOTINSTRUCTIONS_REL_PATH` constant | Delete |
| `syncDotInstructionsFile()` method | Delete |
| `handleTask()` call to `syncDotInstructionsFile()` | Remove |
| `handleVerb()` call to `syncDotInstructionsFile()` | Remove |
| `assets/.instructions.md` template file | Delete |

---

#### 3. Wire up `syncAgentsMdSection()` calls

| Call site | Change |
|-----------|--------|
| `extension.ts` activate | Replace `syncDotInstructionsFile()` with `syncAgentsMdSection()` |
| `handleTask()` | Replace `syncDotInstructionsFile()` with `syncAgentsMdSection()` |
| `handleVerb()` | Replace `syncDotInstructionsFile()` with `syncAgentsMdSection()` |

---

#### 4. Update `assets/INSTRUCTION.md`

Add an echo directive to the Rules section:

> **At the start of each response, confirm which task file you are working in.** If no task file is in context, state this and ask the user to select one with `@kanban /task`.

Add recovery guidance:

> If you cannot find a task file reference in the conversation, search `.agentkanban/tasks/` for files in non-done lanes and ask the user which task to work on.

---

#### 5. Tests — `ChatParticipant.test.ts`

**Add** tests for `syncAgentsMdSection()`:
- Creates AGENTS.md when it doesn't exist (section present)
- Updates existing AGENTS.md — preserves content outside sentinels
- Replaces stale sentinel section with current template
- No-op when no workspace folder

**Remove** tests for `syncDotInstructionsFile()`:
- All tests referencing `.instructions.md` sync

**Update** tests that assert `syncDotInstructionsFile` is called inside `handleTask` and `handleVerb` — change to assert `syncAgentsMdSection` is called instead.

---

#### 6. Documentation

**README.md:**
- Rewrite "Agent Instructions" section — document the layered approach:
  1. **AGENTS.md managed section** (every turn, all threads): ensures the agent always knows to read INSTRUCTION.md and memory.md
  2. **`response.reference()`** (per-thread): attaches instruction + task file URIs to the conversation
  3. **Verb commands** (`@kanban /plan` etc.): on-demand context refresh checkpoints
  4. **Editor tab** (persistent): task file stays open while the tab is open
- Remove `.instructions.md` documentation
- Note that AGENTS.md is modified with sentinel markers; user content outside sentinels is preserved

**TECHNICAL.md:**
- Document `syncAgentsMdSection()` — sentinel markers, read-modify-write, template content
- Remove `syncDotInstructionsFile()` documentation
- Update activation flow to reference `syncAgentsMdSection()`

---

#### Implementation Order

1. `syncAgentsMdSection()` + constant + tests (TDD — write failing tests first)
2. Remove `syncDotInstructionsFile()` + constant + delete `assets/.instructions.md` + remove tests
3. Wire up `syncAgentsMdSection()` calls in `handleTask`, `handleVerb`, `extension.ts`
4. Update `assets/INSTRUCTION.md` with echo directive + recovery guidance
5. Update README.md and TECHNICAL.md
6. Build + test — confirm all green

[user]

todo implement

[agent]

### Implementation Complete — AGENTS.md Managed Section

All changes implemented. Build clean, 133/133 tests pass.

#### Changes Made

**1. `src/agents/ChatParticipant.ts`**
- Added `AGENTS_MD_REL_PATH`, `AGENTS_MD_BEGIN`, `AGENTS_MD_END`, `AGENTS_MD_SECTION` constants
- Added `syncAgentsMdSection()` method — read-modify-write AGENTS.md with sentinel markers, preserves user content outside sentinels
- Removed `DOTINSTRUCTIONS_REL_PATH` constant and `syncDotInstructionsFile()` method
- Updated `handleTask()` and `handleVerb()` — replaced `syncDotInstructionsFile()` calls with `syncAgentsMdSection()`

**2. `src/extension.ts`**
- Replaced `syncDotInstructionsFile()` activation call with `syncAgentsMdSection()`

**3. `assets/INSTRUCTION.md`**
- Added echo directive: "At the start of each response, confirm which task file you are working in"
- Added recovery guidance: "If you cannot find a task file reference, search `.agentkanban/tasks/` and ask the user"

**4. `assets/.instructions.md`**
- Deleted (no longer needed)

**5. `src/test/ChatParticipant.test.ts`**
- Replaced `syncDotInstructionsFile` test suite with `syncAgentsMdSection` suite (5 tests):
  - Creates AGENTS.md when file doesn't exist
  - Appends section preserving user content
  - Replaces stale sentinel section
  - Returns undefined when no workspace folder
  - Returns undefined on write failure

**6. `README.md`**
- Rewrote "Agent Instructions" section documenting the layered approach (AGENTS.md → response.reference → verb commands → editor tab)
- Removed `.instructions.md` documentation

**7. `TECHNICAL.md`**
- Documented `syncAgentsMdSection()` — sentinel markers, read-modify-write, template content, layered approach
- Updated /task and verb command flows to reference AGENTS.md instead of `.instructions.md`
- Removed `syncDotInstructionsFile()` documentation

[user]

After each participant command is it possible to focus the chat input rather than the task file.

/task should focus the task file editor, but the others like /plan /todo should focus the chat window

[agent]

### Plan — Focus Chat Input After Verb Commands

#### The Problem

Currently, both `/task` and verb commands (`/plan`, `/todo`, `/implement`) call `vscode.window.showTextDocument(doc, { preview: false })` which opens the task file and **steals focus** to the editor. For `/task` that's correct — the user wants to see the task file. But for verb commands, the user's next action is to type **go** in the chat input, so focus should stay in the chat panel, not jump to the editor.

#### Analysis

The `showTextDocument` API accepts a `preserveFocus` option. From the docs:

```typescript
await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
```

When `preserveFocus: true`, the document is opened/revealed in the editor but **focus stays where it is** — which during a chat participant handler, should be the chat input panel.

There is no `vscode.commands.executeCommand('workbench.action.chat.focus')` needed — just preserving focus is sufficient since the user is already in the chat panel when the command fires.

#### Changes

| File | Change |
|------|--------|
| `src/agents/ChatParticipant.ts` | In `handleVerb()`, change `{ preview: false }` to `{ preview: false, preserveFocus: true }` |
| `src/test/ChatParticipant.test.ts` | Update the "should open the task file in editor" test in `handleVerb` to verify `preserveFocus: true` |

`handleTask()` keeps `{ preview: false }` (no `preserveFocus`) so focus jumps to the task file as desired.

This is a one-line code change + one test assertion update.

[user]