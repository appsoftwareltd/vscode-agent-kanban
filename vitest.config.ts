import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            vscode: path.resolve(__dirname, 'src/test/__mocks__/vscode.ts'),
        },
    },
    test: {
        globals: true,
        environment: 'node',
        include: ['src/test/**/*.test.ts'],
    },
});
