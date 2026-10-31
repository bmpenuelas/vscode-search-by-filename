import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { FileIndex } from '../indexing/FileIndex';
import { fileItem } from '../ui/QuickSearch';
import { IndexWatcher } from '../indexing/IndexWatcher';
import { SearchEngine } from '../search/SearchEngine';
import * as path from 'node:path';

/** Runs in a real Extension Development Host, not the unit-test VS Code adapter. */
export async function run(): Promise<void> {
    const extension = vscode.extensions.getExtension('bmpenuelas.search-by-filename');
    assert.ok(extension); await extension.activate();
    const manifest = extension.packageJSON as { contributes: { views: Record<string, { id: string }[]>; keybindings: { key: string }[] } };
    assert.equal(manifest.contributes.views.searchByFilename?.[0]?.id, 'searchByFilename.sidebar');
    assert.equal(manifest.contributes.keybindings[0]?.key, 'ctrl+alt+p');
    const index = new FileIndex();
    const watcher = new IndexWatcher(index, () => true);
    const engine = new SearchEngine(path.join(extension.extensionPath, 'dist/search/worker.js'), () => index.files.values());
    const updates = index.onDidUpdate(update => engine.update(update.files, update.ids, update.reset));
    const until = async (condition: () => boolean) => {
        const deadline = Date.now() + 10000;
        while (!condition()) { if (Date.now() > deadline) { throw new Error('Timed out waiting for real filesystem watcher'); } await new Promise(resolve => setTimeout(resolve, 50)); }
    };
    try {
        index.ensure(false); await index.whenIdle();
        assert.ok([...index.files.values()].some(file => file.name === 'App.ts' && file.normal));
        assert.ok(![...index.files.values()].some(file => file.name === 'ignored.js'));
        index.ensure(true); await index.whenIdle();
        const ignored = [...index.files.values()].find(file => file.name === 'ignored.js'); assert.ok(ignored);
        const regex = await engine.search('^ignored\\.js$', { ignoreCase: true, useRegex: true, includeIgnored: true }, 200, new AbortController().signal);
        assert.deepEqual(regex.ids, [ignored.id]);
        await vscode.window.showTextDocument(ignored.uri, { preview: true });
        assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), ignored.uri.toString());
        const folder = vscode.workspace.workspaceFolders![0]!;
        const created = vscode.Uri.joinPath(folder.uri, 'watch-created.ts');
        const renamed = vscode.Uri.joinPath(folder.uri, 'watch-renamed.ts');
        await vscode.workspace.fs.writeFile(created, new Uint8Array());
        await until(() => index.files.has(created.toString()));
        await vscode.workspace.fs.rename(created, renamed);
        await until(() => !index.files.has(created.toString()) && index.files.has(renamed.toString()));
        await vscode.workspace.fs.delete(renamed);
        await until(() => !index.files.has(renamed.toString()));
        const item = fileItem(ignored); assert.equal(item.alwaysShow, true);
        const picker = vscode.window.createQuickPick();
        picker.buttons = [{ iconPath: new vscode.ThemeIcon('regex'), location: vscode.QuickInputButtonLocation.Input, toggle: { checked: true } }];
        picker.items = [item]; picker.value = '^ignored\\.js$'; picker.show();
        assert.equal(picker.value, '^ignored\\.js$'); assert.equal(picker.buttons[0]?.toggle?.checked, true);
        picker.hide(); picker.dispose();
        await vscode.commands.executeCommand('searchByFilename.quickSearch');
        await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
        await vscode.commands.executeCommand('searchByFilename.focusSearch');
        await vscode.commands.executeCommand('searchByFilename.refreshIndex');
        console.log('Real VS Code API integration checks passed.');
    } finally { updates.dispose(); watcher.dispose(); engine.dispose(); index.dispose(); }
}
