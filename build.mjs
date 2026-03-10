import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync, watch } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const postcss = require('postcss');
const tailwindcss = require('@tailwindcss/postcss');

const isWatch = process.argv.includes('--watch');

mkdirSync(resolve(__dirname, 'dist'), { recursive: true });
mkdirSync(resolve(__dirname, 'dist', 'webview'), { recursive: true });

/** @type {import('esbuild').BuildOptions} */
const extensionBuildOptions = {
    entryPoints: ['./src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    sourcemap: true,
};

/** @type {import('esbuild').BuildOptions} */
const webviewBuildOptions = {
    entryPoints: ['./src/webview/board.ts'],
    bundle: true,
    outfile: 'dist/webview/board.js',
    format: 'iife',
    platform: 'browser',
    sourcemap: true,
    target: ['es2022'],
};

async function buildCss() {
    const input = readFileSync('./src/webview/board.css', 'utf8');
    const result = await postcss([
        tailwindcss,
    ]).process(input, { from: './src/webview/board.css', to: './dist/webview/board.css' });
    writeFileSync('./dist/webview/board.css', result.css);
    if (result.map) {
        writeFileSync('./dist/webview/board.css.map', result.map.toString());
    }
}

if (isWatch) {
    await buildCss();
    console.log('CSS built.');

    // Re-build CSS when webview source files change
    watch('./src/webview', { recursive: true }, async (_event, filename) => {
        if (filename?.endsWith('.css')) {
            try {
                await buildCss();
                console.log('CSS rebuilt.');
            } catch (err) {
                console.error('CSS build error:', err.message);
            }
        }
    });

    const extCtx = await esbuild.context(extensionBuildOptions);
    const webCtx = await esbuild.context(webviewBuildOptions);
    await extCtx.watch();
    await webCtx.watch();
    console.log('Watching for changes...');
} else {
    await buildCss();
    await esbuild.build(extensionBuildOptions);
    await esbuild.build(webviewBuildOptions);
    console.log('Build complete.');
}

