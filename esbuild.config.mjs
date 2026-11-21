import esbuild from "esbuild";
import process from "process";
import builtins from 'builtin-modules';
import fs from 'fs';

const banner =
    `/*
Workspace Assistant is distributed under GPL-3.0-only.
See LICENSE, THIRD_PARTY_NOTICES.md and the source archive in the matching release:
https://github.com/RandyAllenEEE/obsidian-workspace-assistant/releases
*/
`;

const prod = (process.argv[2] === 'production');

const context = await esbuild.context({
    banner: {
        js: banner,
    },
    entryPoints: ['src/main.ts'],
    bundle: true,
    external: [
        'obsidian',
        'electron',
        '@codemirror/autocomplete',
        '@codemirror/collab',
        '@codemirror/commands',
        '@codemirror/language',
        '@codemirror/lint',
        '@codemirror/search',
        '@codemirror/state',
        '@codemirror/view',
        '@lezer/common',
        '@lezer/highlight',
        '@lezer/lr',
        ...builtins],
    format: 'cjs',
    target: 'es2018',
    logLevel: 'info',
    sourcemap: prod ? false : 'inline',
    treeShaking: true,
    outfile: 'build/main.js',
});

const copyFiles = () => {
    try {
        if (!fs.existsSync('build')) fs.mkdirSync('build');
        fs.copyFileSync('manifest.json', 'build/manifest.json');
        if (fs.existsSync('styles.css')) {
            fs.copyFileSync('styles.css', 'build/styles.css');
        }
        if (fs.existsSync('versions.json')) {
            fs.copyFileSync('versions.json', 'build/versions.json');
        }
        console.log('Copied static files to build/');
    } catch (e) {
        console.error('Failed to copy files:', e);
    }
}

if (prod) {
    await context.rebuild();
    copyFiles();
    process.exit(0);
} else {
    copyFiles();
    await context.watch();
}
