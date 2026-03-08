import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { CopilotChatProvider } from '../agents/CopilotChatProvider';

vi.mock('fs', () => {
    return {
        existsSync: vi.fn(() => false),
        readFileSync: vi.fn(() => ''),
        writeFileSync: vi.fn(),
        mkdirSync: vi.fn(),
    };
});

import * as fs from 'fs';

const WORKSPACE = process.platform === 'win32'
    ? 'C:\\projects\\my-app'
    : '/home/user/projects/my-app';

describe('CopilotChatProvider', () => {
    let provider: CopilotChatProvider;

    beforeEach(() => {
        provider = new CopilotChatProvider();
        provider.setWorkspaceRoot(WORKSPACE);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('loadAgentInstructions', () => {
        it('should load AGENTS.md from workspace root', () => {
            const agentsPath = path.join(WORKSPACE, 'AGENTS.md');
            vi.mocked(fs.existsSync).mockImplementation((p: any) => p === agentsPath);
            vi.mocked(fs.readFileSync).mockReturnValue('# Agent Instructions\nDo this.');

            provider.loadAgentInstructions();

            expect(provider.getAgentInstructions()).toBe('# Agent Instructions\nDo this.');
        });

        it('should load .github/copilot-instructions.md if AGENTS.md not found', () => {
            const copilotPath = path.join(WORKSPACE, '.github', 'copilot-instructions.md');
            vi.mocked(fs.existsSync).mockImplementation((p: any) => p === copilotPath);
            vi.mocked(fs.readFileSync).mockReturnValue('Copilot instructions.');

            provider.loadAgentInstructions();

            expect(provider.getAgentInstructions()).toBe('Copilot instructions.');
        });

        it('should load .github/AGENTS.md if earlier files not found', () => {
            const githubAgentsPath = path.join(WORKSPACE, '.github', 'AGENTS.md');
            vi.mocked(fs.existsSync).mockImplementation((p: any) => p === githubAgentsPath);
            vi.mocked(fs.readFileSync).mockReturnValue('GitHub agents instructions.');

            provider.loadAgentInstructions();

            expect(provider.getAgentInstructions()).toBe('GitHub agents instructions.');
        });

        it('should load CLAUDE.md if earlier files not found', () => {
            const claudePath = path.join(WORKSPACE, 'CLAUDE.md');
            vi.mocked(fs.existsSync).mockImplementation((p: any) => p === claudePath);
            vi.mocked(fs.readFileSync).mockReturnValue('Claude instructions.');

            provider.loadAgentInstructions();

            expect(provider.getAgentInstructions()).toBe('Claude instructions.');
        });

        it('should prefer AGENTS.md over .github/copilot-instructions.md', () => {
            const agentsPath = path.join(WORKSPACE, 'AGENTS.md');
            const copilotPath = path.join(WORKSPACE, '.github', 'copilot-instructions.md');
            vi.mocked(fs.existsSync).mockImplementation((p: any) => p === agentsPath || p === copilotPath);
            vi.mocked(fs.readFileSync).mockImplementation(((p: string) => {
                if (p === agentsPath) { return 'AGENTS.md content'; }
                return 'Copilot content';
            }) as any);

            provider.loadAgentInstructions();

            expect(provider.getAgentInstructions()).toBe('AGENTS.md content');
        });

        it('should return empty string when no instruction files exist', () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);

            provider.loadAgentInstructions();

            expect(provider.getAgentInstructions()).toBe('');
        });

        it('should handle unreadable files gracefully', () => {
            const agentsPath = path.join(WORKSPACE, 'AGENTS.md');
            vi.mocked(fs.existsSync).mockImplementation((p: any) => p === agentsPath);
            vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('Permission denied'); });

            // Should not throw
            provider.loadAgentInstructions();

            expect(provider.getAgentInstructions()).toBe('');
        });
    });

    describe('buildChatMessages', () => {
        it('should include agent instructions in system prompt when loaded', () => {
            const agentsPath = path.join(WORKSPACE, 'AGENTS.md');
            vi.mocked(fs.existsSync).mockImplementation((p: any) => p === agentsPath);
            vi.mocked(fs.readFileSync).mockReturnValue('Follow these rules.');

            provider.loadAgentInstructions();

            const context = {
                task: { id: 't1', title: 'Test', lane: 'todo', created: '', updated: '', description: 'Desc', conversation: [] },
                conversation: [],
                boardConfig: { lanes: [], basePrompt: 'Base prompt.' },
                action: 'plan' as const,
                userMessage: 'Hello',
            };

            const messages = provider.buildChatMessages(context);

            // First message should contain agent instructions + base prompt
            const firstMsg = messages[0];
            expect(firstMsg.content).toContain('Follow these rules.');
            expect(firstMsg.content).toContain('Base prompt.');
            expect(firstMsg.content).toContain('PLANNING mode');
        });

        it('should not include agent instructions when none loaded', () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);
            provider.loadAgentInstructions();

            const context = {
                task: { id: 't1', title: 'Test', lane: 'todo', created: '', updated: '', description: '', conversation: [] },
                conversation: [],
                boardConfig: { lanes: [], basePrompt: '' },
                action: 'implement' as const,
                userMessage: 'Do it',
            };

            const messages = provider.buildChatMessages(context);

            const firstMsg = messages[0];
            expect(firstMsg.content).toContain('IMPLEMENTATION mode');
            expect(firstMsg.content).not.toContain('Follow these rules');
        });
    });
});
