import * as vscode from 'vscode';
import type { TaskStore } from './TaskStore';
import type { BoardConfigStore } from './BoardConfigStore';
import type { AgentProvider } from './agents/AgentProvider';
import type { Task, Message } from './types';
import { STATUS_PREFIX } from './agents/CopilotChatProvider';
import { ensureUserName, getUserName } from './userName';
import type { LogService } from './LogService';
import { NO_OP_LOGGER } from './LogService';

export class TaskDetailViewProvider {
    private panels: Map<string, vscode.WebviewPanel> = new Map();
    private sendingTasks = new Set<string>();
    private readonly logger: LogService;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly taskStore: TaskStore,
        private readonly boardConfigStore: BoardConfigStore,
        private readonly agentProvider: AgentProvider,
        logger?: LogService,
    ) {
        this.logger = logger ?? NO_OP_LOGGER;
    }

    async openTask(taskId: string): Promise<void> {
        // If panel already open, reveal it
        const existing = this.panels.get(taskId);
        if (existing) {
            existing.reveal();
            return;
        }

        const task = this.taskStore.get(taskId);
        if (!task) {
            vscode.window.showErrorMessage(`Task ${taskId} not found`);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'agentKanban.taskDetail',
            task.title,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this.extensionUri],
            },
        );

        this.panels.set(taskId, panel);
        this.logger.info('taskDetail', `Opened task panel: ${taskId}`);

        panel.onDidDispose(() => {
            this.panels.delete(taskId);
            this.logger.info('taskDetail', `Closed task panel: ${taskId}`);
        });

        panel.webview.onDidReceiveMessage(async (message) => {
            this.logger.info('taskDetail', `Message: ${message.type} (task=${taskId})`);
            await this.handleMessage(taskId, panel, message);
        });

        this.updatePanel(taskId, panel);

        // Send available models to the webview
        this.sendAvailableModels(panel);

        // Listen for task changes to refresh the panel
        this.taskStore.onDidChange(() => {
            if (this.panels.has(taskId) && !this.sendingTasks.has(taskId)) {
                this.updatePanel(taskId, panel);
            }
        });
    }

    private updatePanel(taskId: string, panel: vscode.WebviewPanel): void {
        const task = this.taskStore.get(taskId);
        if (!task) {
            return;
        }
        const config = this.boardConfigStore.get();
        panel.title = task.title;
        panel.webview.html = this.getHtml(panel.webview, task, config);
        // Re-send models when panel refreshes
        this.sendAvailableModels(panel);
    }

    private async sendAvailableModels(panel: vscode.WebviewPanel): Promise<void> {
        try {
            const models = await vscode.lm.selectChatModels();
            const modelList = models.map(m => ({ id: m.id, name: m.name || m.id }));
            panel.webview.postMessage({ type: 'availableModels', models: modelList });
        } catch {
            // lm API may not be available in tests
        }
    }

    private async handleMessage(taskId: string, panel: vscode.WebviewPanel, message: any): Promise<void> {
        switch (message.type) {
            case 'sendMessage': {
                this.logger.info('taskDetail', `sendMessage received: action=${message.action} task=${taskId}`);
                const userName = await ensureUserName();
                if (!userName) {
                    this.logger.warn('taskDetail', `sendMessage aborted: no userName (task=${taskId})`);
                    panel.webview.postMessage({ type: 'agentDone' });
                    return;
                }
                const task = this.taskStore.get(taskId);
                if (!task) {
                    this.logger.warn('taskDetail', `sendMessage aborted: task not found (${taskId})`);
                    panel.webview.postMessage({ type: 'agentDone' });
                    return;
                }

                const action = message.action as 'plan' | 'todo' | 'implement';
                const content = message.content?.trim();
                if (!content) {
                    this.logger.warn('taskDetail', `sendMessage aborted: empty content (task=${taskId})`);
                    panel.webview.postMessage({ type: 'agentDone' });
                    return;
                }

                // Guard: suppress updatePanel during send
                this.sendingTasks.add(taskId);

                try {
                    // Append user message
                    const userMsg: Message = {
                        role: 'user',
                        author: userName,
                        action,
                        timestamp: new Date().toISOString(),
                        content,
                    };
                    this.taskStore.appendMessage(task, userMsg);
                    await this.taskStore.save(task);

                    // Execute agent
                    const boardConfig = this.boardConfigStore.get();
                    const context = {
                        task,
                        conversation: task.conversation,
                        boardConfig,
                        action,
                        userMessage: content,
                    };

                    let fullResponse = '';
                    try {
                        this.logger.info('taskDetail', `Agent execute: ${action} on task ${taskId}`);
                        const done = this.logger.time('taskDetail', `agent ${taskId}`);
                        for await (const chunk of this.agentProvider.execute(context)) {
                            fullResponse += chunk;
                            // Stream update to webview
                            panel.webview.postMessage({
                                type: 'agentChunk',
                                content: fullResponse,
                            });
                        }
                        done();
                        this.logger.info('taskDetail', `Agent complete: task=${taskId} responseLen=${fullResponse.length}`);
                    } catch (err: any) {
                        this.logger.error('taskDetail', `Agent error on task ${taskId}: ${err.message}`);
                        fullResponse = `Error: ${err.message || 'Agent execution failed'}`;
                    }

                    // Strip ephemeral tool-status lines before persisting
                    const persistentResponse = TaskDetailViewProvider.stripStatusLines(fullResponse);

                    // Append agent response
                    const agentMsg: Message = {
                        role: 'agent',
                        provider: this.agentProvider.name,
                        timestamp: new Date().toISOString(),
                        content: persistentResponse,
                    };
                    this.taskStore.appendMessage(task, agentMsg);
                    await this.taskStore.save(task);
                } finally {
                    // Release guard and refresh panel with final state
                    this.sendingTasks.delete(taskId);
                    this.updatePanel(taskId, panel);
                }

                // Signal streaming complete
                panel.webview.postMessage({ type: 'agentDone' });

                break;
            }
            case 'updateTitle': {
                const task = this.taskStore.get(taskId);
                if (task && message.title?.trim()) {
                    task.title = message.title.trim();
                    await this.taskStore.save(task);
                    panel.title = task.title;
                }
                break;
            }
            case 'updateDescription': {
                const task = this.taskStore.get(taskId);
                if (task) {
                    task.description = message.description ?? '';
                    await this.taskStore.save(task);
                }
                break;
            }
            case 'updateLane': {
                const task = this.taskStore.get(taskId);
                if (task && message.lane) {
                    task.lane = message.lane;
                    await this.taskStore.save(task);
                }
                break;
            }
            case 'updateModel': {
                const task = this.taskStore.get(taskId);
                if (task) {
                    task.model = message.model || undefined; // empty string = clear override
                    await this.taskStore.save(task);
                }
                break;
            }
        }
    }

    /** Remove ephemeral STATUS_PREFIX lines from agent output before saving to YAML. */
    static stripStatusLines(text: string): string {
        return text
            .split('\n')
            .filter(line => !line.includes(STATUS_PREFIX))
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    private getHtml(webview: vscode.Webview, task: Task, config: any): string {
        const nonce = getNonce();
        const lanes = config.lanes || [];

        const conversationHtml = task.conversation.map((msg: Message) => {
            const isAgent = msg.role === 'agent';
            const label = isAgent
                ? `<span class="msg-provider">${escapeHtml(msg.provider || 'agent')}</span>`
                : `<span class="msg-author">${escapeHtml(msg.author || 'user')}</span>`;
            const actionBadge = msg.action
                ? `<span class="msg-action msg-action-${escapeHtml(msg.action)}">${escapeHtml(msg.action)}</span>`
                : '';
            const time = msg.timestamp
                ? `<span class="msg-time">${escapeHtml(new Date(msg.timestamp).toLocaleString())}</span>`
                : '';

            return `
                <div class="message ${isAgent ? 'message-agent' : 'message-user'}">
                    <div class="msg-header">${label}${actionBadge}${time}</div>
                    <div class="msg-content">${escapeHtml(msg.content)}</div>
                </div>
            `;
        }).join('');

        const laneOptions = lanes.map((l: any) =>
            `<option value="${escapeHtml(l.id)}" ${l.id === task.lane ? 'selected' : ''}>${escapeHtml(l.name)}</option>`
        ).join('');

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
            background: var(--vscode-editor-background);
            display: flex;
            flex-direction: column;
            height: 100vh;
            padding: 16px;
        }
        .task-header {
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--vscode-widget-border);
        }
        .task-title {
            font-size: 18px;
            font-weight: 600;
            background: none;
            border: 1px solid transparent;
            color: var(--vscode-foreground);
            width: 100%;
            padding: 4px 6px;
            border-radius: 3px;
            font-family: inherit;
        }
        .task-title:hover, .task-title:focus {
            border-color: var(--vscode-focusBorder);
            outline: none;
        }
        .task-meta {
            display: flex;
            gap: 12px;
            align-items: center;
            margin-top: 8px;
        }
        .task-meta label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .task-meta select, .task-meta textarea {
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            padding: 3px 6px;
            font-family: inherit;
            font-size: 12px;
        }
        .description {
            margin-top: 8px;
        }
        .description textarea {
            width: 100%;
            min-height: 60px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            padding: 6px 8px;
            font-family: inherit;
            font-size: 13px;
            resize: vertical;
        }
        .conversation {
            flex: 1;
            overflow-y: auto;
            margin: 12px 0;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .message {
            padding: 10px 14px;
            border-radius: 8px;
            max-width: 85%;
        }
        .message-user {
            background: var(--vscode-textBlockQuote-background);
            border-left: 3px solid var(--vscode-textLink-foreground);
            align-self: flex-start;
        }
        .message-agent {
            background: var(--vscode-editorGroupHeader-tabsBackground);
            border-left: 3px solid var(--vscode-charts-green);
            align-self: flex-end;
        }
        .msg-header {
            display: flex;
            gap: 8px;
            align-items: center;
            margin-bottom: 6px;
            font-size: 11px;
        }
        .msg-author {
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
        }
        .msg-provider {
            font-weight: 600;
            color: var(--vscode-charts-green);
        }
        .msg-action {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 1px 6px;
            border-radius: 3px;
            font-size: 10px;
            text-transform: uppercase;
            font-weight: 600;
        }
        .msg-time {
            color: var(--vscode-descriptionForeground);
            margin-left: auto;
        }
        .msg-content {
            font-size: 13px;
            line-height: 1.5;
            white-space: pre-wrap;
            word-break: break-word;
        }
        .streaming-indicator {
            padding: 10px 14px;
            border-radius: 8px;
            background: var(--vscode-editorGroupHeader-tabsBackground);
            border-left: 3px solid var(--vscode-charts-green);
            align-self: flex-end;
            max-width: 85%;
            display: none;
        }
        .streaming-indicator.active { display: block; }
        .status-text {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        .input-area {
            border-top: 1px solid var(--vscode-widget-border);
            padding-top: 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .action-bar {
            display: flex;
            gap: 6px;
        }
        .action-btn {
            padding: 4px 14px;
            border: 1px solid var(--vscode-button-border, var(--vscode-widget-border));
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            background: var(--vscode-editor-background);
            color: var(--vscode-foreground);
            transition: all 0.15s;
        }
        .action-btn:hover { background: var(--vscode-list-hoverBackground); }
        .action-btn.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: var(--vscode-button-background);
        }
        .input-row {
            display: flex;
            gap: 8px;
        }
        .input-row textarea {
            flex: 1;
            min-height: 60px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            padding: 8px;
            font-family: inherit;
            font-size: 13px;
            resize: vertical;
        }
        .send-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 20px;
            border-radius: 3px;
            cursor: pointer;
            font-weight: 600;
            align-self: flex-end;
        }
        .send-btn:hover { background: var(--vscode-button-hoverBackground); }
        .send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
    </style>
</head>
<body>
    <div class="task-header">
        <input class="task-title" id="taskTitle" type="text" value="${escapeAttr(task.title)}" />
        <div class="task-meta">
            <label>Lane:</label>
            <select id="laneSelect">
                ${laneOptions}
            </select>
            <label>Model:</label>
            <select id="modelSelect">
                <option value="">Default</option>
            </select>
        </div>
        <div class="description">
            <textarea id="taskDescription" placeholder="Task description...">${escapeHtml(task.description)}</textarea>
        </div>
    </div>

    <div class="conversation" id="conversation">
        ${conversationHtml}
        <div class="streaming-indicator" id="streaming">
            <div class="msg-header"><span class="msg-provider">agent</span><span class="msg-action">streaming...</span></div>
            <div class="msg-content" id="streaming-content"></div>
        </div>
    </div>

    <div class="input-area">
        <div class="action-bar">
            <button class="action-btn active" data-action="plan">Plan</button>
            <button class="action-btn" data-action="todo">Todo</button>
            <button class="action-btn" data-action="implement">Implement</button>
        </div>
        <div class="input-row">
            <textarea id="messageInput" placeholder="Type your message..."></textarea>
            <button class="send-btn" id="sendBtn">Send</button>
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        let currentAction = 'plan';
        let isSending = false;

        // Action buttons
        document.querySelectorAll('.action-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                currentAction = btn.dataset.action;
                document.querySelectorAll('.action-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // Send button
        document.getElementById('sendBtn').addEventListener('click', sendMessage);

        // Message input keyboard shortcut
        document.getElementById('messageInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                sendMessage();
            }
        });

        // Task header fields
        document.getElementById('taskTitle').addEventListener('change', (e) => {
            vscode.postMessage({ type: 'updateTitle', title: e.target.value });
        });
        document.getElementById('taskDescription').addEventListener('change', (e) => {
            vscode.postMessage({ type: 'updateDescription', description: e.target.value });
        });
        document.getElementById('laneSelect').addEventListener('change', (e) => {
            vscode.postMessage({ type: 'updateLane', lane: e.target.value });
        });
        document.getElementById('modelSelect').addEventListener('change', (e) => {
            vscode.postMessage({ type: 'updateModel', model: e.target.value });
        });

        const currentTaskModel = '${escapeAttr(task.model || '')}';

        const STATUS_MARKER = '\x00STATUS:';

        function renderStreamingContent(raw) {
            const el = document.getElementById('streaming-content');
            el.innerHTML = '';
            const lines = raw.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const idx = line.indexOf(STATUS_MARKER);
                if (idx !== -1) {
                    // Render text before marker as normal
                    if (idx > 0) {
                        el.appendChild(document.createTextNode(line.slice(0, idx)));
                    }
                    const span = document.createElement('span');
                    span.className = 'status-text';
                    span.textContent = line.slice(idx + STATUS_MARKER.length);
                    el.appendChild(span);
                } else {
                    el.appendChild(document.createTextNode(line));
                }
                if (i < lines.length - 1) {
                    el.appendChild(document.createTextNode('\n'));
                }
            }
        }

        function sendMessage() {
            if (isSending) { console.log('[kanban] sendMessage: already sending, ignoring'); return; }
            const input = document.getElementById('messageInput');
            const content = input.value.trim();
            if (!content) { console.log('[kanban] sendMessage: empty content, ignoring'); return; }

            console.log('[kanban] sendMessage:', currentAction, content.substring(0, 80));
            isSending = true;
            document.getElementById('sendBtn').disabled = true;
            document.getElementById('streaming').classList.add('active');
            document.getElementById('streaming-content').textContent = '';

            vscode.postMessage({
                type: 'sendMessage',
                action: currentAction,
                content,
            });

            input.value = '';
            scrollToBottom();
        }

        function scrollToBottom() {
            const conv = document.getElementById('conversation');
            conv.scrollTop = conv.scrollHeight;
        }

        window.addEventListener('message', (event) => {
            const msg = event.data;
            if (msg.type === 'agentChunk') {
                console.log('[kanban] agentChunk received, len:', msg.content?.length);
                renderStreamingContent(msg.content || '');
                scrollToBottom();
            } else if (msg.type === 'agentDone') {
                console.log('[kanban] agentDone received');
                isSending = false;
                document.getElementById('sendBtn').disabled = false;
                document.getElementById('streaming').classList.remove('active');
                // Panel will be refreshed by the task store change event
            } else if (msg.type === 'availableModels') {
                const select = document.getElementById('modelSelect');
                select.innerHTML = '<option value="">Default</option>';
                for (const m of msg.models) {
                    const opt = document.createElement('option');
                    opt.value = m.id;
                    opt.textContent = m.name;
                    if (m.id === currentTaskModel) { opt.selected = true; }
                    select.appendChild(opt);
                }
            }
        });

        // Scroll to bottom on load
        scrollToBottom();
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

function escapeAttr(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
