import * as vscode from 'vscode';
import type { TaskStore } from '../TaskStore';
import type { BoardConfigStore } from '../BoardConfigStore';
import type { LogService } from '../LogService';
import { NO_OP_LOGGER } from '../LogService';

/** Default lane ID that represents completed work. */
const DONE_LANE = 'done';

/** Relative path within the workspace for the instruction file. */
const INSTRUCTION_REL_PATH = '.agentkanban/INSTRUCTION.md';

/**
 * Lightweight @kanban chat participant.
 *
 * Routes /new and /task commands. Sets up task context (INSTRUCTION.md +
 * task file) and hands off to Copilot agent mode for the actual work.
 */
export class ChatParticipant {
    private readonly logger: LogService;
    private readonly extensionUri: vscode.Uri;

    constructor(
        private readonly taskStore: TaskStore,
        private readonly boardConfigStore: BoardConfigStore,
        extensionUri: vscode.Uri,
        logger?: LogService,
    ) {
        this.extensionUri = extensionUri;
        this.logger = logger ?? NO_OP_LOGGER;
    }

    async handleRequest(
        request: vscode.ChatRequest,
        _context: vscode.ChatContext,
        response: vscode.ChatResponseStream,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        const command = request.command;
        const prompt = request.prompt.trim();

        switch (command) {
            case 'new':
                await this.handleNew(prompt, response);
                return;
            case 'task':
                await this.handleTask(prompt, response);
                return;
            default: {
                response.markdown('Available commands: `/new`, `/task`\n\n');
                response.markdown('- `@kanban /new <task title>` — Create a new task\n');
                response.markdown('- `@kanban /task <task name>` — Select a task to work on\n');
                return;
            }
        }
    }

    /** Get active task titles for display (e.g., in help messages). */
    getActiveTaskTitles(): string[] {
        return this.taskStore.getAll()
            .filter(t => t.lane !== DONE_LANE)
            .map(t => t.title);
    }

    /**
     * Sync `.agentkanban/INSTRUCTION.md` with the bundled template.
     * Always overwrites — this file is managed by the extension, not user-editable.
     */
    async syncInstructionFile(): Promise<vscode.Uri | undefined> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) { return undefined; }

        const instrUri = vscode.Uri.joinPath(workspaceFolder.uri, INSTRUCTION_REL_PATH);
        try {
            const templateUri = vscode.Uri.joinPath(this.extensionUri, 'assets', 'INSTRUCTION.md');
            const templateContent = await vscode.workspace.fs.readFile(templateUri);
            await vscode.workspace.fs.writeFile(instrUri, templateContent);
            this.logger.info('chatParticipant', 'Synced INSTRUCTION.md from template');
            return instrUri;
        } catch (err: any) {
            this.logger.warn('chatParticipant', `Failed to sync INSTRUCTION.md: ${err.message}`);
            return undefined;
        }
    }

    /**
     * Provide follow-up suggestions after a chat response.
     * Suggests /task for the most recently updated active task.
     */
    getFollowups(): vscode.ChatFollowup[] {
        const activeTasks = this.taskStore.getAll()
            .filter(t => t.lane !== DONE_LANE)
            .sort((a, b) => (b.updated || b.created).localeCompare(a.updated || a.created));

        if (activeTasks.length === 0) { return []; }

        const mostRecent = activeTasks[0];
        return [{
            prompt: mostRecent.title,
            command: 'task',
            label: `Task: ${mostRecent.title}`,
        }];
    }

    private async handleNew(prompt: string, response: vscode.ChatResponseStream): Promise<void> {
        const title = prompt;
        if (!title) {
            response.markdown('Usage: `@kanban /new <task title>`');
            return;
        }

        await this.syncInstructionFile();

        const config = this.boardConfigStore.get();
        const firstLane = config.lanes[0]?.id ?? 'todo';
        const task = this.taskStore.createTask(title, firstLane);
        await this.taskStore.save(task);

        const taskUri = this.taskStore.getTaskUri(task.id);
        this.logger.info('chatParticipant', `Created task: ${task.id}`);

        response.markdown(`Created task **${title}**\n\n`);
        response.markdown(`File: \`${vscode.workspace.asRelativePath(taskUri)}\`\n\n`);
        response.markdown('Use `@kanban /task ' + title + '` to start working on it.');
    }

    private async handleTask(prompt: string, response: vscode.ChatResponseStream): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

        if (!prompt) {
            // No task name — list active tasks
            const titles = this.getActiveTaskTitles();
            if (titles.length === 0) {
                response.markdown('No active tasks. Use `@kanban /new <title>` to create one.');
            } else {
                response.markdown('Active tasks:\n\n');
                for (const t of titles) {
                    response.markdown(`- **${t}**\n`);
                }
                response.markdown('\nUsage: `@kanban /task <task name>`');
            }
            return;
        }

        const { task } = this.resolveTaskFromPrompt(prompt);

        if (!task) {
            const suggestions = this.taskStore.findByTitle(prompt.split(/\s+/)[0] || '', DONE_LANE);
            if (suggestions.length > 0) {
                response.markdown(`No task match for "${prompt}". Did you mean:\n\n`);
                for (const s of suggestions.slice(0, 5)) {
                    response.markdown(`- **${s.title}**\n`);
                }
            } else {
                response.markdown(`No task found matching "${prompt}". Use \`@kanban /new <title>\` to create one.`);
            }
            return;
        }

        this.logger.info('chatParticipant', `/task on: ${task.id} (${task.title})`);

        // Sync INSTRUCTION.md from bundled template
        const instrUri = await this.syncInstructionFile();

        const taskUri = this.taskStore.getTaskUri(task.id);
        const taskRelPath = vscode.workspace.asRelativePath(taskUri);

        // Open the task file in editor
        try {
            const doc = await vscode.workspace.openTextDocument(taskUri);
            await vscode.window.showTextDocument(doc, { preview: false });
        } catch {
            // non-fatal — file may already be open
        }

        // Output context for the user and Copilot
        if (instrUri) {
            const instrRelPath = vscode.workspace.asRelativePath(instrUri);
            response.markdown(`Read \`${instrRelPath}\` for workflow instructions.\n\n`);
        }

        // Inject custom instruction file reference if configured
        const customPath = vscode.workspace.getConfiguration('agentKanban').get<string>('customInstructionFile', '');
        if (customPath && workspaceFolder) {
            try {
                const customUri = customPath.match(/^[a-zA-Z]:[\\/]/) || customPath.startsWith('/')
                    ? vscode.Uri.file(customPath)
                    : vscode.Uri.joinPath(workspaceFolder.uri, customPath);
                await vscode.workspace.fs.stat(customUri);
                const customRelPath = vscode.workspace.asRelativePath(customUri);
                response.markdown(`Read \`${customRelPath}\` for additional instructions.\n\n`);
            } catch {
                this.logger.warn('chatParticipant', `Custom instruction file not found: ${customPath}`);
            }
        }

        response.markdown(`Working on task: **${task.title}**\n\n`);
        response.markdown(`Task file: \`${taskRelPath}\`\n\n`);
        response.markdown('The conversation for this task happens in the task file above.\n\n');
        response.markdown('Type `plan`, `todo`, or `implement` (or a combination) in the chat, optionally with additional context, to start working.');
    }

    /**
     * Resolve a task from the prompt text.
     * Tries to match task titles against the prompt, longest match first.
     * Returns the matched task and any remaining free text.
     */
    resolveTaskFromPrompt(prompt: string): { task: ReturnType<TaskStore['get']>; freeText: string } {
        if (!prompt) {
            return { task: undefined, freeText: '' };
        }

        const activeTasks = this.taskStore.getAll().filter(t => t.lane !== DONE_LANE);

        // Try exact title match (case-insensitive)
        const exactMatch = activeTasks.find(t => prompt.toLowerCase().startsWith(t.title.toLowerCase()));
        if (exactMatch) {
            const freeText = prompt.slice(exactMatch.title.length).trim();
            return { task: exactMatch, freeText };
        }

        // Try fuzzy: find best match where title words appear at the start of prompt
        const promptLower = prompt.toLowerCase();
        let bestMatch: typeof activeTasks[0] | undefined;
        let bestMatchLength = 0;

        for (const t of activeTasks) {
            const titleLower = t.title.toLowerCase();
            if (promptLower.includes(titleLower) && titleLower.length > bestMatchLength) {
                bestMatch = t;
                bestMatchLength = titleLower.length;
            }
        }

        if (bestMatch) {
            const idx = promptLower.indexOf(bestMatch.title.toLowerCase());
            const freeText = (prompt.slice(0, idx) + prompt.slice(idx + bestMatch.title.length)).trim();
            return { task: bestMatch, freeText };
        }

        // Try partial match — first word of prompt against titles
        const firstWord = prompt.split(/\s+/)[0].toLowerCase();
        const partialMatch = activeTasks.find(t => t.title.toLowerCase().includes(firstWord));
        if (partialMatch) {
            const freeText = prompt.split(/\s+/).slice(1).join(' ').trim();
            return { task: partialMatch, freeText };
        }

        return { task: undefined, freeText: prompt };
    }
}
