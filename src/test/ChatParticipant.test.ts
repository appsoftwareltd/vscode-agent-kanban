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
    const references: any[] = [];
    return {
        markdown: (text: string) => { messages.push(text); },
        reference: (uri: any) => { references.push(uri); },
        messages,
        references,
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
            expect(response.messages[0]).toContain('/refresh');
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

            vi.spyOn(workspace.fs, 'readFile').mockResolvedValue(new TextEncoder().encode('# Template'));
            vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);
            vi.spyOn(workspace, 'openTextDocument').mockResolvedValue({} as any);
            vi.spyOn(window, 'showTextDocument').mockResolvedValue(undefined as any);

            const response = mockResponse();
            await participant.handleRequest(mockRequest('task', 'My Task'), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('My Task'))).toBe(true);
        });

        it('should route /refresh command to verb handler', async () => {
            const task: Task = {
                id: 'task_refresh_1', title: 'Refresh Task', lane: 'doing',
                created: '2026-03-08T10:00:00.000Z', updated: '2026-03-08T10:00:00.000Z', description: '',
            };
            (taskStore as any).tasks.set(task.id, task);
            participant.lastSelectedTaskId = task.id;

            vi.spyOn(workspace.fs, 'readFile').mockResolvedValue(new TextEncoder().encode('# Template'));
            vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);
            vi.spyOn(workspace, 'openTextDocument').mockResolvedValue({} as any);
            vi.spyOn(window, 'showTextDocument').mockResolvedValue(undefined as any);

            const response = mockResponse();
            await participant.handleRequest(mockRequest('refresh', ''), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('REFRESH'))).toBe(true);
            expect(response.messages.some((m: string) => m.includes('Refresh Task'))).toBe(true);
        });

        it('should include /refresh in help text', async () => {
            const response = mockResponse();
            await participant.handleRequest(mockRequest(undefined, ''), {} as any, response, mockToken);
            expect(response.messages.some((m: string) => m.includes('/refresh'))).toBe(true);
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

        it('should guide user to use /refresh or /worktree', async () => {
            const response = mockResponse();
            await participant.handleRequest(mockRequest('task', 'Auth Feature'), {} as any, response, mockToken);

            expect(response.messages.some((m: string) =>
                m.includes('/refresh') || m.includes('/worktree'),
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

        it('should include custom instruction file reference when setting is configured', async () => {
            vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
                get: (key: string, defaultValue?: any) => {
                    if (key === 'customInstructionFile') { return 'my-instructions.md'; }
                    return defaultValue;
                },
                update: async () => { },
            } as any);
            vi.spyOn(workspace.fs, 'stat').mockResolvedValue({ type: 1, ctime: 0, mtime: 0, size: 100 } as any);

            const response = mockResponse();
            await participant.handleRequest(mockRequest('task', 'Auth Feature'), {} as any, response, mockToken);

            expect(response.messages.some((m: string) =>
                m.includes('my-instructions.md') && m.includes('additional instructions'),
            )).toBe(true);
        });

        it('should not include custom instruction reference when setting is empty', async () => {
            vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
                get: (key: string, defaultValue?: any) => {
                    if (key === 'customInstructionFile') { return ''; }
                    return defaultValue;
                },
                update: async () => { },
            } as any);

            const response = mockResponse();
            await participant.handleRequest(mockRequest('task', 'Auth Feature'), {} as any, response, mockToken);

            expect(response.messages.every((m: string) => !m.includes('additional instructions'))).toBe(true);
        });

        it('should skip custom instruction reference when file does not exist', async () => {
            vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
                get: (key: string, defaultValue?: any) => {
                    if (key === 'customInstructionFile') { return 'nonexistent.md'; }
                    return defaultValue;
                },
                update: async () => { },
            } as any);
            vi.spyOn(workspace.fs, 'stat').mockRejectedValue(new Error('File not found'));

            const response = mockResponse();
            await participant.handleRequest(mockRequest('task', 'Auth Feature'), {} as any, response, mockToken);

            expect(response.messages.every((m: string) => !m.includes('additional instructions'))).toBe(true);
        });

        it('should place custom instruction reference after INSTRUCTION.md and before task context', async () => {
            vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
                get: (key: string, defaultValue?: any) => {
                    if (key === 'customInstructionFile') { return 'custom.md'; }
                    return defaultValue;
                },
                update: async () => { },
            } as any);
            vi.spyOn(workspace.fs, 'stat').mockResolvedValue({ type: 1, ctime: 0, mtime: 0, size: 100 } as any);

            const response = mockResponse();
            await participant.handleRequest(mockRequest('task', 'Auth Feature'), {} as any, response, mockToken);

            const instrIdx = response.messages.findIndex((m: string) => m.includes('INSTRUCTION.md'));
            const customIdx = response.messages.findIndex((m: string) => m.includes('custom.md'));
            const taskIdx = response.messages.findIndex((m: string) => m.includes('Working on task'));

            expect(instrIdx).toBeGreaterThanOrEqual(0);
            expect(customIdx).toBeGreaterThan(instrIdx);
            expect(taskIdx).toBeGreaterThan(customIdx);
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

    describe('syncInstructionFile', () => {
        it('should create INSTRUCTION.md when it does not exist', async () => {
            const readSpy = vi.spyOn(workspace.fs, 'readFile').mockResolvedValueOnce(
                new TextEncoder().encode('# Template content'),
            );
            const writeSpy = vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);

            const uri = await participant.syncInstructionFile();

            expect(uri).toBeDefined();
            expect(readSpy).toHaveBeenCalled();
            expect(writeSpy).toHaveBeenCalled();
        });

        it('should overwrite INSTRUCTION.md when it already exists', async () => {
            const templateContent = new TextEncoder().encode('# Updated template');
            const readSpy = vi.spyOn(workspace.fs, 'readFile').mockResolvedValueOnce(templateContent);
            const writeSpy = vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);

            const uri = await participant.syncInstructionFile();

            expect(uri).toBeDefined();
            expect(readSpy).toHaveBeenCalled();
            expect(writeSpy).toHaveBeenCalled();
        });

        it('should write the exact template content to the workspace', async () => {
            const templateContent = new TextEncoder().encode('# Exact template bytes');
            vi.spyOn(workspace.fs, 'readFile').mockResolvedValueOnce(templateContent);
            const writeSpy = vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);

            await participant.syncInstructionFile();

            expect(writeSpy).toHaveBeenCalledWith(expect.anything(), templateContent);
        });
    });

    describe('syncAgentsMdSection', () => {
        it('should create AGENTS.md with sentinel section when file does not exist', async () => {
            // readFile throws → file doesn't exist
            vi.spyOn(workspace.fs, 'readFile').mockRejectedValueOnce(new Error('File not found'));
            const writeSpy = vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);

            await participant.syncAgentsMdSection();

            expect(writeSpy).toHaveBeenCalled();
            const written = new TextDecoder().decode(writeSpy.mock.calls[0][1] as Uint8Array);
            expect(written).toContain('<!-- BEGIN AGENT KANBAN');
            expect(written).toContain('<!-- END AGENT KANBAN -->');
            expect(written).toContain('INSTRUCTION.md');
            expect(written).toContain('memory.md');
            expect(written).toContain('re-read it before responding');
        });

        it('should append sentinel section to existing AGENTS.md preserving user content', async () => {
            const existingContent = '# My AGENTS\n\nSome user instructions.\n';
            vi.spyOn(workspace.fs, 'readFile').mockResolvedValueOnce(
                new TextEncoder().encode(existingContent),
            );
            const writeSpy = vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);

            await participant.syncAgentsMdSection();

            expect(writeSpy).toHaveBeenCalled();
            const written = new TextDecoder().decode(writeSpy.mock.calls[0][1] as Uint8Array);
            expect(written).toContain('# My AGENTS');
            expect(written).toContain('Some user instructions.');
            expect(written).toContain('<!-- BEGIN AGENT KANBAN');
            expect(written).toContain('<!-- END AGENT KANBAN -->');
        });

        it('should replace existing sentinel section with updated content', async () => {
            const existingContent = [
                '# My AGENTS',
                '',
                '<!-- BEGIN AGENT KANBAN — DO NOT EDIT THIS SECTION -->',
                '## Old Content',
                '<!-- END AGENT KANBAN -->',
                '',
                'User content below.',
            ].join('\n');
            vi.spyOn(workspace.fs, 'readFile').mockResolvedValueOnce(
                new TextEncoder().encode(existingContent),
            );
            const writeSpy = vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);

            await participant.syncAgentsMdSection();

            const written = new TextDecoder().decode(writeSpy.mock.calls[0][1] as Uint8Array);
            expect(written).toContain('# My AGENTS');
            expect(written).toContain('User content below.');
            expect(written).toContain('INSTRUCTION.md');
            expect(written).not.toContain('## Old Content');
        });

        it('should return undefined when no workspace folder', async () => {
            const orig = workspace.workspaceFolders;
            (workspace as any).workspaceFolders = undefined;

            const result = await participant.syncAgentsMdSection();

            expect(result).toBeUndefined();
            (workspace as any).workspaceFolders = orig;
        });

        it('should return undefined on write failure', async () => {
            vi.spyOn(workspace.fs, 'readFile').mockRejectedValueOnce(new Error('not found'));
            vi.spyOn(workspace.fs, 'writeFile').mockRejectedValueOnce(new Error('write failed'));

            const result = await participant.syncAgentsMdSection();

            expect(result).toBeUndefined();
        });

        it('should preserve worktree-enhanced sentinel when called without worktreeTask', async () => {
            // Simulate an AGENTS.md that already has a worktree-enhanced sentinel
            const enhanced = [
                '# My AGENTS',
                '',
                '<!-- BEGIN AGENT KANBAN — DO NOT EDIT THIS SECTION -->',
                '## Agent Kanban',
                '',
                '**Active Task:** My Task',
                '**Task File:** `.agentkanban/tasks/todo/task_123.md`',
                '',
                'Read the task file above before responding.',
                '<!-- END AGENT KANBAN -->',
            ].join('\n');
            vi.spyOn(workspace.fs, 'readFile').mockResolvedValueOnce(
                new TextEncoder().encode(enhanced),
            );
            const writeSpy = vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);

            // Call WITHOUT worktreeTask — should NOT overwrite the enhanced sentinel
            const result = await participant.syncAgentsMdSection();

            expect(result).toBeDefined();
            expect(writeSpy).not.toHaveBeenCalled();
        });

        it('should overwrite standard sentinel normally when no enhanced sentinel exists', async () => {
            const standard = [
                '<!-- BEGIN AGENT KANBAN — DO NOT EDIT THIS SECTION -->',
                '## Agent Kanban',
                '<!-- END AGENT KANBAN -->',
            ].join('\n');
            vi.spyOn(workspace.fs, 'readFile').mockResolvedValueOnce(
                new TextEncoder().encode(standard),
            );
            const writeSpy = vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);

            await participant.syncAgentsMdSection();

            expect(writeSpy).toHaveBeenCalled();
        });

        it('should overwrite enhanced sentinel when called WITH worktreeTask', async () => {
            const enhanced = [
                '<!-- BEGIN AGENT KANBAN — DO NOT EDIT THIS SECTION -->',
                '## Agent Kanban',
                '',
                '**Active Task:** Old Task',
                '**Task File:** `.agentkanban/tasks/todo/task_old.md`',
                '<!-- END AGENT KANBAN -->',
            ].join('\n');
            vi.spyOn(workspace.fs, 'readFile').mockResolvedValueOnce(
                new TextEncoder().encode(enhanced),
            );
            const writeSpy = vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);

            await participant.syncAgentsMdSection({ title: 'New Task', taskRelPath: '.agentkanban/tasks/todo/task_new.md' });

            expect(writeSpy).toHaveBeenCalled();
            const written = new TextDecoder().decode(writeSpy.mock.calls[0][1] as Uint8Array);
            expect(written).toContain('**Active Task:** New Task');
            expect(written).toContain('task_new.md');
        });
    });

    describe('response.reference() calls', () => {
        let task: Task;

        beforeEach(() => {
            task = {
                id: 'task_ref_1',
                title: 'Ref Task',
                lane: 'doing',
                created: '2026-03-08T10:00:00.000Z',
                updated: '2026-03-08T10:00:00.000Z',
                description: '',
            };
            (taskStore as any).tasks.set(task.id, task);

            vi.spyOn(workspace.fs, 'readFile').mockResolvedValue(
                new TextEncoder().encode('# Template'),
            );
            vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);
            vi.spyOn(workspace, 'openTextDocument').mockResolvedValue({} as any);
            vi.spyOn(window, 'showTextDocument').mockResolvedValue(undefined as any);
        });

        it('should attach INSTRUCTION.md and task file references on /task', async () => {
            const response = mockResponse();
            await participant.handleRequest(mockRequest('task', 'Ref Task'), {} as any, response, mockToken);

            expect(response.references.length).toBe(2);
            // First reference is INSTRUCTION.md
            const instrRef = response.references[0];
            expect(instrRef.fsPath || instrRef.path).toContain('INSTRUCTION.md');
            // Second reference is the task file
            const taskRef = response.references[1];
            expect(taskRef.fsPath || taskRef.path).toContain('task_ref_1');
        });

        it('should attach INSTRUCTION.md and task file references on /refresh', async () => {
            participant.lastSelectedTaskId = task.id;
            const response = mockResponse();
            await participant.handleRequest(mockRequest('refresh', ''), {} as any, response, mockToken);

            expect(response.references.length).toBe(2);
            const instrRef = response.references[0];
            expect(instrRef.fsPath || instrRef.path).toContain('INSTRUCTION.md');
            const taskRef = response.references[1];
            expect(taskRef.fsPath || taskRef.path).toContain('task_ref_1');
        });

        it('should still attach task reference even if syncInstructionFile fails', async () => {
            vi.spyOn(workspace.fs, 'readFile').mockRejectedValue(new Error('sync failed'));

            const response = mockResponse();
            await participant.handleRequest(mockRequest('task', 'Ref Task'), {} as any, response, mockToken);

            // Only the task file reference (INSTRUCTION.md sync failed)
            expect(response.references.length).toBe(1);
            const taskRef = response.references[0];
            expect(taskRef.fsPath || taskRef.path).toContain('task_ref_1');
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

        it('should return refresh followup when a task is selected', () => {
            const task: Task = {
                id: 'task_sel', title: 'Selected Task', lane: 'doing',
                created: '2026-03-08T10:00:00.000Z', updated: '2026-03-08T10:00:00.000Z', description: '',
            };
            (taskStore as any).tasks.set(task.id, task);
            participant.lastSelectedTaskId = 'task_sel';

            const followups = participant.getFollowups();

            expect(followups).toHaveLength(1);
            expect(followups[0]).toEqual({ prompt: '', command: 'refresh', label: 'Refresh: Selected Task' });
        });

        it('should fall back to /task followup when selected task is done', () => {
            const tasks: Task[] = [
                { id: 'task_done', title: 'Done Task', lane: 'done', created: '2026-03-08T10:00:00.000Z', updated: '2026-03-08T10:00:00.000Z', description: '' },
                { id: 'task_active', title: 'Active Task', lane: 'doing', created: '2026-03-07T10:00:00.000Z', updated: '2026-03-07T10:00:00.000Z', description: '' },
            ];
            for (const t of tasks) {
                (taskStore as any).tasks.set(t.id, t);
            }
            participant.lastSelectedTaskId = 'task_done';

            const followups = participant.getFollowups();

            expect(followups).toHaveLength(1);
            expect(followups[0].command).toBe('task');
            expect(participant.lastSelectedTaskId).toBeUndefined();
        });

    });

    describe('handleRefresh', () => {
        let task: Task;

        beforeEach(() => {
            task = {
                id: 'task_verb_1',
                title: 'Verb Task',
                lane: 'doing',
                created: '2026-03-08T10:00:00.000Z',
                updated: '2026-03-08T10:00:00.000Z',
                description: '',
            };
            (taskStore as any).tasks.set(task.id, task);

            vi.spyOn(workspace.fs, 'readFile').mockResolvedValue(
                new TextEncoder().encode('# Agent Kanban — Instruction'),
            );
            vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);
            vi.spyOn(workspace, 'openTextDocument').mockResolvedValue({} as any);
            vi.spyOn(window, 'showTextDocument').mockResolvedValue(undefined as any);
        });

        it('should prompt to select a task when no task is selected', async () => {
            const response = mockResponse();
            await participant.handleRequest(mockRequest('refresh', ''), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('No task selected'))).toBe(true);
        });

        it('should show no-tasks message when board is empty and no task selected', async () => {
            (taskStore as any).tasks.clear();
            const response = mockResponse();
            await participant.handleRequest(mockRequest('refresh', ''), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('No active tasks'))).toBe(true);
        });

        it('should re-inject context for the selected task', async () => {
            participant.lastSelectedTaskId = task.id;
            const response = mockResponse();
            await participant.handleRequest(mockRequest('refresh', ''), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('INSTRUCTION.md'))).toBe(true);
            expect(response.messages.some((m: string) => m.includes('REFRESH'))).toBe(true);
            expect(response.messages.some((m: string) => m.includes('Verb Task'))).toBe(true);
            expect(response.messages.some((m: string) => m.includes('Task file:'))).toBe(true);
        });

        it('should include additional context from prompt', async () => {
            participant.lastSelectedTaskId = task.id;
            const response = mockResponse();
            await participant.handleRequest(mockRequest('refresh', 'focus on error handling'), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('Additional context: focus on error handling'))).toBe(true);
        });

        it('should handle done task by clearing selection', async () => {
            task.lane = 'done';
            participant.lastSelectedTaskId = task.id;
            const response = mockResponse();
            await participant.handleRequest(mockRequest('refresh', ''), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('no longer active'))).toBe(true);
            expect(participant.lastSelectedTaskId).toBeUndefined();
        });

        it('should open task file in editor with preserveFocus', async () => {
            participant.lastSelectedTaskId = task.id;
            const openSpy = vi.spyOn(workspace, 'openTextDocument');
            const showSpy = vi.spyOn(window, 'showTextDocument');

            const response = mockResponse();
            await participant.handleRequest(mockRequest('refresh', ''), {} as any, response, mockToken);

            expect(openSpy).toHaveBeenCalled();
            expect(showSpy).toHaveBeenCalledWith(expect.anything(), { preview: false, preserveFocus: true });
        });

        it('should end with workflow phase prompt', async () => {
            participant.lastSelectedTaskId = task.id;
            const response = mockResponse();
            await participant.handleRequest(mockRequest('refresh', ''), {} as any, response, mockToken);

            const last = response.messages[response.messages.length - 1];
            expect(last).toContain('plan');
            expect(last).toContain('implement');
        });

        it('should show in-worktree hint on /refresh when in task worktree', async () => {
            const wtTask: Task = {
                id: 'task_refwt', title: 'Refresh WT Task', lane: 'doing',
                created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z',
                description: '',
                worktree: { branch: 'agentkanban/refwt', path: '/test-workspace', created: '' },
            };
            (taskStore as any).tasks.set(wtTask.id, wtTask);
            participant.lastSelectedTaskId = wtTask.id;

            const response = mockResponse();
            await participant.handleRequest(mockRequest('refresh', ''), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('Worktree workspace'))).toBe(true);
        });

        it('should NOT show in-worktree hint on /refresh when not in worktree', async () => {
            participant.lastSelectedTaskId = task.id;

            const response = mockResponse();
            await participant.handleRequest(mockRequest('refresh', ''), {} as any, response, mockToken);

            expect(response.messages.every((m: string) => !m.includes('Worktree workspace'))).toBe(true);
        });

        it('should auto-detect worktree task on /refresh when no task selected', async () => {
            // Task with worktree matching the mock workspace path
            const wtTask: Task = {
                id: 'task_autowt', title: 'Auto WT Refresh', lane: 'doing',
                created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z',
                description: '',
                worktree: { branch: 'agentkanban/auto', path: '/test-workspace', created: '' },
            };
            (taskStore as any).tasks.set(wtTask.id, wtTask);
            // lastSelectedTaskId is NOT set

            const response = mockResponse();
            await participant.handleRequest(mockRequest('refresh', ''), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('REFRESH'))).toBe(true);
            expect(response.messages.some((m: string) => m.includes('Auto WT Refresh'))).toBe(true);
            expect(response.messages.some((m: string) => m.includes('Worktree workspace'))).toBe(true);
            expect(participant.lastSelectedTaskId).toBe('task_autowt');
        });
    });

    describe('lastSelectedTaskId tracking', () => {
        it('should set lastSelectedTaskId on /task', async () => {
            const task: Task = {
                id: 'task_track_1', title: 'Track Task', lane: 'doing',
                created: '2026-03-08T10:00:00.000Z', updated: '2026-03-08T10:00:00.000Z', description: '',
            };
            (taskStore as any).tasks.set(task.id, task);

            vi.spyOn(workspace.fs, 'readFile').mockResolvedValue(new TextEncoder().encode('# Template'));
            vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);
            vi.spyOn(workspace, 'openTextDocument').mockResolvedValue({} as any);
            vi.spyOn(window, 'showTextDocument').mockResolvedValue(undefined as any);

            const response = mockResponse();
            await participant.handleRequest(mockRequest('task', 'Track Task'), {} as any, response, mockToken);

            expect(participant.lastSelectedTaskId).toBe('task_track_1');
        });

        it('should clear lastSelectedTaskId on /new', async () => {
            participant.lastSelectedTaskId = 'task_old';

            vi.spyOn(taskStore, 'createTask').mockReturnValue({
                id: 'task_new', title: 'New', lane: 'todo',
                created: '', updated: '', description: '',
            });
            vi.spyOn(taskStore, 'save').mockResolvedValue(undefined);

            const response = mockResponse();
            await participant.handleRequest(mockRequest('new', 'New Task'), {} as any, response, mockToken);

            expect(participant.lastSelectedTaskId).toBeUndefined();
        });
    });

    describe('syncAgentsMdSection with worktree task', () => {
        it('should write enhanced sentinel when worktreeTask is provided', async () => {
            vi.spyOn(workspace.fs, 'readFile').mockRejectedValueOnce(new Error('not found'));
            const writeSpy = vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);

            await participant.syncAgentsMdSection({
                title: 'My Feature',
                taskRelPath: '.agentkanban/tasks/doing/task_001.md',
            });

            expect(writeSpy).toHaveBeenCalled();
            const written = new TextDecoder().decode(writeSpy.mock.calls[0][1] as Uint8Array);
            expect(written).toContain('**Active Task:** My Feature');
            expect(written).toContain('**Task File:** `.agentkanban/tasks/doing/task_001.md`');
            expect(written).toContain('Read the task file above before responding');
            expect(written).toContain('<!-- BEGIN AGENT KANBAN');
            expect(written).toContain('<!-- END AGENT KANBAN -->');
        });

        it('should write default sentinel when no worktreeTask is provided', async () => {
            vi.spyOn(workspace.fs, 'readFile').mockRejectedValueOnce(new Error('not found'));
            const writeSpy = vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);

            await participant.syncAgentsMdSection();

            const written = new TextDecoder().decode(writeSpy.mock.calls[0][1] as Uint8Array);
            expect(written).not.toContain('**Active Task:**');
            expect(written).toContain('INSTRUCTION.md');
            expect(written).toContain('memory.md');
        });
    });

    describe('/worktree command', () => {
        it('should show help listing /worktree for unknown command', async () => {
            const response = mockResponse();
            await participant.handleRequest(mockRequest(undefined, ''), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('/worktree'))).toBe(true);
        });

        it('should report no worktree service when not provided', async () => {
            // participant has no worktreeService by default
            participant.lastSelectedTaskId = 'task_1';
            const task: Task = {
                id: 'task_1', title: 'Test', lane: 'doing',
                created: '', updated: '', description: '',
            };
            (taskStore as any).tasks.set(task.id, task);

            const response = mockResponse();
            await participant.handleRequest(mockRequest('worktree', ''), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('not available'))).toBe(true);
        });

        it('should require task selection before /worktree', async () => {
            const mockWs = {
                isGitRepo: vi.fn().mockResolvedValue(true),
            } as any;
            const wsParticipant = new ChatParticipant(taskStore, boardConfigStore, extensionUri, undefined, undefined, mockWs);

            const response = mockResponse();
            await wsParticipant.handleRequest(mockRequest('worktree', ''), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('No task selected'))).toBe(true);
        });

        it('should auto-detect worktree task on /worktree when no task selected', async () => {
            const mockWs = {
                isGitRepo: vi.fn().mockResolvedValue(true),
                exists: vi.fn().mockResolvedValue(true),
            } as any;
            const wsParticipant = new ChatParticipant(taskStore, boardConfigStore, extensionUri, undefined, undefined, mockWs);

            const wtTask: Task = {
                id: 'task_wt_auto', title: 'WT Auto Task', lane: 'doing',
                created: '', updated: '', description: '',
                worktree: { branch: 'agentkanban/auto', path: '/test-workspace', created: '' },
            };
            (taskStore as any).tasks.set(wtTask.id, wtTask);
            // NO lastSelectedTaskId set

            const response = mockResponse();
            await wsParticipant.handleRequest(mockRequest('worktree', ''), {} as any, response, mockToken);

            // Should auto-detect and handle the existing worktree
            expect(response.messages.some((m: string) => m.includes('already has a worktree'))).toBe(true);
            expect(response.messages.some((m: string) => m.includes('Worktree workspace'))).toBe(true);
        });

        it('should require git repo for /worktree', async () => {
            const mockWs = {
                isGitRepo: vi.fn().mockResolvedValue(false),
            } as any;
            const wsParticipant = new ChatParticipant(taskStore, boardConfigStore, extensionUri, undefined, undefined, mockWs);

            wsParticipant.lastSelectedTaskId = 'task_1';
            const task: Task = {
                id: 'task_1', title: 'Test', lane: 'doing',
                created: '', updated: '', description: '',
            };
            (taskStore as any).tasks.set(task.id, task);

            const response = mockResponse();
            await wsParticipant.handleRequest(mockRequest('worktree', ''), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('not a git repository'))).toBe(true);
        });

        it('should report existing worktree when task already has one', async () => {
            const mockWs = {
                isGitRepo: vi.fn().mockResolvedValue(true),
                exists: vi.fn().mockResolvedValue(true),
            } as any;
            const wsParticipant = new ChatParticipant(taskStore, boardConfigStore, extensionUri, undefined, undefined, mockWs);

            const task: Task = {
                id: 'task_wt', title: 'WT Task', lane: 'doing',
                created: '', updated: '', description: '',
                worktree: { branch: 'agentkanban/test', path: '/wt/test', created: '' },
            };
            (taskStore as any).tasks.set(task.id, task);
            wsParticipant.lastSelectedTaskId = task.id;

            const response = mockResponse();
            await wsParticipant.handleRequest(mockRequest('worktree', ''), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('already has a worktree'))).toBe(true);
        });

        it('should open worktree on "open" subcommand', async () => {
            const openSpy = vi.fn().mockResolvedValue(undefined);
            const existsSpy = vi.fn().mockResolvedValue(true);
            const mockWs = {
                isGitRepo: vi.fn().mockResolvedValue(true),
                exists: existsSpy,
                openInVSCode: openSpy,
            } as any;
            const wsParticipant = new ChatParticipant(taskStore, boardConfigStore, extensionUri, undefined, undefined, mockWs);

            const task: Task = {
                id: 'task_open', title: 'Open Task', lane: 'doing',
                created: '', updated: '', description: '',
                worktree: { branch: 'agentkanban/test', path: '/wt/test', created: '' },
            };
            (taskStore as any).tasks.set(task.id, task);
            wsParticipant.lastSelectedTaskId = task.id;

            const response = mockResponse();
            await wsParticipant.handleRequest(mockRequest('worktree', 'open'), {} as any, response, mockToken);

            expect(openSpy).toHaveBeenCalledWith('/wt/test');
            expect(response.messages.some((m: string) => m.includes('Opening worktree'))).toBe(true);
        });

        it('should show worktree reminder on "open" when already in worktree', async () => {
            const openSpy = vi.fn().mockResolvedValue(undefined);
            const existsSpy = vi.fn().mockResolvedValue(true);
            const mockWs = {
                isGitRepo: vi.fn().mockResolvedValue(true),
                exists: existsSpy,
                openInVSCode: openSpy,
            } as any;
            const wsParticipant = new ChatParticipant(taskStore, boardConfigStore, extensionUri, undefined, undefined, mockWs);

            const task: Task = {
                id: 'task_openwt', title: 'Open WT Here', lane: 'doing',
                created: '', updated: '', description: '',
                worktree: { branch: 'agentkanban/here', path: '/test-workspace', created: '' },
            };
            (taskStore as any).tasks.set(task.id, task);
            wsParticipant.lastSelectedTaskId = task.id;

            const response = mockResponse();
            await wsParticipant.handleRequest(mockRequest('worktree', 'open'), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('Worktree workspace'))).toBe(true);
        });

        it('should clean up stale worktree metadata on "open" when directory is gone', async () => {
            const existsSpy = vi.fn().mockResolvedValue(false);
            const saveSpy = vi.spyOn(taskStore, 'save').mockResolvedValue(undefined);
            const mockWs = {
                isGitRepo: vi.fn().mockResolvedValue(true),
                exists: existsSpy,
            } as any;
            const wsParticipant = new ChatParticipant(taskStore, boardConfigStore, extensionUri, undefined, undefined, mockWs);

            const task: Task = {
                id: 'task_stale', title: 'Stale Task', lane: 'doing',
                created: '', updated: '', description: '',
                worktree: { branch: 'agentkanban/old', path: '/wt/old', created: '' },
            };
            (taskStore as any).tasks.set(task.id, task);
            wsParticipant.lastSelectedTaskId = task.id;

            const response = mockResponse();
            await wsParticipant.handleRequest(mockRequest('worktree', 'open'), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('no longer exists'))).toBe(true);
            expect(saveSpy).toHaveBeenCalled();
            expect(task.worktree).toBeUndefined();
        });

        it('should report no worktree on "open" when task has none', async () => {
            const mockWs = {
                isGitRepo: vi.fn().mockResolvedValue(true),
            } as any;
            const wsParticipant = new ChatParticipant(taskStore, boardConfigStore, extensionUri, undefined, undefined, mockWs);

            const task: Task = {
                id: 'task_nowt', title: 'No WT', lane: 'doing',
                created: '', updated: '', description: '',
            };
            (taskStore as any).tasks.set(task.id, task);
            wsParticipant.lastSelectedTaskId = task.id;

            const response = mockResponse();
            await wsParticipant.handleRequest(mockRequest('worktree', 'open'), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('has no worktree'))).toBe(true);
        });

        it('should remove worktree on "remove" subcommand', async () => {
            const removeSpy = vi.fn().mockResolvedValue(undefined);
            const saveSpy = vi.spyOn(taskStore, 'save').mockResolvedValue(undefined);
            const mockWs = {
                isGitRepo: vi.fn().mockResolvedValue(true),
                remove: removeSpy,
            } as any;
            const wsParticipant = new ChatParticipant(taskStore, boardConfigStore, extensionUri, undefined, undefined, mockWs);

            const worktreeInfo = { branch: 'agentkanban/rm', path: '/wt/rm', created: '' };
            const task: Task = {
                id: 'task_rm', title: 'Remove Task', lane: 'doing',
                created: '', updated: '', description: '',
                worktree: { ...worktreeInfo },
            };
            (taskStore as any).tasks.set(task.id, task);
            wsParticipant.lastSelectedTaskId = task.id;

            const response = mockResponse();
            await wsParticipant.handleRequest(mockRequest('worktree', 'remove'), {} as any, response, mockToken);

            expect(removeSpy).toHaveBeenCalled();
            expect(saveSpy).toHaveBeenCalled();
            expect(task.worktree).toBeUndefined();
            expect(response.messages.some((m: string) => m.includes('Worktree removed'))).toBe(true);
        });

        it('should report no worktree on "remove" when task has none', async () => {
            const mockWs = {
                isGitRepo: vi.fn().mockResolvedValue(true),
            } as any;
            const wsParticipant = new ChatParticipant(taskStore, boardConfigStore, extensionUri, undefined, undefined, mockWs);

            const task: Task = {
                id: 'task_nrm', title: 'No WT Remove', lane: 'doing',
                created: '', updated: '', description: '',
            };
            (taskStore as any).tasks.set(task.id, task);
            wsParticipant.lastSelectedTaskId = task.id;

            const response = mockResponse();
            await wsParticipant.handleRequest(mockRequest('worktree', 'remove'), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('has no worktree to remove'))).toBe(true);
        });
    });

    describe('getFollowups with worktree', () => {
        it('should include "Create Worktree" followup when task has no worktree and service exists', () => {
            const mockWs = {} as any;
            const wsParticipant = new ChatParticipant(taskStore, boardConfigStore, extensionUri, undefined, undefined, mockWs);

            const task: Task = {
                id: 'task_fu', title: 'Followup Task', lane: 'doing',
                created: '2026-03-08T10:00:00.000Z', updated: '2026-03-08T10:00:00.000Z', description: '',
            };
            (taskStore as any).tasks.set(task.id, task);
            wsParticipant.lastSelectedTaskId = task.id;

            const followups = wsParticipant.getFollowups();

            expect(followups.some(f => f.command === 'worktree' && f.label?.includes('Create Worktree'))).toBe(true);
        });

        it('should include "Open Worktree" followup when task has a worktree', () => {
            const mockWs = {} as any;
            const wsParticipant = new ChatParticipant(taskStore, boardConfigStore, extensionUri, undefined, undefined, mockWs);

            const task: Task = {
                id: 'task_owt', title: 'Open WT Task', lane: 'doing',
                created: '2026-03-08T10:00:00.000Z', updated: '2026-03-08T10:00:00.000Z', description: '',
                worktree: { branch: 'agentkanban/test', path: '/wt/test', created: '' },
            };
            (taskStore as any).tasks.set(task.id, task);
            wsParticipant.lastSelectedTaskId = task.id;

            const followups = wsParticipant.getFollowups();

            expect(followups.some(f => f.command === 'worktree' && f.prompt === 'open' && f.label?.includes('Open Worktree'))).toBe(true);
        });

        it('should not include worktree followups when no worktreeService', () => {
            const task: Task = {
                id: 'task_nows', title: 'No WS', lane: 'doing',
                created: '2026-03-08T10:00:00.000Z', updated: '2026-03-08T10:00:00.000Z', description: '',
            };
            (taskStore as any).tasks.set(task.id, task);
            participant.lastSelectedTaskId = task.id;

            const followups = participant.getFollowups();

            // Standard participant has no worktreeService, so only verb followups
            expect(followups.every(f => f.command !== 'worktree')).toBe(true);
        });
    });

    describe('resolveTaskFromPrompt — slug matching', () => {
        beforeEach(() => {
            const tasks: Task[] = [
                { id: 'task_1', title: 'Auth Feature', lane: 'doing', created: '', updated: '', description: '', slug: 'auth_feature' },
                { id: 'task_2', title: 'Login Bug', lane: 'todo', created: '', updated: '', description: '', slug: 'login_bug' },
                { id: 'task_3', title: 'Consider Git Worktree Based Flows', lane: 'doing', created: '', updated: '', description: '', slug: 'consider_git_worktree_based_flows' },
            ];
            for (const t of tasks) {
                (taskStore as any).tasks.set(t.id, t);
            }
        });

        it('should match exact slug (case-insensitive)', () => {
            const result = participant.resolveTaskFromPrompt('auth_feature');
            expect(result.task).toBeDefined();
            expect(result.task!.title).toBe('Auth Feature');
            expect(result.freeText).toBe('');
        });

        it('should match slug case-insensitively', () => {
            const result = participant.resolveTaskFromPrompt('AUTH_FEATURE');
            expect(result.task).toBeDefined();
            expect(result.task!.title).toBe('Auth Feature');
        });

        it('should prefer slug match over other methods', () => {
            const result = participant.resolveTaskFromPrompt('login_bug');
            expect(result.task).toBeDefined();
            expect(result.task!.title).toBe('Login Bug');
        });

        it('should match long slug', () => {
            const result = participant.resolveTaskFromPrompt('consider_git_worktree_based_flows');
            expect(result.task).toBeDefined();
            expect(result.task!.title).toBe('Consider Git Worktree Based Flows');
        });
    });

    describe('resolveTaskFromPrompt — alphanumeric fuzzy', () => {
        beforeEach(() => {
            const tasks: Task[] = [
                { id: 'task_1', title: 'Auth Feature', lane: 'doing', created: '', updated: '', description: '' },
                { id: 'task_2', title: 'Consider Git Worktree Based Flows', lane: 'doing', created: '', updated: '', description: '' },
                { id: 'task_3', title: 'Login Bug Fix', lane: 'todo', created: '', updated: '', description: '' },
            ];
            for (const t of tasks) {
                (taskStore as any).tasks.set(t.id, t);
            }
        });

        it('should match when stripped query is substring of stripped title', () => {
            const result = participant.resolveTaskFromPrompt('worktree');
            expect(result.task).toBeDefined();
            expect(result.task!.title).toBe('Consider Git Worktree Based Flows');
        });

        it('should match ignoring spaces and punctuation', () => {
            const result = participant.resolveTaskFromPrompt('gitworktree');
            expect(result.task).toBeDefined();
            expect(result.task!.title).toBe('Consider Git Worktree Based Flows');
        });

        it('should match partial alphanumeric query', () => {
            const result = participant.resolveTaskFromPrompt('bugfix');
            expect(result.task).toBeDefined();
            expect(result.task!.title).toBe('Login Bug Fix');
        });

        it('should not match when ambiguous (equal length titles)', () => {
            // Add another task with same alnum length — both contain "feature"
            const t: Task = { id: 'task_4', title: 'Cool Feature', lane: 'todo', created: '', updated: '', description: '' };
            (taskStore as any).tasks.set(t.id, t);

            // "feature" matches both "Auth Feature" and "Cool Feature" — these have same alnum length (11 and 11)
            // The function picks the longer alnum title, but Auth Feature = "authfeature" (11) and "coolfeature" (11)
            // This should be ambiguous and fall through to first-word partial
            const result = participant.resolveTaskFromPrompt('feature');
            // Should still match via first-word partial (step 5) — "feature" found in a title
            expect(result.task).toBeDefined();
        });
    });

    describe('/task worktree awareness', () => {
        it('should show worktree status when task has worktree', async () => {
            const task: Task = {
                id: 'task_wt', title: 'Worktree Task', lane: 'doing',
                created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z',
                description: '',
                worktree: { branch: 'agentkanban/wt', path: '/wt/path', created: '' },
            };
            (taskStore as any).tasks.set(task.id, task);

            vi.spyOn(workspace, 'openTextDocument').mockResolvedValue({} as any);
            vi.spyOn(window, 'showTextDocument').mockResolvedValue(undefined as any);

            const response = mockResponse();
            await participant.handleRequest(mockRequest('task', 'Worktree Task'), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('/wt/path'))).toBe(true);
            expect(response.messages.some((m: string) => m.includes('agentkanban/wt'))).toBe(true);
        });

        it('should not show worktree info when task has no worktree', async () => {
            const task: Task = {
                id: 'task_plain', title: 'Plain Task', lane: 'doing',
                created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z',
                description: '',
            };
            (taskStore as any).tasks.set(task.id, task);

            vi.spyOn(workspace, 'openTextDocument').mockResolvedValue({} as any);
            vi.spyOn(window, 'showTextDocument').mockResolvedValue(undefined as any);

            const response = mockResponse();
            await participant.handleRequest(mockRequest('task', 'Plain Task'), {} as any, response, mockToken);

            expect(response.messages.every((m: string) => !m.includes('Worktree:'))).toBe(true);
        });

        it('should show in-worktree hint when workspace IS the task worktree', async () => {
            const task: Task = {
                id: 'task_inwt', title: 'In WT Task', lane: 'doing',
                created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z',
                description: '',
                worktree: { branch: 'agentkanban/inwt', path: '/test-workspace', created: '' },
            };
            (taskStore as any).tasks.set(task.id, task);

            vi.spyOn(workspace, 'openTextDocument').mockResolvedValue({} as any);
            vi.spyOn(window, 'showTextDocument').mockResolvedValue(undefined as any);

            const response = mockResponse();
            await participant.handleRequest(mockRequest('task', 'In WT Task'), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('Worktree workspace'))).toBe(true);
        });

        it('should NOT show in-worktree hint when workspace differs from worktree path', async () => {
            const task: Task = {
                id: 'task_diffwt', title: 'Diff WT Task', lane: 'doing',
                created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z',
                description: '',
                worktree: { branch: 'agentkanban/diffwt', path: '/other-workspace', created: '' },
            };
            (taskStore as any).tasks.set(task.id, task);

            vi.spyOn(workspace, 'openTextDocument').mockResolvedValue({} as any);
            vi.spyOn(window, 'showTextDocument').mockResolvedValue(undefined as any);

            const response = mockResponse();
            await participant.handleRequest(mockRequest('task', 'Diff WT Task'), {} as any, response, mockToken);

            expect(response.messages.every((m: string) => !m.includes('Worktree workspace'))).toBe(true);
        });

        it('should auto-detect worktree task on /task with no args', async () => {
            const wtTask: Task = {
                id: 'task_taskwt', title: 'WT Task Auto', lane: 'doing',
                created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z',
                description: '',
                worktree: { branch: 'agentkanban/tauto', path: '/test-workspace', created: '' },
            };
            (taskStore as any).tasks.set(wtTask.id, wtTask);

            const response = mockResponse();
            await participant.handleRequest(mockRequest('task', ''), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('WT Task Auto'))).toBe(true);
            expect(response.messages.some((m: string) => m.includes('Worktree workspace'))).toBe(true);
        });
    });
});
