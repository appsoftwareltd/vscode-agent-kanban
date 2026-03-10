import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskStore } from '../TaskStore';
import type { Task } from '../types';
import { Uri, workspace } from 'vscode';

describe('TaskStore', () => {
    describe('slugify', () => {
        it('should lowercase and replace spaces with underscores', () => {
            expect(TaskStore.slugify('Hello World')).toBe('hello_world');
        });

        it('should replace special characters with underscores', () => {
            expect(TaskStore.slugify('Fix bug #123 (urgent!)')).toBe('fix_bug_123_urgent');
        });

        it('should collapse consecutive underscores', () => {
            expect(TaskStore.slugify('A --- B')).toBe('a_b');
        });

        it('should trim leading and trailing underscores', () => {
            expect(TaskStore.slugify('  hello  ')).toBe('hello');
        });

        it('should truncate to 50 characters', () => {
            const long = 'a'.repeat(60);
            expect(TaskStore.slugify(long).length).toBeLessThanOrEqual(50);
        });

        it('should handle empty string', () => {
            expect(TaskStore.slugify('')).toBe('');
        });
    });

    describe('generateId', () => {
        it('should generate ID in expected format', () => {
            const id = TaskStore.generateId(new Date(), 'Test Task');
            // Format: task_YYYYMMDD_HHmmssfff_XXXXXX_slugified_title
            expect(id).toMatch(/^task_\d{8}_\d{9}_[a-z0-9]{6}_test_task$/);
        });

        it('should include task prefix and slug', () => {
            const id = TaskStore.generateId(new Date(), 'My Task');
            expect(id.startsWith('task_')).toBe(true);
            expect(id.endsWith('_my_task')).toBe(true);
        });

        it('should generate unique IDs due to random component', () => {
            const date = new Date();
            const id1 = TaskStore.generateId(date, 'Task');
            const id2 = TaskStore.generateId(date, 'Task');
            expect(id1).not.toBe(id2);
        });
    });

    describe('splitFrontmatter', () => {
        it('should split valid frontmatter from body', () => {
            const text = '---\ntitle: Test\nlane: todo\n---\n\n## Conversation\n';
            const { frontmatter, body } = TaskStore.splitFrontmatter(text);

            expect(frontmatter).toBe('title: Test\nlane: todo');
            expect(body).toBe('\n## Conversation\n');
        });

        it('should return null frontmatter for text without opening fence', () => {
            const text = 'Just some text\n';
            const { frontmatter, body } = TaskStore.splitFrontmatter(text);

            expect(frontmatter).toBeNull();
            expect(body).toBe('Just some text\n');
        });

        it('should return null frontmatter for unclosed fence', () => {
            const text = '---\ntitle: Test\n';
            const { frontmatter, body } = TaskStore.splitFrontmatter(text);

            expect(frontmatter).toBeNull();
            expect(body).toBe('---\ntitle: Test\n');
        });

        it('should handle empty frontmatter', () => {
            const text = '---\n---\nBody here\n';
            const { frontmatter, body } = TaskStore.splitFrontmatter(text);

            expect(frontmatter).toBe('');
            expect(body).toBe('Body here\n');
        });
    });

    describe('serialise / deserialise round-trip', () => {
        it('should round-trip a task via markdown frontmatter', () => {
            const task: Task = {
                id: 'task_20260308_143045123_abc123_test_task',
                title: 'Test task',
                lane: 'todo',
                created: '2026-03-08T10:00:00.000Z',
                updated: '2026-03-08T10:00:00.000Z',
                description: 'A test task description',
            };

            const md = TaskStore.serialise(task);
            const result = TaskStore.deserialise(md);

            expect(result).not.toBeNull();
            expect(result!.title).toBe(task.title);
            // lane is not serialised — determined by directory
            expect(result!.lane).toBe('');
            expect(result!.created).toBe(task.created);
            expect(result!.updated).toBe(task.updated);
            expect(result!.description).toBe(task.description);
        });

        it('should produce markdown with YAML frontmatter fences', () => {
            const task: Task = {
                id: 'task_001',
                title: 'YAML validity',
                lane: 'done',
                created: '2026-03-08T10:00:00.000Z',
                updated: '2026-03-08T10:00:00.000Z',
                description: '',
            };

            const md = TaskStore.serialise(task);

            expect(md.startsWith('---\n')).toBe(true);
            expect(md).toContain('title: YAML validity');
            // lane is NOT written to frontmatter — determined by directory
            expect(md).not.toMatch(/^lane:/m);
            expect(md).toContain('## Conversation');
        });

        it('should preserve custom body when provided', () => {
            const task: Task = {
                id: 'task_002',
                title: 'With body',
                lane: 'doing',
                created: '2026-03-08T10:00:00.000Z',
                updated: '2026-03-08T10:00:00.000Z',
                description: '',
            };

            const body = '\n## Conversation\n\n[user] Hello\n\n[agent] Hi there\n';
            const md = TaskStore.serialise(task, body);
            const { body: parsedBody } = TaskStore.splitFrontmatter(md);

            // Body round-trips cleanly through serialise/splitFrontmatter
            expect(parsedBody).toBe(body);
        });

        it('should be stable across multiple serialise/split round-trips', () => {
            const task: Task = {
                id: 'task_rt',
                title: 'Round Trip',
                lane: 'doing',
                created: '2026-03-08T10:00:00.000Z',
                updated: '2026-03-08T10:00:00.000Z',
                description: '',
            };

            const body = '\n## Conversation\n\n[user] Hello\n';
            const md1 = TaskStore.serialise(task, body);
            const { body: body1 } = TaskStore.splitFrontmatter(md1);
            const md2 = TaskStore.serialise(task, body1);
            const { body: body2 } = TaskStore.splitFrontmatter(md2);
            const md3 = TaskStore.serialise(task, body2);

            // No whitespace accumulation across round-trips
            expect(md1).toBe(md2);
            expect(md2).toBe(md3);
        });

        it('should omit description when empty', () => {
            const task: Task = {
                id: 'task_003',
                title: 'No description',
                lane: 'todo',
                created: '2026-03-08T10:00:00.000Z',
                updated: '2026-03-08T10:00:00.000Z',
                description: '',
            };

            const md = TaskStore.serialise(task);
            // Check there's no 'description:' YAML key (title contains 'description' substring)
            expect(md).not.toMatch(/^description:/m);
        });

        it('should include description when present', () => {
            const task: Task = {
                id: 'task_004',
                title: 'Has description',
                lane: 'todo',
                created: '2026-03-08T10:00:00.000Z',
                updated: '2026-03-08T10:00:00.000Z',
                description: 'Some details here',
            };

            const md = TaskStore.serialise(task);
            expect(md).toContain('description: Some details here');
        });

        it('should serialise and deserialise priority', () => {
            const task: Task = {
                id: 'task_005',
                title: 'Priority task',
                lane: 'doing',
                created: '2026-03-08T10:00:00.000Z',
                updated: '2026-03-08T10:00:00.000Z',
                description: '',
                priority: 'high',
            };
            const md = TaskStore.serialise(task);
            expect(md).toContain('priority: high');
            const result = TaskStore.deserialise(md);
            expect(result!.priority).toBe('high');
        });

        it('should serialise and deserialise assignee', () => {
            const task: Task = {
                id: 'task_006',
                title: 'Assigned task',
                lane: 'todo',
                created: '2026-03-08T10:00:00.000Z',
                updated: '2026-03-08T10:00:00.000Z',
                description: '',
                assignee: 'alice',
            };
            const md = TaskStore.serialise(task);
            expect(md).toContain('assignee: alice');
            const result = TaskStore.deserialise(md);
            expect(result!.assignee).toBe('alice');
        });

        it('should serialise and deserialise labels', () => {
            const task: Task = {
                id: 'task_007',
                title: 'Labelled task',
                lane: 'todo',
                created: '2026-03-08T10:00:00.000Z',
                updated: '2026-03-08T10:00:00.000Z',
                description: '',
                labels: ['backend', 'api'],
            };
            const md = TaskStore.serialise(task);
            const result = TaskStore.deserialise(md);
            expect(result!.labels).toEqual(['backend', 'api']);
        });

        it('should serialise and deserialise dueDate', () => {
            const task: Task = {
                id: 'task_008',
                title: 'Due task',
                lane: 'todo',
                created: '2026-03-08T10:00:00.000Z',
                updated: '2026-03-08T10:00:00.000Z',
                description: '',
                dueDate: '2026-04-01',
            };
            const md = TaskStore.serialise(task);
            expect(md).toContain('dueDate: ');
            const result = TaskStore.deserialise(md);
            expect(result!.dueDate).toBe('2026-04-01');
        });

        it('should omit optional metadata fields when not set', () => {
            const task: Task = {
                id: 'task_009',
                title: 'Minimal',
                lane: 'todo',
                created: '2026-03-08T10:00:00.000Z',
                updated: '2026-03-08T10:00:00.000Z',
                description: '',
            };
            const md = TaskStore.serialise(task);
            expect(md).not.toMatch(/^priority:/m);
            expect(md).not.toMatch(/^assignee:/m);
            expect(md).not.toMatch(/^labels:/m);
            expect(md).not.toMatch(/^dueDate:/m);
        });



        it('should serialise and deserialise sortOrder', () => {
            const task: Task = {
                id: 'task_012',
                title: 'Ordered task',
                lane: 'doing',
                created: '2026-03-09T10:00:00.000Z',
                updated: '2026-03-09T10:00:00.000Z',
                description: '',
                sortOrder: 2.5,
            };
            const md = TaskStore.serialise(task);
            expect(md).toContain('sortOrder: 2.5');
            const result = TaskStore.deserialise(md);
            expect(result!.sortOrder).toBe(2.5);
        });

        it('should omit sortOrder when undefined', () => {
            const task: Task = {
                id: 'task_013',
                title: 'No order',
                lane: 'todo',
                created: '2026-03-09T10:00:00.000Z',
                updated: '2026-03-09T10:00:00.000Z',
                description: '',
            };
            const md = TaskStore.serialise(task);
            expect(md).not.toMatch(/^sortOrder:/m);
            const result = TaskStore.deserialise(md);
            expect(result!.sortOrder).toBeUndefined();
        });

        it('should not serialise lane to YAML (determined by directory)', () => {
            const task: Task = {
                id: 'task_014',
                title: 'Lane case test',
                lane: 'doing',
                created: '2026-03-09T10:00:00.000Z',
                updated: '2026-03-09T10:00:00.000Z',
                description: '',
            };
            const md = TaskStore.serialise(task);
            expect(md).not.toMatch(/^lane:/m);
        });

        it('should set lane to empty string on deserialise (caller populates)', () => {
            const md = '---\ntitle: Test\nlane: DOING\ncreated: 2026-03-09T10:00:00.000Z\nupdated: 2026-03-09T10:00:00.000Z\n---\n';
            const result = TaskStore.deserialise(md);
            // lane is ignored from frontmatter — caller sets it from directory name
            expect(result!.lane).toBe('');
        });
    });

    describe('deserialise', () => {
        it('should return null for plain text without frontmatter', () => {
            expect(TaskStore.deserialise('not markdown')).toBeNull();
        });

        it('should return null for frontmatter without title', () => {
            const text = '---\nlane: todo\n---\n\n## Conversation\n';
            expect(TaskStore.deserialise(text)).toBeNull();
        });

        it('should set lane to empty string (caller populates from directory)', () => {
            const text = '---\ntitle: Test\ncreated: "2026-03-08T10:00:00.000Z"\nupdated: "2026-03-08T10:00:00.000Z"\n---\n\n## Conversation\n';
            const task = TaskStore.deserialise(text);
            expect(task).not.toBeNull();
            expect(task!.lane).toBe('');
        });

        it('should set empty id (caller populates from filename)', () => {
            const text = '---\ntitle: Test\n---\n\n';
            const task = TaskStore.deserialise(text);
            expect(task).not.toBeNull();
            expect(task!.id).toBe('');
        });
    });

    describe('createTask', () => {
        it('should create a task with correct fields', () => {
            const uri = { scheme: 'file', fsPath: '/test', path: '/test', toString: () => '/test' } as any;
            const store = new TaskStore(uri);

            const task = store.createTask('My Task', 'todo');

            expect(task.title).toBe('My Task');
            expect(task.lane).toBe('todo');
            expect(task.description).toBe('');
            expect(task.id).toMatch(/^task_/);
            expect(task.id).toContain('_my_task');
        });

        it('should generate unique IDs for different tasks', () => {
            const uri = { scheme: 'file', fsPath: '/test', path: '/test', toString: () => '/test' } as any;
            const store = new TaskStore(uri);

            const task1 = store.createTask('Task A', 'todo');
            const task2 = store.createTask('Task B', 'doing');

            expect(task1.id).not.toBe(task2.id);
        });

        it('should not include conversation field', () => {
            const uri = { scheme: 'file', fsPath: '/test', path: '/test', toString: () => '/test' } as any;
            const store = new TaskStore(uri);

            const task = store.createTask('Test', 'todo');

            expect((task as any).conversation).toBeUndefined();
        });
    });

    describe('read-only init', () => {
        const workspaceUri = Uri.file('/test-workspace');

        beforeEach(() => {
            vi.restoreAllMocks();
        });

        it('should not create tasks directory when it does not exist', async () => {
            vi.spyOn(workspace.fs, 'readDirectory').mockRejectedValue(new Error('not found'));
            const dirSpy = vi.spyOn(workspace.fs, 'createDirectory').mockResolvedValue(undefined);

            const store = new TaskStore(workspaceUri);
            await store.init();

            expect(dirSpy).not.toHaveBeenCalled();
        });

        it('should load tasks when directory exists without creating dirs', async () => {
            vi.spyOn(workspace.fs, 'readDirectory').mockResolvedValue([]);
            const dirSpy = vi.spyOn(workspace.fs, 'createDirectory').mockResolvedValue(undefined);

            const store = new TaskStore(workspaceUri);
            await store.init();

            expect(dirSpy).not.toHaveBeenCalled();
            expect(store.getAll()).toEqual([]);
        });
    });

    describe('initialise', () => {
        const workspaceUri = Uri.file('/test-workspace');

        beforeEach(() => {
            vi.restoreAllMocks();
        });

        it('should create tasks directory', async () => {
            vi.spyOn(workspace.fs, 'readDirectory').mockRejectedValue(new Error('not found'));
            const dirSpy = vi.spyOn(workspace.fs, 'createDirectory').mockResolvedValue(undefined);

            const store = new TaskStore(workspaceUri);
            await store.initialise();

            expect(dirSpy).toHaveBeenCalledWith(
                expect.objectContaining({ fsPath: expect.stringContaining('tasks') }),
            );
        });
    });

    describe('findByTitle', () => {
        it('should find tasks by partial title match case-insensitively', () => {
            const uri = { scheme: 'file', fsPath: '/test', path: '/test', toString: () => '/test' } as any;
            const store = new TaskStore(uri);

            const task1 = store.createTask('Implement Auth', 'todo');
            const task2 = store.createTask('Fix Login Bug', 'doing');
            const task3 = store.createTask('Implement API', 'done');

            (store as any).tasks.set(task1.id, task1);
            (store as any).tasks.set(task2.id, task2);
            (store as any).tasks.set(task3.id, task3);

            const results = store.findByTitle('implement');

            expect(results).toHaveLength(2);
        });

        it('should exclude tasks in specified lane', () => {
            const uri = { scheme: 'file', fsPath: '/test', path: '/test', toString: () => '/test' } as any;
            const store = new TaskStore(uri);

            const task1 = store.createTask('Implement Auth', 'todo');
            const task2 = store.createTask('Implement API', 'done');

            (store as any).tasks.set(task1.id, task1);
            (store as any).tasks.set(task2.id, task2);

            const results = store.findByTitle('Implement', 'done');

            expect(results).toHaveLength(1);
            expect(results[0].title).toBe('Implement Auth');
        });

        it('should return empty array when no match', () => {
            const uri = { scheme: 'file', fsPath: '/test', path: '/test', toString: () => '/test' } as any;
            const store = new TaskStore(uri);

            const results = store.findByTitle('nonexistent');

            expect(results).toHaveLength(0);
        });
    });

    describe('getTaskUri / getTodoUri', () => {
        it('should construct task URI using lane subdirectory from cache', () => {
            const uri = { scheme: 'file', fsPath: '/test', path: '/test', toString: () => '/test' } as any;
            const store = new TaskStore(uri);

            // Add task to cache so URI uses its lane directory
            const task = store.createTask('Test', 'doing');
            (store as any).tasks.set(task.id, task);

            const taskUri = store.getTaskUri(task.id);
            expect(taskUri.fsPath).toContain('doing');
            expect(taskUri.fsPath).toContain(`${task.id}.md`);
        });

        it('should fall back to todo directory when task not in cache', () => {
            const uri = { scheme: 'file', fsPath: '/test', path: '/test', toString: () => '/test' } as any;
            const store = new TaskStore(uri);

            const taskUri = store.getTaskUri('task_20260308_143045123_abc123_test');
            expect(taskUri.fsPath).toContain('todo');
            expect(taskUri.fsPath).toContain('task_20260308_143045123_abc123_test.md');
        });

        it('should construct todo URI using lane subdirectory from cache', () => {
            const uri = { scheme: 'file', fsPath: '/test', path: '/test', toString: () => '/test' } as any;
            const store = new TaskStore(uri);

            const task = store.createTask('Test', 'doing');
            (store as any).tasks.set(task.id, task);

            const todoUri = store.getTodoUri(task.id);
            expect(todoUri.fsPath).toContain('doing');
            expect(todoUri.fsPath).toContain('todo_');
        });

        it('should fall back to todo directory for todo URI when task not in cache', () => {
            const uri = { scheme: 'file', fsPath: '/test', path: '/test', toString: () => '/test' } as any;
            const store = new TaskStore(uri);

            const todoUri = store.getTodoUri('task_20260308_143045123_abc123_test');
            expect(todoUri.fsPath).toContain('todo');
            expect(todoUri.fsPath).toContain('todo_20260308_143045123_abc123_test.md');
        });
    });

    describe('moveTaskToLane', () => {
        let store: TaskStore;
        let writtenFiles: Map<string, string>;
        let deletedPaths: string[];
        let renamedPaths: Array<{ from: string; to: string }>;

        beforeEach(() => {
            const uri = { scheme: 'file', fsPath: '/test', path: '/test', toString: () => '/test' } as any;
            store = new TaskStore(uri);
            writtenFiles = new Map();
            deletedPaths = [];
            renamedPaths = [];

            vi.spyOn(workspace.fs, 'createDirectory').mockResolvedValue(undefined);
            vi.spyOn(workspace.fs, 'writeFile').mockImplementation(async (u: any, content: Uint8Array) => {
                writtenFiles.set(u.fsPath || u.path, new TextDecoder().decode(content));
            });
            vi.spyOn(workspace.fs, 'delete').mockImplementation(async (u: any) => {
                deletedPaths.push(u.fsPath || u.path);
            });
            vi.spyOn(workspace.fs, 'stat').mockRejectedValue(new Error('not found'));
            vi.spyOn(workspace.fs, 'rename').mockImplementation(async (from: any, to: any) => {
                renamedPaths.push({ from: from.fsPath || from.path, to: to.fsPath || to.path });
            });
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('should move task file from old lane to new lane directory', async () => {
            const task = store.createTask('Move Me', 'todo');
            (store as any).tasks.set(task.id, task);

            // Mock readFile to return existing content at old location
            const existingMd = TaskStore.serialise(task, '\n## Conversation\n\n[user] Hello\n');
            vi.spyOn(workspace.fs, 'readFile').mockResolvedValue(
                new TextEncoder().encode(existingMd),
            );

            await store.moveTaskToLane(task.id, 'doing');

            // Should write to new location
            const newPath = writtenFiles.keys().next().value;
            expect(newPath).toContain('/doing/');
            expect(newPath).toContain(`${task.id}.md`);

            // Should delete old file
            expect(deletedPaths.length).toBe(1);
            expect(deletedPaths[0]).toContain('/todo/');
            expect(deletedPaths[0]).toContain(`${task.id}.md`);

            // In-memory lane should be updated
            expect(store.get(task.id)!.lane).toBe('doing');
        });

        it('should preserve conversation body when moving', async () => {
            const task = store.createTask('Body Test', 'todo');
            (store as any).tasks.set(task.id, task);

            const body = '\n## Conversation\n\n[user] Keep me\n\n[agent] Sure\n';
            const existingMd = TaskStore.serialise(task, body);
            vi.spyOn(workspace.fs, 'readFile').mockResolvedValue(
                new TextEncoder().encode(existingMd),
            );

            await store.moveTaskToLane(task.id, 'done');

            const written = writtenFiles.values().next().value;
            expect(written).toContain('[user] Keep me');
            expect(written).toContain('[agent] Sure');
        });

        it('should persist in-memory sortOrder changes after move', async () => {
            const task = store.createTask('Sorted Task', 'todo');
            task.sortOrder = 3.5;
            (store as any).tasks.set(task.id, task);

            // File on disk has no sortOrder yet
            const oldTask = { ...task, sortOrder: undefined };
            const existingMd = TaskStore.serialise(oldTask, '\n## Conversation\n\n[user]\n\n');
            vi.spyOn(workspace.fs, 'readFile').mockResolvedValue(
                new TextEncoder().encode(existingMd),
            );

            await store.moveTaskToLane(task.id, 'doing');

            const written = writtenFiles.values().next().value;
            expect(written).toContain('sortOrder: 3.5');
        });

        it('should persist in-memory meta fields after move', async () => {
            const task = store.createTask('Meta Task', 'todo');
            task.priority = 'high';
            task.assignee = 'alice';
            task.labels = ['bug'];
            (store as any).tasks.set(task.id, task);

            const existingMd = TaskStore.serialise(
                { ...task, priority: undefined, assignee: undefined, labels: undefined },
                '\n## Conversation\n\n[user]\n\n',
            );
            vi.spyOn(workspace.fs, 'readFile').mockResolvedValue(
                new TextEncoder().encode(existingMd),
            );

            await store.moveTaskToLane(task.id, 'doing');

            const written = writtenFiles.values().next().value;
            expect(written).toContain('priority: high');
            expect(written).toContain('assignee: alice');
            expect(written).toContain('bug');
        });

        it('should not move when same lane (just save)', async () => {
            const task = store.createTask('Same Lane', 'todo');
            task.sortOrder = 1;
            (store as any).tasks.set(task.id, task);

            vi.spyOn(workspace.fs, 'readFile').mockResolvedValue(new Uint8Array());

            await store.moveTaskToLane(task.id, 'todo');

            // Should write a file (save) but not delete anything
            expect(writtenFiles.size).toBe(1);
            expect(deletedPaths.length).toBe(0);
        });

        it('should do nothing for unknown task id', async () => {
            await store.moveTaskToLane('nonexistent', 'doing');

            expect(writtenFiles.size).toBe(0);
            expect(deletedPaths.length).toBe(0);
        });
    });
});
