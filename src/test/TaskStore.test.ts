import { describe, it, expect } from 'vitest';
import { TaskStore } from '../TaskStore';
import type { Task } from '../types';

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
            expect(result!.lane).toBe(task.lane);
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
            expect(md).toContain('lane: done');
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

            const body = '\n## Conversation\n\n[user]: Hello\n';
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
    });

    describe('deserialise', () => {
        it('should return null for plain text without frontmatter', () => {
            expect(TaskStore.deserialise('not markdown')).toBeNull();
        });

        it('should return null for frontmatter without title', () => {
            const text = '---\nlane: todo\n---\n\n## Conversation\n';
            expect(TaskStore.deserialise(text)).toBeNull();
        });

        it('should default lane to todo when missing', () => {
            const text = '---\ntitle: Test\ncreated: "2026-03-08T10:00:00.000Z"\nupdated: "2026-03-08T10:00:00.000Z"\n---\n\n## Conversation\n';
            const task = TaskStore.deserialise(text);
            expect(task).not.toBeNull();
            expect(task!.lane).toBe('todo');
        });

        it('should set empty id (caller populates from filename)', () => {
            const text = '---\ntitle: Test\nlane: doing\n---\n\n';
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
        it('should construct task URI from id', () => {
            const uri = { scheme: 'file', fsPath: '/test', path: '/test', toString: () => '/test' } as any;
            const store = new TaskStore(uri);

            const taskUri = store.getTaskUri('task_20260308_143045123_abc123_test');
            expect(taskUri.fsPath).toContain('task_20260308_143045123_abc123_test.md');
        });

        it('should construct todo URI from task id', () => {
            const uri = { scheme: 'file', fsPath: '/test', path: '/test', toString: () => '/test' } as any;
            const store = new TaskStore(uri);

            const todoUri = store.getTodoUri('task_20260308_143045123_abc123_test');
            expect(todoUri.fsPath).toContain('todo_20260308_143045123_abc123_test.md');
        });
    });
});
