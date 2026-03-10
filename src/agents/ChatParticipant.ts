import * as vscode from 'vscode';
import type { TaskStore } from '../TaskStore';
import type { BoardConfigStore } from '../BoardConfigStore';
import type { LogService } from '../LogService';
import { NO_OP_LOGGER } from '../LogService';

/** Default lane ID that represents completed work. */
const DONE_LANE = 'done';

/** Relative path within the workspace for the instruction file. */
const INSTRUCTION_REL_PATH = '.agentkanban/INSTRUCTION.md';

/** Relative path within the workspace for AGENTS.md (managed section). */
const AGENTS_MD_REL_PATH = 'AGENTS.md';

const AGENTS_MD_BEGIN = '<!-- BEGIN AGENT KANBAN \u2014 DO NOT EDIT THIS SECTION -->';
const AGENTS_MD_END = '<!-- END AGENT KANBAN -->';

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

/**
 * Lightweight @kanban chat participant.
 *
 * Routes /new and /task commands. Sets up task context (INSTRUCTION.md +
 * task file) and hands off to Copilot agent mode for the actual work.
 */
/** Recognised verb names for context-refresh commands. */
const VERBS = ['plan', 'todo', 'implement'] as const;
type Verb = typeof VERBS[number];

export class ChatParticipant {
    private readonly logger: LogService;
    private readonly extensionUri: vscode.Uri;
    private readonly getIsInitialised: () => boolean;

    /** Tracks the last task selected via /task, used by verb commands. */
    lastSelectedTaskId: string | undefined;

    constructor(
        private readonly taskStore: TaskStore,
        private readonly boardConfigStore: BoardConfigStore,
        extensionUri: vscode.Uri,
        getIsInitialised: (() => boolean) | undefined = undefined,
        logger?: LogService,
    ) {
        this.extensionUri = extensionUri;
        this.getIsInitialised = getIsInitialised ?? (() => true);
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
            case 'plan':
            case 'todo':
            case 'implement': {
                const verbs = this.parseVerbs(command, prompt);
                await this.handleVerb(verbs, prompt, response);
                return;
            }
            default: {
                response.markdown('Available commands: `/new`, `/task`, `/plan`, `/todo`, `/implement`\n\n');
                response.markdown('- `@kanban /new <task title>` — Create a new task\n');
                response.markdown('- `@kanban /task <task name>` — Select a task to work on\n');
                response.markdown('- `@kanban /plan` — Plan the selected task (refreshes context)\n');
                response.markdown('- `@kanban /todo` — Generate TODOs for the selected task\n');
                response.markdown('- `@kanban /implement` — Implement the selected task\n');
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
     */
    async syncAgentsMdSection(): Promise<vscode.Uri | undefined> {
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

            const beginIdx = existing.indexOf(AGENTS_MD_BEGIN);
            const endIdx = existing.indexOf(AGENTS_MD_END);

            let updated: string;
            if (beginIdx !== -1 && endIdx !== -1) {
                // Replace existing section
                const before = existing.slice(0, beginIdx);
                const after = existing.slice(endIdx + AGENTS_MD_END.length);
                updated = before + AGENTS_MD_SECTION + after;
            } else {
                // Append section
                const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n\n' : existing.length > 0 ? '\n' : '';
                updated = existing + sep + AGENTS_MD_SECTION + '\n';
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
     * Provide follow-up suggestions after a chat response.
     * Suggests /task for the most recently updated active task.
     */
    getFollowups(): vscode.ChatFollowup[] {
        // When a task is selected, offer verb commands as followups
        if (this.lastSelectedTaskId) {
            const task = this.taskStore.get(this.lastSelectedTaskId);
            if (task && task.lane !== DONE_LANE) {
                return [
                    { prompt: '', command: 'plan', label: `Plan: ${task.title}` },
                    { prompt: '', command: 'todo', label: `Todo: ${task.title}` },
                    { prompt: '', command: 'implement', label: `Implement: ${task.title}` },
                    { prompt: '#todo #implement', command: 'todo', label: `Todo + Implement: ${task.title}` },
                ];
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
        response.markdown('The conversation for this task happens in the task file above.\n\n');
        response.markdown('Use `@kanban /plan`, `@kanban /todo`, or `@kanban /implement` to begin working (or combine with `#` tags, e.g. `@kanban /todo #implement`).');
    }

    /**
     * Parse verb names from the primary command and any #-prefixed verbs in the prompt.
     * E.g. command='plan', prompt='#todo #implement extra text' → ['plan', 'todo', 'implement']
     */
    parseVerbs(command: string, prompt: string): Verb[] {
        const verbs = new Set<Verb>();
        if (VERBS.includes(command as Verb)) {
            verbs.add(command as Verb);
        }
        const hashPattern = /#(plan|todo|implement)\b/gi;
        let match: RegExpExecArray | null;
        while ((match = hashPattern.exec(prompt)) !== null) {
            verbs.add(match[1].toLowerCase() as Verb);
        }
        // Return in canonical order
        return VERBS.filter(v => verbs.has(v));
    }

    /**
     * Strip #verb tags from the prompt to extract additional context text.
     */
    private stripVerbTags(prompt: string): string {
        return prompt.replace(/#(plan|todo|implement)\b/gi, '').trim();
    }

    /**
     * Handle a verb command (/plan, /todo, /implement).
     * Re-injects workflow context for the last selected task.
     */
    private async handleVerb(
        verbs: Verb[],
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

        this.logger.info('chatParticipant', `/${verbs.join('+')} on: ${task.id} (${task.title})`);

        // Sync INSTRUCTION.md and AGENTS.md section from bundled templates
        const instrUri = this.getIsInitialised() ? await this.syncInstructionFile() : undefined;
        if (this.getIsInitialised()) { await this.syncAgentsMdSection(); }

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

        const verbLabel = verbs.join(' + ');
        response.markdown(`**${verbLabel.toUpperCase()}** — Task: **${task.title}**\n\n`);
        response.markdown(`Task file: \`${taskRelPath}\`\n\n`);

        const additionalContext = this.stripVerbTags(prompt);
        if (additionalContext) {
            response.markdown(`Additional context: ${additionalContext}\n\n`);
        }

        response.markdown('Type **go** in the chat to begin.');
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
