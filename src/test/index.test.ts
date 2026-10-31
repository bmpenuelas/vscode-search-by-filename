import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { FileIndex } from '../indexing/FileIndex';
import { IndexWatcher } from '../indexing/IndexWatcher';
import { configuration, directoryReads, Uri, workspace, watcherEvents } from './vscodeMock';

async function fixture(): Promise<{ base: string; index: FileIndex; uri: (relative: string) => vscode.Uri; cleanup: () => Promise<void> }> {
    await fs.mkdir(path.resolve('.test-workspaces'), { recursive: true });
    const base = await fs.mkdtemp(path.resolve('.test-workspaces', 'filename-test-'));
    const contents: Record<string, string> = { '.gitignore': 'node_modules/\n*.log\n!important.log\n', '.ignore': 'cache/\n', '.rgignore': 'rg-cache/\n',
        'src/App.ts': '', 'src/app.test.ts': '', 'node_modules/example/ignored.js': '', 'dist/bundle.js': '',
        'nested/.gitignore': 'hidden.txt\n!visible.log', 'nested/visible.log': '', 'nested/hidden.log': '', 'nested/hidden.txt': '',
        '.env': '', 'important.log': '', 'cache/a': '', 'rg-cache/b': '' };
    for (const [relative, text] of Object.entries(contents)) { const target = path.join(base, relative); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, text); }
    for (const key of Object.keys(configuration)) { delete configuration[key]; }
    configuration['search.exclude'] = { '**/dist': true };
    configuration['files.exclude'] = { '**/*.test.ts': true };
    workspace.workspaceFolders = [{ uri: Uri.file(base), name: 'fixture', index: 0 }];
    const index = new FileIndex();
    return { base, index, uri: relative => vscode.Uri.file(path.join(base, relative)), cleanup: async () => { index.dispose(); await fs.rm(base, { recursive: true, force: true }); } };
}
test('normal pruning and lazy expansion really discover dependency, generated and dot files', async () => {
    const f = await fixture();
    try {
        f.index.ensure(false); await f.index.whenIdle();
        const normal = [...f.index.files.values()].filter(file => file.normal).map(file => file.name);
        assert.ok(normal.includes('App.ts')); assert.ok(normal.includes('.env')); assert.ok(normal.includes('important.log')); assert.ok(normal.includes('visible.log'));
        assert.ok(!normal.includes('hidden.log')); assert.ok(!normal.includes('hidden.txt')); assert.ok(!normal.includes('app.test.ts'));
        assert.ok(![...f.index.files.values()].some(file => file.name === 'ignored.js' || file.name === 'bundle.js'));
        const before = directoryReads;
        f.index.ensure(false); await f.index.whenIdle(); assert.equal(directoryReads, before);
        f.index.ensure(true); await f.index.whenIdle();
        assert.ok([...f.index.files.values()].some(file => file.name === 'ignored.js'));
        assert.ok([...f.index.files.values()].some(file => file.name === 'bundle.js'));
        assert.ok([...f.index.files.values()].some(file => file.name === 'b'));
        const expandedReads = directoryReads; f.index.ensure(false); f.index.ensure(true); await f.index.whenIdle(); assert.equal(directoryReads, expandedReads);
    } finally { await f.cleanup(); }
});
test('batched creation, deletion, rename and directory-only events reconcile incrementally', async () => {
    const f = await fixture();
    try {
        f.index.ensure(false); await f.index.whenIdle();
        await fs.writeFile(path.join(f.base, 'src/new.ts'), '');
        await fs.rename(path.join(f.base, 'src/App.ts'), path.join(f.base, 'src/Renamed.ts'));
        f.index.events([f.uri('src/new.ts'), f.uri('src/App.ts'), f.uri('src/Renamed.ts')]); await f.index.whenIdle();
        assert.ok([...f.index.files.values()].some(file => file.name === 'new.ts'));
        assert.ok(![...f.index.files.values()].some(file => file.name === 'App.ts'));
        assert.ok([...f.index.files.values()].some(file => file.name === 'Renamed.ts'));
        await fs.mkdir(path.join(f.base, 'new/deep'), { recursive: true }); await fs.writeFile(path.join(f.base, 'new/deep/inside.ts'), '');
        f.index.events([f.uri('new/deep/inside.ts')]); await f.index.whenIdle();
        assert.ok([...f.index.files.values()].some(file => file.name === 'inside.ts'));
        await fs.rm(path.join(f.base, 'new'), { recursive: true }); f.index.events([f.uri('new')]); await f.index.whenIdle();
        assert.ok(![...f.index.files.values()].some(file => file.name === 'inside.ts'));
        await Promise.all(Array.from({ length: 250 }, (_, i) => fs.writeFile(path.join(f.base, `src/burst${i}.ts`), '')));
        const before = directoryReads;
        f.index.events(Array.from({ length: 250 }, (_, i) => f.uri(`src/burst${i}.ts`))); await f.index.whenIdle();
        assert.equal(directoryReads - before, 1);
        assert.equal([...f.index.files.values()].filter(file => file.name.startsWith('burst')).length, 250);
    } finally { await f.cleanup(); }
});
test('ignore invalidation, useIgnoreFiles, missed watcher events and manual refresh', async () => {
    const f = await fixture();
    try {
        f.index.ensure(true); await f.index.whenIdle();
        await fs.writeFile(path.join(f.base, 'nested/.gitignore'), '!*.log\n!hidden.txt');
        f.index.events([f.uri('nested/.gitignore')]); await f.index.whenIdle();
        assert.ok([...f.index.files.values()].find(file => file.name === 'hidden.txt')?.normal);
        await fs.writeFile(path.join(f.base, 'node_modules/missed.js'), '');
        assert.ok(![...f.index.files.values()].some(file => file.name === 'missed.js'));
        f.index.refresh(true); await f.index.whenIdle(); assert.ok([...f.index.files.values()].some(file => file.name === 'missed.js'));
        configuration['search.useIgnoreFiles'] = false; f.index.refresh(false); await f.index.whenIdle();
        assert.ok([...f.index.files.values()].find(file => file.name === 'ignored.js')?.normal);
    } finally { await f.cleanup(); }
});
test('file/directory replacements and conditional sibling excludes stay consistent', async () => {
    const f = await fixture();
    try {
        configuration['files.exclude'] = { '**/*.js': { when: '$(basename).ts' } };
        await fs.writeFile(path.join(f.base, 'src/pair.js'), '');
        f.index.ensure(false); await f.index.whenIdle();
        assert.ok([...f.index.files.values()].find(file => file.name === 'pair.js')?.normal);
        await fs.writeFile(path.join(f.base, 'src/pair.ts'), '');
        f.index.events([f.uri('src/pair.ts')]); await f.index.whenIdle();
        assert.equal([...f.index.files.values()].find(file => file.name === 'pair.js')?.normal, false);
        await fs.rm(path.join(f.base, 'src/pair.ts')); await fs.mkdir(path.join(f.base, 'src/pair.ts'));
        await fs.writeFile(path.join(f.base, 'src/pair.ts/inside.txt'), '');
        f.index.events([f.uri('src/pair.ts')]); await f.index.whenIdle();
        assert.ok(![...f.index.files.values()].some(file => file.name === 'pair.ts'));
        assert.ok([...f.index.files.values()].some(file => file.name === 'inside.txt'));
        await fs.rm(path.join(f.base, 'src/pair.ts'), { recursive: true }); await fs.writeFile(path.join(f.base, 'src/pair.ts'), '');
        f.index.events([f.uri('src/pair.ts')]); await f.index.whenIdle();
        assert.ok([...f.index.files.values()].some(file => file.name === 'pair.ts'));
        assert.ok(![...f.index.files.values()].some(file => file.name === 'inside.txt'));
    } finally { await f.cleanup(); }
});
test('multi-root and non-file URIs retain distinct identities', async () => {
    const f = await fixture();
    const second = await fs.mkdtemp(path.resolve('.test-workspaces', 'filename-second-'));
    try {
        await fs.writeFile(path.join(second, 'App.ts'), '');
        const remote = new Uri('test-remote', Uri.file(second).path, 'host');
        workspace.workspaceFolders.push({ uri: remote, name: 'remote', index: 1 });
        f.index.ensure(false); await f.index.whenIdle();
        const apps = [...f.index.files.values()].filter(file => file.name === 'App.ts');
        assert.equal(apps.length, 2); assert.equal(new Set(apps.map(file => file.id)).size, 2);
        assert.ok(apps.some(file => file.uri.scheme === 'test-remote' && file.relativePath === 'remote/App.ts'));
        workspace.workspaceFolders.pop(); f.index.refresh(false); await f.index.whenIdle(); assert.equal([...f.index.files.values()].filter(file => file.name === 'App.ts').length, 1);
    } finally { await f.cleanup(); await fs.rm(second, { recursive: true, force: true }); }
});
test('file limit is explicit and preserves completed work; symlinks are not followed', async () => {
    const f = await fixture();
    try {
        configuration['searchByFilename.maxIndexedFiles'] = 3;
        f.index.ensure(true); await f.index.whenIdle(); assert.equal(f.index.files.size, 3); assert.equal(f.index.limited, true); assert.match(f.index.status, /INCOMPLETE/);
        configuration['searchByFilename.maxIndexedFiles'] = 500000;
        try { await fs.symlink(path.join(f.base, 'src'), path.join(f.base, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EPERM') { throw error; } }
        f.index.refresh(true); await f.index.whenIdle(); assert.equal(f.index.limited, false);
        assert.ok(![...f.index.files.values()].some(file => file.relativePath.startsWith('linked/')));
    } finally { await f.cleanup(); }
});
test('unreadable directories report incomplete indexing and watcher bursts are coalesced', async () => {
    const f = await fixture();
    const original = workspace.fs.readDirectory;
    try {
        workspace.fs.readDirectory = async uri => { if (uri.path.endsWith('/src')) { throw new Error('permission denied'); } return original(uri); };
        f.index.ensure(false); await f.index.whenIdle(); assert.ok(f.index.errors > 0); assert.match(f.index.status, /INCOMPLETE/);
        workspace.fs.readDirectory = original; f.index.refresh(false); await f.index.whenIdle();
        const watcher = new IndexWatcher(f.index, () => false);
        try {
            await fs.writeFile(path.join(f.base, 'src/watch.ts'), ''); const before = directoryReads;
            for (let i = 0; i < 100; i++) { watcherEvents.create.fire(Uri.file(path.join(f.base, 'src/watch.ts'))); }
            await new Promise(resolve => setTimeout(resolve, 200)); await f.index.whenIdle();
            assert.equal(directoryReads - before, 1); assert.ok([...f.index.files.values()].some(file => file.name === 'watch.ts'));
        } finally { watcher.dispose(); }
    } finally { workspace.fs.readDirectory = original; await f.cleanup(); }
});
