import * as vscode from 'vscode';
import { parse, stringify } from 'yaml';
import type { Task, Priority, WorktreeInfo } from './types';
import { slugifyLane } from './types';
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

    /**
     * Read-only init: migrates directory-based task files (if any) and reloads tasks.
     * Does NOT create the tasks directory.
     * Safe to call on uninitialised workspaces — silently loads nothing if
     * the directory does not exist.
     */
    async init(): Promise<void> {
        await this.migrateFromDirectories();
        await this.reload();
    }

    /**
     * Full first-time setup: creates the tasks directory then calls init().
     * Safe to call on already-initialised workspaces (idempotent).
     */
    async initialise(): Promise<void> {
        try {
            await vscode.workspace.fs.createDirectory(this.tasksUri);
        } catch {
            // directory may already exist
        }
        await this.init();
    }

    /**
     * Migrate legacy directory-based task files into flat tasks/ directory.
     * Scans subdirectories under tasks/ (excluding archive/), moves files
     * up into tasks/ adding the lane to frontmatter, and renames files
     * from old format (with HHmmssfff timestamp) to new format.
     */
    async migrateFromDirectories(): Promise<void> {
        let entries: [string, vscode.FileType][];
        try {
            entries = await vscode.workspace.fs.readDirectory(this.tasksUri);
        } catch {
            return;
        }

        // Find lane subdirectories (not archive, not files)
        const laneDirs = entries.filter(
            ([name, type]) => type === vscode.FileType.Directory && name !== 'archive',
        );
        if (laneDirs.length === 0) {
            // Also rename any flat task files that have old naming format
            await this.migrateFileNames(this.tasksUri);
            const archiveUri = vscode.Uri.joinPath(this.tasksUri, 'archive');
            await this.migrateFileNames(archiveUri);
            return;
        }

        this.logger.info('taskStore', `Migrating ${laneDirs.length} lane directories to flat structure`);

        for (const [dirName] of laneDirs) {
            const dirUri = vscode.Uri.joinPath(this.tasksUri, dirName);
            let dirEntries: [string, vscode.FileType][];
            try {
                dirEntries = await vscode.workspace.fs.readDirectory(dirUri);
            } catch {
                continue;
            }

            const lane = slugifyLane(dirName) || 'todo';

            for (const [fileName, fileType] of dirEntries) {
                if (fileType !== vscode.FileType.File || !fileName.endsWith('.md')) {
                    continue;
                }

                const srcUri = vscode.Uri.joinPath(dirUri, fileName);

                if (fileName.startsWith('task_')) {
                    try {
                        // Read and inject lane into frontmatter
                        const content = await vscode.workspace.fs.readFile(srcUri);
                        const text = new TextDecoder().decode(content);
                        const task = TaskStore.deserialise(text);
                        if (task) {
                            task.lane = lane;
                            const parsed = TaskStore.splitFrontmatter(text);
                            const body = parsed.body;
                            const newContent = TaskStore.serialise(task, body);

                            // Determine new filename (drop HHmmssfff if present)
                            const newFileName = TaskStore.migrateFileName(fileName);
                            const destUri = vscode.Uri.joinPath(this.tasksUri, newFileName);
                            await vscode.workspace.fs.writeFile(destUri, new TextEncoder().encode(newContent));
                            await vscode.workspace.fs.delete(srcUri);
                            this.logger.info('taskStore', `Migrated ${dirName}/${fileName} → ${newFileName}`);
                        }
                    } catch (err: any) {
                        this.logger.warn('taskStore', `Failed to migrate ${dirName}/${fileName}: ${err.message}`);
                    }
                } else if (fileName.startsWith('todo_')) {
                    try {
                        const newFileName = TaskStore.migrateFileName(fileName);
                        const destUri = vscode.Uri.joinPath(this.tasksUri, newFileName);
                        await vscode.workspace.fs.rename(srcUri, destUri, { overwrite: false });
                        this.logger.info('taskStore', `Migrated ${dirName}/${fileName} → ${newFileName}`);
                    } catch (err: any) {
                        this.logger.warn('taskStore', `Failed to migrate todo ${dirName}/${fileName}: ${err.message}`);
                    }
                }
            }

            // Remove empty directory
            try {
                const remaining = await vscode.workspace.fs.readDirectory(dirUri);
                if (remaining.length === 0) {
                    await vscode.workspace.fs.delete(dirUri);
                    this.logger.info('taskStore', `Removed empty directory: ${dirName}`);
                }
            } catch {
                // not critical
            }
        }

        // Also rename any files in archive/ that have old format
        const archiveUri = vscode.Uri.joinPath(this.tasksUri, 'archive');
        await this.migrateFileNames(archiveUri);
    }

    /**
     * Rename files within a directory from old format (with HHmmssfff) to new format.
     * Only renames if the name actually changes.
     */
    private async migrateFileNames(dirUri: vscode.Uri): Promise<void> {
        let entries: [string, vscode.FileType][];
        try {
            entries = await vscode.workspace.fs.readDirectory(dirUri);
        } catch {
            return;
        }
        for (const [name, type] of entries) {
            if (type !== vscode.FileType.File || !name.endsWith('.md')) { continue; }
            if (!name.startsWith('task_') && !name.startsWith('todo_')) { continue; }
            const newName = TaskStore.migrateFileName(name);
            if (newName !== name) {
                try {
                    const srcUri = vscode.Uri.joinPath(dirUri, name);
                    const destUri = vscode.Uri.joinPath(dirUri, newName);
                    await vscode.workspace.fs.rename(srcUri, destUri, { overwrite: false });
                    this.logger.info('taskStore', `Renamed ${name} → ${newName}`);
                } catch (err: any) {
                    this.logger.warn('taskStore', `Failed to rename ${name}: ${err.message}`);
                }
            }
        }
    }

    /**
     * Convert a legacy filename with HHmmssfff to the new format without it.
     * E.g. task_20260315_085316225_hwsri7_title.md → task_20260315_hwsri7_title.md
     * Returns the name unchanged if it already uses the new format.
     */
    static migrateFileName(name: string): string {
        // Match: (task_|todo_)YYYYMMDD_HHmmssfff_XXXXXX_slug.md
        const match = name.match(/^(task_|todo_)(\d{8})_(\d{9})_([a-z0-9]{4,8})_(.+)$/);
        if (match) {
            const [, prefix, date, , uuid, rest] = match;
            return `${prefix}${date}_${uuid}_${rest}`;
        }
        return name;
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
        this._archivedIds.clear();
        try {
            // Load tasks from flat tasks/ directory
            await this.loadTasksFromDirectory(this.tasksUri);
            // Load archived tasks from tasks/archive/
            const archiveUri = vscode.Uri.joinPath(this.tasksUri, 'archive');
            await this.loadTasksFromDirectory(archiveUri, true);
            this.logger.info('taskStore', `Loaded ${this.tasks.size} tasks`);
        } catch {
            // directory may not exist yet
        }
        this._onDidChange.fire();
    }

    /** Load all task files from a directory. */
    private async loadTasksFromDirectory(dirUri: vscode.Uri, isArchive = false): Promise<void> {
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
                        // For archived tasks without a lane, default to 'archive'
                        if (isArchive && !task.lane) {
                            task.lane = 'archive';
                        }
                        // For non-archived tasks without a lane, default to 'todo'
                        if (!isArchive && !task.lane) {
                            task.lane = 'todo';
                        }
                        // Backward compat: recover slug from ID if not in frontmatter
                        if (!task.slug) {
                            task.slug = TaskStore.extractSlugFromId(task.id);
                        }
                        if (isArchive) {
                            this._archivedIds.add(task.id);
                        }
                        this.tasks.set(task.id, task);
                    }
                } catch {
                    // skip unreadable files
                }
            }
        }
    }

    getAll(): Task[] {
        return Array.from(this.tasks.values());
    }

    get(id: string): Task | undefined {
        return this.tasks.get(id);
    }

    /** Returns the URI for a task's markdown file. Archived tasks live in tasks/archive/. */
    getTaskUri(id: string): vscode.Uri {
        const task = this.tasks.get(id);
        if (task && this.isArchived(task)) {
            return vscode.Uri.joinPath(this.tasksUri, 'archive', `${id}.md`);
        }
        return vscode.Uri.joinPath(this.tasksUri, `${id}.md`);
    }

    /** Returns the URI for a task's todo file. */
    getTodoUri(taskId: string): vscode.Uri {
        const todoFilename = taskId.replace(/^task_/, 'todo_') + '.md';
        const task = this.tasks.get(taskId);
        if (task && this.isArchived(task)) {
            return vscode.Uri.joinPath(this.tasksUri, 'archive', todoFilename);
        }
        return vscode.Uri.joinPath(this.tasksUri, todoFilename);
    }

    /** Check if a task is stored in the archive directory. */
    isArchived(task: Task): boolean {
        // A task is archived if its file lives in the archive/ subdirectory.
        // We detect this by checking if the file exists in archive/ at read time,
        // but at runtime we track it via a simple signal: the task was loaded
        // from the archive directory. We use a lightweight check:
        // tasks loaded from archive have their lane preserved from frontmatter,
        // and the archiveTask method moves files into archive/.
        // For simplicity, check if the file exists in archive first.
        // Actually: we can tell by checking the task's _archived flag or
        // by relying on the fact that we only call moveToArchive explicitly.
        // Let's use a direct approach: check membership.
        return this._archivedIds.has(task.id);
    }

    /** Track which task IDs are in the archive directory. */
    private _archivedIds = new Set<string>();

    async save(task: Task): Promise<void> {
        task.updated = new Date().toISOString();
        this.tasks.set(task.id, task);
        const uri = this.getTaskUri(task.id);

        // Preserve existing markdown body if the file already exists
        let body = '\n## Conversation\n\n### user\n\n';
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
        const uri = this.getTaskUri(task.id);
        const content = new TextEncoder().encode(TaskStore.serialise(task, body));
        await vscode.workspace.fs.writeFile(uri, content);
        this.logger.info('taskStore', `Saved task with body ${task.id}`);
        this._onDidChange.fire();
    }

    /**
     * Move a task to a new lane. Updates frontmatter only — no file move.
     * Reads the existing body, writes the updated frontmatter at the same location.
     */
    async moveTaskToLane(id: string, newLane: string): Promise<void> {
        const task = this.tasks.get(id);
        if (!task) { return; }

        const oldLane = task.lane;
        task.lane = newLane;
        task.updated = new Date().toISOString();
        this.tasks.set(id, task);

        if (oldLane === newLane) {
            await this.save(task);
            return;
        }

        // Read existing body from current file location
        const wasArchived = this._archivedIds.has(id);
        const oldUri = wasArchived
            ? vscode.Uri.joinPath(this.tasksUri, 'archive', `${id}.md`)
            : vscode.Uri.joinPath(this.tasksUri, `${id}.md`);

        let body = '\n## Conversation\n\n### user\n\n';
        try {
            const existing = await vscode.workspace.fs.readFile(oldUri);
            const existingText = new TextDecoder().decode(existing);
            const parsed = TaskStore.splitFrontmatter(existingText);
            if (parsed.body) {
                body = parsed.body;
            }
        } catch {
            // file may not exist at old location
        }

        // Write updated file at same location (lane is in frontmatter now)
        const content = new TextEncoder().encode(TaskStore.serialise(task, body));
        await vscode.workspace.fs.writeFile(oldUri, content);

        this.logger.info('taskStore', `Moved task ${id} from ${oldLane} to ${newLane}`);
        this._onDidChange.fire();
    }

    /**
     * Archive a task — move file from tasks/ to tasks/archive/.
     * Retains the original lane in frontmatter.
     */
    async archiveTask(id: string): Promise<void> {
        const task = this.tasks.get(id);
        if (!task) { return; }

        if (this._archivedIds.has(id)) {
            return; // already archived
        }

        const oldUri = vscode.Uri.joinPath(this.tasksUri, `${id}.md`);
        const archiveDir = vscode.Uri.joinPath(this.tasksUri, 'archive');
        try { await vscode.workspace.fs.createDirectory(archiveDir); } catch { /* exists */ }
        const newUri = vscode.Uri.joinPath(archiveDir, `${id}.md`);

        // Read body, update frontmatter, write to archive
        let body = '\n## Conversation\n\n### user\n\n';
        try {
            const existing = await vscode.workspace.fs.readFile(oldUri);
            const existingText = new TextDecoder().decode(existing);
            const parsed = TaskStore.splitFrontmatter(existingText);
            if (parsed.body) {
                body = parsed.body;
            }
        } catch {
            // source may not exist
        }

        task.updated = new Date().toISOString();
        const content = new TextEncoder().encode(TaskStore.serialise(task, body));
        await vscode.workspace.fs.writeFile(newUri, content);

        // Delete old file
        try { await vscode.workspace.fs.delete(oldUri); } catch { /* may not exist */ }

        // Move todo file if it exists
        const todoFilename = id.replace(/^task_/, 'todo_') + '.md';
        const oldTodoUri = vscode.Uri.joinPath(this.tasksUri, todoFilename);
        const newTodoUri = vscode.Uri.joinPath(archiveDir, todoFilename);
        try {
            await vscode.workspace.fs.stat(oldTodoUri);
            await vscode.workspace.fs.rename(oldTodoUri, newTodoUri, { overwrite: false });
        } catch { /* no todo file */ }

        this._archivedIds.add(id);
        this.logger.info('taskStore', `Archived task ${id}`);
        this._onDidChange.fire();
    }

    async delete(id: string): Promise<void> {
        const task = this.tasks.get(id);
        const isArchived = this._archivedIds.has(id);
        this.tasks.delete(id);
        this._archivedIds.delete(id);

        const taskUri = isArchived
            ? vscode.Uri.joinPath(this.tasksUri, 'archive', `${id}.md`)
            : vscode.Uri.joinPath(this.tasksUri, `${id}.md`);
        try {
            await vscode.workspace.fs.delete(taskUri);
            this.logger.info('taskStore', `Deleted task ${id}`);
        } catch {
            // file may not exist
        }
        const todoFilename = id.replace(/^task_/, 'todo_') + '.md';
        const todoUri = isArchived
            ? vscode.Uri.joinPath(this.tasksUri, 'archive', todoFilename)
            : vscode.Uri.joinPath(this.tasksUri, todoFilename);
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
            slug: TaskStore.slugify(title),
        };
    }

    /** Find tasks whose title or slug contains the query (case-insensitive). Excludes tasks in the given lane. */
    findByTitle(query: string, excludeLane?: string): Task[] {
        const q = query.toLowerCase();
        const qAlnum = q.replace(/[^a-z0-9]/g, '');
        return this.getAll().filter(t =>
            (t.title.toLowerCase().includes(q) ||
                (t.slug && t.slug.toLowerCase().includes(q)) ||
                (qAlnum && t.title.toLowerCase().replace(/[^a-z0-9]/g, '').includes(qAlnum))) &&
            (!excludeLane || t.lane !== excludeLane),
        );
    }

    /**
     * Generate a task ID in the format: task_YYYYMMDD_XXXXXX_slugified_title
     */
    static generateId(date: Date, title: string): string {
        const y = date.getFullYear();
        const mo = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const ds = `${y}${mo}${d}`;
        const uuid = Math.random().toString(36).slice(2, 8);
        const slug = TaskStore.slugify(title);
        return `task_${ds}_${uuid}_${slug}`;
    }

    /**
     * Extract the slug portion from a task ID.
     * ID format: task_YYYYMMDD_XXXXXX_<slug>
     * Also supports legacy format: task_YYYYMMDD_HHmmssfff_XXXXXX_<slug>
     * Returns empty string if the ID doesn't match the expected format.
     */
    static extractSlugFromId(id: string): string {
        const parts = id.split('_');
        if (parts.length < 4 || parts[0] !== 'task') { return ''; }
        // New format: task_YYYYMMDD_XXXXXX_slug... (date is 8 digits, uuid is 6 alnum)
        // Legacy format: task_YYYYMMDD_HHmmssfff_XXXXXX_slug... (time is 9 digits)
        if (parts.length >= 5 && /^\d{9}$/.test(parts[2])) {
            // Legacy format — skip date, time, uuid
            return parts.slice(4).join('_');
        }
        // New format — skip date, uuid
        return parts.slice(3).join('_');
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
     */
    static serialise(task: Task, body?: string): string {
        const frontmatter: Record<string, unknown> = {
            title: task.title,
            lane: task.lane,
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
        if (task.slug) {
            frontmatter.slug = task.slug;
        }
        if (task.worktree) {
            frontmatter.worktree = {
                branch: task.worktree.branch,
                path: task.worktree.path,
                created: task.worktree.created,
            };
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
                lane: typeof data.lane === 'string' ? data.lane : '',
                created: (data.created as string) ?? new Date().toISOString(),
                updated: (data.updated as string) ?? new Date().toISOString(),
                description: (data.description as string) ?? '',
                priority: (data.priority as Priority) || undefined,
                assignee: (data.assignee as string) || undefined,
                labels: Array.isArray(data.labels) ? (data.labels as string[]) : undefined,
                dueDate: (data.dueDate as string) || undefined,
                sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : undefined,
                slug: typeof data.slug === 'string' ? data.slug : undefined,
                worktree: data.worktree && typeof data.worktree === 'object'
                    ? {
                        branch: String((data.worktree as Record<string, unknown>).branch ?? ''),
                        path: String((data.worktree as Record<string, unknown>).path ?? ''),
                        created: String((data.worktree as Record<string, unknown>).created ?? ''),
                    } as WorktreeInfo
                    : undefined,
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
