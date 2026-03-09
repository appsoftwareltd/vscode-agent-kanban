import * as vscode from 'vscode';
import { parse, stringify } from 'yaml';
import type { Task, Priority } from './types';
import { slugifyLane, RESERVED_LANES } from './types';
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
        await this.migrateFlat();
        await this.reload();
    }

    /**
     * Migrate legacy flat task files from tasks/ root into lane subdirectories.
     * Reads frontmatter `lane` to determine the target directory.
     */
    async migrateFlat(): Promise<void> {
        let entries: [string, vscode.FileType][];
        try {
            entries = await vscode.workspace.fs.readDirectory(this.tasksUri);
        } catch {
            return;
        }

        const flatTasks = entries.filter(
            ([name, type]) => type === vscode.FileType.File && name.endsWith('.md') && name.startsWith('task_'),
        );
        if (flatTasks.length === 0) {
            return;
        }

        this.logger.info('taskStore', `Migrating ${flatTasks.length} flat task files to lane directories`);
        for (const [name] of flatTasks) {
            const srcUri = vscode.Uri.joinPath(this.tasksUri, name);
            try {
                const content = await vscode.workspace.fs.readFile(srcUri);
                const text = new TextDecoder().decode(content);
                const task = TaskStore.deserialise(text);
                // Read legacy lane from frontmatter, default to 'todo'
                const legacyLane = this.extractLegacyLane(text) || 'todo';
                const laneSlug = slugifyLane(legacyLane) || 'todo';

                // Check if task was archived
                const isArchived = task && (task as any).archived === true;
                const targetDir = isArchived ? 'archive' : laneSlug;

                const dirUri = vscode.Uri.joinPath(this.tasksUri, targetDir);
                try { await vscode.workspace.fs.createDirectory(dirUri); } catch { /* exists */ }

                const destUri = vscode.Uri.joinPath(dirUri, name);
                await vscode.workspace.fs.rename(srcUri, destUri, { overwrite: false });
                this.logger.info('taskStore', `Migrated ${name} → ${targetDir}/`);

                // Also migrate corresponding todo file
                const todoName = name.replace(/^task_/, 'todo_');
                const todoSrcUri = vscode.Uri.joinPath(this.tasksUri, todoName);
                try {
                    await vscode.workspace.fs.stat(todoSrcUri);
                    const todoDestUri = vscode.Uri.joinPath(dirUri, todoName);
                    await vscode.workspace.fs.rename(todoSrcUri, todoDestUri, { overwrite: false });
                    this.logger.info('taskStore', `Migrated ${todoName} → ${targetDir}/`);
                } catch {
                    // no todo file — fine
                }
            } catch (err: any) {
                this.logger.warn('taskStore', `Failed to migrate ${name}: ${err.message}`);
            }
        }
    }

    /** Extract legacy lane value from frontmatter text (before removal). */
    private extractLegacyLane(text: string): string | null {
        const parsed = TaskStore.splitFrontmatter(text);
        if (!parsed.frontmatter) { return null; }
        try {
            const data = parse(parsed.frontmatter) as Record<string, unknown>;
            return typeof data.lane === 'string' ? data.lane.toLowerCase() : null;
        } catch {
            return null;
        }
    }

    async reload(): Promise<void> {
        this.tasks.clear();
        try {
            const entries = await vscode.workspace.fs.readDirectory(this.tasksUri);
            for (const [name, type] of entries) {
                if (type === vscode.FileType.Directory) {
                    // Skip archive directory — those tasks don't appear on the board
                    if (RESERVED_LANES.includes(name)) {
                        continue;
                    }
                    await this.loadTasksFromDirectory(name);
                }
                // Legacy flat files handled by migrateFlat() during init
            }
            this.logger.info('taskStore', `Loaded ${this.tasks.size} tasks`);
        } catch {
            // directory may not exist yet
        }
        this._onDidChange.fire();
    }

    /** Load all task files from a lane subdirectory. */
    private async loadTasksFromDirectory(dirName: string): Promise<void> {
        const dirUri = vscode.Uri.joinPath(this.tasksUri, dirName);
        let entries: [string, vscode.FileType][];
        try {
            entries = await vscode.workspace.fs.readDirectory(dirUri);
        } catch {
            return;
        }
        for (const [name, type] of entries) {
            if (type === vscode.FileType.File && name.endsWith('.md') && name.startsWith('task_')) {
                const uri = vscode.Uri.joinPath(dirUri, name);
                try {
                    const content = await vscode.workspace.fs.readFile(uri);
                    const text = new TextDecoder().decode(content);
                    const task = TaskStore.deserialise(text);
                    if (task) {
                        task.id = name.slice(0, -3);
                        task.lane = dirName; // Directory is the source of truth
                        this.tasks.set(task.id, task);
                    }
                } catch {
                    // skip unreadable files
                }
            }
        }
    }

    /** Return all lane directory names under tasks/ (excluding reserved). */
    async getDirectories(): Promise<string[]> {
        const dirs: string[] = [];
        try {
            const entries = await vscode.workspace.fs.readDirectory(this.tasksUri);
            for (const [name, type] of entries) {
                if (type === vscode.FileType.Directory && !RESERVED_LANES.includes(name)) {
                    dirs.push(name);
                }
            }
        } catch {
            // directory may not exist
        }
        return dirs;
    }

    getAll(): Task[] {
        return Array.from(this.tasks.values());
    }

    get(id: string): Task | undefined {
        return this.tasks.get(id);
    }

    /** Returns the URI for a task's markdown file. Uses cache to determine lane directory. */
    getTaskUri(id: string): vscode.Uri {
        const task = this.tasks.get(id);
        if (task) {
            return vscode.Uri.joinPath(this.tasksUri, task.lane, `${id}.md`);
        }
        // Fallback: caller should ensure task is loaded
        return vscode.Uri.joinPath(this.tasksUri, 'todo', `${id}.md`);
    }

    /** Returns the URI for a task's todo file. */
    getTodoUri(taskId: string): vscode.Uri {
        const todoFilename = taskId.replace(/^task_/, 'todo_') + '.md';
        const task = this.tasks.get(taskId);
        if (task) {
            return vscode.Uri.joinPath(this.tasksUri, task.lane, todoFilename);
        }
        return vscode.Uri.joinPath(this.tasksUri, 'todo', todoFilename);
    }

    async save(task: Task): Promise<void> {
        task.updated = new Date().toISOString();
        this.tasks.set(task.id, task);
        const laneDir = vscode.Uri.joinPath(this.tasksUri, task.lane);
        try {
            await vscode.workspace.fs.createDirectory(laneDir);
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
        const laneDir = vscode.Uri.joinPath(this.tasksUri, task.lane);
        try {
            await vscode.workspace.fs.createDirectory(laneDir);
        } catch {
            // directory may already exist
        }
        const uri = this.getTaskUri(task.id);
        const content = new TextEncoder().encode(TaskStore.serialise(task, body));
        await vscode.workspace.fs.writeFile(uri, content);
        this.logger.info('taskStore', `Saved task with body ${task.id}`);
        this._onDidChange.fire();
    }

    /**
     * Move a task (and its todo file) to a new lane directory.
     * Reads the existing body, writes the complete serialised task at the
     * new location (persisting any in-memory changes such as sortOrder or
     * meta fields), then deletes the old file.
     */
    async moveTaskToLane(id: string, newLane: string): Promise<void> {
        const task = this.tasks.get(id);
        if (!task) { return; }

        const oldLane = task.lane;
        if (oldLane === newLane) {
            await this.save(task);
            return;
        }

        const oldTaskUri = vscode.Uri.joinPath(this.tasksUri, oldLane, `${id}.md`);
        const newDir = vscode.Uri.joinPath(this.tasksUri, newLane);
        const newTaskUri = vscode.Uri.joinPath(newDir, `${id}.md`);

        try { await vscode.workspace.fs.createDirectory(newDir); } catch { /* exists */ }

        // Preserve existing markdown body from old file
        let body = '\n## Conversation\n\n[user]\n\n';
        try {
            const existing = await vscode.workspace.fs.readFile(oldTaskUri);
            const existingText = new TextDecoder().decode(existing);
            const parsed = TaskStore.splitFrontmatter(existingText);
            if (parsed.body) {
                body = parsed.body;
            }
        } catch {
            // file may not exist at old location
        }

        // Update in-memory state
        task.lane = newLane;
        task.updated = new Date().toISOString();
        this.tasks.set(id, task);

        // Write complete serialised task at new location
        const content = new TextEncoder().encode(TaskStore.serialise(task, body));
        await vscode.workspace.fs.writeFile(newTaskUri, content);

        // Delete old task file
        try {
            await vscode.workspace.fs.delete(oldTaskUri);
        } catch {
            // old file may not exist
        }

        // Move todo file if it exists
        const todoFilename = id.replace(/^task_/, 'todo_') + '.md';
        const oldTodoUri = vscode.Uri.joinPath(this.tasksUri, oldLane, todoFilename);
        const newTodoUri = vscode.Uri.joinPath(newDir, todoFilename);
        try {
            await vscode.workspace.fs.stat(oldTodoUri);
            await vscode.workspace.fs.rename(oldTodoUri, newTodoUri, { overwrite: false });
        } catch {
            // no todo file or already moved
        }

        this.logger.info('taskStore', `Moved task ${id} from ${oldLane} to ${newLane}`);
        this._onDidChange.fire();
    }

    async delete(id: string): Promise<void> {
        const task = this.tasks.get(id);
        this.tasks.delete(id);
        const taskUri = task
            ? vscode.Uri.joinPath(this.tasksUri, task.lane, `${id}.md`)
            : this.getTaskUri(id);
        try {
            await vscode.workspace.fs.delete(taskUri);
            this.logger.info('taskStore', `Deleted task ${id}`);
        } catch {
            // file may not exist
        }
        const todoFilename = id.replace(/^task_/, 'todo_') + '.md';
        const todoUri = task
            ? vscode.Uri.joinPath(this.tasksUri, task.lane, todoFilename)
            : this.getTodoUri(id);
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
     * Lane is NOT included — determined by directory.
     */
    static serialise(task: Task, body?: string): string {
        const frontmatter: Record<string, unknown> = {
            title: task.title,
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
     * Lane is NOT read from frontmatter — caller sets it from directory name.
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
                lane: '', // Caller sets this from directory name
                created: (data.created as string) ?? new Date().toISOString(),
                updated: (data.updated as string) ?? new Date().toISOString(),
                description: (data.description as string) ?? '',
                priority: (data.priority as Priority) || undefined,
                assignee: (data.assignee as string) || undefined,
                labels: Array.isArray(data.labels) ? (data.labels as string[]) : undefined,
                dueDate: (data.dueDate as string) || undefined,
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
