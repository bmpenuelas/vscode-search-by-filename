import * as vscode from 'vscode';
import { FileIndex, IndexedFile } from '../indexing/FileIndex';
import { SearchEngine } from '../search/SearchEngine';
import { SearchResult } from '../search/SearchTypes';
import { SettingsManager } from '../settings/SettingsManager';

export interface Services { index: FileIndex; engine: SearchEngine; settings: SettingsManager }
export class SearchSession implements vscode.Disposable {
    query = '';
    limit = vscode.workspace.getConfiguration('searchByFilename').get('maxResults', 200);
    private generation = 0;
    private timer?: NodeJS.Timeout;
    private controller?: AbortController;
    private readonly listeners: vscode.Disposable[];
    constructor(readonly services: Services, private readonly render: (result: SearchResult, files: IndexedFile[]) => void,
        private readonly busy: () => void) {
        this.listeners = [services.index.onDidChange(() => this.schedule()), services.settings.onDidChange(() => this.schedule()),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('searchByFilename.maxResults')) {
                    this.limit = vscode.workspace.getConfiguration('searchByFilename').get('maxResults', 200); this.schedule();
                }
            })];
    }
    schedule(query = this.query): void {
        this.query = query;
        const generation = ++this.generation;
        if (this.timer) { clearTimeout(this.timer); }
        this.controller?.abort(); this.controller = undefined;
        this.services.index.ensure(this.services.settings.options.includeIgnored);
        this.busy();
        this.timer = setTimeout(() => {
            this.timer = undefined;
            const controller = new AbortController(); this.controller = controller;
            void this.services.engine.search(this.query, this.services.settings.options, this.limit, controller.signal).then(result => {
                if (generation !== this.generation || controller.signal.aborted) { return; }
                this.controller = undefined;
                const files = result.ids.map(id => this.services.index.files.get(id)).filter((file): file is IndexedFile => !!file);
                this.render(result, files);
            });
        }, 45);
    }
    more(): void { this.limit = Math.min(2000, this.limit + vscode.workspace.getConfiguration('searchByFilename').get('maxResults', 200)); this.schedule(); }
    dispose(): void { this.generation++; if (this.timer) { clearTimeout(this.timer); } this.controller?.abort(); this.listeners.forEach(item => item.dispose()); }
}
export async function openFile(file: IndexedFile, index: FileIndex): Promise<void> {
    if (index.files.get(file.id) !== file) { return; }
    try {
        await vscode.window.showTextDocument(file.uri, { preview: vscode.workspace.getConfiguration('searchByFilename').get('openInPreview', true) });
    } catch { void vscode.window.showErrorMessage(`Could not open ${file.name}. It may have moved or its provider may not support text documents.`); }
}
