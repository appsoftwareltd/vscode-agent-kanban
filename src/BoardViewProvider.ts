import * as vscode from 'vscode';
import type { TaskStore } from './TaskStore';
import type { BoardConfigStore } from './BoardConfigStore';
import { ensureUserName } from './userName';
import type { LogService } from './LogService';
import { NO_OP_LOGGER } from './LogService';

export class BoardViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private readonly logger: LogService;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly taskStore: TaskStore,
        private readonly boardConfigStore: BoardConfigStore,
        logger?: LogService,
    ) {
        this.logger = logger ?? NO_OP_LOGGER;
        this.taskStore.onDidChange(() => this.refresh());
        this.boardConfigStore.onDidChange(() => this.refresh());
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };

        webviewView.webview.onDidReceiveMessage(async (message) => {
            this.logger.info('boardView', `Message: ${message.type}`);
            await this.handleMessage(message);
        });

        this.logger.info('boardView', 'Webview resolved');
        this.refresh();
    }

    async refresh(): Promise<void> {
        if (!this.view) {
            return;
        }

        const tasks = this.taskStore.getAll();
        const config = this.boardConfigStore.get();

        this.view.webview.html = this.getHtml(this.view.webview, tasks, config);
    }

    async createNewTask(): Promise<void> {
        const title = await vscode.window.showInputBox({
            prompt: 'Enter task title',
            placeHolder: 'Task title',
            validateInput: (v) => v.trim() ? null : 'Title cannot be empty',
        });
        if (!title) {
            return;
        }

        const config = this.boardConfigStore.get();
        const firstLane = config.lanes[0]?.id ?? 'todo';
        const task = this.taskStore.createTask(title.trim(), firstLane);
        await this.taskStore.save(task);
        this.refresh();
    }

    private async handleMessage(message: any): Promise<void> {
        switch (message.type) {
            case 'openTask': {
                const task = this.taskStore.get(message.taskId);
                if (task) {
                    const taskUri = this.taskStore.getTaskUri(message.taskId);
                    const doc = await vscode.workspace.openTextDocument(taskUri);
                    await vscode.window.showTextDocument(doc);
                }
                break;
            }
            case 'moveTask': {
                const task = this.taskStore.get(message.taskId);
                if (task) {
                    task.lane = message.lane;
                    await this.taskStore.save(task);
                }
                break;
            }
            case 'newTask':
                await ensureUserName();
                await this.createNewTask();
                break;
            case 'addLane': {
                const laneName = await vscode.window.showInputBox({
                    prompt: 'Enter lane name',
                    placeHolder: 'Lane name',
                    validateInput: (v) => v.trim() ? null : 'Name cannot be empty',
                });
                if (laneName?.trim()) {
                    const config = this.boardConfigStore.get();
                    const id = laneName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
                    config.lanes.push({ id, name: laneName.trim() });
                    await this.boardConfigStore.update({ lanes: config.lanes });
                }
                break;
            }
            case 'removeLane': {
                if (message.laneId === 'done') {
                    vscode.window.showWarningMessage('The Done lane cannot be removed.');
                    break;
                }
                const config = this.boardConfigStore.get();
                config.lanes = config.lanes.filter(l => l.id !== message.laneId);
                await this.boardConfigStore.update({ lanes: config.lanes });
                break;
            }
            case 'renameLane': {
                const config = this.boardConfigStore.get();
                const lane = config.lanes.find(l => l.id === message.laneId);
                if (lane) {
                    const newName = await vscode.window.showInputBox({
                        prompt: 'Rename lane',
                        value: lane.name,
                        validateInput: (v) => v.trim() ? null : 'Name cannot be empty',
                    });
                    if (newName?.trim()) {
                        lane.name = newName.trim();
                        await this.boardConfigStore.update({ lanes: config.lanes });
                    }
                }
                break;
            }
            case 'deleteTask': {
                await this.taskStore.delete(message.taskId);
                break;
            }
        }
    }

    private getHtml(webview: vscode.Webview, tasks: any[], config: any): string {
        const nonce = getNonce();
        const lanes = config.lanes || [];

        const laneHtml = lanes.map((lane: any) => {
            const laneTasks = tasks.filter((t: any) => t.lane === lane.id);
            const cardsHtml = laneTasks.map((t: any) => `
                <div class="card" draggable="true" data-task-id="${escapeHtml(t.id)}">
                    <div class="card-title">${escapeHtml(t.title)}</div>
                    <div class="card-meta">${escapeHtml(new Date(t.updated).toLocaleDateString())}</div>
                    <button class="card-delete" data-delete-task-id="${escapeHtml(t.id)}" title="Delete task">&times;</button>
                </div>
            `).join('');

            const isDoneLane = lane.id === 'done';
            return `
                <div class="lane" data-lane-id="${escapeHtml(lane.id)}">
                    <div class="lane-header">
                        <span class="lane-title" data-rename-lane-id="${escapeHtml(lane.id)}">${escapeHtml(lane.name)}</span>
                        <span class="lane-count">${laneTasks.length}</span>
                        ${isDoneLane ? '' : `<button class="lane-remove" data-remove-lane-id="${escapeHtml(lane.id)}" title="Remove lane">&times;</button>`}
                    </div>
                    <div class="lane-cards" data-lane-id="${escapeHtml(lane.id)}">
                        ${cardsHtml}
                    </div>
                </div>
            `;
        }).join('');

        return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style nonce="${nonce}">
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            padding: 8px;
            overflow-x: auto;
        }
        .toolbar {
            display: flex;
            gap: 8px;
            margin-bottom: 12px;
            flex-wrap: wrap;
        }
        .toolbar button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 12px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
        }
        .toolbar button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .board {
            display: flex;
            gap: 12px;
            min-height: 200px;
            overflow-x: auto;
            padding-bottom: 8px;
        }
        .lane {
            min-width: 180px;
            max-width: 260px;
            flex: 1;
            background: var(--vscode-editorGroupHeader-tabsBackground);
            border-radius: 6px;
            display: flex;
            flex-direction: column;
        }
        .lane-header {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 10px;
            font-weight: 600;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--vscode-descriptionForeground);
            border-bottom: 1px solid var(--vscode-widget-border);
        }
        .lane-title { flex: 1; cursor: default; }
        .lane-count {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 10px;
            padding: 1px 7px;
            font-size: 11px;
            font-weight: 600;
        }
        .lane-remove {
            background: none;
            border: none;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            font-size: 16px;
            line-height: 1;
            opacity: 0.5;
            padding: 0 2px;
        }
        .lane-remove:hover { opacity: 1; color: var(--vscode-errorForeground); }
        .lane-cards {
            flex: 1;
            padding: 6px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            min-height: 50px;
        }
        .lane-cards.drag-over {
            background: var(--vscode-list-hoverBackground);
            border-radius: 4px;
        }
        .card {
            position: relative;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 4px;
            padding: 8px 10px;
            cursor: pointer;
            transition: border-color 0.15s;
        }
        .card:hover {
            border-color: var(--vscode-focusBorder);
        }
        .card.dragging { opacity: 0.4; }
        .card-title {
            font-size: 13px;
            font-weight: 500;
            margin-bottom: 4px;
            padding-right: 16px;
        }
        .card-meta {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        .card-delete {
            position: absolute;
            top: 4px;
            right: 6px;
            background: none;
            border: none;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            font-size: 14px;
            opacity: 0;
            transition: opacity 0.15s;
            padding: 0 2px;
        }
        .card:hover .card-delete { opacity: 0.6; }
        .card-delete:hover { opacity: 1; color: var(--vscode-errorForeground); }
    </style>
</head>
<body>
    <div class="toolbar">
        <button id="btn-new-task">+ New Task</button>
        <button id="btn-add-lane">+ Add Lane</button>
    </div>
    <div class="board">
        ${laneHtml}
    </div>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        document.getElementById('btn-new-task').addEventListener('click', () => {
            vscode.postMessage({ type: 'newTask' });
        });
        document.getElementById('btn-add-lane').addEventListener('click', () => {
            vscode.postMessage({ type: 'addLane' });
        });

        // Event delegation for cards, delete buttons, lane remove, lane rename
        document.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('[data-delete-task-id]');
            if (deleteBtn) {
                e.stopPropagation();
                vscode.postMessage({ type: 'deleteTask', taskId: deleteBtn.dataset.deleteTaskId });
                return;
            }
            const card = e.target.closest('.card');
            if (card) {
                vscode.postMessage({ type: 'openTask', taskId: card.dataset.taskId });
                return;
            }
            const removeBtn = e.target.closest('[data-remove-lane-id]');
            if (removeBtn) {
                vscode.postMessage({ type: 'removeLane', laneId: removeBtn.dataset.removeLaneId });
                return;
            }
        });
        document.addEventListener('dblclick', (e) => {
            const renameEl = e.target.closest('[data-rename-lane-id]');
            if (renameEl) {
                vscode.postMessage({ type: 'renameLane', laneId: renameEl.dataset.renameLaneId });
            }
        });

        // Drag and drop
        let draggedTaskId = null;

        document.addEventListener('dragstart', (e) => {
            const card = e.target.closest?.('.card');
            if (!card) return;
            draggedTaskId = card.dataset.taskId;
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        document.addEventListener('dragend', (e) => {
            const card = e.target.closest?.('.card');
            if (card) card.classList.remove('dragging');
            document.querySelectorAll('.lane-cards').forEach(el => el.classList.remove('drag-over'));
            draggedTaskId = null;
        });

        document.addEventListener('dragover', (e) => {
            e.preventDefault();
            const laneCards = e.target.closest?.('.lane-cards');
            if (laneCards) {
                laneCards.classList.add('drag-over');
            }
        });

        document.addEventListener('dragleave', (e) => {
            const laneCards = e.target.closest?.('.lane-cards');
            if (laneCards && !laneCards.contains(e.relatedTarget)) {
                laneCards.classList.remove('drag-over');
            }
        });

        document.addEventListener('drop', (e) => {
            e.preventDefault();
            const laneCards = e.target.closest?.('.lane-cards');
            if (laneCards && draggedTaskId) {
                const lane = laneCards.dataset.laneId;
                vscode.postMessage({ type: 'moveTask', taskId: draggedTaskId, lane });
            }
            document.querySelectorAll('.lane-cards').forEach(el => el.classList.remove('drag-over'));
        });
    </script>
</body>
</html>`;
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

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
