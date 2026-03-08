import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
vi.mock('fs');
import * as fs from 'fs';
import { validatePath, ToolExecutor, TOOL_DEFINITIONS, READ_ONLY_TOOLS } from '../agents/tools';
import * as vscode from 'vscode';

const WORKSPACE = process.platform === 'win32'
    ? 'C:\\projects\\my-app'
    : '/home/user/projects/my-app';

const SEP = path.sep;

describe('validatePath', () => {
    describe('when allowExternal is false', () => {
        it('should resolve a simple relative path inside workspace', () => {
            const result = validatePath('src/index.ts', WORKSPACE, false);
            expect(result).toBe(path.join(WORKSPACE, 'src', 'index.ts'));
        });

        it('should resolve a nested relative path', () => {
            const result = validatePath('src/utils/../helpers/run.ts', WORKSPACE, false);
            expect(result).toBe(path.join(WORKSPACE, 'src', 'helpers', 'run.ts'));
        });

        it('should allow a path that resolves to workspace root itself', () => {
            const result = validatePath('.', WORKSPACE, false);
            expect(result).toBe(WORKSPACE);
        });

        it('should reject a path that traverses above workspace root', () => {
            expect(() => validatePath('../other-project/file.ts', WORKSPACE, false))
                .toThrow(/resolves outside workspace/);
        });

        it('should reject an absolute path outside workspace', () => {
            const outsidePath = process.platform === 'win32'
                ? 'D:\\secrets\\passwords.txt'
                : '/etc/passwd';
            expect(() => validatePath(outsidePath, WORKSPACE, false))
                .toThrow(/resolves outside workspace/);
        });

        it('should reject deep traversal disguised with nested ..', () => {
            expect(() => validatePath('src/../../../../../../etc/passwd', WORKSPACE, false))
                .toThrow(/resolves outside workspace/);
        });
    });

    describe('when allowExternal is true', () => {
        it('should allow paths outside workspace', () => {
            const result = validatePath('../sibling-project/file.ts', WORKSPACE, true);
            const expected = path.resolve(WORKSPACE, '..', 'sibling-project', 'file.ts');
            expect(result).toBe(expected);
        });

        it('should still resolve paths correctly within workspace', () => {
            const result = validatePath('src/app.ts', WORKSPACE, true);
            expect(result).toBe(path.join(WORKSPACE, 'src', 'app.ts'));
        });

        it('should allow absolute paths outside workspace', () => {
            const outsidePath = process.platform === 'win32'
                ? 'D:\\other\\file.txt'
                : '/tmp/file.txt';
            const result = validatePath(outsidePath, WORKSPACE, true);
            expect(result).toBe(path.resolve(outsidePath));
        });
    });
});

describe('TOOL_DEFINITIONS', () => {
    it('should define 6 tools', () => {
        expect(TOOL_DEFINITIONS).toHaveLength(6);
    });

    it('should include all tool names', () => {
        const names = TOOL_DEFINITIONS.map(t => t.name);
        expect(names).toEqual(['readFile', 'writeFile', 'listFiles', 'runTerminal', 'editFile', 'searchFiles']);
    });
});

describe('READ_ONLY_TOOLS', () => {
    it('should contain exactly readFile, listFiles, searchFiles', () => {
        const names = READ_ONLY_TOOLS.map(t => t.name);
        expect(names).toEqual(['readFile', 'listFiles', 'searchFiles']);
    });
});

describe('ToolExecutor', () => {
    let executor: ToolExecutor;

    beforeEach(() => {
        executor = new ToolExecutor({
            workspaceRoot: WORKSPACE,
            allowExternalPaths: false,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('editFile', () => {
        it('should replace oldText with newText when oldText appears exactly once', async () => {
            const filePath = path.join(WORKSPACE, 'src', 'app.ts');
            vi.mocked(fs.readFileSync).mockReturnValue('const a = 1;\nconst b = 2;\nconst c = 3;\n');
            vi.mocked(fs.writeFileSync).mockImplementation(() => { });
            vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue('Allow' as any);

            const result = await executor.execute('editFile', {
                path: 'src/app.ts',
                oldText: 'const b = 2;',
                newText: 'const b = 42;',
            });

            expect(result.status).toContain('Edited');
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                filePath,
                'const a = 1;\nconst b = 42;\nconst c = 3;\n',
                'utf-8',
            );
        });

        it('should return error when oldText is not found', async () => {
            vi.mocked(fs.readFileSync).mockReturnValue('const a = 1;\n');

            const result = await executor.execute('editFile', {
                path: 'src/app.ts',
                oldText: 'not in file',
                newText: 'replacement',
            });

            expect(result.status).toContain('Edit failed');
            expect(result.result).toContain('not found');
        });

        it('should return error when oldText appears more than once', async () => {
            vi.mocked(fs.readFileSync).mockReturnValue('const a = 1;\nconst a = 1;\n');

            const result = await executor.execute('editFile', {
                path: 'src/app.ts',
                oldText: 'const a = 1;',
                newText: 'const a = 2;',
            });

            expect(result.status).toContain('Edit failed');
            expect(result.result).toContain('more than once');
        });

        it('should return denied when user rejects confirmation', async () => {
            vi.mocked(fs.readFileSync).mockReturnValue('const a = 1;\n');
            vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue('Deny' as any);

            const result = await executor.execute('editFile', {
                path: 'src/app.ts',
                oldText: 'const a = 1;',
                newText: 'const a = 2;',
            });

            expect(result.status).toContain('denied');
            expect(result.result).toContain('denied');
        });

        it('should validate path before editing', async () => {
            const result = await executor.execute('editFile', {
                path: '../../../etc/passwd',
                oldText: 'root',
                newText: 'hacked',
            });

            expect(result.status).toContain('Failed to edit');
            expect(result.result).toContain('outside workspace');
        });
    });

    describe('searchFiles', () => {
        it('should find matching lines across files', async () => {
            const filePath1 = path.join(WORKSPACE, 'src', 'a.ts');
            const filePath2 = path.join(WORKSPACE, 'src', 'b.ts');

            vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue([
                { fsPath: filePath1 } as any,
                { fsPath: filePath2 } as any,
            ]);
            vi.mocked(fs.readFileSync).mockImplementation(((p: string) => {
                if (p === filePath1) { return 'line 1\nfoo bar\nline 3\n'; }
                if (p === filePath2) { return 'hello\nfoo world\n'; }
                return '';
            }) as any);

            const result = await executor.execute('searchFiles', { query: 'foo' });

            expect(result.status).toContain('2 matches');
            expect(result.result).toContain('src/a.ts:2:');
            expect(result.result).toContain('src/b.ts:2:');
        });

        it('should return no matches message when nothing found', async () => {
            const filePath1 = path.join(WORKSPACE, 'src', 'a.ts');

            vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue([
                { fsPath: filePath1 } as any,
            ]);
            vi.mocked(fs.readFileSync).mockReturnValue('nothing to see here\n');

            const result = await executor.execute('searchFiles', { query: 'zzzzz' });

            expect(result.result).toBe('No matches found.');
        });

        it('should support regex patterns', async () => {
            const filePath1 = path.join(WORKSPACE, 'src', 'a.ts');

            vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue([
                { fsPath: filePath1 } as any,
            ]);
            vi.mocked(fs.readFileSync).mockReturnValue('const x = 123;\nconst y = abc;\nconst z = 456;\n');

            const result = await executor.execute('searchFiles', {
                query: '\\d{3}',
                pattern: '',
                isRegex: true,
            });

            expect(result.status).toContain('2 matches');
            expect(result.result).toContain('const x = 123;');
            expect(result.result).toContain('const z = 456;');
        });

        it('should return error for invalid regex', async () => {
            vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue([]);

            const result = await executor.execute('searchFiles', {
                query: '[invalid',
                pattern: '',
                isRegex: true,
            });

            expect(result.status).toContain('Invalid regex');
            expect(result.result).toContain('Invalid regex');
        });

        it('should skip binary/unreadable files', async () => {
            const filePath1 = path.join(WORKSPACE, 'src', 'a.ts');
            const filePath2 = path.join(WORKSPACE, 'images', 'icon.png');

            vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue([
                { fsPath: filePath1 } as any,
                { fsPath: filePath2 } as any,
            ]);
            vi.mocked(fs.readFileSync).mockImplementation(((p: string) => {
                if (p === filePath1) { return 'hello world\n'; }
                throw new Error('Cannot read binary');
            }) as any);

            const result = await executor.execute('searchFiles', { query: 'hello' });

            expect(result.status).toContain('1 matches');
            expect(result.result).toContain('hello world');
        });

        it('should pass file pattern to findFiles', async () => {
            const findFilesSpy = vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue([]);

            await executor.execute('searchFiles', {
                query: 'test',
                pattern: 'src/**/*.ts',
            });

            expect(findFilesSpy).toHaveBeenCalled();
            const patternArg = findFilesSpy.mock.calls[0][0];
            expect(patternArg).toHaveProperty('pattern', 'src/**/*.ts');
        });
    });

    describe('readFile', () => {
        it('should read file contents', async () => {
            const filePath = path.join(WORKSPACE, 'src', 'index.ts');
            vi.mocked(fs.readFileSync).mockReturnValue('export const x = 1;');

            const result = await executor.execute('readFile', { path: 'src/index.ts' });

            expect(result.status).toContain('Read file');
            expect(result.result).toBe('export const x = 1;');
        });

        it('should truncate large files', async () => {
            const bigContent = 'x'.repeat(60_000);
            vi.mocked(fs.readFileSync).mockReturnValue(bigContent);

            const result = await executor.execute('readFile', { path: 'src/big.ts' });

            expect(result.result).toContain('truncated');
            expect(result.result.length).toBeLessThan(bigContent.length);
        });
    });

    describe('writeFile', () => {
        it('should write file when user allows', async () => {
            vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue('Allow' as any);
            vi.mocked(fs.mkdirSync).mockImplementation(() => '' as any);
            vi.mocked(fs.writeFileSync).mockImplementation(() => { });

            const result = await executor.execute('writeFile', {
                path: 'src/new.ts',
                content: 'export const y = 2;',
            });

            expect(result.status).toContain('Written');
            expect(fs.writeFileSync).toHaveBeenCalled();
        });

        it('should not write when user denies', async () => {
            vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue('Deny' as any);
            const writeSpy = vi.mocked(fs.writeFileSync).mockImplementation(() => { });

            const result = await executor.execute('writeFile', {
                path: 'src/new.ts',
                content: 'export const y = 2;',
            });

            expect(result.status).toContain('denied');
            expect(writeSpy).not.toHaveBeenCalled();
        });
    });

    describe('tool call limit', () => {
        it('should enforce maximum tool calls', async () => {
            vi.mocked(fs.readFileSync).mockReturnValue('test');

            // Make 20 calls (the limit)
            for (let i = 0; i < 20; i++) {
                await executor.execute('readFile', { path: 'src/index.ts' });
            }

            expect(executor.maxCallsReached).toBe(true);

            // 21st call should be rejected
            const result = await executor.execute('readFile', { path: 'src/index.ts' });
            expect(result.status).toContain('limit reached');
        });
    });

    describe('unknown tool', () => {
        it('should return error for unknown tool name', async () => {
            const result = await executor.execute('unknownTool', {});

            expect(result.status).toContain('Unknown tool');
            expect(result.result).toContain('Unknown tool');
        });
    });
});
