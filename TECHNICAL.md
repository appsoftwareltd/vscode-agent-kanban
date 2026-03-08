# Technical Documentation

## Architecture

```
src/
├── extension.ts              # Extension entry point — activation, registration
├── types.ts                  # Core type definitions (Task, Message, BoardConfig)
├── LogService.ts             # Pure Node.js rolling file logger
├── TaskStore.ts              # YAML task file read/write/watch
├── BoardConfigStore.ts       # Board configuration persistence
├── BoardViewProvider.ts      # Sidebar webview — kanban board UI
├── TaskDetailViewProvider.ts # Editor panel webview — task detail/conversation UI
├── userName.ts               # User display name management
├── agents/
│   ├── AgentProvider.ts      # AgentProvider interface definition
│   ├── CopilotChatProvider.ts # GitHub Copilot Chat Participant implementation
│   └── tools.ts              # Tool definitions, path validation, tool executor
└── test/
    ├── __mocks__/vscode.ts   # VS Code API mock for unit tests
    ├── LogService.test.ts    # Log writing, rotation, no-op tests
    ├── TaskStore.test.ts     # Task serialisation round-trip tests
    ├── BoardConfigStore.test.ts # Board config serialisation tests
    ├── tools.test.ts         # Path validation, tool execution, sandbox tests
    └── CopilotChatProvider.test.ts # AGENTS.md discovery, prompt construction tests
```

## Core Types

### Task (`types.ts`)

```typescript
interface Task {
    id: string;           // Unique ID (task-<timestamp>-<random>)
    title: string;
    lane: string;         // Lane ID the task is in
    created: string;      // ISO 8601 timestamp
    updated: string;      // ISO 8601 timestamp (auto-updated on save)
    description: string;
    model?: string;       // Optional language model override (per-task)
    conversation: Message[];
}
```

### Message (`types.ts`)

```typescript
interface Message {
    role: 'user' | 'agent';
    author?: string;      // Human display name (role=user)
    provider?: string;    // Agent provider name (role=agent)
    action?: 'plan' | 'todo' | 'implement'; // Action on initiating message
    timestamp: string;    // ISO 8601
    content: string;
}
```

### BoardConfig (`types.ts`)

```typescript
interface BoardConfig {
    lanes: LaneConfig[];  // Ordered lane definitions
    basePrompt: string;   // System-level prompt prepended to all agent requests
}

interface LaneConfig {
    id: string;           // URL-safe identifier
    name: string;         // Display name
}
```

## Persistence Layer

### TaskStore (`TaskStore.ts`)

- Reads/writes YAML files under `.agentkanban/tasks/<task-id>.yaml`
- In-memory cache with `Map<string, Task>`
- File watcher triggers `reload()` on external changes
- Fires `onDidChange` event for UI refresh
- Static `serialise()`/`deserialise()` methods for unit-testable YAML round-trips
- Uses the `yaml` npm package (v2.x) for parsing/stringifying with `lineWidth: 0` (no wrapping)

### BoardConfigStore (`BoardConfigStore.ts`)

- Reads/writes `.agentkanban/board.yaml`
- Creates default config (3 lanes, empty base prompt) if file doesn't exist
- `update()` accepts partial config for incremental changes
- Fires `onDidChange` event

## Webview Architecture

### BoardViewProvider (`BoardViewProvider.ts`)

- Registered as `WebviewViewProvider` for the `agentKanban.boardView` sidebar view
- Renders HTML with CSS variables mapped to VS Code theme tokens
- Drag-and-drop via native HTML5 drag events
- Communication via `postMessage`/`onDidReceiveMessage`:
  - `newTask` — prompts for title, creates YAML file
  - `openTask` — fires `agentKanban.openTask` command
  - `moveTask` — updates task lane in YAML
  - `addLane` / `removeLane` / `renameLane` — updates board config
  - `deleteTask` — removes YAML file
- CSP: nonce-based script/style, `default-src 'none'`

### TaskDetailViewProvider (`TaskDetailViewProvider.ts`)

- Creates `WebviewPanel` instances (editor tab) per task
- Tracks open panels in `Map<string, WebviewPanel>`
- Shows: editable title, description, lane selector, conversation thread, message input
- Action bar: Plan / Todo / Implement buttons set the current action mode
- Send triggers agent execution → streams response chunks to webview → saves to YAML
- Ctrl+Enter keyboard shortcut for send

## Agent Integration

### AgentProvider Interface (`agents/AgentProvider.ts`)

```typescript
interface TaskContext {
    task: Task;
    conversation: Message[];
    boardConfig: BoardConfig;
    action: 'plan' | 'todo' | 'implement';
    userMessage: string;
}

interface AgentProvider {
    readonly name: string;
    execute(context: TaskContext): AsyncIterable<string>;
}
```

### CopilotChatProvider (`agents/CopilotChatProvider.ts`)

- Implements `AgentProvider` using the VS Code Language Model API (`vscode.lm`)
- Registered as Chat Participant `agentKanban.chat` with name `@kanban`
- Slash commands: `/plan`, `/todo`, `/implement`
- **AGENTS.md auto-discovery**: On activation, scans workspace for instruction files in priority order: `AGENTS.md`, `.github/copilot-instructions.md`, `.github/AGENTS.md`, `CLAUDE.md`. First found is loaded and prepended to the system prompt. Content is cached after first load.
- **Model resolution**: Priority chain — task-level `model` override → `agentKanban.defaultModel` setting → first available model from `vscode.lm.selectChatModels()`
- Prompt construction layers:
  1. Agent instruction file content (if discovered)
  2. Board base prompt
  3. Action-specific system instruction
  4. Task title + description
  5. Full conversation history (user messages prefixed with `[author]:`)
  6. Current user message
- **Agentic loop** (implement mode): Uses `response.stream` with `TOOL_DEFINITIONS` (6 tools). When the model returns `LanguageModelToolCallPart`, executes the tool via `ToolExecutor`, feeds the result back, and loops until the model responds with text only.
- **Read-only tools** (plan/todo modes): Uses `response.stream` with `READ_ONLY_TOOLS` (readFile, listFiles, searchFiles) — model can read and search the codebase but cannot modify it.
- `handleChatRequest()` for Chat Participant invocations — appends both user and agent messages to YAML
- `execute()` for webview invocations — returns `AsyncIterable<string>` chunks (including tool status messages)
- `buildChatMessages()` is public for unit testing

### Tool Calling (`agents/tools.ts`)

The agent can read/write files and run commands during **implement** mode, and has read-only access in **plan** and **todo** modes. Tools are implemented as private tool definitions passed to the Language Model API, not registered globally.

#### Available Tools

| Tool | Description | Confirmation | Modes |
|------|-------------|--------------|-------|
| `readFile(path)` | Read file contents relative to workspace root | No | All |
| `writeFile(path, content)` | Create or overwrite a file | Yes (modal dialog) | Implement |
| `listFiles(pattern)` | List files matching a glob pattern | No | All |
| `runTerminal(command)` | Run a shell command and return output | Yes (modal dialog) | Implement |
| `editFile(path, oldText, newText)` | Surgical text replacement — `oldText` must appear exactly once | Yes (modal dialog) | Implement |
| `searchFiles(query, pattern?, isRegex?)` | Search file contents across workspace, returns matching lines with locations | No | All |

`READ_ONLY_TOOLS` exports the subset: readFile, listFiles, searchFiles. `TOOL_DEFINITIONS` exports all 6.

#### Path Sandboxing

- All paths are resolved relative to the workspace root via `validatePath()`
- Path traversal (`../`) is blocked by default — resolved path must remain under workspace root
- Setting `agentKanban.allowExternalPaths` (boolean, default `false`) unlocks external paths for monorepo setups
- `validatePath()` normalises paths and checks containment after resolution

#### Guardrails

- **Confirmation prompts**: `writeFile` and `runTerminal` show a modal VS Code dialog ("Allow" / "Deny") before execution
- **Rate limiting**: Maximum 20 tool calls per agent turn (prevents infinite loops)
- **Output caps**: File reads capped at 50,000 chars, terminal output at 10,000 chars
- **Terminal timeout**: Commands time out after 30 seconds

#### Agentic Loop Flow

```
User sends message (implement mode)
  → buildChatMessages() with TOOL_DEFINITIONS
  → model.sendRequest(messages, { tools, toolMode: Auto })
  → iterate response.stream
    → LanguageModelTextPart → yield text to webview
    → LanguageModelToolCallPart → collect all tool calls for this turn
  → If tool calls present:
    → Append Assistant message (text + tool calls) to messages
    → Execute each tool via ToolExecutor
    → Yield status messages (📁 Read file: ..., ✅ Written: ...)
    → Append User message with LanguageModelToolResultPart for each call
    → model.sendRequest(messages, { tools }) again → loop
  → Until model responds with text only (no tool calls)
```

### Action Instructions

| Action | System Instruction | Tools |
|--------|--------------------| ------|
| `plan` | Discuss, analyse, plan. No code or TODOs. Read-only tools available for codebase exploration. | readFile, listFiles, searchFiles |
| `todo` | Generate/update actionable TODO list in markdown checkbox format. Read-only tools available. | readFile, listFiles, searchFiles |
| `implement` | Write code following pragmatic principles. Use tools to read/write files and run commands. | readFile, writeFile, listFiles, runTerminal, editFile, searchFiles |

### Model Selection

Model resolution follows a priority chain:

1. **Per-task override**: `task.model` field in YAML (set via model dropdown in task detail UI)
2. **Default setting**: `agentKanban.defaultModel` (string, workspace-scoped)
3. **Auto-detect**: First model returned by `vscode.lm.selectChatModels()`

The task detail webview shows a model dropdown populated by `vscode.lm.selectChatModels()`. Selecting a model saves it to the task's YAML file. An empty selection clears the override, falling back to the default.

### AGENTS.md Auto-Discovery

On extension activation, `loadAgentInstructions()` scans the workspace root for instruction files in priority order:

1. `AGENTS.md`
2. `.github/copilot-instructions.md`
3. `.github/AGENTS.md`
4. `CLAUDE.md`

The first file found is read and its content is prepended to the system prompt (before the board base prompt) in `buildChatMessages()`. The content is cached — call `loadAgentInstructions()` again to refresh.

## Multi-User Support

- `agentKanban.userName` setting scoped to `application` (local, not workspace)
- `ensureUserName()` prompts on first use if not set
- `author` field on user messages, `provider` field on agent messages
- Conversation is append-only — minimises merge conflicts when syncing via VC
- File watcher detects external YAML changes and refreshes UI

## Build System

- **esbuild** via `build.mjs` — bundles `src/extension.ts` to `dist/extension.js`
- **TypeScript** config: ES2022 target, Node16 modules, strict mode
- **Vitest** for unit tests with vscode module mocked via alias
- Scripts: `build`, `watch`, `lint` (tsc --noEmit), `test`, `test:watch`

## Security

- Webview CSP: `default-src 'none'`, nonce-based script/style execution
- HTML output escaped via `escapeHtml()` / `escapeAttr()` helpers
- No external resource loading in webviews
- User name stored in local (application-scope) settings only

## Logging

### LogService (`LogService.ts`)

Pure Node.js rolling file logger with no VS Code dependency. Adapted from the `as-notes` extension.

- **Log file**: `.agentkanban/logs/agent-kanban.log`
- **Rolling**: When file exceeds 10 MB, rotates to `agent-kanban.1.log` ... `agent-kanban.5.log`; oldest is deleted
- **Log levels**: `INFO`, `WARN`, `ERROR`
- **API**: `info(tag, message)`, `warn(tag, message)`, `error(tag, message)`, `time(tag, label)` (returns timer callback)
- **No-op mode**: `NO_OP_LOGGER` singleton — all methods are no-ops with negligible overhead when logging is disabled

### Activation

Two paths (requires VS Code reload after changing):
1. Setting: `agentKanban.enableLogging` (boolean, default `false`)
2. Environment variable: `AGENT_KANBAN_DEBUG=1` (for Extension Development Host)

### Injection Pattern

All services accept an optional `logger?: LogService` constructor parameter, defaulting to `NO_OP_LOGGER`:
- `TaskStore` — task file CRUD, cache reload
- `BoardConfigStore` — config loading/saving
- `BoardViewProvider` — webview lifecycle, message handling
- `TaskDetailViewProvider` — panel lifecycle, agent invocations
- `CopilotChatProvider` — model selection, prompt construction, streaming

### Tag Convention

| Tag | Source |
|-----|--------|
| `extension` | Extension activation/lifecycle |
| `taskStore` | Task CRUD operations |
| `boardConfig` | Board config operations |
| `boardView` | Board webview events |
| `taskDetail` | Task detail webview events |
| `copilot` | Copilot Chat provider operations |
| `tools` | Tool execution, path validation |

### Log Format

```
[2026-03-08T14:30:45.123Z] [INFO] taskStore: Loaded 12 tasks
[2026-03-08T14:30:46.001Z] [WARN] copilot: No language model available
```

Note: `.agentkanban/logs/` should be added to `.gitignore` — logs are not intended for version control.

## Future: Token Management

- Conversation summary: user-triggered condensation of older messages
- Smart truncation: description + summary + last N messages
- UI warning when conversation approaches token limits
