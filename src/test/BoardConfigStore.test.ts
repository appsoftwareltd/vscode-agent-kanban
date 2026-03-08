import { describe, it, expect } from 'vitest';
import { BoardConfigStore } from '../BoardConfigStore';
import type { BoardConfig } from '../types';
import { DEFAULT_BOARD_CONFIG } from '../types';

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
});
