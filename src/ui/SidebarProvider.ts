import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { IndexedFile } from '../indexing/FileIndex';
import { optionKeys } from '../search/SearchTypes';
import { sidebarHtml } from './sidebarHtml';
import { SearchSession, Services, openFile } from './SearchSession';

export class SidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    private view?: vscode.WebviewView;
    private session?: SearchSession;
    private bindings: vscode.Disposable[] = [];
    private results = new Map<string, IndexedFile>();
    private query = '';
    constructor(private readonly extensionUri: vscode.Uri, private readonly services: Services) {}
    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')] };
        const nonce = randomBytes(24).toString('hex');
        const asset = (name: string) => view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', name)).toString();
        view.webview.html = sidebarHtml({
            nonce, cspSource: view.webview.cspSource, styleUri: asset('sidebar.css'),
            scriptUri: asset('sidebar.js'), options: this.services.settings.options
        });
        const start = () => {
            this.session?.dispose();
            this.session = new SearchSession(this.services, (result, files) => {
                const known = new Map([...this.results].map(([id, file]) => [file.id, id]));
                this.results.clear();
                const entries = files.map(file => { const id = known.get(file.id) ?? randomBytes(12).toString('hex'); this.results.set(id, file); return { id, name: file.name, path: file.relativePath }; });
                void view.webview.postMessage({ type: 'results', entries, options: this.services.settings.options,
                    status: result.error ?? `${result.total.toLocaleString()} matches · ${files.length} shown · ${this.services.index.status}`,
                    error: !!result.error, more: result.total > files.length && this.session!.limit < 2000 });
            }, () => { void view.webview.postMessage({ type: 'busy' }); });
            this.session.schedule(this.query);
        };
        this.bindings = [view.webview.onDidReceiveMessage((message: unknown) => {
            if (!message || typeof message !== 'object') { return; }
            const data = message as Record<string, unknown>;
            if (data.type === 'ready') { start(); void view.webview.postMessage({ type: 'options', options: this.services.settings.options }); void view.webview.postMessage({ type: 'focus', query: this.query }); }
            else if (data.type === 'query' && typeof data.value === 'string' && data.value.length <= 512) {
                this.query = data.value; this.session?.schedule(this.query);
            } else if (data.type === 'toggle' && optionKeys.includes(data.key as typeof optionKeys[number])) { this.services.settings.toggle(data.key as typeof optionKeys[number]); }
            else if (data.type === 'more') { this.session?.more(); }
            else if (data.type === 'open' && typeof data.id === 'string') { const file = this.results.get(data.id); if (file) { void openFile(file, this.services.index); } }
        }), this.services.settings.onDidChange(options => { if (view.visible) { void view.webview.postMessage({ type: 'options', options }); } }), view.onDidChangeVisibility(() => {
            if (view.visible) { start(); void view.webview.postMessage({ type: 'focus', query: this.query }); }
            else { this.session?.dispose(); this.session = undefined; this.results.clear(); }
        }), view.onDidDispose(() => this.release())];
    }
    async focus(): Promise<void> {
        await vscode.commands.executeCommand('workbench.view.extension.searchByFilename');
        this.view?.show(false); void this.view?.webview.postMessage({ type: 'focus', query: this.query });
    }
    private release(): void { this.session?.dispose(); this.session = undefined; this.bindings.forEach(binding => binding.dispose()); this.bindings = []; this.results.clear(); this.view = undefined; }
    dispose(): void { this.release(); }
}
