import * as vscode from 'vscode';
import { parse, stringify } from 'yaml';
import type { BoardConfig } from './types';
import { DEFAULT_BOARD_CONFIG } from './types';
import type { LogService } from './LogService';
import { NO_OP_LOGGER } from './LogService';

const CONFIG_PATH = '.agentkanban/board.yaml';

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

    async init(): Promise<void> {
        try {
            await vscode.workspace.fs.createDirectory(
                vscode.Uri.joinPath(this.workspaceUri, '.agentkanban'),
            );
        } catch {
            // directory may already exist
        }

        try {
            const content = await vscode.workspace.fs.readFile(this.configUri);
            const text = new TextDecoder().decode(content);
            const loaded = parse(text) as BoardConfig;
            if (loaded?.lanes) {
                this.config = loaded;
                this.logger.info('boardConfig', `Loaded config with ${loaded.lanes.length} lanes`);
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
        if (config.basePrompt !== undefined) {
            this.config.basePrompt = config.basePrompt;
        }
        await this.save();
        this.logger.info('boardConfig', 'Board config updated');
        this._onDidChange.fire();
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
