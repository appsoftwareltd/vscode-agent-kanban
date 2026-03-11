import * as vscode from 'vscode';
import type { TaskStore } from '../TaskStore';
import type { BoardConfigStore } from '../BoardConfigStore';
import type { WorktreeService } from '../WorktreeService';
import type { LogService } from '../LogService';
import { NO_OP_LOGGER } from '../LogService';

/** Default lane ID that represents completed work. */
const DONE_LANE = 'done';

/** Relative path within the workspace for the instruction file. */
const INSTRUCTION_REL_PATH = '.agentkanban/INSTRUCTION.md';

/** Relative path within the workspace for AGENTS.md (managed section). */
export const AGENTS_MD_REL_PATH = 'AGENTS.md';

export const AGENTS_MD_BEGIN = '<!-- BEGIN AGENT KANBAN \u2014 DO NOT EDIT THIS SECTION -->';
export const AGENTS_MD_END = '<!-- END AGENT KANBAN -->';

const AGENTS_MD_SECTION = [
    AGENTS_MD_BEGIN,
    '## Agent Kanban',
    '',
    'Read `.agentkanban/INSTRUCTION.md` for task workflow rules.',
    'Read `.agentkanban/memory.md` for project context.',
    '',
    'If a task file (`.agentkanban/tasks/**/*.md`) was referenced earlier in this conversation, re-read it before responding.',
    AGENTS_MD_END,
].join('\n');

/** Build a richer AGENTS.md sentinel for worktree-linked workspaces. */
export function buildWorktreeAgentsMdSection(taskTitle: string, taskRelPath: string): string {
    return [
        AGENTS_MD_BEGIN,
        '## Agent Kanban',
        '',
        `**Active Task:** ${taskTitle}`,
        `**Task File:** \`${taskRelPath}\``,
        '',
        'Read the task file above before responding.',
        'Read `.agentkanban/INSTRUCTION.md` for task workflow rules.',
        'Read `.agentkanban/memory.md` for project context.',
        AGENTS_MD_END,
    ].join('\n');
}

/**
 * Lightweight @kanban chat participant.
 *
 * Routes /new and /task commands. Sets up task context (INSTRUCTION.md +
 * task file) and hands off to Copilot agent mode for the actual work.
 */
/** Recognised verb names for context-refresh commands. */
const VERBS = ['refresh'] as const;
type Verb = typeof VERBS[number];

export class ChatParticipant {
    private readonly logger: LogService;
    private readonly extensionUri: vscode.Uri;
    private readonly getIsInitialised: () => boolean;
    private readonly worktreeService: WorktreeService | undefined;

    /** Tracks the last task selected via /task, used by verb commands. */
    lastSelectedTaskId: string | undefined;

    constructor(
        private readonly taskStore: TaskStore,
        private readonly boardConfigStore: BoardConfigStore,
        extensionUri: vscode.Uri,
        getIsInitialised: (() => boolean) | undefined = undefined,
        logger?: LogService,
        worktreeService?: WorktreeService,
    ) {
        this.extensionUri = extensionUri;
        this.getIsInitialised = getIsInitialised ?? (() => true);
        this.logger = logger ?? NO_OP_LOGGER;
        this.worktreeService = worktreeService;
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
            case 'refresh': {
                await this.handleRefresh(prompt, response);
                return;
            }
            case 'worktree':
                await this.handleWorktree(prompt, response);
                return;
            default: {
                response.markdown('Available commands: `/new`, `/task`, `/refresh`, `/worktree`\n\n');
                response.markdown('- `@kanban /new <task title>` — Create a new task\n');
                response.markdown('- `@kanban /task <task name>` — Select a task to work on\n');
                response.markdown('- `@kanban /refresh` — Re-inject agent context for the selected task\n');
                response.markdown('- `@kanban /worktree` — Create a git worktree for the selected task\n');
                response.markdown('- `@kanban /worktree open` — Open the task worktree in VS Code\n');
                response.markdown('- `@kanban /worktree remove` — Remove the task worktree\n');
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
     * Manage a sentinel-delimited section in the workspace's AGENTS.md.
     * Preserves any user content outside the sentinels. Creates the file if
     * it does not exist.
     *
     * When a worktree-linked task is provided, writes a richer sentinel that
     * names the specific task file — this is used in worktree workspaces where
     * the AGENTS.md is protected by --skip-worktree.
     */
    async syncAgentsMdSection(worktreeTask?: { title: string; taskRelPath: string }): Promise<vscode.Uri | undefined> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) { return undefined; }

        const agentsUri = vscode.Uri.joinPath(workspaceFolder.uri, AGENTS_MD_REL_PATH);
        try {
            let existing = '';
            try {
                const bytes = await vscode.workspace.fs.readFile(agentsUri);
                existing = new TextDecoder().decode(bytes);
            } catch {
                // File doesn't exist — start fresh
            }

            // Choose the appropriate sentinel section
            const section = worktreeTask
                ? buildWorktreeAgentsMdSection(worktreeTask.title, worktreeTask.taskRelPath)
                : AGENTS_MD_SECTION;

            const beginIdx = existing.indexOf(AGENTS_MD_BEGIN);
            const endIdx = existing.indexOf(AGENTS_MD_END);

            let updated: string;
            if (beginIdx !== -1 && endIdx !== -1) {
                // Replace existing section
                const before = existing.slice(0, beginIdx);
                const after = existing.slice(endIdx + AGENTS_MD_END.length);
                updated = before + section + after;
            } else {
                // Append section
                const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n\n' : existing.length > 0 ? '\n' : '';
                updated = existing + sep + section + '\n';
            }

            await vscode.workspace.fs.writeFile(agentsUri, new TextEncoder().encode(updated));
            this.logger.info('chatParticipant', 'Synced AGENTS.md managed section');
            return agentsUri;
        } catch (err: any) {
            this.logger.warn('chatParticipant', `Failed to sync AGENTS.md section: ${err.message}`);
            return undefined;
        }
    }

    /**
     * Detect if the current workspace has a worktree-linked task and sync
     * the enhanced AGENTS.md sentinel accordingly. Called on extension activation.
     */
    async syncWorktreeAgentsMd(): Promise<void> {
        // Find a task whose worktree.path matches the current workspace
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) { return; }

        const currentPath = workspaceFolder.uri.fsPath;
        const allTasks = this.taskStore.getAll();
        const linkedTask = allTasks.find(t =>
            t.worktree && this.normalisePath(t.worktree.path) === this.normalisePath(currentPath),
        );

        if (linkedTask) {
            const taskUri = this.taskStore.getTaskUri(linkedTask.id);
            const taskRelPath = vscode.workspace.asRelativePath(taskUri);
            await this.syncAgentsMdSection({ title: linkedTask.title, taskRelPath });
            this.logger.info('chatParticipant', `Synced worktree AGENTS.md for task: ${linkedTask.title}`);
        }
    }

    /** Normalise a file path for comparison (lowercase on Windows, resolve). */
    private normalisePath(p: string): string {
        const normalised = p.replace(/\\/g, '/').replace(/\/+$/, '');
        return process.platform === 'win32' ? normalised.toLowerCase() : normalised;
    }

    /**
     * Provide follow-up suggestions after a chat response.
     * Suggests /task for the most recently updated active task.
     */
    getFollowups(): vscode.ChatFollowup[] {
        // When a task is selected, offer verb commands as followups
        if (this.lastSelectedTaskId) {
            const task = this.taskStore.get(this.lastSelectedTaskId);
            if (task && task.lane !== DONE_LANE) {
                const followups: vscode.ChatFollowup[] = [
                    { prompt: '', command: 'refresh', label: `Refresh: ${task.title}` },
                ];
                // Add worktree followup if no worktree exists and service is available
                if (!task.worktree && this.worktreeService) {
                    followups.push({ prompt: '', command: 'worktree', label: `Create Worktree: ${task.title}` });
                } else if (task.worktree && this.worktreeService) {
                    followups.push({ prompt: 'open', command: 'worktree', label: `Open Worktree: ${task.title}` });
                }
                return followups;
            }
            // Task gone/done — clear selection
            this.lastSelectedTaskId = undefined;
        }

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

        this.lastSelectedTaskId = undefined;

        // Auto-initialise if not yet set up (using @kanban /new implies consent)
        if (!this.getIsInitialised()) {
            await vscode.commands.executeCommand('agentKanban.initialise');
        }

        await this.syncInstructionFile();

        const config = this.boardConfigStore.get();
        const firstLane = config.lanes[0] ?? 'todo';
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
        this.lastSelectedTaskId = task.id;

        // Sync INSTRUCTION.md and AGENTS.md section from bundled templates
        const instrUri = this.getIsInitialised() ? await this.syncInstructionFile() : undefined;
        if (this.getIsInitialised()) { await this.syncAgentsMdSection(); }

        const taskUri = this.taskStore.getTaskUri(task.id);
        const taskRelPath = vscode.workspace.asRelativePath(taskUri);

        // Attach files as references so they persist in conversation context
        if (instrUri) { response.reference(instrUri); }
        response.reference(taskUri);

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

        // Show worktree status
        if (task.worktree) {
            response.markdown(`Worktree: \`${task.worktree.path}\` (branch \`${task.worktree.branch}\`)\n\n`);
        }

        // Hint when enforce is on and no worktree
        const enforceWorktrees = vscode.workspace.getConfiguration('agentKanban').get<boolean>('enforceWorktrees', false);
        if (enforceWorktrees && this.worktreeService && !task.worktree) {
            response.markdown('⚠️ Worktree enforcement is on. Create a worktree before using verb commands.\n\n');
        }

        response.markdown('The conversation for this task happens in the task file above.\n\n');
        response.markdown('Use `@kanban /refresh` to re-inject context if the agent loses track, or `@kanban /worktree` to create an isolated worktree.');
    }

    /**
     * Handle the /refresh command.
     * Re-injects workflow context for the last selected task.
     */
    private async handleRefresh(
        prompt: string,
        response: vscode.ChatResponseStream,
    ): Promise<void> {
        if (!this.lastSelectedTaskId) {
            const titles = this.getActiveTaskTitles();
            if (titles.length === 0) {
                response.markdown('No active tasks. Use `@kanban /new <title>` to create one.');
            } else {
                response.markdown('No task selected. Use `@kanban /task <task name>` first.\n\n');
                response.markdown('Active tasks:\n\n');
                for (const t of titles) {
                    response.markdown(`- **${t}**\n`);
                }
            }
            return;
        }

        const task = this.taskStore.get(this.lastSelectedTaskId);
        if (!task || task.lane === DONE_LANE) {
            this.lastSelectedTaskId = undefined;
            response.markdown('Previously selected task is no longer active. Use `@kanban /task <task name>` to select a new one.');
            return;
        }

        this.logger.info('chatParticipant', `/refresh on: ${task.id} (${task.title})`);

        // Check enforceWorktrees setting
        const enforceWorktrees = vscode.workspace.getConfiguration('agentKanban').get<boolean>('enforceWorktrees', false);
        if (enforceWorktrees && this.worktreeService && !task.worktree) {
            const isGit = await this.worktreeService.isGitRepo();
            if (isGit) {
                response.markdown('⚠️ **Worktree required.** The `agentKanban.enforceWorktrees` setting is enabled.\n\n');
                response.markdown('Use `@kanban /worktree` to create a worktree for this task first.\n');
                return;
            }
        }

        // Sync INSTRUCTION.md and AGENTS.md section from bundled templates
        const instrUri = this.getIsInitialised() ? await this.syncInstructionFile() : undefined;
        if (this.getIsInitialised()) {
            // Use worktree-enhanced sentinel if this task has a worktree
            if (task.worktree) {
                const taskUri = this.taskStore.getTaskUri(task.id);
                const taskRelPath = vscode.workspace.asRelativePath(taskUri);
                await this.syncAgentsMdSection({ title: task.title, taskRelPath });
            } else {
                await this.syncAgentsMdSection();
            }
        }

        const taskUri = this.taskStore.getTaskUri(task.id);
        const taskRelPath = vscode.workspace.asRelativePath(taskUri);

        // Attach files as references so they persist in conversation context
        if (instrUri) { response.reference(instrUri); }
        response.reference(taskUri);

        // Open the task file in editor (preserveFocus keeps cursor in chat input)
        try {
            const doc = await vscode.workspace.openTextDocument(taskUri);
            await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
        } catch {
            // non-fatal — file may already be open
        }

        // Output context for Copilot
        if (instrUri) {
            const instrRelPath = vscode.workspace.asRelativePath(instrUri);
            response.markdown(`Read \`${instrRelPath}\` for workflow instructions.\n\n`);
        }

        response.markdown(`**REFRESH** — Task: **${task.title}**\n\n`);
        response.markdown(`Task file: \`${taskRelPath}\`\n\n`);

        if (prompt.trim()) {
            response.markdown(`Additional context: ${prompt.trim()}\n\n`);
        }

        response.markdown('Type **go** in the chat to begin.');
    }

    /**
     * Handle the /worktree command.
     * Subcommands: (none) → create, "open" → open, "remove" → remove.
     */
    private async handleWorktree(prompt: string, response: vscode.ChatResponseStream): Promise<void> {
        if (!this.worktreeService) {
            response.markdown('Git worktree support is not available (workspace may not be a git repository).');
            return;
        }

        const isGit = await this.worktreeService.isGitRepo();
        if (!isGit) {
            response.markdown('This workspace is not a git repository. Worktree support requires git.');
            return;
        }

        if (!this.lastSelectedTaskId) {
            response.markdown('No task selected. Use `@kanban /task <task name>` first.');
            return;
        }

        const task = this.taskStore.get(this.lastSelectedTaskId);
        if (!task || task.lane === DONE_LANE) {
            this.lastSelectedTaskId = undefined;
            response.markdown('Previously selected task is no longer active. Use `@kanban /task <task name>` to select a new one.');
            return;
        }

        const subcommand = prompt.toLowerCase().trim();

        if (subcommand === 'open') {
            await this.handleWorktreeOpen(task, response);
        } else if (subcommand === 'remove') {
            await this.handleWorktreeRemove(task, response);
        } else {
            await this.handleWorktreeCreate(task, response);
        }
    }

    private async handleWorktreeCreate(
        task: ReturnType<TaskStore['get']> & {},
        response: vscode.ChatResponseStream,
    ): Promise<void> {
        if (task.worktree) {
            const exists = await this.worktreeService!.exists(task.worktree.path);
            if (exists) {
                response.markdown(`Task **${task.title}** already has a worktree at \`${task.worktree.path}\`.\n\n`);
                response.markdown('Use `@kanban /worktree open` to open it, or `@kanban /worktree remove` to remove it.');
                return;
            }
            // Worktree metadata exists but directory is gone — clean up and recreate
            this.logger.warn('chatParticipant', `Stale worktree metadata for task ${task.id}, recreating`);
        }

        try {
            response.markdown(`Creating worktree for **${task.title}**...\n\n`);

            const taskUri = this.taskStore.getTaskUri(task.id);
            const taskRelPath = vscode.workspace.asRelativePath(taskUri);
            const worktreeInfo = await this.worktreeService!.create(task.id, task.title, taskRelPath);

            // Update task frontmatter with worktree info
            task.worktree = worktreeInfo;
            await this.taskStore.save(task);

            response.markdown(`✅ Worktree created:\n\n`);
            response.markdown(`- **Branch:** \`${worktreeInfo.branch}\`\n`);
            response.markdown(`- **Path:** \`${worktreeInfo.path}\`\n\n`);
            response.markdown('Opening worktree in VS Code...\n');

            await this.worktreeService!.openInVSCode(worktreeInfo.path);
        } catch (err: any) {
            response.markdown(`❌ Failed to create worktree: ${err.message}`);
            this.logger.warn('chatParticipant', `Worktree creation failed: ${err.message}`);
        }
    }

    private async handleWorktreeOpen(
        task: ReturnType<TaskStore['get']> & {},
        response: vscode.ChatResponseStream,
    ): Promise<void> {
        if (!task.worktree) {
            response.markdown(`Task **${task.title}** has no worktree. Use \`@kanban /worktree\` to create one.`);
            return;
        }

        const exists = await this.worktreeService!.exists(task.worktree.path);
        if (!exists) {
            response.markdown(`Worktree directory no longer exists at \`${task.worktree.path}\`.\n\n`);
            response.markdown('Use `@kanban /worktree` to create a new one.');
            // Clean up stale metadata
            task.worktree = undefined;
            await this.taskStore.save(task);
            return;
        }

        response.markdown(`Opening worktree for **${task.title}** at \`${task.worktree.path}\`...\n`);
        await this.worktreeService!.openInVSCode(task.worktree.path);
    }

    private async handleWorktreeRemove(
        task: ReturnType<TaskStore['get']> & {},
        response: vscode.ChatResponseStream,
    ): Promise<void> {
        if (!task.worktree) {
            response.markdown(`Task **${task.title}** has no worktree to remove.`);
            return;
        }

        try {
            await this.worktreeService!.remove(task.worktree);
            const branch = task.worktree.branch;
            task.worktree = undefined;
            await this.taskStore.save(task);

            response.markdown(`✅ Worktree removed for **${task.title}**.\n`);
            response.markdown(`Branch \`${branch}\` has been deleted.\n`);
        } catch (err: any) {
            response.markdown(`❌ Failed to remove worktree: ${err.message}`);
            this.logger.warn('chatParticipant', `Worktree removal failed: ${err.message}`);
        }
    }

    /**
     * Resolve a task from the prompt text.
     * Cascade: slug match → exact title prefix → title substring → alphanumeric fuzzy → first-word partial.
     * Returns the matched task and any remaining free text.
     */
    resolveTaskFromPrompt(prompt: string): { task: ReturnType<TaskStore['get']>; freeText: string } {
        if (!prompt) {
            return { task: undefined, freeText: '' };
        }

        const activeTasks = this.taskStore.getAll().filter(t => t.lane !== DONE_LANE);
        const promptLower = prompt.toLowerCase();

        // 1. Slug match (highest priority) — exact slug, case-insensitive
        const promptSlug = prompt.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
        if (promptSlug) {
            const slugMatch = activeTasks.find(t => t.slug?.toLowerCase() === promptSlug);
            if (slugMatch) {
                return { task: slugMatch, freeText: '' };
            }
        }

        // 2. Exact title prefix (case-insensitive)
        const exactMatch = activeTasks.find(t => promptLower.startsWith(t.title.toLowerCase()));
        if (exactMatch) {
            const freeText = prompt.slice(exactMatch.title.length).trim();
            return { task: exactMatch, freeText };
        }

        // 3. Title substring — find best match where full title appears in prompt
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

        // 4. Alphanumeric fuzzy — strip non-alnum, check substring
        const promptAlnum = promptLower.replace(/[^a-z0-9]/g, '');
        if (promptAlnum) {
            let alnumBest: typeof activeTasks[0] | undefined;
            let alnumBestLen = 0;
            let alnumAmbiguous = false;

            for (const t of activeTasks) {
                const titleAlnum = t.title.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (titleAlnum.includes(promptAlnum)) {
                    if (titleAlnum.length > alnumBestLen) {
                        alnumBest = t;
                        alnumBestLen = titleAlnum.length;
                        alnumAmbiguous = false;
                    } else if (titleAlnum.length === alnumBestLen && alnumBest && alnumBest.id !== t.id) {
                        alnumAmbiguous = true;
                    }
                }
            }

            if (alnumBest && !alnumAmbiguous) {
                return { task: alnumBest, freeText: '' };
            }
        }

        // 5. First-word partial — first word of prompt matches within a title
        const firstWord = prompt.split(/\s+/)[0].toLowerCase();
        const partialMatch = activeTasks.find(t => t.title.toLowerCase().includes(firstWord));
        if (partialMatch) {
            const freeText = prompt.split(/\s+/).slice(1).join(' ').trim();
            return { task: partialMatch, freeText };
        }

        return { task: undefined, freeText: prompt };
    }
}
