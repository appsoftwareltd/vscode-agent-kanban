import * as vscode from 'vscode';
import type { TaskStore } from './TaskStore';
import type { BoardConfigStore } from './BoardConfigStore';
import type { LogService } from './LogService';
import { NO_OP_LOGGER } from './LogService';
import { isProtectedLane, PROTECTED_LANE_NAMES } from './types';
import type { Priority } from './types';

function sanitiseLaneName(raw: string): string {
    return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export class KanbanEditorPanel {
    public static readonly VIEW_TYPE = 'agentKanban.boardPanel';
    public static currentPanel: KanbanEditorPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _logger: LogService;
    private _disposables: vscode.Disposable[] = [];
    private _webviewReady = false;
    private _pendingMessages: unknown[] = [];

    // ── Public API ───────────────────────────────────────────────────────────

    /** Create a new panel, or reveal the existing one. */
    public static createOrShow(
        extensionUri: vscode.Uri,
        taskStore: TaskStore,
        boardConfigStore: BoardConfigStore,
        logger?: LogService,
    ): KanbanEditorPanel {
        const column =
            vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        if (KanbanEditorPanel.currentPanel) {
            KanbanEditorPanel.currentPanel._panel.reveal(column);
            return KanbanEditorPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            KanbanEditorPanel.VIEW_TYPE,
            'Agent Kanban',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'dist', 'webview'),
                ],
            },
        );

        panel.iconPath = {
            light: vscode.Uri.joinPath(extensionUri, 'images', 'kanban-icon.svg'),
            dark: vscode.Uri.joinPath(extensionUri, 'images', 'kanban-icon.svg'),
        };

        KanbanEditorPanel.currentPanel = new KanbanEditorPanel(
            panel,
            extensionUri,
            taskStore,
            boardConfigStore,
            logger,
        );
        return KanbanEditorPanel.currentPanel;
    }

    /** Revive a panel after VS Code restart (called by the serialiser). */
    public static revive(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        taskStore: TaskStore,
        boardConfigStore: BoardConfigStore,
        logger?: LogService,
    ): void {
        KanbanEditorPanel.currentPanel = new KanbanEditorPanel(
            panel,
            extensionUri,
            taskStore,
            boardConfigStore,
            logger,
        );
    }

    /** Push fresh board state to the webview. */
    public async refresh(): Promise<void> {
        await this._sendState();
    }

    /** Tell the webview to open the create-task modal. */
    public triggerCreateModal(): void {
        const msg = { type: 'openCreateModal' };
        if (this._webviewReady) {
            this._panel.webview.postMessage(msg);
        } else {
            this._pendingMessages.push(msg);
        }
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    private constructor(
        panel: vscode.WebviewPanel,
        private readonly _extensionUri: vscode.Uri,
        private readonly _taskStore: TaskStore,
        private readonly _boardConfigStore: BoardConfigStore,
        logger?: LogService,
    ) {
        this._panel = panel;
        this._logger = logger ?? NO_OP_LOGGER;

        // Enforce options (important when reviving a deserialized panel)
        this._panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview'),
            ],
        };

        this._setWebviewHtml();

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                this._logger.info('boardPanel', `Message: ${message.type}`);
                await this._handleMessage(message);
            },
            undefined,
            this._disposables,
        );

        // Subscribe to store changes so the panel always reflects current data
        this._disposables.push(this._taskStore.onDidChange(() => this._sendState()));
        this._disposables.push(this._boardConfigStore.onDidChange(() => this._sendState()));

        this._panel.onDidDispose(() => this._dispose(), undefined, this._disposables);
    }

    // ── Webview HTML ─────────────────────────────────────────────────────────

    private _setWebviewHtml(): void {
        const webview = this._panel.webview;

        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'board.js'),
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'board.css'),
        );

        this._panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${styleUri}">
    <title>Agent Kanban</title>
</head>
<body>
    <div id="app"></div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }

    // ── State ────────────────────────────────────────────────────────────────

    private async _sendState(): Promise<void> {
        const tasks = this._taskStore.getAll()
            .filter((t) => !t.archived)
            .sort((a, b) => {
                const sa = a.sortOrder ?? Date.parse(a.created);
                const sb = b.sortOrder ?? Date.parse(b.created);
                return sa - sb;
            });
        const config = this._boardConfigStore.get();
        await this._panel.webview.postMessage({
            type: 'stateUpdate',
            state: { tasks, config },
        });
    }

    // ── Message Handlers ─────────────────────────────────────────────────────

    private async _handleMessage(message: any): Promise<void> {
        switch (message.type) {
            case 'ready':
                await this._sendState();
                this._webviewReady = true;
                for (const msg of this._pendingMessages) {
                    this._panel.webview.postMessage(msg);
                }
                this._pendingMessages = [];
                break;

            case 'openTask': {
                const task = this._taskStore.get(message.taskId);
                if (task) {
                    const uri = this._taskStore.getTaskUri(message.taskId);
                    const doc = await vscode.workspace.openTextDocument(uri);
                    await vscode.window.showTextDocument(doc, {
                        viewColumn: vscode.ViewColumn.Active,
                    });
                }
                break;
            }

            case 'moveTask': {
                const task = this._taskStore.get(message.taskId);
                if (task) {
                    task.lane = message.lane;
                    if (typeof message.sortOrder === 'number') {
                        task.sortOrder = message.sortOrder;
                    }
                    await this._taskStore.save(task);
                }
                break;
            }

            case 'newTask': {
                // Legacy — now handled by createTask from the webview modal.
                // Keep for backwards compat if the sidebar still sends this.
                const title = await vscode.window.showInputBox({
                    prompt: 'Enter task title',
                    placeHolder: 'Task title',
                    validateInput: (v) => (v.trim() ? null : 'Title cannot be empty'),
                });
                if (!title) {
                    break;
                }
                const config = this._boardConfigStore.get();
                const firstLane = config.lanes[0]?.id ?? 'todo';
                const task = this._taskStore.createTask(title.trim(), firstLane);
                await this._taskStore.save(task);
                break;
            }

            case 'createTask': {
                const title = (message.title ?? '').trim();
                if (!title) {
                    break;
                }
                const lane = message.lane || this._boardConfigStore.get().lanes[0]?.id || 'todo';
                const task = this._taskStore.createTask(title, lane);
                // Assign sortOrder: place at end of target lane
                const laneTasks = this._taskStore.getAll()
                    .filter((t) => t.lane === lane && !t.archived)
                    .sort((a, b) => (a.sortOrder ?? Date.parse(a.created)) - (b.sortOrder ?? Date.parse(b.created)));
                const lastOrder = laneTasks.length > 0
                    ? (laneTasks[laneTasks.length - 1].sortOrder ?? Date.parse(laneTasks[laneTasks.length - 1].created))
                    : 0;
                task.sortOrder = lastOrder + 1;
                task.priority = message.priority as Priority | undefined;
                task.assignee = message.assignee as string | undefined;
                task.labels = message.labels as string[] | undefined;
                task.dueDate = message.dueDate as string | undefined;
                task.description = (message.description ?? '').trim();

                // Build custom body with description as first [user] entry
                let body: string;
                if (task.description) {
                    body = `\n## Conversation\n\n[user]\n\n${task.description}\n\n`;
                } else {
                    body = '\n## Conversation\n\n[user]\n\n';
                }
                await this._taskStore.saveWithBody(task, body);
                break;
            }

            case 'addLane': {
                const config = this._boardConfigStore.get();
                const laneName = await vscode.window.showInputBox({
                    prompt: 'Enter lane name',
                    placeHolder: 'Lane name',
                    validateInput: (v) => {
                        const sanitised = sanitiseLaneName(v);
                        if (!sanitised) {
                            return 'Name cannot be empty';
                        }
                        if (PROTECTED_LANE_NAMES.includes(sanitised)) {
                            return `"${sanitised}" is a reserved lane name`;
                        }
                        if (config.lanes.some((l) => l.id === sanitised)) {
                            return `A lane named "${sanitised}" already exists`;
                        }
                        return null;
                    },
                });
                if (laneName) {
                    const id = sanitiseLaneName(laneName);
                    if (id) {
                        config.lanes.push({ id, name: id });
                        await this._boardConfigStore.update({ lanes: config.lanes });
                    }
                }
                break;
            }

            case 'removeLane': {
                const config = this._boardConfigStore.get();
                const lane = config.lanes.find((l) => l.id === message.laneId);
                if (lane && isProtectedLane(lane)) {
                    vscode.window.showWarningMessage(
                        `The ${lane.name} lane cannot be removed.`,
                    );
                    break;
                }
                const laneTasks = this._taskStore
                    .getAll()
                    .filter((t) => t.lane === message.laneId);
                if (laneTasks.length > 0) {
                    const confirm = await vscode.window.showWarningMessage(
                        `Removing this lane will delete ${laneTasks.length} task${laneTasks.length === 1 ? '' : 's'}. Continue?`,
                        { modal: true },
                        'Yes',
                    );
                    if (confirm !== 'Yes') {
                        break;
                    }
                    for (const task of laneTasks) {
                        await this._taskStore.delete(task.id);
                    }
                }
                config.lanes = config.lanes.filter((l) => l.id !== message.laneId);
                await this._boardConfigStore.update({ lanes: config.lanes });
                break;
            }

            case 'renameLane': {
                const config = this._boardConfigStore.get();
                const lane = config.lanes.find((l) => l.id === message.laneId);
                if (!lane) {
                    break;
                }
                if (isProtectedLane(lane)) {
                    vscode.window.showWarningMessage(
                        `The ${lane.name} lane cannot be renamed.`,
                    );
                    break;
                }
                const newName = await vscode.window.showInputBox({
                    prompt: 'Rename lane',
                    value: lane.name,
                    validateInput: (v) => {
                        const sanitised = sanitiseLaneName(v);
                        if (!sanitised) {
                            return 'Name cannot be empty';
                        }
                        if (PROTECTED_LANE_NAMES.includes(sanitised)) {
                            return `Cannot rename to "${sanitised}" — that name is reserved`;
                        }
                        if (sanitised !== lane.id && config.lanes.some((l) => l.id === sanitised)) {
                            return `A lane named "${sanitised}" already exists`;
                        }
                        return null;
                    },
                });
                if (newName) {
                    const newId = sanitiseLaneName(newName);
                    if (newId && newId !== lane.id) {
                        const oldId = lane.id;
                        lane.id = newId;
                        lane.name = newId;
                        await this._boardConfigStore.update({ lanes: config.lanes });
                        // Migrate tasks from old lane to new lane
                        const tasks = this._taskStore.getAll().filter((t) => t.lane === oldId);
                        for (const task of tasks) {
                            task.lane = newId;
                            await this._taskStore.save(task);
                        }
                    }
                }
                break;
            }

            case 'deleteTask':
                await this._taskStore.delete(message.taskId);
                break;

            case 'moveLane': {
                const config = this._boardConfigStore.get();
                const fromIndex = config.lanes.findIndex(
                    (l) => l.id === message.sourceLaneId,
                );
                const toIndex = config.lanes.findIndex(
                    (l) => l.id === message.targetLaneId,
                );
                if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
                    const [moved] = config.lanes.splice(fromIndex, 1);
                    config.lanes.splice(toIndex, 0, moved);
                    await this._boardConfigStore.update({ lanes: config.lanes });
                }
                break;
            }

            case 'updateTaskMeta': {
                const task = this._taskStore.get(message.taskId);
                if (!task) {
                    break;
                }
                // Update optional fields (undefined clears them from YAML)
                task.priority = message.priority as Priority | undefined;
                task.assignee = message.assignee as string | undefined;
                task.labels = message.labels as string[] | undefined;
                task.dueDate = message.dueDate as string | undefined;
                if (message.lane && message.lane !== task.lane) {
                    task.lane = message.lane;
                }
                await this._taskStore.save(task);
                break;
            }

            case 'addUser':
                await this._boardConfigStore.addUser(message.name);
                break;

            case 'addLabel':
                await this._boardConfigStore.addLabel(message.name);
                break;

            case 'sendToChat': {
                const task = this._taskStore.get(message.taskId);
                if (task) {
                    await vscode.commands.executeCommand(
                        'workbench.action.chat.open',
                        { query: `@kanban /task ${task.title}` },
                    );
                }
                break;
            }

            case 'archiveTask': {
                const task = this._taskStore.get(message.taskId);
                if (task) {
                    task.archived = true;
                    await this._taskStore.save(task);
                }
                break;
            }
        }
    }

    // ── Disposal ─────────────────────────────────────────────────────────────

    private _dispose(): void {
        KanbanEditorPanel.currentPanel = undefined;
        this._panel.dispose();
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables = [];
    }
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
}

// Keep getNonce available for potential future use (linter may warn otherwise)
void getNonce;
