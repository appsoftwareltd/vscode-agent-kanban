import * as vscode from 'vscode';
import * as path from 'path';
import { BoardViewProvider } from './BoardViewProvider';
import { KanbanEditorPanel } from './KanbanEditorPanel';
import { TaskStore } from './TaskStore';
import { BoardConfigStore } from './BoardConfigStore';
import { ChatParticipant } from './agents/ChatParticipant';
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
    const chatParticipantHandler = new ChatParticipant(taskStore, boardConfigStore, context.extensionUri, logger);

    const boardViewProvider = new BoardViewProvider(
        context.extensionUri,
        taskStore,
        boardConfigStore,
        logger,
    );

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'agentKanban.boardView',
            boardViewProvider,
        ),
    );

    // Register the webview panel serialiser so the board panel survives reloads
    context.subscriptions.push(
        vscode.window.registerWebviewPanelSerializer(KanbanEditorPanel.VIEW_TYPE, {
            async deserializeWebviewPanel(panel: vscode.WebviewPanel) {
                KanbanEditorPanel.revive(panel, context.extensionUri, taskStore, boardConfigStore, logger);
            },
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agentKanban.openBoard', () => {
            KanbanEditorPanel.createOrShow(context.extensionUri, taskStore, boardConfigStore, logger);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agentKanban.newTask', () => {
            KanbanEditorPanel.createOrShow(context.extensionUri, taskStore, boardConfigStore, logger);
            KanbanEditorPanel.currentPanel?.triggerCreateModal();
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agentKanban.openTask', async (taskId: string) => {
            const task = taskStore.get(taskId);
            if (task) {
                const uri = taskStore.getTaskUri(taskId);
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc);
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agentKanban.resetMemory', async () => {
            const memoryUri = vscode.Uri.joinPath(workspaceFolder.uri, '.agentkanban', 'memory.md');
            try {
                await vscode.workspace.fs.writeFile(memoryUri, new TextEncoder().encode('# Memory\n'));
                vscode.window.showInformationMessage('Agent Kanban memory has been reset.');
                logger.info('extension', 'Memory reset');
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to reset memory: ${err.message}`);
            }
        }),
    );

    // Register chat participant
    const participant = vscode.chat.createChatParticipant(
        'agentKanban.chat',
        async (request, chatContext, response, token) => {
            await chatParticipantHandler.handleRequest(request, chatContext, response, token);
        },
    );
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'kanban-icon.svg');
    participant.followupProvider = {
        provideFollowups() {
            return chatParticipantHandler.getFollowups();
        },
    };
    context.subscriptions.push(participant);

    // File watcher for task markdown files — debounced to coalesce
    // delete+create pairs that file-system moves produce.
    const mdWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceFolder, '.agentkanban/tasks/**/*.md'),
    );
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    const debouncedReload = () => {
        if (reloadTimer) { clearTimeout(reloadTimer); }
        reloadTimer = setTimeout(async () => {
            reloadTimer = undefined;
            const taskDirs = await taskStore.getDirectories();
            boardConfigStore.reconcileWithDirectories(taskDirs);
            await taskStore.reload();
        }, 200);
    };
    mdWatcher.onDidChange(debouncedReload);
    mdWatcher.onDidCreate(debouncedReload);
    mdWatcher.onDidDelete(debouncedReload);
    context.subscriptions.push(mdWatcher);

    // Directory watcher — detects empty directory creation and directory renames
    // under the tasks folder so new lanes appear on the board immediately.
    const dirWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceFolder, '.agentkanban/tasks/*'),
    );
    dirWatcher.onDidCreate(debouncedReload);
    dirWatcher.onDidDelete(debouncedReload);
    context.subscriptions.push(dirWatcher);

    // File watcher for board config
    const yamlWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceFolder, '.agentkanban/board.yaml'),
    );
    yamlWatcher.onDidChange(async () => { await boardConfigStore.init(); });
    context.subscriptions.push(yamlWatcher);

    // Initialise stores
    await boardConfigStore.init();
    await taskStore.init();

    // Housekeeping: reconcile assignees/labels from task frontmatter into board.yaml
    const runHousekeeping = async () => {
        const tasks = taskStore.getAll();
        await boardConfigStore.reconcileMetadata(tasks);
    };
    await runHousekeeping();
    const housekeepingInterval = setInterval(runHousekeeping, 10 * 60 * 1000);
    context.subscriptions.push({ dispose: () => clearInterval(housekeepingInterval) });

    // Sync INSTRUCTION.md and AGENTS.md managed section (keeps them up-to-date on extension updates)
    await chatParticipantHandler.syncInstructionFile();
    await chatParticipantHandler.syncAgentsMdSection();

    if (logger.isEnabled) {
        logger.info('extension', 'Extension activated');
    }
}

export function deactivate(): void {
    // nothing to clean up
}
