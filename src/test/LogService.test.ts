import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LogService, NO_OP_LOGGER } from '../LogService';

describe('LogService', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logservice-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('disabled (no-op)', () => {
        it('should not create log directory when disabled', () => {
            const logDir = path.join(tmpDir, 'logs');
            const logger = new LogService(logDir, { enabled: false });

            logger.info('test', 'hello');

            expect(fs.existsSync(logDir)).toBe(false);
            expect(logger.isEnabled).toBe(false);
        });

        it('should be disabled by default when no options are provided', () => {
            const logDir = path.join(tmpDir, 'logs');
            const logger = new LogService(logDir);

            logger.info('test', 'hello');

            expect(logger.isEnabled).toBe(false);
            expect(fs.existsSync(logDir)).toBe(false);
        });

        it('should be disabled by default when empty options object is provided', () => {
            const logDir = path.join(tmpDir, 'logs');
            const logger = new LogService(logDir, {});

            logger.info('test', 'hello');

            expect(logger.isEnabled).toBe(false);
            expect(fs.existsSync(logDir)).toBe(false);
        });

        it('NO_OP_LOGGER should be disabled', () => {
            expect(NO_OP_LOGGER.isEnabled).toBe(false);
        });
    });

    describe('enabled', () => {
        it('should create log directory on construction', () => {
            const logDir = path.join(tmpDir, 'logs');
            const logger = new LogService(logDir, { enabled: true });

            expect(fs.existsSync(logDir)).toBe(true);
            expect(logger.isEnabled).toBe(true);
        });

        it('should write log lines with correct format', () => {
            const logDir = path.join(tmpDir, 'logs');
            const logger = new LogService(logDir, { enabled: true });

            logger.info('taskStore', 'Loaded 5 tasks');
            logger.warn('copilot', 'No model available');
            logger.error('extension', 'Something failed');

            const logFile = path.join(logDir, 'agent-kanban.log');
            const content = fs.readFileSync(logFile, 'utf-8');
            const lines = content.trim().split('\n');

            expect(lines).toHaveLength(3);
            expect(lines[0]).toMatch(/^\[.+\] \[INFO\] taskStore: Loaded 5 tasks$/);
            expect(lines[1]).toMatch(/^\[.+\] \[WARN\] copilot: No model available$/);
            expect(lines[2]).toMatch(/^\[.+\] \[ERROR\] extension: Something failed$/);
        });

        it('should include ISO 8601 timestamps', () => {
            const logDir = path.join(tmpDir, 'logs');
            const logger = new LogService(logDir, { enabled: true });

            logger.info('test', 'timestamp check');

            const logFile = path.join(logDir, 'agent-kanban.log');
            const content = fs.readFileSync(logFile, 'utf-8');
            // Match ISO 8601: [2026-03-08T14:30:45.123Z]
            expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
        });
    });

    describe('time helper', () => {
        it('should log elapsed time when enabled', () => {
            const logDir = path.join(tmpDir, 'logs');
            const logger = new LogService(logDir, { enabled: true });

            const done = logger.time('test', 'operation');
            done();

            const logFile = path.join(logDir, 'agent-kanban.log');
            const content = fs.readFileSync(logFile, 'utf-8');
            expect(content).toMatch(/\[INFO\] test: operation: \d+\.\d+ms/);
        });

        it('should return no-op when disabled', () => {
            const done = NO_OP_LOGGER.time('test', 'operation');
            // Should not throw
            done();
        });
    });

    describe('rotation', () => {
        it('should rotate when file exceeds max size', () => {
            const logDir = path.join(tmpDir, 'logs');
            const logger = new LogService(logDir, {
                enabled: true,
                maxFileSize: 100, // 100 bytes to trigger rotation quickly
                maxFiles: 3,
            });

            // Write enough to exceed 100 bytes
            for (let i = 0; i < 5; i++) {
                logger.info('test', `Message number ${i} with enough content to fill the log`);
            }

            const files = fs.readdirSync(logDir).sort();
            // Should have at least the main file and some rolled files
            expect(files.some(f => f === 'agent-kanban.log')).toBe(true);
            expect(files.some(f => f.match(/^agent-kanban\.\d+\.log$/))).toBe(true);
        });

        it('should not keep more than maxFiles rolled files', () => {
            const logDir = path.join(tmpDir, 'logs');
            const logger = new LogService(logDir, {
                enabled: true,
                maxFileSize: 50, // Very small to force many rotations
                maxFiles: 2,
            });

            for (let i = 0; i < 20; i++) {
                logger.info('test', `Message ${i} padding padding padding padding`);
            }

            const files = fs.readdirSync(logDir);
            const rolledFiles = files.filter(f => /^agent-kanban\.\d+\.log$/.test(f));
            // maxFiles=2 means at most file .1.log (the main file + 1 rolled = 2 total)
            expect(rolledFiles.length).toBeLessThanOrEqual(1);
        });
    });
});
