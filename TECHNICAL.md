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
│   └── CopilotChatProvider.ts # GitHub Copilot Chat Participant implementation
└── test/
    ├── __mocks__/vscode.ts   # VS Code API mock for unit tests
    ├── LogService.test.ts    # Log writing, rotation, no-op tests
    ├── TaskStore.test.ts     # Task serialisation round-trip tests
    └── BoardConfigStore.test.ts # Board config serialisation tests
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
- Prompt construction layers:
  1. Board base prompt
  2. Action-specific system instruction
  3. Task title + description
  4. Full conversation history (user messages prefixed with `[author]:`)
  5. Current user message
- Uses `model.sendRequest()` for streaming responses
- `handleChatRequest()` for Chat Participant invocations — appends both user and agent messages to YAML
- `execute()` for webview invocations — returns `AsyncIterable<string>` chunks

### Action Instructions

| Action | System Instruction |
|--------|--------------------|
| `plan` | Discuss, analyse, plan. No code or TODOs. |
| `todo` | Generate/update actionable TODO list in markdown checkbox format. |
| `implement` | Write code following pragmatic principles. Explain what and why. |

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
