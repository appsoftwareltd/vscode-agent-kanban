import * as vscode from 'vscode';
import * as path from 'path';
import { BoardViewProvider } from './BoardViewProvider';
import { TaskDetailViewProvider } from './TaskDetailViewProvider';
import { TaskStore } from './TaskStore';
import { BoardConfigStore } from './BoardConfigStore';
import { CopilotChatProvider } from './agents/CopilotChatProvider';
import { ensureUserName } from './userName';
import { LogService, NO_OP_LOGGER } from './LogService';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return;
    }

    // Create LogService — enabled by setting or env var, requires reload to change.
    const config = vscode.workspace.getConfiguration('agentKanban');
    const loggingEnabled = config.get<boolean>('enableLogging', false)
        || process.env.AGENT_KANBAN_DEBUG === '1';
    const logDir = path.join(workspaceFolder.uri.fsPath, '.agentkanban', 'logs');
    const logger = loggingEnabled ? new LogService(logDir, { enabled: true }) : NO_OP_LOGGER;
    if (logger.isEnabled) {
        logger.info('extension', 'Logging activated');
    }

    const taskStore = new TaskStore(workspaceFolder.uri, logger);
    const boardConfigStore = new BoardConfigStore(workspaceFolder.uri, logger);
    const agentProvider = new CopilotChatProvider(logger);

    const boardViewProvider = new BoardViewProvider(
        context.extensionUri,
        taskStore,
        boardConfigStore,
        logger,
    );

    const taskDetailViewProvider = new TaskDetailViewProvider(
        context.extensionUri,
        taskStore,
        boardConfigStore,
        agentProvider,
        logger,
    );

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'agentKanban.boardView',
            boardViewProvider,
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agentKanban.openBoard', () => {
            vscode.commands.executeCommand('agentKanban.boardView.focus');
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agentKanban.newTask', async () => {
            const userName = await ensureUserName();
            if (!userName) {
                return;
            }
            boardViewProvider.createNewTask();
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agentKanban.openTask', (taskId: string) => {
            taskDetailViewProvider.openTask(taskId);
        }),
    );

    // Register chat participant
    const chatParticipant = vscode.chat.createChatParticipant(
        'agentKanban.chat',
        async (request, context, response, token) => {
            await agentProvider.handleChatRequest(request, context, response, token, taskStore, boardConfigStore);
        },
    );
    chatParticipant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'kanban-icon.svg');
    context.subscriptions.push(chatParticipant);

    // File watcher for YAML changes
    const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceFolder, '.agentkanban/**/*.yaml'),
    );
    watcher.onDidChange(() => {
        taskStore.reload();
        boardViewProvider.refresh();
    });
    watcher.onDidCreate(() => {
        taskStore.reload();
        boardViewProvider.refresh();
    });
    watcher.onDidDelete(() => {
        taskStore.reload();
        boardViewProvider.refresh();
    });
    context.subscriptions.push(watcher);

    // Initialise stores
    await boardConfigStore.init();
    await taskStore.init();

    if (logger.isEnabled) {
        logger.info('extension', 'Extension activated');
    }
}

export function deactivate(): void {
    // nothing to clean up
}
