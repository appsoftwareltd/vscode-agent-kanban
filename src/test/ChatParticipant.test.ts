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
            expect(response.messages[0]).toContain('/plan');
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

        it('should attach INSTRUCTION.md and task file references on verb commands', async () => {
            participant.lastSelectedTaskId = task.id;
            const response = mockResponse();
            await participant.handleRequest(mockRequest('plan', ''), {} as any, response, mockToken);

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

        it('should return verb followups when a task is selected', () => {
            const task: Task = {
                id: 'task_sel', title: 'Selected Task', lane: 'doing',
                created: '2026-03-08T10:00:00.000Z', updated: '2026-03-08T10:00:00.000Z', description: '',
            };
            (taskStore as any).tasks.set(task.id, task);
            participant.lastSelectedTaskId = 'task_sel';

            const followups = participant.getFollowups();

            expect(followups).toHaveLength(4);
            expect(followups[0]).toEqual({ prompt: '', command: 'plan', label: 'Plan: Selected Task' });
            expect(followups[1]).toEqual({ prompt: '', command: 'todo', label: 'Todo: Selected Task' });
            expect(followups[2]).toEqual({ prompt: '', command: 'implement', label: 'Implement: Selected Task' });
            expect(followups[3]).toEqual({ prompt: '#todo #implement', command: 'todo', label: 'Todo + Implement: Selected Task' });
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

    describe('parseVerbs', () => {
        it('should return primary verb when no hash tags in prompt', () => {
            expect(participant.parseVerbs('plan', 'some context')).toEqual(['plan']);
        });

        it('should combine primary verb with hash-tagged verbs', () => {
            expect(participant.parseVerbs('plan', '#todo #implement')).toEqual(['plan', 'todo', 'implement']);
        });

        it('should deduplicate when primary verb appears as hash tag too', () => {
            expect(participant.parseVerbs('todo', '#todo #implement')).toEqual(['todo', 'implement']);
        });

        it('should return verbs in canonical order (plan, todo, implement)', () => {
            expect(participant.parseVerbs('implement', '#plan')).toEqual(['plan', 'implement']);
        });

        it('should be case-insensitive for hash tags', () => {
            expect(participant.parseVerbs('plan', '#TODO #Implement')).toEqual(['plan', 'todo', 'implement']);
        });
    });

    describe('handleVerb', () => {
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
            await participant.handleRequest(mockRequest('plan', ''), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('No task selected'))).toBe(true);
        });

        it('should show no-tasks message when board is empty and no task selected', async () => {
            (taskStore as any).tasks.clear();
            const response = mockResponse();
            await participant.handleRequest(mockRequest('plan', ''), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('No active tasks'))).toBe(true);
        });

        it('should re-inject context for the selected task', async () => {
            participant.lastSelectedTaskId = task.id;
            const response = mockResponse();
            await participant.handleRequest(mockRequest('plan', ''), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('INSTRUCTION.md'))).toBe(true);
            expect(response.messages.some((m: string) => m.includes('PLAN'))).toBe(true);
            expect(response.messages.some((m: string) => m.includes('Verb Task'))).toBe(true);
            expect(response.messages.some((m: string) => m.includes('Task file:'))).toBe(true);
        });

        it('should route /todo command', async () => {
            participant.lastSelectedTaskId = task.id;
            const response = mockResponse();
            await participant.handleRequest(mockRequest('todo', ''), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('TODO'))).toBe(true);
        });

        it('should route /implement command', async () => {
            participant.lastSelectedTaskId = task.id;
            const response = mockResponse();
            await participant.handleRequest(mockRequest('implement', ''), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('IMPLEMENT'))).toBe(true);
        });

        it('should combine verbs from hash tags', async () => {
            participant.lastSelectedTaskId = task.id;
            const response = mockResponse();
            await participant.handleRequest(mockRequest('plan', '#todo #implement extra context'), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('PLAN + TODO + IMPLEMENT'))).toBe(true);
            expect(response.messages.some((m: string) => m.includes('extra context'))).toBe(true);
        });

        it('should include additional context from prompt', async () => {
            participant.lastSelectedTaskId = task.id;
            const response = mockResponse();
            await participant.handleRequest(mockRequest('plan', 'focus on error handling'), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('Additional context: focus on error handling'))).toBe(true);
        });

        it('should handle done task by clearing selection', async () => {
            task.lane = 'done';
            participant.lastSelectedTaskId = task.id;
            const response = mockResponse();
            await participant.handleRequest(mockRequest('plan', ''), {} as any, response, mockToken);

            expect(response.messages.some((m: string) => m.includes('no longer active'))).toBe(true);
            expect(participant.lastSelectedTaskId).toBeUndefined();
        });

        it('should open task file in editor with preserveFocus', async () => {
            participant.lastSelectedTaskId = task.id;
            const openSpy = vi.spyOn(workspace, 'openTextDocument');
            const showSpy = vi.spyOn(window, 'showTextDocument');

            const response = mockResponse();
            await participant.handleRequest(mockRequest('implement', ''), {} as any, response, mockToken);

            expect(openSpy).toHaveBeenCalled();
            expect(showSpy).toHaveBeenCalledWith(expect.anything(), { preview: false, preserveFocus: true });
        });

        it('should end with "Type go" prompt', async () => {
            participant.lastSelectedTaskId = task.id;
            const response = mockResponse();
            await participant.handleRequest(mockRequest('plan', ''), {} as any, response, mockToken);

            const last = response.messages[response.messages.length - 1];
            expect(last).toContain('go');
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
});
