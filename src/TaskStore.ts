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
        const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const now = new Date().toISOString();
        return {
            id,
            title,
            lane,
            created: now,
            updated: now,
            description: '',
            conversation: [],
        };
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
