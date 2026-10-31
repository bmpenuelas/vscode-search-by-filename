import * as vscode from 'vscode';
import { FileIndex } from './FileIndex';
export class IndexWatcher implements vscode.Disposable {
    private watchers: vscode.Disposable[] = [];
    private readonly listeners: vscode.Disposable[] = [];
    private pending = new Map<string, vscode.Uri>();
    private timer?: NodeJS.Timeout;
    constructor(private readonly index: FileIndex, private readonly expanded: () => boolean) {
        this.reset();
        this.listeners.push(vscode.workspace.onDidChangeWorkspaceFolders(() => { this.reset(); index.refresh(expanded()); }),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (['files.exclude', 'search.exclude', 'search.useIgnoreFiles', 'searchByFilename.maxIndexedFiles'].some(key => event.affectsConfiguration(key))) { index.refresh(expanded()); }
            }));
    }
    private reset(): void {
        this.watchers.forEach(watcher => watcher.dispose()); this.watchers = [];
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '**/*'));
            const add = (uri: vscode.Uri) => {
                this.pending.set(uri.toString(), uri);
                if (this.timer) { return; }
                this.timer = setTimeout(() => { this.timer = undefined; const uris = [...this.pending.values()]; this.pending.clear(); this.index.events(uris); }, 150);
            };
            this.watchers.push(watcher, watcher.onDidCreate(add), watcher.onDidDelete(add), watcher.onDidChange(add));
        }
    }
    dispose(): void { if (this.timer) { clearTimeout(this.timer); } this.pending.clear(); [...this.watchers, ...this.listeners].forEach(item => item.dispose()); }
}
