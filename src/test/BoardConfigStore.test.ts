import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BoardConfigStore } from '../BoardConfigStore';
import type { BoardConfig } from '../types';
import { DEFAULT_BOARD_CONFIG, isProtectedLane, PROTECTED_LANES } from '../types';
import { Uri, workspace } from 'vscode';

describe('BoardConfigStore', () => {
    describe('serialise / deserialise round-trip', () => {
        it('should round-trip default config', () => {
            const yaml = BoardConfigStore.serialise(DEFAULT_BOARD_CONFIG);
            const result = BoardConfigStore.deserialise(yaml);

            expect(result).toEqual(DEFAULT_BOARD_CONFIG);
        });

        it('should round-trip config with custom lanes and base prompt', () => {
            const config: BoardConfig = {
                lanes: ['backlog', 'in-progress', 'review', 'done'],
            };

            const yaml = BoardConfigStore.serialise(config);
            const result = BoardConfigStore.deserialise(yaml);

            expect(result).toEqual(config);
        });

        it('should produce valid YAML output', () => {
            const config: BoardConfig = {
                lanes: ['todo', 'doing'],
            };

            const yaml = BoardConfigStore.serialise(config);

            expect(yaml).toContain('- todo');
            expect(yaml).toContain('- doing');
        });

        it('should handle config with no optional fields', () => {
            const config: BoardConfig = {
                lanes: ['a'],
            };

            const yaml = BoardConfigStore.serialise(config);
            const result = BoardConfigStore.deserialise(yaml);

            expect(result.lanes).toEqual(['a']);
        });
    });

    describe('isProtectedLane', () => {
        it('should protect todo lane', () => {
            expect(isProtectedLane('todo')).toBe(true);
        });

        it('should protect done lane', () => {
            expect(isProtectedLane('done')).toBe(true);
        });

        it('should not protect other lanes', () => {
            expect(isProtectedLane('doing')).toBe(false);
            expect(isProtectedLane('backlog')).toBe(false);
            expect(isProtectedLane('review')).toBe(false);
        });
    });

    describe('PROTECTED_LANES', () => {
        it('should contain todo and done', () => {
            expect(PROTECTED_LANES).toContain('todo');
            expect(PROTECTED_LANES).toContain('done');
        });

        it('should only contain lowercase values', () => {
            for (const name of PROTECTED_LANES) {
                expect(name).toBe(name.toLowerCase());
            }
        });
    });

    describe('ensureGitignore (via init)', () => {
        const workspaceUri = Uri.file('/test-workspace');

        beforeEach(() => {
            vi.restoreAllMocks();
        });

        it('should create .gitignore when it does not exist', async () => {
            // stat throws for .gitignore (doesn't exist), readFile throws for board.yaml (no config)
            vi.spyOn(workspace.fs, 'stat').mockRejectedValue(new Error('not found'));
            vi.spyOn(workspace.fs, 'readFile').mockRejectedValue(new Error('not found'));
            vi.spyOn(workspace.fs, 'createDirectory').mockResolvedValue(undefined);
            const writeSpy = vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);

            const store = new BoardConfigStore(workspaceUri);
            await store.init();

            // Find the writeFile call for .gitignore
            const gitignoreCall = writeSpy.mock.calls.find(
                ([uri]) => (uri as any).fsPath.endsWith('.gitignore'),
            );
            expect(gitignoreCall).toBeDefined();
            const content = new TextDecoder().decode(gitignoreCall![1] as Uint8Array);
            expect(content).toContain('logs/');
        });

        it('should not overwrite existing .gitignore', async () => {
            // stat succeeds for .gitignore (exists)
            vi.spyOn(workspace.fs, 'stat').mockResolvedValue({ type: 1, ctime: 0, mtime: 0, size: 10 } as any);
            vi.spyOn(workspace.fs, 'readFile').mockResolvedValue(
                new TextEncoder().encode('lanes:\n  - todo\n  - done\n'),
            );
            vi.spyOn(workspace.fs, 'createDirectory').mockResolvedValue(undefined);
            const writeSpy = vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);

            const store = new BoardConfigStore(workspaceUri);
            await store.init();

            const gitignoreCall = writeSpy.mock.calls.find(
                ([uri]) => (uri as any).fsPath.endsWith('.gitignore'),
            );
            expect(gitignoreCall).toBeUndefined();
        });
    });

    describe('users and labels registry', () => {
        it('should round-trip config with users and labels', () => {
            const config: BoardConfig = {
                lanes: ['todo'],
                users: ['alice', 'bob'],
                labels: ['backend', 'frontend'],
            };
            const yaml = BoardConfigStore.serialise(config);
            const result = BoardConfigStore.deserialise(yaml);
            expect(result.users).toEqual(['alice', 'bob']);
            expect(result.labels).toEqual(['backend', 'frontend']);
        });

        it('should handle missing users/labels gracefully', () => {
            const config: BoardConfig = {
                lanes: ['todo'],
            };
            const yaml = BoardConfigStore.serialise(config);
            const result = BoardConfigStore.deserialise(yaml);
            expect(result.users).toBeUndefined();
            expect(result.labels).toBeUndefined();
        });
    });

    describe('reconcileMetadata', () => {
        const workspaceUri = Uri.file('/test-workspace');

        beforeEach(() => {
            vi.restoreAllMocks();
        });

        it('should add unknown assignees from tasks', async () => {
            vi.spyOn(workspace.fs, 'stat').mockRejectedValue(new Error('not found'));
            vi.spyOn(workspace.fs, 'readFile').mockRejectedValue(new Error('not found'));
            vi.spyOn(workspace.fs, 'createDirectory').mockResolvedValue(undefined);
            vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);

            const store = new BoardConfigStore(workspaceUri);
            await store.init();

            await store.reconcileMetadata([
                { assignee: 'alice' },
                { assignee: 'bob' },
                { assignee: 'alice' },
            ]);

            const config = store.get();
            expect(config.users).toContain('alice');
            expect(config.users).toContain('bob');
        });

        it('should add unknown labels from tasks', async () => {
            vi.spyOn(workspace.fs, 'stat').mockRejectedValue(new Error('not found'));
            vi.spyOn(workspace.fs, 'readFile').mockRejectedValue(new Error('not found'));
            vi.spyOn(workspace.fs, 'createDirectory').mockResolvedValue(undefined);
            vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);

            const store = new BoardConfigStore(workspaceUri);
            await store.init();

            await store.reconcileMetadata([
                { labels: ['bug', 'frontend'] },
                { labels: ['bug', 'backend'] },
            ]);

            const config = store.get();
            expect(config.labels).toContain('bug');
            expect(config.labels).toContain('frontend');
            expect(config.labels).toContain('backend');
        });

        it('should not save if nothing new is found', async () => {
            vi.spyOn(workspace.fs, 'stat').mockRejectedValue(new Error('not found'));
            vi.spyOn(workspace.fs, 'readFile').mockRejectedValue(new Error('not found'));
            vi.spyOn(workspace.fs, 'createDirectory').mockResolvedValue(undefined);
            const writeSpy = vi.spyOn(workspace.fs, 'writeFile').mockResolvedValue(undefined);

            const store = new BoardConfigStore(workspaceUri);
            await store.init();

            const writeCountAfterInit = writeSpy.mock.calls.length;
            await store.reconcileMetadata([]);

            expect(writeSpy.mock.calls.length).toBe(writeCountAfterInit);
        });
    });
});
