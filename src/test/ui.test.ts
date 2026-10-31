import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { configuration, configChanges, pickers, opened, Uri, workspace, EventEmitter } from './vscodeMock';
import { SettingsManager } from '../settings/SettingsManager';
import { QuickSearch } from '../ui/QuickSearch';
import { SearchSession, Services } from '../ui/SearchSession';
import { SearchEngine } from '../search/SearchEngine';
import { FileIndex, IndexedFile } from '../indexing/FileIndex';
import { SearchResult } from '../search/SearchTypes';
import { SidebarProvider } from '../ui/SidebarProvider';
import { readFile } from 'node:fs/promises';

class State {
    values = new Map<string, unknown>();
    get<T>(key: string, fallback?: T): T { return (this.values.get(key) ?? fallback) as T; }
    async update(key: string, value: unknown): Promise<void> { this.values.set(key, value); }
    keys(): readonly string[] { return [...this.values.keys()]; }
}
function setup(): { services: Services; state: State; cleanup: () => void } {
    for (const key of Object.keys(configuration)) { delete configuration[key]; }
    workspace.workspaceFolders = [];
    const state = new State(), settings = new SettingsManager(state);
    const index = new FileIndex(); index.ensure(false);
    const engine = new SearchEngine(path.resolve('dist/search/worker.js'), () => index.files.values());
    return { services: { settings, index, engine }, state, cleanup: () => { settings.dispose(); index.dispose(); engine.dispose(); } };
}
async function until(condition: () => boolean): Promise<void> {
    const deadline = Date.now() + 5000;
    while (!condition()) { if (Date.now() > deadline) { throw new Error('Timed out waiting for UI state'); } await new Promise(resolve => setTimeout(resolve, 10)); }
}
test('shared workspace options persist; explicit configuration wins when reloaded', () => {
    const { services, state, cleanup } = setup();
    try {
        assert.deepEqual(services.settings.options, { ignoreCase: true, useRegex: false, includeIgnored: false });
        services.settings.toggle('includeIgnored'); services.settings.toggle('ignoreCase');
        const next = new SettingsManager(state);
        assert.equal(next.options.includeIgnored, true); assert.equal(next.options.ignoreCase, false);
        configuration['searchByFilename.ignoreCase'] = true;
        configChanges.fire({ affectsConfiguration: key => key === 'searchByFilename.ignoreCase' });
        assert.equal(next.options.ignoreCase, true); next.dispose();
    } finally { cleanup(); }
});
test('QuickPick uses three inline toggles, retains query, bypasses fuzzy filtering, opens indexed resources, disposes', async () => {
    const { services, cleanup } = setup();
    const quick = new QuickSearch(services);
    try {
        await services.index.whenIdle();
        const uri = vscode.Uri.file(path.resolve('App.ts'));
        const file: IndexedFile = { uri, id: uri.toString(), root: '', name: 'App.ts', lowerName: 'app.ts', relativePath: 'src/App.ts', normal: true };
        services.index.files.set(file.id, file);
        quick.show(); const picker = pickers[pickers.length - 1]!;
        assert.equal(picker.buttons.length, 3); assert.ok(picker.buttons.every(button => button.location === 3));
        picker.value = '^app\\.ts$'; picker.values.fire(picker.value);
        picker.triggers.fire(picker.buttons[1]);
        await until(() => !picker.busy && picker.items.length === 1);
        assert.equal(picker.value, '^app\\.ts$'); assert.equal(picker.items[0]?.alwaysShow, true);
        assert.equal(picker.buttons[1]?.toggle.checked, true);
        // External/sidebar state changes update this already-open picker.
        services.settings.toggle('ignoreCase');
        await until(() => !picker.busy && picker.items.length === 0);
        assert.equal(picker.value, '^app\\.ts$'); assert.equal(picker.buttons[0]?.toggle.checked, false);
        picker.value = '['; picker.values.fire(picker.value);
        await until(() => !picker.busy); assert.equal(picker.items.length, 0); assert.match(picker.title, /regular expression/i);
        picker.value = 'App'; picker.values.fire(picker.value);
        await until(() => !picker.busy && picker.items.length === 1);
        picker.selectedItems = [picker.items[0]!]; picker.accepts.fire();
        await until(() => picker.disposed);
        assert.equal(opened.at(-1)?.toString(), uri.toString());
        quick.show(); assert.notEqual(pickers.at(-1), picker); quick.dispose(); assert.ok(pickers.at(-1)?.disposed);
    } finally { quick.dispose(); cleanup(); }
});
test('out-of-order results and disposed sessions never overwrite current results', async () => {
    const { services, cleanup } = setup();
    const pending: { query: string; signal: AbortSignal; finish: (result: SearchResult) => void }[] = [];
    services.engine.search = (query, _options, _limit, signal) => new Promise(resolve => pending.push({ query, signal, finish: resolve }));
    const rendered: number[] = [];
    const session = new SearchSession(services, result => rendered.push(result.total), () => undefined);
    try {
        session.schedule('a'); await until(() => pending.length >= 1);
        const first = pending.at(-1)!;
        session.schedule('ab'); await until(() => pending.length >= 2);
        const second = pending.at(-1)!;
        second.finish({ ids: [], total: 2 }); await new Promise(resolve => setImmediate(resolve));
        first.finish({ ids: [], total: 1 }); await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(rendered, [2]); assert.equal(first.signal.aborted, true);
        session.schedule('abc'); await until(() => pending.length >= 3); session.dispose();
        pending.at(-1)!.finish({ ids: [], total: 3 }); await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(rendered, [2]);
    } finally { session.dispose(); cleanup(); }
});
test('opaque-result opening rejects stale/unindexed objects', async () => {
    const { services, cleanup } = setup();
    try {
        const { openFile } = await import('../ui/SearchSession');
        const before = opened.length;
        await openFile({ uri: Uri.file(path.resolve('not-indexed')) } as unknown as IndexedFile, services.index);
        assert.equal(opened.length, before);
    } finally { cleanup(); }
});
test('sidebar validates messages, uses opaque IDs/CSP, shares options, and releases hidden sessions', async () => {
    const { services, cleanup } = setup();
    const sidebar = new SidebarProvider(vscode.Uri.file(process.cwd()), services);
    const incoming = new EventEmitter<unknown>(), visibility = new EventEmitter<void>(), disposal = new EventEmitter<void>();
    const messages: Record<string, unknown>[] = [];
    const webview = { html: '', options: {}, cspSource: 'test-resource:', asWebviewUri: (uri: vscode.Uri) => uri,
        postMessage: async (message: Record<string, unknown>) => { messages.push(message); return true; }, onDidReceiveMessage: incoming.event };
    const view = { webview, visible: true, show() {}, onDidChangeVisibility: visibility.event, onDidDispose: disposal.event };
    try {
        await services.index.whenIdle();
        const uri = vscode.Uri.file(path.resolve('safe.ts'));
        const file: IndexedFile = { uri, id: uri.toString(), root: '', name: '<img onerror=alert(1)>.ts', lowerName: '<img onerror=alert(1)>.ts', relativePath: 'src/safe.ts', normal: true };
        services.index.files.set(file.id, file);
        sidebar.resolveWebviewView(view as unknown as vscode.WebviewView);
        assert.match(webview.html, /default-src 'none'/); assert.match(webview.html, /script-src 'nonce-/); assert.ok(!webview.html.includes('onerror'));
        incoming.fire({ type: 'ready' });
        await until(() => messages.some(message => message.type === 'results'));
        const result = messages.filter(message => message.type === 'results').at(-1)!;
        const entries = result.entries as { id: string; name: string }[];
        assert.equal(entries.length, 1); assert.equal(entries[0]?.name, file.name);
        assert.notEqual(entries[0]?.id, uri.toString());
        const before = opened.length;
        for (const invalid of [null, 'open', { type: 'open', id: 'file:///arbitrary' }, { type: 'toggle', key: '__proto__' }, { type: 'query', value: 'x'.repeat(513) }]) { incoming.fire(invalid); }
        await new Promise(resolve => setImmediate(resolve)); assert.equal(opened.length, before);
        incoming.fire({ type: 'open', id: entries[0]!.id }); await until(() => opened.length > before);
        incoming.fire({ type: 'toggle', key: 'useRegex' }); assert.equal(services.settings.options.useRegex, true);
        incoming.fire({ type: 'query', value: '[' });
        await until(() => messages.some(message => message.type === 'results' && message.error));
        assert.deepEqual(messages.filter(message => message.type === 'results').at(-1)?.entries, []);
        view.visible = false; visibility.fire(); const count = messages.length;
        services.settings.toggle('ignoreCase'); await new Promise(resolve => setTimeout(resolve, 80)); assert.equal(messages.length, count);
        disposal.fire();
        const browserSource = await readFile(path.resolve('media/sidebar.js'), 'utf8');
        assert.ok(browserSource.includes('textContent')); assert.ok(!browserSource.includes('innerHTML'));
    } finally { sidebar.dispose(); cleanup(); }
});
