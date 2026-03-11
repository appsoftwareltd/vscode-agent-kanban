import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { WorktreeInfo } from './types';
import type { LogService } from './LogService';
import { NO_OP_LOGGER } from './LogService';
import {
    AGENTS_MD_REL_PATH,
    AGENTS_MD_BEGIN,
    AGENTS_MD_END,
    buildWorktreeAgentsMdSection,
} from './agents/ChatParticipant';

const execFileAsync = promisify(execFile);

/** Branch prefix used for all Agent Kanban worktree branches. */
const BRANCH_PREFIX = 'agentkanban/';

/**
 * WorktreeService manages git worktrees for Agent Kanban tasks.
 *
 * Wraps `git worktree add`, `git worktree remove`, and related operations.
 * All git commands run in the workspace root directory.
 */
export class WorktreeService {
    private readonly logger: LogService;
    private readonly workspacePath: string;

    constructor(workspaceUri: vscode.Uri, logger?: LogService) {
        this.workspacePath = workspaceUri.fsPath;
        this.logger = logger ?? NO_OP_LOGGER;
    }

    // ── Git Detection ────────────────────────────────────────────────────────

    /** Check if the workspace is a git repository. */
    async isGitRepo(): Promise<boolean> {
        try {
            await this.git(['rev-parse', '--is-inside-work-tree']);
            return true;
        } catch {
            return false;
        }
    }

    /** Get the repository name from the root directory. */
    async getRepoName(): Promise<string> {
        try {
            const { stdout } = await this.git(['rev-parse', '--show-toplevel']);
            return path.basename(stdout.trim());
        } catch {
            return path.basename(this.workspacePath);
        }
    }

    // ── Worktree Operations ──────────────────────────────────────────────────

    /**
     * Create a git worktree for a task.
     *
     * 1. Auto-commits untracked/modified task files if needed
     * 2. Creates a new branch (agentkanban/<task-slug>)
     * 3. Creates a worktree at the configured root path
     * 4. Sets --skip-worktree on AGENTS.md in the new worktree
     * 5. Writes task-specific AGENTS.md into the worktree
     *
     * Returns the WorktreeInfo to store in task frontmatter.
     */
    async create(taskId: string, taskTitle: string, taskRelPath?: string): Promise<WorktreeInfo> {
        const slug = this.slugifyForBranch(taskId);
        const branch = `${BRANCH_PREFIX}${slug}`;
        const worktreeRoot = this.getWorktreeRoot();
        const worktreePath = path.join(worktreeRoot, slug);

        this.logger.info('worktreeService', `Creating worktree: branch=${branch}, path=${worktreePath}`);

        // 1. Auto-commit task files
        try {
            await this.autoCommitTaskFiles(taskTitle);
        } catch (err: any) {
            this.logger.warn('worktreeService', `Auto-commit failed: ${err.message}`);
            vscode.window.showWarningMessage(
                `Agent Kanban: Could not auto-commit task files — the worktree may not contain the latest task data. Error: ${err.message}`,
            );
        }

        // 2. Create worktree + branch
        try {
            await this.git(['worktree', 'add', '-b', branch, worktreePath]);
        } catch (err: any) {
            // Branch may already exist — try without -b
            if (err.message?.includes('already exists')) {
                await this.git(['worktree', 'add', worktreePath, branch]);
            } else {
                throw err;
            }
        }

        // 3. Set --skip-worktree on AGENTS.md in the new worktree
        try {
            await this.gitAt(worktreePath, ['update-index', '--skip-worktree', 'AGENTS.md']);
            this.logger.info('worktreeService', 'Set --skip-worktree on AGENTS.md');
        } catch {
            // AGENTS.md may not exist yet in the worktree — that's ok,
            // it will be created when the extension activates there
            this.logger.warn('worktreeService', 'Could not set --skip-worktree on AGENTS.md (may not exist yet)');
        }

        // 4. Write task-specific AGENTS.md into the worktree
        if (taskRelPath) {
            await this.writeWorktreeAgentsMd(worktreePath, taskTitle, taskRelPath);
        }

        const info: WorktreeInfo = {
            branch,
            path: worktreePath,
            created: new Date().toISOString(),
        };

        this.logger.info('worktreeService', `Worktree created successfully: ${worktreePath}`);
        return info;
    }

    /**
     * Remove a worktree associated with a task.
     */
    async remove(worktree: WorktreeInfo): Promise<void> {
        this.logger.info('worktreeService', `Removing worktree: ${worktree.path}`);

        try {
            await this.git(['worktree', 'remove', worktree.path, '--force']);
        } catch (err: any) {
            this.logger.warn('worktreeService', `Failed to remove worktree: ${err.message}`);
            throw err;
        }

        // Optionally delete the branch
        try {
            await this.git(['branch', '-D', worktree.branch]);
            this.logger.info('worktreeService', `Deleted branch: ${worktree.branch}`);
        } catch {
            // Branch may have been merged/deleted already
            this.logger.warn('worktreeService', `Could not delete branch ${worktree.branch} (may be merged)`);
        }
    }

    /**
     * List all active worktrees.
     */
    async list(): Promise<{ path: string; branch: string }[]> {
        try {
            const { stdout } = await this.git(['worktree', 'list', '--porcelain']);
            return this.parseWorktreeList(stdout);
        } catch {
            return [];
        }
    }

    /**
     * Check if a worktree path still exists on disk.
     */
    async exists(worktreePath: string): Promise<boolean> {
        try {
            const uri = vscode.Uri.file(worktreePath);
            await vscode.workspace.fs.stat(uri);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Open a worktree folder in VS Code.
     */
    async openInVSCode(worktreePath: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('agentKanban');
        const openBehavior = config.get<string>('worktreeOpenBehavior', 'current');
        const uri = vscode.Uri.file(worktreePath);
        const newWindow = openBehavior === 'new';
        await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: newWindow });
    }

    // ── Auto-Commit ──────────────────────────────────────────────────────────

    /**
     * Stage and commit .agentkanban/ task files if they have untracked/modified changes.
     * Shows a notification to the user.
     */
    async autoCommitTaskFiles(taskTitle: string): Promise<boolean> {
        // Check for changes in .agentkanban/
        const { stdout: status } = await this.git([
            'status', '--porcelain', '--', '.agentkanban/',
        ]);

        if (!status.trim()) {
            this.logger.info('worktreeService', 'No uncommitted task file changes');
            return false;
        }

        this.logger.info('worktreeService', `Auto-committing task files:\n${status}`);

        // Stage all .agentkanban/ changes
        await this.git(['add', '.agentkanban/']);

        // Commit with a descriptive message
        const message = `agentkanban: add task "${taskTitle}"`;
        await this.git(['commit', '-m', message]);

        vscode.window.showInformationMessage(
            `Agent Kanban: Committed task files before creating worktree.`,
        );

        return true;
    }

    // ── Worktree AGENTS.md ───────────────────────────────────────────────────

    /**
     * Write the enhanced AGENTS.md sentinel directly into a worktree directory.
     * This runs after worktree creation, before the extension activates there.
     */
    async writeWorktreeAgentsMd(
        worktreePath: string,
        taskTitle: string,
        taskRelPath: string,
    ): Promise<void> {
        const agentsUri = vscode.Uri.joinPath(vscode.Uri.file(worktreePath), AGENTS_MD_REL_PATH);
        try {
            let existing = '';
            try {
                const bytes = await vscode.workspace.fs.readFile(agentsUri);
                existing = new TextDecoder().decode(bytes);
            } catch {
                // File doesn't exist in worktree yet
            }

            const section = buildWorktreeAgentsMdSection(taskTitle, taskRelPath);
            const beginIdx = existing.indexOf(AGENTS_MD_BEGIN);
            const endIdx = existing.indexOf(AGENTS_MD_END);

            let updated: string;
            if (beginIdx !== -1 && endIdx !== -1) {
                const before = existing.slice(0, beginIdx);
                const after = existing.slice(endIdx + AGENTS_MD_END.length);
                updated = before + section + after;
            } else {
                const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n\n' : existing.length > 0 ? '\n' : '';
                updated = existing + sep + section + '\n';
            }

            await vscode.workspace.fs.writeFile(agentsUri, new TextEncoder().encode(updated));
            this.logger.info('worktreeService', `Wrote enhanced AGENTS.md to worktree: ${worktreePath}`);
        } catch (err: any) {
            this.logger.warn('worktreeService', `Failed to write worktree AGENTS.md: ${err.message}`);
        }
    }

    // ── Configuration ────────────────────────────────────────────────────────

    /** Get the resolved worktree root directory. */
    getWorktreeRoot(): string {
        const config = vscode.workspace.getConfiguration('agentKanban');
        const template = config.get<string>('worktreeRoot', '../{repo}-worktrees');

        // Replace {repo} with the workspace folder name
        const repoName = path.basename(this.workspacePath);
        const resolved = template.replace(/\{repo\}/g, repoName);

        // Resolve relative to workspace root
        if (path.isAbsolute(resolved)) {
            return resolved;
        }
        return path.resolve(this.workspacePath, resolved);
    }

    // ── Private Helpers ──────────────────────────────────────────────────────

    /** Run a git command in the workspace root. */
    private async git(args: string[]): Promise<{ stdout: string; stderr: string }> {
        return execFileAsync('git', args, {
            cwd: this.workspacePath,
            timeout: 30_000,
        });
    }

    /** Run a git command in a specific directory. */
    private async gitAt(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
        return execFileAsync('git', args, {
            cwd,
            timeout: 30_000,
        });
    }

    /** Slugify a task ID for use in branch names. */
    private slugifyForBranch(taskId: string): string {
        // Remove 'task_' prefix, keep timestamp + unique ID + slug
        return taskId
            .replace(/^task_/, '')
            .replace(/[^a-z0-9_-]+/gi, '_')
            .toLowerCase();
    }

    /** Parse `git worktree list --porcelain` output. */
    private parseWorktreeList(output: string): { path: string; branch: string }[] {
        const worktrees: { path: string; branch: string }[] = [];
        const blocks = output.split('\n\n').filter(Boolean);

        for (const block of blocks) {
            const lines = block.split('\n');
            let wtPath = '';
            let branch = '';

            for (const line of lines) {
                if (line.startsWith('worktree ')) {
                    wtPath = line.slice('worktree '.length);
                }
                if (line.startsWith('branch refs/heads/')) {
                    branch = line.slice('branch refs/heads/'.length);
                }
            }

            if (wtPath && branch) {
                worktrees.push({ path: wtPath, branch });
            }
        }

        return worktrees;
    }
}
