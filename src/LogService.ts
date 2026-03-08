import * as fs from 'fs';
import * as path from 'path';

// ── Types ──────────────────────────────────────────────────────────────────

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

// ── Constants ──────────────────────────────────────────────────────────────

/** Default maximum size of a single log file (10 MB). */
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Default maximum number of rolled log files to keep. */
const DEFAULT_MAX_FILES = 5;

/** Base filename for log output. */
const LOG_FILENAME = 'agent-kanban.log';

// ── LogService ─────────────────────────────────────────────────────────────

/**
 * Pure Node.js rolling file logger.
 *
 * Writes timestamped log lines to `<logDir>/agent-kanban.log`.
 * When the file exceeds `maxFileSize`, older files are rotated:
 *   agent-kanban.log → agent-kanban.1.log → ... → agent-kanban.{maxFiles-1}.log
 * The oldest file beyond `maxFiles` is deleted.
 *
 * No VS Code dependency — safe for unit testing and reuse.
 *
 * Activation: pass `enabled: true` via the constructor options.
 * When disabled all methods are no-ops with negligible overhead.
 */
export class LogService {
    private readonly logDir: string;
    private readonly maxFileSize: number;
    private readonly maxFiles: number;
    private readonly enabled: boolean;
    private readonly logFilePath: string;

    constructor(
        logDir: string,
        options?: {
            enabled?: boolean;
            maxFileSize?: number;
            maxFiles?: number;
        },
    ) {
        this.logDir = logDir;
        this.enabled = options?.enabled ?? false;
        this.maxFileSize = options?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
        this.maxFiles = options?.maxFiles ?? DEFAULT_MAX_FILES;
        this.logFilePath = path.join(this.logDir, LOG_FILENAME);

        if (this.enabled && !fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    // ── Public API ─────────────────────────────────────────────────────────

    get isEnabled(): boolean {
        return this.enabled;
    }

    info(tag: string, message: string): void {
        this.write('INFO', tag, message);
    }

    warn(tag: string, message: string): void {
        this.write('WARN', tag, message);
    }

    error(tag: string, message: string): void {
        this.write('ERROR', tag, message);
    }

    /**
     * Start a timer. Returns a function that, when called, logs the elapsed
     * milliseconds at INFO level.
     */
    time(tag: string, label: string): () => void {
        if (!this.enabled) { return () => { /* no-op */ }; }
        const start = performance.now();
        return () => {
            const elapsed = (performance.now() - start).toFixed(2);
            this.info(tag, `${label}: ${elapsed}ms`);
        };
    }

    // ── Internals ──────────────────────────────────────────────────────────

    private write(level: LogLevel, tag: string, message: string): void {
        if (!this.enabled) { return; }

        const timestamp = new Date().toISOString();
        const line = `[${timestamp}] [${level}] ${tag}: ${message}\n`;

        try {
            this.rotateIfNeeded();
            fs.appendFileSync(this.logFilePath, line, 'utf-8');
        } catch {
            // Logging must never crash the host — swallow all I/O errors.
        }
    }

    private rotateIfNeeded(): void {
        if (!fs.existsSync(this.logFilePath)) { return; }

        let stat: fs.Stats;
        try { stat = fs.statSync(this.logFilePath); } catch { return; }
        if (stat.size < this.maxFileSize) { return; }

        const oldest = this.rolledPath(this.maxFiles - 1);
        if (fs.existsSync(oldest)) {
            fs.unlinkSync(oldest);
        }

        for (let i = this.maxFiles - 2; i >= 1; i--) {
            const src = this.rolledPath(i);
            const dst = this.rolledPath(i + 1);
            if (fs.existsSync(src)) {
                fs.renameSync(src, dst);
            }
        }

        fs.renameSync(this.logFilePath, this.rolledPath(1));
    }

    private rolledPath(n: number): string {
        const ext = path.extname(LOG_FILENAME);
        const base = LOG_FILENAME.slice(0, -ext.length);
        return path.join(this.logDir, `${base}.${n}${ext}`);
    }
}

export const NO_OP_LOGGER = new LogService('', { enabled: false });
