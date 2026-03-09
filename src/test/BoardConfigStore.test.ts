import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BoardConfigStore } from '../BoardConfigStore';
import type { BoardConfig, LaneConfig } from '../types';
import { DEFAULT_BOARD_CONFIG, isProtectedLane, PROTECTED_LANE_NAMES } from '../types';
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
                lanes: [
                    { id: 'backlog', name: 'Backlog' },
                    { id: 'in-progress', name: 'In Progress' },
                    { id: 'review', name: 'Review' },
                    { id: 'done', name: 'Done' },
                ],
                basePrompt: 'You are a senior engineer.\nFollow TDD principles.\nWrite clean code.',
            };

            const yaml = BoardConfigStore.serialise(config);
            const result = BoardConfigStore.deserialise(yaml);

            expect(result).toEqual(config);
        });

        it('should produce valid YAML output', () => {
            const config: BoardConfig = {
                lanes: [
                    { id: 'todo', name: 'Todo' },
                    { id: 'doing', name: 'Doing' },
                ],
                basePrompt: 'Be helpful',
            };

            const yaml = BoardConfigStore.serialise(config);

            expect(yaml).toContain('basePrompt: Be helpful');
            expect(yaml).toContain('id: todo');
            expect(yaml).toContain('name: Todo');
        });

        it('should handle empty base prompt', () => {
            const config: BoardConfig = {
                lanes: [{ id: 'a', name: 'A' }],
                basePrompt: '',
            };

            const yaml = BoardConfigStore.serialise(config);
            const result = BoardConfigStore.deserialise(yaml);

            expect(result.basePrompt).toBe('');
        });

        it('should handle multi-line base prompt', () => {
            const config: BoardConfig = {
                lanes: [{ id: 'a', name: 'A' }],
                basePrompt: 'Line 1\nLine 2\nLine 3',
            };

            const yaml = BoardConfigStore.serialise(config);
            const result = BoardConfigStore.deserialise(yaml);

            expect(result.basePrompt).toBe(config.basePrompt);
        });
    });

    describe('isProtectedLane', () => {
        it('should protect Todo lane (case-insensitive)', () => {
            expect(isProtectedLane({ id: 'todo', name: 'Todo' })).toBe(true);
            expect(isProtectedLane({ id: 'any-id', name: 'todo' })).toBe(true);
            expect(isProtectedLane({ id: 'any-id', name: 'TODO' })).toBe(true);
        });

        it('should protect Done lane (case-insensitive)', () => {
            expect(isProtectedLane({ id: 'done', name: 'Done' })).toBe(true);
            expect(isProtectedLane({ id: 'any-id', name: 'done' })).toBe(true);
            expect(isProtectedLane({ id: 'any-id', name: 'DONE' })).toBe(true);
        });

        it('should not protect other lanes', () => {
            expect(isProtectedLane({ id: 'doing', name: 'Doing' })).toBe(false);
            expect(isProtectedLane({ id: 'backlog', name: 'Backlog' })).toBe(false);
            expect(isProtectedLane({ id: 'review', name: 'Review' })).toBe(false);
        });

        it('should match by name not by id', () => {
            expect(isProtectedLane({ id: 'todo', name: 'Backlog' })).toBe(false);
            expect(isProtectedLane({ id: 'custom', name: 'Done' })).toBe(true);
        });
    });

    describe('PROTECTED_LANE_NAMES', () => {
        it('should contain todo and done', () => {
            expect(PROTECTED_LANE_NAMES).toContain('todo');
            expect(PROTECTED_LANE_NAMES).toContain('done');
        });

        it('should only contain lowercase values', () => {
            for (const name of PROTECTED_LANE_NAMES) {
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
                new TextEncoder().encode('lanes:\n  - id: todo\n    name: Todo\n  - id: done\n    name: Done\nbasePrompt: ""\n'),
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
});
