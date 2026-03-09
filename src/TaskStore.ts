import * as vscode from 'vscode';
import { parse, stringify } from 'yaml';
import type { Task, Priority } from './types';
import type { LogService } from './LogService';
import { NO_OP_LOGGER } from './LogService';

const TASKS_DIR = '.agentkanban/tasks';

/** Separator between YAML frontmatter and markdown body. */
const FRONTMATTER_FENCE = '---';

export class TaskStore {
    private tasks: Map<string, Task> = new Map();
    private readonly tasksUri: vscode.Uri;
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;
    private readonly logger: LogService;

    constructor(private readonly workspaceUri: vscode.Uri, logger?: LogService) {
        this.tasksUri = vscode.Uri.joinPath(workspaceUri, TASKS_DIR);
        this.logger = logger ?? NO_OP_LOGGER;
    }

    async init(): Promise<void> {
        try {
            await vscode.workspace.fs.createDirectory(this.tasksUri);
        } catch {
            // directory may already exist
        }
        await this.reload();
    }

    async reload(): Promise<void> {
        this.tasks.clear();
        try {
            const entries = await vscode.workspace.fs.readDirectory(this.tasksUri);
            for (const [name, type] of entries) {
                if (type === vscode.FileType.File && name.endsWith('.md') && name.startsWith('task_')) {
                    const uri = vscode.Uri.joinPath(this.tasksUri, name);
                    const content = await vscode.workspace.fs.readFile(uri);
                    const text = new TextDecoder().decode(content);
                    const task = TaskStore.deserialise(text);
                    if (task) {
                        task.id = name.slice(0, -3);
                        this.tasks.set(task.id, task);
                    }
                }
            }
            this.logger.info('taskStore', `Loaded ${this.tasks.size} tasks`);
        } catch {
            // directory may not exist yet
        }
        this._onDidChange.fire();
    }

    getAll(): Task[] {
        return Array.from(this.tasks.values());
    }

    get(id: string): Task | undefined {
        return this.tasks.get(id);
    }

    /** Returns the URI for a task's markdown file. */
    getTaskUri(id: string): vscode.Uri {
        return vscode.Uri.joinPath(this.tasksUri, `${id}.md`);
    }

    /** Returns the URI for a task's todo file. */
    getTodoUri(taskId: string): vscode.Uri {
        const todoFilename = taskId.replace(/^task_/, 'todo_') + '.md';
        return vscode.Uri.joinPath(this.tasksUri, todoFilename);
    }

    async save(task: Task): Promise<void> {
        task.updated = new Date().toISOString();
        this.tasks.set(task.id, task);
        try {
            await vscode.workspace.fs.createDirectory(this.tasksUri);
        } catch {
            // directory may already exist
        }
        const uri = this.getTaskUri(task.id);

        // Preserve existing markdown body if the file already exists
        let body = '\n## Conversation\n\n[user]\n\n';
        try {
            const existing = await vscode.workspace.fs.readFile(uri);
            const existingText = new TextDecoder().decode(existing);
            const parsed = TaskStore.splitFrontmatter(existingText);
            if (parsed.body) {
                body = parsed.body;
            }
        } catch {
            // file doesn't exist yet — use default body
        }

        const content = new TextEncoder().encode(TaskStore.serialise(task, body));
        await vscode.workspace.fs.writeFile(uri, content);
        this.logger.info('taskStore', `Saved task ${task.id}`);
        this._onDidChange.fire();
    }

    /** Save a task with an explicit markdown body (used when creating tasks with descriptions). */
    async saveWithBody(task: Task, body: string): Promise<void> {
        task.updated = new Date().toISOString();
        this.tasks.set(task.id, task);
        try {
            await vscode.workspace.fs.createDirectory(this.tasksUri);
        } catch {
            // directory may already exist
        }
        const uri = this.getTaskUri(task.id);
        const content = new TextEncoder().encode(TaskStore.serialise(task, body));
        await vscode.workspace.fs.writeFile(uri, content);
        this.logger.info('taskStore', `Saved task with body ${task.id}`);
        this._onDidChange.fire();
    }

    async delete(id: string): Promise<void> {
        this.tasks.delete(id);
        const taskUri = this.getTaskUri(id);
        try {
            await vscode.workspace.fs.delete(taskUri);
            this.logger.info('taskStore', `Deleted task ${id}`);
        } catch {
            // file may not exist
        }
        const todoUri = this.getTodoUri(id);
        try {
            await vscode.workspace.fs.delete(todoUri);
            this.logger.info('taskStore', `Deleted todo for ${id}`);
        } catch {
            // todo file may not exist
        }
        this._onDidChange.fire();
    }

    createTask(title: string, lane: string): Task {
        const now = new Date();
        const id = TaskStore.generateId(now, title);
        return {
            id,
            title,
            lane,
            created: now.toISOString(),
            updated: now.toISOString(),
            description: '',
        };
    }

    /** Find tasks whose title contains the query (case-insensitive). Excludes tasks in the Done lane. */
    findByTitle(query: string, excludeLane?: string): Task[] {
        const q = query.toLowerCase();
        return this.getAll().filter(t =>
            t.title.toLowerCase().includes(q) &&
            (!excludeLane || t.lane !== excludeLane),
        );
    }

    /**
     * Generate a task ID in the format: task_YYYYMMDD_HHmmssfff_XXXXXX_slugified_title
     */
    static generateId(date: Date, title: string): string {
        const y = date.getFullYear();
        const mo = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const h = String(date.getHours()).padStart(2, '0');
        const mi = String(date.getMinutes()).padStart(2, '0');
        const s = String(date.getSeconds()).padStart(2, '0');
        const ms = String(date.getMilliseconds()).padStart(3, '0');
        const ts = `${y}${mo}${d}_${h}${mi}${s}${ms}`;
        const uuid = Math.random().toString(36).slice(2, 8);
        const slug = TaskStore.slugify(title);
        return `task_${ts}_${uuid}_${slug}`;
    }

    /**
     * Slugify a title: lowercase, replace non-alphanumeric with underscores,
     * collapse consecutive underscores, trim edges, truncate to 50 chars.
     */
    static slugify(title: string): string {
        return title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 50)
            .replace(/_+$/, '');
    }

    /**
     * Serialise a task to markdown with YAML frontmatter.
     * The body is preserved as-is (conversation lives in markdown).
     */
    static serialise(task: Task, body?: string): string {
        const frontmatter: Record<string, unknown> = {
            title: task.title,
            lane: task.lane.toUpperCase(),
            created: task.created,
            updated: task.updated,
        };
        if (task.description) {
            frontmatter.description = task.description;
        }
        if (task.priority) {
            frontmatter.priority = task.priority;
        }
        if (task.assignee) {
            frontmatter.assignee = task.assignee;
        }
        if (task.labels?.length) {
            frontmatter.labels = task.labels;
        }
        if (task.dueDate) {
            frontmatter.dueDate = task.dueDate;
        }
        if (task.archived) {
            frontmatter.archived = true;
        }
        if (task.sortOrder != null) {
            frontmatter.sortOrder = task.sortOrder;
        }
        const yamlStr = stringify(frontmatter, { lineWidth: 0 }).trimEnd();
        const mdBody = body ?? '\n## Conversation\n';
        return `${FRONTMATTER_FENCE}\n${yamlStr}\n${FRONTMATTER_FENCE}\n${mdBody}`;
    }

    /**
     * Deserialise a markdown file with YAML frontmatter into a Task.
     * Returns null if the frontmatter is missing or invalid.
     */
    static deserialise(text: string): Task | null {
        const parsed = TaskStore.splitFrontmatter(text);
        if (!parsed.frontmatter) {
            return null;
        }
        try {
            const data = parse(parsed.frontmatter) as Record<string, unknown>;
            if (!data || typeof data.title !== 'string') {
                return null;
            }
            return {
                id: '', // Caller sets this from filename
                title: data.title,
                lane: ((data.lane as string) ?? 'todo').toLowerCase(),
                created: (data.created as string) ?? new Date().toISOString(),
                updated: (data.updated as string) ?? new Date().toISOString(),
                description: (data.description as string) ?? '',
                priority: (data.priority as Priority) || undefined,
                assignee: (data.assignee as string) || undefined,
                labels: Array.isArray(data.labels) ? (data.labels as string[]) : undefined,
                dueDate: (data.dueDate as string) || undefined,
                archived: data.archived === true ? true : undefined,
                sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : undefined,
            };
        } catch {
            return null;
        }
    }

    /** Split a markdown file into frontmatter and body. */
    static splitFrontmatter(text: string): { frontmatter: string | null; body: string } {
        if (!text.startsWith(FRONTMATTER_FENCE)) {
            return { frontmatter: null, body: text };
        }

        const end = text.indexOf(`\n${FRONTMATTER_FENCE}`, FRONTMATTER_FENCE.length);
        if (end === -1) {
            return { frontmatter: null, body: text };
        }

        const frontmatter = text.slice(FRONTMATTER_FENCE.length + 1, end);
        // Skip past \n---\n — the newline after closing fence is part of the
        // fence line, not the body.  serialise() adds it back.
        const bodyStart = end + FRONTMATTER_FENCE.length + 1;
        const body = text[bodyStart] === '\n' ? text.slice(bodyStart + 1) : text.slice(bodyStart);
        return { frontmatter, body };
    }
}
