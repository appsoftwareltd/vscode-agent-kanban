import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatParticipant } from '../agents/ChatParticipant';
import { TaskStore } from '../TaskStore';
import { BoardConfigStore } from '../BoardConfigStore';
import type { Task, BoardConfig } from '../types';
import { Uri, workspace, window } from 'vscode';

// Helpers to build mock request/response objects
function mockRequest(command: string | undefined, prompt: string) {
    return { command, prompt } as any;
}

function mockResponse() {
    const messages: string[] = [];
    return {
        markdown: (text: string) => { messages.push(text); },
        messages,
    } as any;
}

const mockToken = { isCancellationRequested: false } as any;

/** Mock extensionUri for tests */
const extensionUri = Uri.file('/test-extension') as any;

describe('ChatParticipant', () => {
    let taskStore: TaskStore;
    let boardConfigStore: BoardConfigStore;
    let participant: ChatParticipant;

    beforeEach(() => {
        const uri = { scheme: 'file', fsPath: '/test-workspace', path: '/test-workspace', toString: () => '/test-workspace' } as any;
        taskStore = new TaskStore(uri);
        boardConfigStore = new BoardConfigStore(uri);
        participant = new ChatParticipant(taskStore, boardConfigStore, extensionUri);
    });

    describe('handleRequest routing', () => {
        it('should show help for unknown command', async () => {
            const response = mockResponse();
            await participant.handleRequest(mockRequest(undefined, ''), {} as any, response, mockToken);

            expect(response.messages.length).toBeGreaterThan(0);
            expect(response.messages[0]).toContain('Available commands');
        });

        it('should route /new command', async () => {
            const response = mockResponse();
            vi.spyOn(taskStore, 'createTask').mockReturnValue({
                id: 'task_001_test', title: 'Test', lane: 'todo',
                created: '', updated: '', description: '',
            });
            vi.spyOn(taskStore, 'save').mockResolvedValue(undefined);

            await participant.handleRequest(mockRequest('new', 'Test Task'), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('Created task'))).toBe(true);
        });

        it('should route /task command', async () => {
            const task: Task = {
                id: 'task_1', title: 'My Task', lane: 'doing',
                created: '2026-03-08T10:00:00.000Z', updated: '2026-03-08T10:00:00.000Z', description: '',
            };
            (taskStore as any).tasks.set(task.id, task);

            vi.spyOn(workspace.fs, 'stat').mockRejectedValue(new Error('not found'));
            vi.spyOn(workspace.fs, 'readFile').mockResolvedValue(new TextEncoder().encode('# Template'));
            vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);
            vi.spyOn(workspace, 'openTextDocument').mockResolvedValue({} as any);
            vi.spyOn(window, 'showTextDocument').mockResolvedValue(undefined as any);

            const response = mockResponse();
            await participant.handleRequest(mockRequest('task', 'My Task'), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('My Task'))).toBe(true);
        });
    });

    describe('handleNew', () => {
        it('should show usage when no title given', async () => {
            const response = mockResponse();
            await participant.handleRequest(mockRequest('new', ''), {} as any, response, mockToken);

            expect(response.messages[0]).toContain('Usage');
        });

        it('should create task and report file path', async () => {
            const response = mockResponse();
            vi.spyOn(taskStore, 'createTask').mockReturnValue({
                id: 'task_20260308_143045123_abc123_my_task',
                title: 'My Task', lane: 'todo',
                created: '', updated: '', description: '',
            });
            vi.spyOn(taskStore, 'save').mockResolvedValue(undefined);

            await participant.handleRequest(mockRequest('new', 'My Task'), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('**My Task**'))).toBe(true);
            expect(response.messages.some((m: string) => m.includes('File:'))).toBe(true);
        });

        it('should suggest /task after creating', async () => {
            const response = mockResponse();
            vi.spyOn(taskStore, 'createTask').mockReturnValue({
                id: 'task_1', title: 'New Feature', lane: 'todo',
                created: '', updated: '', description: '',
            });
            vi.spyOn(taskStore, 'save').mockResolvedValue(undefined);

            await participant.handleRequest(mockRequest('new', 'New Feature'), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('/task'))).toBe(true);
        });
    });

    describe('handleTask', () => {
        let task: Task;

        beforeEach(() => {
            task = {
                id: 'task_20260308_143045123_abc123_auth',
                title: 'Auth Feature',
                lane: 'doing',
                created: '2026-03-08T10:00:00.000Z',
                updated: '2026-03-08T10:00:00.000Z',
                description: '',
            };
            (taskStore as any).tasks.set(task.id, task);

            vi.spyOn(workspace.fs, 'readFile').mockResolvedValue(
                new TextEncoder().encode('# Agent Kanban — Instruction'),
            );
            vi.spyOn(workspace.fs, 'stat').mockImplementation(async (uri: any) => {
                const path = uri.fsPath || uri.path || '';
                if (path.includes('INSTRUCTION.md')) {
                    throw new Error('not found');
                }
                return { type: 1, ctime: 0, mtime: 0, size: 0 } as any;
            });
            vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);
            vi.spyOn(workspace, 'openTextDocument').mockResolvedValue({} as any);
            vi.spyOn(window, 'showTextDocument').mockResolvedValue(undefined as any);
        });

        it('should list active tasks when no name given', async () => {
            const response = mockResponse();
            await participant.handleRequest(mockRequest('task', ''), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('Auth Feature'))).toBe(true);
            expect(response.messages.some((m: string) => m.includes('Active tasks'))).toBe(true);
        });

        it('should show no-tasks message when board is empty', async () => {
            (taskStore as any).tasks.clear();
            const response = mockResponse();
            await participant.handleRequest(mockRequest('task', ''), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('No active tasks'))).toBe(true);
        });

        it('should select task and show context', async () => {
            const response = mockResponse();
            await participant.handleRequest(mockRequest('task', 'Auth Feature'), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('Working on task: **Auth Feature**'))).toBe(true);
            expect(response.messages.some((m: string) => m.includes('INSTRUCTION.md'))).toBe(true);
            expect(response.messages.some((m: string) => m.includes('Task file:'))).toBe(true);
        });

        it('should open the task file in the editor', async () => {
            const openSpy = vi.spyOn(workspace, 'openTextDocument');
            const showSpy = vi.spyOn(window, 'showTextDocument');

            const response = mockResponse();
            await participant.handleRequest(mockRequest('task', 'Auth Feature'), {} as any, response, mockToken);

            expect(openSpy).toHaveBeenCalled();
            expect(showSpy).toHaveBeenCalledWith(expect.anything(), { preview: false });
        });

        it('should guide user to type plan/todo/implement', async () => {
            const response = mockResponse();
            await participant.handleRequest(mockRequest('task', 'Auth Feature'), {} as any, response, mockToken);

            expect(response.messages.some((m: string) =>
                m.includes('plan') && m.includes('todo') && m.includes('implement'),
            )).toBe(true);
        });

        it('should report no match for unknown task', async () => {
            const response = mockResponse();
            await participant.handleRequest(mockRequest('task', 'Nonexistent'), {} as any, response, mockToken);

            expect(response.messages.some((m: string) =>
                m.includes('No task found') || m.includes('No task match'),
            )).toBe(true);
        });

        it('should match case-insensitively', async () => {
            const response = mockResponse();
            await participant.handleRequest(mockRequest('task', 'auth feature'), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('Auth Feature'))).toBe(true);
            expect(response.messages.some((m: string) => m.includes('No task'))).toBe(false);
        });

        it('should match partial first word', async () => {
            const tasks: Task[] = [
                { id: 'task_2', title: 'Login Bug', lane: 'todo', created: '', updated: '', description: '' },
            ];
            for (const t of tasks) {
                (taskStore as any).tasks.set(t.id, t);
            }

            const response = mockResponse();
            await participant.handleRequest(mockRequest('task', 'Login'), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('Login Bug'))).toBe(true);
        });

        it('should exclude done tasks from matching', async () => {
            (taskStore as any).tasks.clear();
            const doneTask: Task = {
                id: 'task_done', title: 'Done Task', lane: 'done',
                created: '2026-03-08T10:00:00.000Z', updated: '2026-03-08T10:00:00.000Z', description: '',
            };
            (taskStore as any).tasks.set(doneTask.id, doneTask);

            const response = mockResponse();
            await participant.handleRequest(mockRequest('task', 'Done Task'), {} as any, response, mockToken);

            expect(response.messages.some((m: string) =>
                m.includes('No task found') || m.includes('No task match'),
            )).toBe(true);
        });
    });

    describe('resolveTaskFromPrompt', () => {
        beforeEach(() => {
            const tasks: Task[] = [
                { id: 'task_1', title: 'Auth Feature', lane: 'doing', created: '', updated: '', description: '' },
                { id: 'task_2', title: 'Login Bug', lane: 'todo', created: '', updated: '', description: '' },
                { id: 'task_3', title: 'Done Task', lane: 'done', created: '', updated: '', description: '' },
            ];
            for (const t of tasks) {
                (taskStore as any).tasks.set(t.id, t);
            }
        });

        it('should match exact title (case-insensitive)', () => {
            const result = participant.resolveTaskFromPrompt('auth feature');

            expect(result.task).toBeDefined();
            expect(result.task!.title).toBe('Auth Feature');
            expect(result.freeText).toBe('');
        });

        it('should extract free text after title match', () => {
            const result = participant.resolveTaskFromPrompt('Auth Feature focus on OAuth2');

            expect(result.task!.title).toBe('Auth Feature');
            expect(result.freeText).toBe('focus on OAuth2');
        });

        it('should exclude done lane tasks', () => {
            const result = participant.resolveTaskFromPrompt('Done Task');

            expect(result.task).toBeUndefined();
        });

        it('should match partial first word', () => {
            const result = participant.resolveTaskFromPrompt('Login fix the issue');

            expect(result.task!.title).toBe('Login Bug');
            expect(result.freeText).toBe('fix the issue');
        });

        it('should return undefined for no match', () => {
            const result = participant.resolveTaskFromPrompt('Nonexistent');

            expect(result.task).toBeUndefined();
            expect(result.freeText).toBe('Nonexistent');
        });

        it('should return undefined for empty prompt', () => {
            const result = participant.resolveTaskFromPrompt('');

            expect(result.task).toBeUndefined();
            expect(result.freeText).toBe('');
        });
    });

    describe('getActiveTaskTitles', () => {
        it('should return titles of non-done tasks', () => {
            const tasks: Task[] = [
                { id: 'task_1', title: 'Active Task', lane: 'doing', created: '', updated: '', description: '' },
                { id: 'task_2', title: 'Completed', lane: 'done', created: '', updated: '', description: '' },
            ];
            for (const t of tasks) {
                (taskStore as any).tasks.set(t.id, t);
            }

            const titles = participant.getActiveTaskTitles();

            expect(titles).toEqual(['Active Task']);
        });

        it('should return empty array when no active tasks', () => {
            expect(participant.getActiveTaskTitles()).toEqual([]);
        });
    });

    describe('ensureInstructionFile', () => {
        it('should create INSTRUCTION.md when it does not exist', async () => {
            vi.spyOn(workspace.fs, 'stat').mockRejectedValueOnce(new Error('not found'));
            const readSpy = vi.spyOn(workspace.fs, 'readFile').mockResolvedValueOnce(
                new TextEncoder().encode('# Template content'),
            );
            const writeSpy = vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);

            const uri = await participant.ensureInstructionFile();

            expect(uri).toBeDefined();
            expect(readSpy).toHaveBeenCalled();
            expect(writeSpy).toHaveBeenCalled();
        });

        it('should skip creation when INSTRUCTION.md already exists', async () => {
            vi.spyOn(workspace.fs, 'stat').mockResolvedValueOnce({ type: 1, ctime: 0, mtime: 0, size: 0 } as any);
            const writeSpy = vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);

            const uri = await participant.ensureInstructionFile();

            expect(uri).toBeDefined();
            expect(writeSpy).not.toHaveBeenCalled();
        });
    });

    describe('getFollowups', () => {
        it('should return /task followup for most recent active task when no task selected', () => {
            const tasks: Task[] = [
                { id: 'task_1', title: 'Old Task', lane: 'doing', created: '2026-03-01T00:00:00.000Z', updated: '2026-03-01T00:00:00.000Z', description: '' },
                { id: 'task_2', title: 'New Task', lane: 'todo', created: '2026-03-08T00:00:00.000Z', updated: '2026-03-08T00:00:00.000Z', description: '' },
                { id: 'task_3', title: 'Done Task', lane: 'done', created: '2026-03-09T00:00:00.000Z', updated: '2026-03-09T00:00:00.000Z', description: '' },
            ];
            for (const t of tasks) {
                (taskStore as any).tasks.set(t.id, t);
            }

            const followups = participant.getFollowups();

            expect(followups).toHaveLength(1);
            expect(followups[0]).toEqual({ prompt: 'New Task', command: 'task', label: 'Task: New Task' });
        });

        it('should return empty array when no active tasks', () => {
            expect(participant.getFollowups()).toEqual([]);
        });

        it('should exclude done lane tasks', () => {
            const tasks: Task[] = [
                { id: 'task_1', title: 'Done Task', lane: 'done', created: '2026-03-09T00:00:00.000Z', updated: '2026-03-09T00:00:00.000Z', description: '' },
            ];
            for (const t of tasks) {
                (taskStore as any).tasks.set(t.id, t);
            }

            expect(participant.getFollowups()).toEqual([]);
        });

    });
});
