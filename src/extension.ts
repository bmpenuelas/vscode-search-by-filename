import * as vscode from 'vscode';
import * as path from 'node:path';
import { FileIndex } from './indexing/FileIndex';
import { IndexWatcher } from './indexing/IndexWatcher';
import { SearchEngine } from './search/SearchEngine';
import { SettingsManager } from './settings/SettingsManager';
import { QuickSearch } from './ui/QuickSearch';
import { SidebarProvider } from './ui/SidebarProvider';

export function activate(context: vscode.ExtensionContext): void {
    const settings = new SettingsManager(context.workspaceState);
    const index = new FileIndex();
    const engine = new SearchEngine(path.join(context.extensionPath, 'dist', 'search', 'worker.js'), () => index.files.values());
    const services = { settings, index, engine };
    const quick = new QuickSearch(services);
    const sidebar = new SidebarProvider(context.extensionUri, services);
    context.subscriptions.push(settings, index, engine, quick, sidebar,
        index.onDidUpdate(update => engine.update(update.files, update.ids, update.reset)),
        new IndexWatcher(index, () => settings.options.includeIgnored),
        vscode.window.registerWebviewViewProvider('searchByFilename.sidebar', sidebar),
        vscode.commands.registerCommand('searchByFilename.quickSearch', () => quick.show()),
        vscode.commands.registerCommand('searchByFilename.focusSearch', () => sidebar.focus()),
        vscode.commands.registerCommand('searchByFilename.refreshIndex', () => index.refresh(settings.options.includeIgnored)));
}
