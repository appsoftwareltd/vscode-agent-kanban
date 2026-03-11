import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Uri, workspace } from 'vscode';

// Use vi.hoisted so the mock fn is available when vi.mock factory runs.
const execFileMock = vi.hoisted(() =>
    vi.fn<any[], Promise<{ stdout: string; stderr: string }>>(),
);

vi.mock('child_process', () => {
    const { promisify } = require('util');
    const fn = (...args: any[]) => {
        const cb = args[args.length - 1];
        if (typeof cb === 'function') {
            execFileMock(...args.slice(0, -1)).then(
                (r: any) => cb(null, r.stdout, r.stderr),
                (e: any) => cb(e),
            );
        }
    };
    fn[promisify.custom] = execFileMock;
    return { execFile: fn };
});

import { WorktreeService } from '../WorktreeService';

describe('WorktreeService', () => {
    let service: WorktreeService;
    const workspaceUri = Uri.file('/test-workspace') as any;

    beforeEach(() => {
        vi.restoreAllMocks();
        // Default: succeed silently
        execFileMock.mockResolvedValue({ stdout: '', stderr: '' });
        service = new WorktreeService(workspaceUri);
    });

    describe('isGitRepo', () => {
        it('should return true when git rev-parse succeeds', async () => {
            execFileMock.mockResolvedValue({ stdout: 'true\n', stderr: '' });

            expect(await service.isGitRepo()).toBe(true);
        });

        it('should return false when git rev-parse fails', async () => {
            execFileMock.mockRejectedValue(new Error('not a git repo'));

            expect(await service.isGitRepo()).toBe(false);
        });
    });

    describe('getRepoName', () => {
        it('should return basename of git root', async () => {
            execFileMock.mockResolvedValue({ stdout: '/home/user/my-project\n', stderr: '' });

            expect(await service.getRepoName()).toBe('my-project');
        });

        it('should fall back to workspace basename on error', async () => {
            execFileMock.mockRejectedValue(new Error('fail'));

            expect(await service.getRepoName()).toBe('test-workspace');
        });
    });

    describe('getWorktreeRoot', () => {
        it('should resolve {repo} template to workspace folder name', () => {
            vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
                get: (key: string, defaultValue?: any) => {
                    if (key === 'worktreeRoot') { return '../{repo}-worktrees'; }
                    return defaultValue;
                },
                update: async () => { },
            } as any);

            const root = service.getWorktreeRoot();
            expect(root).toContain('test-workspace-worktrees');
        });

        it('should return absolute path when template is absolute', () => {
            vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
                get: (key: string, defaultValue?: any) => {
                    if (key === 'worktreeRoot') { return '/absolute/worktrees'; }
                    return defaultValue;
                },
                update: async () => { },
            } as any);

            expect(service.getWorktreeRoot()).toBe('/absolute/worktrees');
        });
    });

    describe('exists', () => {
        it('should return true when stat succeeds', async () => {
            vi.spyOn(workspace.fs, 'stat').mockResolvedValue({ type: 2, ctime: 0, mtime: 0, size: 0 } as any);

            expect(await service.exists('/some/path')).toBe(true);
        });

        it('should return false when stat fails', async () => {
            vi.spyOn(workspace.fs, 'stat').mockRejectedValue(new Error('not found'));

            expect(await service.exists('/some/path')).toBe(false);
        });
    });

    describe('list', () => {
        it('should parse porcelain worktree list output', async () => {
            const porcelainOutput = [
                'worktree /home/user/repo',
                'HEAD abc1234',
                'branch refs/heads/main',
                '',
                'worktree /home/user/repo-wt/feature',
                'HEAD def5678',
                'branch refs/heads/agentkanban/feature_task',
                '',
            ].join('\n');

            execFileMock.mockResolvedValue({ stdout: porcelainOutput, stderr: '' });

            const result = await service.list();
            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ path: '/home/user/repo', branch: 'main' });
            expect(result[1]).toEqual({ path: '/home/user/repo-wt/feature', branch: 'agentkanban/feature_task' });
        });

        it('should return empty array on error', async () => {
            execFileMock.mockRejectedValue(new Error('git error'));

            expect(await service.list()).toEqual([]);
        });

        it('should skip entries without branch', async () => {
            const porcelainOutput = [
                'worktree /home/user/repo',
                'HEAD abc1234',
                'branch refs/heads/main',
                '',
                'worktree /home/user/repo-wt/detached',
                'HEAD def5678',
                'detached',
                '',
            ].join('\n');

            execFileMock.mockResolvedValue({ stdout: porcelainOutput, stderr: '' });

            const result = await service.list();
            expect(result).toHaveLength(1);
            expect(result[0].branch).toBe('main');
        });
    });

    describe('autoCommitTaskFiles', () => {
        it('should commit when there are uncommitted changes', async () => {
            const gitCalls: string[][] = [];
            execFileMock.mockImplementation(async (_file: any, args: any, _opts: any) => {
                gitCalls.push(args);
                if (args.includes('--porcelain') && args.includes('.agentkanban/')) {
                    return { stdout: 'A  .agentkanban/tasks/todo/task_001.md\n', stderr: '' };
                }
                return { stdout: '', stderr: '' };
            });

            const result = await service.autoCommitTaskFiles('Test task');
            expect(result).toBe(true);

            // Should have called git add and git commit
            expect(gitCalls.some(args => args.includes('add') && args.includes('.agentkanban/'))).toBe(true);
            expect(gitCalls.some(args => args.includes('commit'))).toBe(true);
        });

        it('should skip commit when no changes', async () => {
            execFileMock.mockResolvedValue({ stdout: '', stderr: '' });

            const result = await service.autoCommitTaskFiles('Test task');
            expect(result).toBe(false);
        });
    });

    describe('create', () => {
        it('should create worktree and return WorktreeInfo', async () => {
            const gitCalls: string[][] = [];
            execFileMock.mockImplementation(async (_file: any, args: any, _opts: any) => {
                gitCalls.push(args);
                return { stdout: '', stderr: '' };
            });

            const info = await service.create('task_20260310_100000_abc_test', 'Test task');

            expect(info.branch).toBe('agentkanban/20260310_100000_abc_test');
            expect(info.path).toContain('20260310_100000_abc_test');
            expect(info.created).toBeTruthy();

            // Should have called git worktree add
            expect(gitCalls.some(args => args[0] === 'worktree' && args[1] === 'add')).toBe(true);
        });

        it('should retry without -b when branch already exists', async () => {
            let worktreeAddCount = 0;
            execFileMock.mockImplementation(async (_file: any, args: any, _opts: any) => {
                if (args[0] === 'worktree' && args[1] === 'add') {
                    worktreeAddCount++;
                    if (args.includes('-b')) {
                        throw new Error("fatal: a branch named 'agentkanban/test' already exists");
                    }
                    return { stdout: '', stderr: '' };
                }
                return { stdout: '', stderr: '' };
            });

            const info = await service.create('task_test', 'Test');
            expect(worktreeAddCount).toBe(2);
            expect(info.branch).toContain('agentkanban/');
        });

        it('should write AGENTS.md to worktree when taskRelPath is provided', async () => {
            execFileMock.mockResolvedValue({ stdout: '', stderr: '' });
            const writeSpy = vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);
            vi.spyOn(workspace.fs, 'readFile').mockRejectedValue(new Error('not found'));

            const info = await service.create(
                'task_20260310_100000_abc_test',
                'Test task',
                '.agentkanban/tasks/doing/task_20260310_100000_abc_test.md',
            );

            expect(info.branch).toContain('agentkanban/');
            // Should have written AGENTS.md
            expect(writeSpy).toHaveBeenCalled();
            const writeCall = writeSpy.mock.calls.find(
                (c: any) => c[0]?.fsPath?.includes('AGENTS.md') || c[0]?.path?.includes('AGENTS.md'),
            );
            expect(writeCall).toBeDefined();
            const content = new TextDecoder().decode(writeCall![1] as Uint8Array);
            expect(content).toContain('Test task');
            expect(content).toContain('task_20260310_100000_abc_test.md');
        });

        it('should not write AGENTS.md when taskRelPath is omitted', async () => {
            execFileMock.mockResolvedValue({ stdout: '', stderr: '' });
            const writeSpy = vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);

            await service.create('task_20260310_100000_abc_test2', 'Test task 2');

            const agentsWrite = writeSpy.mock.calls.find(
                (c: any) => c[0]?.fsPath?.includes('AGENTS.md') || c[0]?.path?.includes('AGENTS.md'),
            );
            expect(agentsWrite).toBeUndefined();
        });

        it('should warn but not throw when autoCommitTaskFiles fails', async () => {
            const warnSpy = vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);
            const showWarningSpy = vi.fn();
            const { window: vscodeWindow } = await import('vscode');
            vi.spyOn(vscodeWindow, 'showWarningMessage').mockImplementation(showWarningSpy);

            execFileMock.mockImplementation(async (_file: any, args: any, _opts: any) => {
                if (args.includes('--porcelain') && args.includes('.agentkanban/')) {
                    // Has changes — then add/commit will fail
                    return { stdout: '?? .agentkanban/tasks/todo/task.md\n', stderr: '' };
                }
                if (args.includes('add') && args.includes('.agentkanban/')) {
                    throw new Error('git add failed');
                }
                return { stdout: '', stderr: '' };
            });

            // Should not throw — error is caught and turned into a warning
            const info = await service.create('task_test_fail', 'Failing commit task');
            expect(info.branch).toContain('agentkanban/');
            expect(showWarningSpy).toHaveBeenCalledWith(
                expect.stringContaining('Could not auto-commit'),
            );
        });
    });

    describe('remove', () => {
        it('should remove worktree and delete branch', async () => {
            const gitCalls: string[][] = [];
            execFileMock.mockImplementation(async (_file: any, args: any, _opts: any) => {
                gitCalls.push(args);
                return { stdout: '', stderr: '' };
            });

            const worktree = {
                branch: 'agentkanban/test_task',
                path: '/wt/test_task',
                created: '2026-03-10T00:00:00.000Z',
            };

            await service.remove(worktree);

            expect(gitCalls.some(args => args[0] === 'worktree' && args[1] === 'remove')).toBe(true);
            expect(gitCalls.some(args => args[0] === 'branch' && args[1] === '-D')).toBe(true);
        });

        it('should throw when worktree remove fails', async () => {
            execFileMock.mockImplementation(async (_file: any, args: any, _opts: any) => {
                if (args[0] === 'worktree') {
                    throw new Error('worktree is dirty');
                }
                return { stdout: '', stderr: '' };
            });

            const worktree = {
                branch: 'agentkanban/test',
                path: '/wt/test',
                created: '',
            };

            await expect(service.remove(worktree)).rejects.toThrow('worktree is dirty');
        });
    });

    describe('openInVSCode', () => {
        it('should open folder in current window by default', async () => {
            const { commands } = await import('vscode');
            const execSpy = vi.spyOn(commands, 'executeCommand').mockResolvedValue(undefined);

            vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
                get: (key: string, defaultValue?: any) => {
                    if (key === 'worktreeOpenBehavior') { return 'current'; }
                    return defaultValue;
                },
                update: async () => { },
            } as any);

            await service.openInVSCode('/test/worktree');

            expect(execSpy).toHaveBeenCalledWith(
                'vscode.openFolder',
                expect.anything(),
                { forceNewWindow: false },
            );
        });

        it('should open in new window when setting is "new"', async () => {
            const { commands } = await import('vscode');
            const execSpy = vi.spyOn(commands, 'executeCommand').mockResolvedValue(undefined);

            vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
                get: (key: string, defaultValue?: any) => {
                    if (key === 'worktreeOpenBehavior') { return 'new'; }
                    return defaultValue;
                },
                update: async () => { },
            } as any);

            await service.openInVSCode('/test/worktree');

            expect(execSpy).toHaveBeenCalledWith(
                'vscode.openFolder',
                expect.anything(),
                { forceNewWindow: true },
            );
        });
    });
});
