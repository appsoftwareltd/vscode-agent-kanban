import * as vscode from 'vscode';
import { parse, stringify } from 'yaml';
import type { BoardConfig } from './types';
import { DEFAULT_BOARD_CONFIG } from './types';
import type { LogService } from './LogService';
import { NO_OP_LOGGER } from './LogService';

const CONFIG_PATH = '.agentkanban/board.yaml';
const GITIGNORE_PATH = '.agentkanban/.gitignore';
const GITIGNORE_CONTENT = '# Agent Kanban — auto-generated\nlogs/\n';

export class BoardConfigStore {
    private config: BoardConfig = { ...DEFAULT_BOARD_CONFIG, lanes: [...DEFAULT_BOARD_CONFIG.lanes] };
    private readonly configUri: vscode.Uri;
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;
    private readonly logger: LogService;

    constructor(private readonly workspaceUri: vscode.Uri, logger?: LogService) {
        this.configUri = vscode.Uri.joinPath(workspaceUri, CONFIG_PATH);
        this.logger = logger ?? NO_OP_LOGGER;
    }

    /**
     * Read-only init: loads config from an existing board.yaml.
     * Does NOT create directories or write any files.
     * Safe to call on uninitialised workspaces — stays with defaults if config absent.
     * Migration of old object-format lanes is still performed (writes only when
     * the file already exists, i.e. the workspace was previously set up).
     */
    async init(): Promise<void> {
        try {
            const content = await vscode.workspace.fs.readFile(this.configUri);
            const text = new TextDecoder().decode(content);
            const loaded = parse(text) as any;
            if (loaded?.lanes) {
                // Migrate from old { id, name } format to flat slug list
                if (loaded.lanes.length > 0 && typeof loaded.lanes[0] === 'object') {
                    this.config = {
                        ...loaded,
                        lanes: (loaded.lanes as Array<{ id: string }>).map(l => l.id),
                    };
                    this.logger.info('boardConfig', 'Migrated lanes from object format to flat slugs');
                    await this.save(); // Updating existing data — acceptable write
                } else {
                    this.config = loaded as BoardConfig;
                }
                this.logger.info('boardConfig', `Loaded config with ${this.config.lanes.length} lanes`);
            }
        } catch {
            // Config file doesn't exist — stay with defaults, no writes
            this.logger.info('boardConfig', 'No config found, using defaults (not writing)');
        }
        this._onDidChange.fire();
    }

    /**
     * Full first-time setup: creates the .agentkanban directory, .gitignore,
     * board.yaml (if absent), and lane subdirectories.
     * Safe to call on already-initialised workspaces (idempotent).
     */
    async initialise(): Promise<void> {
        try {
            await vscode.workspace.fs.createDirectory(
                vscode.Uri.joinPath(this.workspaceUri, '.agentkanban'),
            );
        } catch {
            // directory may already exist
        }

        await this.ensureGitignore();

        try {
            const content = await vscode.workspace.fs.readFile(this.configUri);
            const text = new TextDecoder().decode(content);
            const loaded = parse(text) as any;
            if (loaded?.lanes) {
                // Migrate from old { id, name } format to flat slug list
                if (loaded.lanes.length > 0 && typeof loaded.lanes[0] === 'object') {
                    this.config = {
                        ...loaded,
                        lanes: (loaded.lanes as Array<{ id: string }>).map(l => l.id),
                    };
                    this.logger.info('boardConfig', 'Migrated lanes from object format to flat slugs');
                    await this.save();
                } else {
                    this.config = loaded as BoardConfig;
                }
                this.logger.info('boardConfig', `Loaded config with ${this.config.lanes.length} lanes`);
            }
        } catch {
            // file doesn't exist yet — write defaults
            this.logger.info('boardConfig', 'No config found, writing defaults');
            await this.save();
        }

        this._onDidChange.fire();
    }

    get(): BoardConfig {
        return this.config;
    }

    async update(config: Partial<BoardConfig>): Promise<void> {
        if (config.lanes !== undefined) {
            this.config.lanes = config.lanes;
        }
        if (config.users !== undefined) {
            this.config.users = config.users;
        }
        if (config.labels !== undefined) {
            this.config.labels = config.labels;
        }
        await this.save();
        this.logger.info('boardConfig', 'Board config updated');
        this._onDidChange.fire();
    }

    async addUser(name: string): Promise<void> {
        const users = this.config.users ?? [];
        if (!users.includes(name)) {
            this.config.users = [...users, name];
            await this.save();
            this._onDidChange.fire();
        }
    }

    async addLabel(name: string): Promise<void> {
        const labels = this.config.labels ?? [];
        if (!labels.includes(name)) {
            this.config.labels = [...labels, name];
            await this.save();
            this._onDidChange.fire();
        }
    }

    /**
     * Scan task metadata and add any unknown assignees or labels to the config.
     * Called on activation and periodically as housekeeping.
     */
    async reconcileMetadata(tasks: Array<{ assignee?: string; labels?: string[] }>): Promise<void> {
        let changed = false;
        const users = new Set(this.config.users ?? []);
        const labels = new Set(this.config.labels ?? []);

        for (const task of tasks) {
            if (task.assignee && !users.has(task.assignee)) {
                users.add(task.assignee);
                changed = true;
            }
            if (task.labels) {
                for (const label of task.labels) {
                    if (!labels.has(label)) {
                        labels.add(label);
                        changed = true;
                    }
                }
            }
        }

        if (changed) {
            this.config.users = [...users];
            this.config.labels = [...labels];
            await this.save();
            this.logger.info('boardConfig', 'Reconciled metadata — added missing users/labels');
            this._onDidChange.fire();
        }
    }

    private async ensureGitignore(): Promise<void> {
        const gitignoreUri = vscode.Uri.joinPath(this.workspaceUri, GITIGNORE_PATH);
        try {
            await vscode.workspace.fs.stat(gitignoreUri);
            return; // already exists
        } catch {
            // file doesn't exist — create it
        }
        try {
            await vscode.workspace.fs.writeFile(gitignoreUri, new TextEncoder().encode(GITIGNORE_CONTENT));
            this.logger.info('boardConfig', 'Created .agentkanban/.gitignore');
        } catch (err: any) {
            this.logger.warn('boardConfig', `Failed to create .gitignore: ${err.message}`);
        }
    }

    private async save(): Promise<void> {
        const content = new TextEncoder().encode(stringify(this.config, { lineWidth: 0 }));
        await vscode.workspace.fs.writeFile(this.configUri, content);
    }

    static serialise(config: BoardConfig): string {
        return stringify(config, { lineWidth: 0 });
    }

    static deserialise(text: string): BoardConfig {
        return parse(text) as BoardConfig;
    }
}
