import * as vscode from 'vscode';
import type { TaskStore } from './TaskStore';
import type { BoardConfigStore } from './BoardConfigStore';
import type { LogService } from './LogService';
import { NO_OP_LOGGER } from './LogService';
import { displayLane } from './types';

/**
 * Slim sidebar webview showing per-lane task counts and shortcuts.
 * The full Kanban board lives in the KanbanEditorPanel (editor tab).
 */
export class BoardViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private readonly _logger: LogService;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _taskStore: TaskStore,
        private readonly _boardConfigStore: BoardConfigStore,
        private _isInitialised: boolean,
        logger?: LogService,
    ) {
        this._logger = logger ?? NO_OP_LOGGER;
        this._taskStore.onDidChange(() => this.refresh());
        this._boardConfigStore.onDidChange(() => this.refresh());
    }

    setInitialised(flag: boolean): void {
        this._isInitialised = flag;
        this.refresh();
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this.view = webviewView;

        webviewView.webview.options = { enableScripts: true };

        webviewView.webview.onDidReceiveMessage(async (message) => {
            this._logger.info('boardView', `Message: ${message.type}`);
            if (message.type === 'openBoard') {
                await vscode.commands.executeCommand('agentKanban.openBoard');
            } else if (message.type === 'newTask') {
                await vscode.commands.executeCommand('agentKanban.newTask');
            } else if (message.type === 'initialise') {
                await vscode.commands.executeCommand('agentKanban.initialise');
            }
        });

        this._logger.info('boardView', 'Sidebar webview resolved');
        this.refresh();
    }

    refresh(): void {
        if (!this.view) {
            return;
        }
        if (!this._isInitialised) {
            this.view.webview.html = this._getUninitHtml();
            return;
        }
        const tasks = this._taskStore.getAll();
        const config = this._boardConfigStore.get();
        this.view.webview.html = this._getHtml(tasks, config);
    }

    private _getUninitHtml(): string {
        const nonce = getNonce();
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <style nonce="${nonce}">
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            padding: 16px 12px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .title {
            font-weight: 600;
            font-size: 13px;
        }
        .desc {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            line-height: 1.5;
        }
        .btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none; padding: 6px 12px; border-radius: 3px;
            cursor: pointer; font-size: 12px; width: 100%;
        }
        .btn:hover { background: var(--vscode-button-hoverBackground); }
    </style>
</head>
<body>
    <div class="title">Agent Kanban</div>
    <div class="desc">This workspace has not yet been initialised. Click below to set up the Kanban board and agent instruction files.</div>
    <button class="btn" id="btn-init">Initialise Agent Kanban</button>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        document.getElementById('btn-init').addEventListener('click', () => vscode.postMessage({ type: 'initialise' }));
    </script>
</body>
</html>`;
    }

    private _getHtml(tasks: any[], config: any): string {
        const nonce = getNonce();
        const lanes: any[] = config.lanes ?? [];

        const totalActive = tasks.filter((t: any) => t.lane !== 'done').length;

        const lanesHtml = lanes
            .map((lane: string) => {
                const count = tasks.filter((t: any) => t.lane === lane).length;
                return `<div class="lane-row">
                    <span class="lane-name">${escapeHtml(displayLane(lane))}</span>
                    <span class="lane-cnt">${count}</span>
                </div>`;
            })
            .join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <style nonce="${nonce}">
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            padding: 10px 8px;
        }
        .actions { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
        .btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none; padding: 4px 10px; border-radius: 3px;
            cursor: pointer; font-size: 12px; flex: 1;
            display: inline-flex; align-items: center; justify-content: center; gap: 6px;
        }
        .btn:hover { background: var(--vscode-button-hoverBackground); }
        .btn-sec {
            background: rgba(255, 255, 255, 0.12);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn-sec:hover { background: rgba(255, 255, 255, 0.18); }
        .section-label {
            font-size: 10px; font-weight: 700; text-transform: uppercase;
            letter-spacing: 0.6px; color: var(--vscode-descriptionForeground);
            margin-bottom: 6px;
        }
        .lanes { display: flex; flex-direction: column; gap: 3px; }
        .lane-row {
            display: flex; justify-content: space-between; align-items: center;
            padding: 3px 2px; font-size: 12px;
        }
        .lane-name { color: var(--vscode-foreground); font-weight: 500; }
        .lane-cnt {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 10px; padding: 1px 7px;
            font-size: 11px; font-weight: 600;
        }
        .summary { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 10px; }
    </style>
</head>
<body>
    <div class="actions">
        <button class="btn" id="btn-open"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="2" width="3" height="10" rx="0.5" fill="currentColor"/><rect x="5.5" y="2" width="3" height="7" rx="0.5" fill="currentColor"/><rect x="10" y="2" width="3" height="9" rx="0.5" fill="currentColor"/></svg>Open Board</button>
        <button class="btn btn-sec" id="btn-new">+ New Task</button>
    </div>
    <div class="summary">${totalActive} active task${totalActive !== 1 ? 's' : ''}</div>
    <div class="section-label">Lanes</div>
    <div class="lanes">${lanesHtml}</div>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        document.getElementById('btn-open').addEventListener('click', () => vscode.postMessage({ type: 'openBoard' }));
        document.getElementById('btn-new').addEventListener('click', () => vscode.postMessage({ type: 'newTask' }));
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
