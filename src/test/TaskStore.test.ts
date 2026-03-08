import { describe, it, expect } from 'vitest';
import { TaskStore } from '../TaskStore';
import type { Task, Message } from '../types';

describe('TaskStore', () => {
    describe('serialise / deserialise round-trip', () => {
        it('should round-trip a task with no conversation', () => {
            const task: Task = {
                id: 'task-001',
                title: 'Test task',
                lane: 'todo',
                created: '2026-03-08T10:00:00.000Z',
                updated: '2026-03-08T10:00:00.000Z',
                description: 'A test task description',
                conversation: [],
            };

            const yaml = TaskStore.serialise(task);
            const result = TaskStore.deserialise(yaml);

            expect(result).toEqual(task);
        });

        it('should round-trip a task with conversation messages', () => {
            const task: Task = {
                id: 'task-002',
                title: 'Task with chat',
                lane: 'doing',
                created: '2026-03-08T10:00:00.000Z',
                updated: '2026-03-08T14:30:00.000Z',
                description: 'Multi-line\ndescription here',
                conversation: [
                    {
                        role: 'user',
                        author: 'Gareth',
                        action: 'plan',
                        timestamp: '2026-03-08T10:00:00.000Z',
                        content: 'Plan the OAuth2 implementation',
                    },
                    {
                        role: 'agent',
                        provider: 'copilot',
                        timestamp: '2026-03-08T10:01:00.000Z',
                        content: 'Here is my plan for OAuth2...',
                    },
                    {
                        role: 'user',
                        author: 'Sarah',
                        timestamp: '2026-03-08T15:00:00.000Z',
                        content: 'I think we should also consider refresh tokens',
                    },
                ],
            };

            const yaml = TaskStore.serialise(task);
            const result = TaskStore.deserialise(yaml);

            expect(result).toEqual(task);
        });

        it('should preserve multi-line content in conversation', () => {
            const task: Task = {
                id: 'task-003',
                title: 'Multiline content',
                lane: 'todo',
                created: '2026-03-08T10:00:00.000Z',
                updated: '2026-03-08T10:00:00.000Z',
                description: '',
                conversation: [
                    {
                        role: 'user',
                        author: 'Gareth',
                        action: 'implement',
                        timestamp: '2026-03-08T10:00:00.000Z',
                        content: 'Line 1\nLine 2\nLine 3\n\nLine after blank',
                    },
                ],
            };

            const yaml = TaskStore.serialise(task);
            const result = TaskStore.deserialise(yaml);

            expect(result.conversation[0].content).toBe(task.conversation[0].content);
        });

        it('should produce valid YAML output', () => {
            const task: Task = {
                id: 'task-004',
                title: 'YAML validity',
                lane: 'done',
                created: '2026-03-08T10:00:00.000Z',
                updated: '2026-03-08T10:00:00.000Z',
                description: 'Test',
                conversation: [],
            };

            const yaml = TaskStore.serialise(task);

            expect(yaml).toContain('id: task-004');
            expect(yaml).toContain('title: YAML validity');
            expect(yaml).toContain('lane: done');
        });
    });

    describe('appendMessage', () => {
        it('should append a message to the conversation', () => {
            const uri = { scheme: 'file', fsPath: '/test', path: '/test', toString: () => '/test' } as any;
            const store = new TaskStore(uri);
            const task: Task = {
                id: 'task-005',
                title: 'Test',
                lane: 'todo',
                created: '2026-03-08T10:00:00.000Z',
                updated: '2026-03-08T10:00:00.000Z',
                description: '',
                conversation: [],
            };

            const msg: Message = {
                role: 'user',
                author: 'Gareth',
                action: 'plan',
                timestamp: '2026-03-08T10:00:00.000Z',
                content: 'Plan this task',
            };

            store.appendMessage(task, msg);

            expect(task.conversation).toHaveLength(1);
            expect(task.conversation[0]).toEqual(msg);
        });

        it('should update the task timestamp when appending', () => {
            const uri = { scheme: 'file', fsPath: '/test', path: '/test', toString: () => '/test' } as any;
            const store = new TaskStore(uri);
            const task: Task = {
                id: 'task-006',
                title: 'Test',
                lane: 'todo',
                created: '2026-03-08T10:00:00.000Z',
                updated: '2026-03-08T10:00:00.000Z',
                description: '',
                conversation: [],
            };

            const before = task.updated;
            store.appendMessage(task, {
                role: 'agent',
                provider: 'copilot',
                timestamp: new Date().toISOString(),
                content: 'Response',
            });

            expect(task.updated).not.toBe(before);
        });
    });

    describe('createTask', () => {
        it('should create a task with a unique id', () => {
            const uri = { scheme: 'file', fsPath: '/test', path: '/test', toString: () => '/test' } as any;
            const store = new TaskStore(uri);

            const task1 = store.createTask('Task A', 'todo');
            const task2 = store.createTask('Task B', 'doing');

            expect(task1.id).not.toBe(task2.id);
            expect(task1.title).toBe('Task A');
            expect(task1.lane).toBe('todo');
            expect(task1.conversation).toEqual([]);
            expect(task2.title).toBe('Task B');
            expect(task2.lane).toBe('doing');
        });
    });
});
