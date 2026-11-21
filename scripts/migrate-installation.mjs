import { cpSync, copyFileSync, lstatSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const oldId = 'obsidian-assistant';
const newId = 'obsidian-workspace-assistant';
const releaseFiles = ['main.js', 'manifest.json', 'styles.css'];

function migrateId(value) {
    if (value === oldId || value.startsWith(oldId + ':')) {
        return newId + value.slice(oldId.length);
    }
    if (/^plugin-obsidian-assistant(?:-MiniSettings-statusbar-button)?;[0-9]+$/.test(value)) {
        return value.replace(oldId, newId);
    }
    return value;
}

function migrateValue(value, file) {
    if (typeof value === 'string') return migrateId(value);
    if (Array.isArray(value)) return value.map(item => migrateValue(item, file));
    if (!value || typeof value !== 'object') return value;

    const entries = new Map();
    for (const [key, item] of Object.entries(value)) {
        const newKey = migrateId(key);
        const migrated = migrateValue(item, file);
        if (entries.has(newKey) && JSON.stringify(entries.get(newKey)) !== JSON.stringify(migrated)) {
            throw new Error('Conflicting entries in ' + file + ' for ' + newKey);
        }
        entries.set(newKey, migrated);
    }
    return Object.fromEntries(entries);
}

function readChange(file, deduplicate = false) {
    const stats = lstatSync(file, { throwIfNoEntry: false });
    if (!stats) return undefined;
    if (!stats.isFile()) throw new Error('Expected a regular configuration file: ' + file);
    const original = readFileSync(file, 'utf8');
    const value = JSON.parse(original);
    if (deduplicate && !Array.isArray(value)) throw new Error('Expected an enabled-plugin list: ' + file);
    const migrated = migrateValue(value, file);
    if (JSON.stringify(value) === JSON.stringify(migrated)) return undefined;
    const indent = original.match(/\n([ \t]+)/)?.[1] ?? '';
    const lineEnding = original.includes('\r\n') ? '\r\n' : '\n';
    const ending = original.endsWith('\n') ? lineEnding : '';
    const updated = JSON.stringify(deduplicate ? [...new Set(migrated)] : migrated, null, indent);
    return { file, updated: updated.replaceAll('\n', lineEnding) + ending };
}

function verifyRelease(directory) {
    const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
    if (manifest.id !== newId || manifest.name !== 'Workspace Assistant') {
        throw new Error('Use the release attachments for ' + newId);
    }
    for (const file of releaseFiles) {
        const stats = lstatSync(join(directory, file));
        if (!stats.isFile() || stats.size === 0) throw new Error('Invalid release attachment: ' + file);
    }
}

function applyMigration(config, oldDirectory, newDirectory, release, changes, settings) {
    const backup = mkdtempSync(join(dirname(dirname(config)), 'workspace-assistant-backup-'));
    const savedOldDirectory = join(backup, oldId);
    const staged = join(backup, 'staged');
    console.log('Backup directory: ' + backup);

    cpSync(oldDirectory, staged, { recursive: true });
    for (const file of releaseFiles) {
        const target = join(staged, file);
        const stats = lstatSync(target, { throwIfNoEntry: false });
        if (stats && !stats.isFile()) {
            throw new Error('Expected a regular plugin attachment: ' + target);
        }
        copyFileSync(join(release, file), target);
    }
    if (settings) writeFileSync(join(staged, 'data.json'), settings.updated);
    for (const change of changes) {
        copyFileSync(change.file, join(backup, change.name));
        writeFileSync(join(backup, 'updated-' + change.name), change.updated);
    }

    const changed = [];
    let installed = false;
    renameSync(oldDirectory, savedOldDirectory);
    try {
        renameSync(staged, newDirectory);
        installed = true;
        for (const change of changes) {
            renameSync(join(backup, 'updated-' + change.name), change.file);
            changed.push(change);
        }
    } catch (error) {
        try {
            if (installed) renameSync(newDirectory, staged);
            renameSync(savedOldDirectory, oldDirectory);
        } finally {
            for (const change of changed.reverse()) copyFileSync(join(backup, change.name), change.file);
        }
        throw error;
    }
}

function main([configPath, releasePath, mode, ...extra]) {
    if (!configPath || !releasePath || (mode && mode !== '--apply') || extra.length) {
        throw new Error('Usage: node scripts/migrate-installation.mjs <config directory> <release directory> [--apply]');
    }

    const config = realpathSync(resolve(configPath));
    const release = realpathSync(resolve(releasePath));
    const oldDirectory = join(config, 'plugins', oldId);
    const newDirectory = join(config, 'plugins', newId);
    if (lstatSync(newDirectory, { throwIfNoEntry: false })) {
        throw new Error('The destination plugin directory already exists: ' + newDirectory);
    }
    if (dirname(realpathSync(oldDirectory)) !== join(config, 'plugins') || !lstatSync(oldDirectory).isDirectory()) {
        throw new Error('Expected an installed plugin directory inside the vault configuration');
    }
    if (JSON.parse(readFileSync(join(oldDirectory, 'manifest.json'), 'utf8')).id !== oldId) {
        throw new Error('The installed manifest does not match ' + oldId);
    }
    verifyRelease(release);

    const names = ['community-plugins.json', 'hotkeys.json', 'workspace.json', 'workspace-mobile.json'];
    const changes = names.flatMap(name => {
        const change = readChange(join(config, name), name === 'community-plugins.json');
        return change ? [{ ...change, name }] : [];
    });
    const settings = readChange(join(oldDirectory, 'data.json'));
    console.log(oldId + ' -> ' + newId);
    for (const change of changes) console.log(change.name);
    if (settings) console.log('plugins/' + newId + '/data.json');
    if (mode === '--apply') {
        applyMigration(config, oldDirectory, newDirectory, release, changes, settings);
        console.log('Migration complete.');
    } else {
        console.log('Dry run. Close Obsidian before rerunning with --apply.');
    }
}

try {
    main(process.argv.slice(2));
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
