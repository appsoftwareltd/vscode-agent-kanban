import * as vscode from 'vscode';
import { parse, stringify } from 'yaml';
import type { Task, Message } from './types';
import type { LogService } from './LogService';
import { NO_OP_LOGGER } from './LogService';

const TASKS_DIR = '.agentkanban/tasks';

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
                if (type === vscode.FileType.File && name.endsWith('.yaml')) {
                    const uri = vscode.Uri.joinPath(this.tasksUri, name);
                    const content = await vscode.workspace.fs.readFile(uri);
                    const text = new TextDecoder().decode(content);
                    const task = parse(text) as Task;
                    if (task?.id) {
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

    async save(task: Task): Promise<void> {
        task.updated = new Date().toISOString();
        this.tasks.set(task.id, task);
        try {
            await vscode.workspace.fs.createDirectory(this.tasksUri);
        } catch {
            // directory may already exist
        }
        const uri = vscode.Uri.joinPath(this.tasksUri, `${task.id}.yaml`);
        const content = new TextEncoder().encode(stringify(task, { lineWidth: 0 }));
        await vscode.workspace.fs.writeFile(uri, content);
        this.logger.info('taskStore', `Saved task ${task.id}`);
        this._onDidChange.fire();
    }

    async delete(id: string): Promise<void> {
        this.tasks.delete(id);
        const uri = vscode.Uri.joinPath(this.tasksUri, `${id}.yaml`);
        try {
            await vscode.workspace.fs.delete(uri);
            this.logger.info('taskStore', `Deleted task ${id}`);
        } catch {
            // file may not exist
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
            conversation: [],
        };
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

    appendMessage(task: Task, message: Message): void {
        task.conversation.push(message);
        task.updated = new Date().toISOString();
    }

    static serialise(task: Task): string {
        return stringify(task, { lineWidth: 0 });
    }

    static deserialise(text: string): Task {
        return parse(text) as Task;
    }
}
