import * as vscode from 'vscode';
import { SearchFile } from '../search/SearchTypes';
import { Excludes, IgnoreRules } from './IgnoreRules';
import { DirectoryEntry, scan, ScanHost, ScanTask } from './FileScanner';

export interface IndexedFile extends SearchFile { uri: vscode.Uri; root: string }
interface Root { folder: vscode.WorkspaceFolder; rules: IgnoreRules; useIgnore: boolean }
export class FileIndex implements vscode.Disposable {
    readonly files = new Map<string, IndexedFile>();
    private readonly roots = new Map<string, Root>();
    private readonly directories = new Map<string, ScanTask>();
    private readonly frontier = new Map<string, ScanTask>();
    private readonly fileParents = new Map<string, Set<string>>();
    private readonly childDirectories = new Map<string, Set<string>>();
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChange = this.changed.event;
    private readonly updates = new vscode.EventEmitter<{ files: SearchFile[]; ids: string[]; reset?: boolean }>();
    readonly onDidUpdate = this.updates.event;
    private additions: SearchFile[] = [];
    private removals: string[] = [];
    private lastNotification = 0;
    private generation = 0;
    private started = false;
    private expanded = false;
    private expandRequested = false;
    private chain: Promise<void> = Promise.resolve();
    private disposed = false;
    private maximum = 500000;
    busy = false;
    limited = false;
    errors = 0;
    get status(): string {
        return `${this.busy ? 'Indexing · ' : ''}${this.files.size.toLocaleString()} cached files` +
            (this.limited ? ' · INCOMPLETE: file limit reached; increase maxIndexedFiles and refresh' : '') +
            (this.errors ? ` · INCOMPLETE: ${this.errors} unreadable directories/ignore files; refresh to retry` : '') +
            (!this.roots.size ? ' · Open a workspace folder to search' : '');
    }
    private key(root: string, path: string): string { return root + '\n' + path; }
    private uri(task: ScanTask, name?: string): vscode.Uri {
        return vscode.Uri.joinPath(this.roots.get(task.root)!.folder.uri, ...task.path.split('/').filter(Boolean), ...(name ? [name] : []));
    }
    private entries = async (task: ScanTask): Promise<DirectoryEntry[]> => {
        const entries = (await vscode.workspace.fs.readDirectory(this.uri(task))).filter(([name]) =>
            !!name && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\0') && !(process.platform === 'win32' && name.includes('\\'))).map(([name, type]) => ({
            name, directory: (type & vscode.FileType.Directory) !== 0,
            symlink: (type & vscode.FileType.SymbolicLink) !== 0
        }));
        if (this.disposed) { return []; }
        if (!task.normal) { this.directories.set(this.key(task.root, task.path), task); }
        return entries;
    };
    private async loadRules(task: ScanTask, entries: DirectoryEntry[]): Promise<IgnoreRules> {
        const contents: string[] = [];
        if (this.roots.get(task.root)?.useIgnore) {
            for (const name of ['.gitignore', '.ignore', '.rgignore']) {
                if (!entries.some(entry => entry.name === name && !entry.directory && !entry.symlink)) { continue; }
                try {
                    const uri = this.uri(task, name);
                    const stat = await vscode.workspace.fs.stat(uri);
                    if (stat.size > 1024 * 1024) { this.errors++; continue; }
                    contents.push(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'));
                } catch { this.errors++; }
            }
        }
        const rules = contents.length ? task.rules.extend(task.path, contents) : task.rules;
        if (this.disposed) { return rules; }
        this.directories.set(this.key(task.root, task.path), { ...task, rules });
        return rules;
    }
    private add(task: ScanTask, entry: DirectoryEntry, normal: boolean): boolean {
        if (this.disposed) { return false; }
        const uri = this.uri(task, entry.name), id = uri.toString();
        const existing = this.files.get(id);
        if (existing && existing.normal === normal) { return true; }
        if (!existing && this.files.size >= this.maximum) { this.limited = true; return false; }
        const relative = task.path ? task.path + '/' + entry.name : entry.name;
        const root = this.roots.get(task.root)!;
        const file: IndexedFile = { id, uri, name: entry.name, lowerName: entry.name.toLowerCase(), root: task.root,
            relativePath: this.roots.size > 1 ? root.folder.name + '/' + relative : relative, normal };
        this.files.set(id, file);
        const key = this.key(task.root, task.path);
        let siblings = this.fileParents.get(key);
        if (!siblings) { siblings = new Set(); this.fileParents.set(key, siblings); }
        siblings.add(id);
        this.additions.push({ id, name: file.name, lowerName: file.lowerName, relativePath: file.relativePath, normal });
        return true;
    }
    private flush(): void {
        if (this.additions.length || this.removals.length) {
            this.updates.fire({ files: this.additions, ids: this.removals }); this.additions = []; this.removals = [];
        }
        // Throttle progress notifications, not index deltas: sustained discovery must still render results.
        if (!this.busy || Date.now() - this.lastNotification >= 100) { this.lastNotification = Date.now(); this.changed.fire(); }
    }
    private async run(tasks: ScanTask[], generation: number): Promise<void> {
        const host: ScanHost = {
            read: async task => {
                const entries = await this.entries(task);
                if (!this.disposed) { this.childDirectories.set(this.key(task.root, task.path), new Set(entries.filter(entry => entry.directory && !entry.symlink).map(entry => task.path ? task.path + '/' + entry.name : entry.name))); }
                return entries;
            }, rules: (task, entries) => this.loadRules(task, entries), file: (task, entry, normal) => this.add(task, entry, normal),
            pruned: task => { this.frontier.set(this.key(task.root, task.path), task); },
            error: () => { this.errors++; }, progress: () => this.flush()
        };
        await scan(tasks, host, () => this.disposed || generation !== this.generation || this.limited);
    }
    private enqueue(work: (generation: number) => Promise<void>): Promise<void> {
        const generation = this.generation;
        this.chain = this.chain.then(async () => {
            if (this.disposed || generation !== this.generation) { return; }
            this.busy = true; this.changed.fire();
            try { await work(generation); }
            catch { this.errors++; }
            finally { this.busy = false; this.flush(); }
        });
        return this.chain;
    }
    ensure(includeIgnored: boolean): void {
        if (!this.started) { this.refresh(includeIgnored); return; }
        if (includeIgnored && !this.expanded && !this.expandRequested) {
            this.expandRequested = true;
            void this.enqueue(async generation => {
                this.expanded = true;
                const tasks = [...this.frontier.values()]; this.frontier.clear();
                await this.run(tasks, generation);
            });
        }
    }
    refresh(includeIgnored: boolean): void {
        this.generation++;
        this.started = true; this.expanded = false; this.expandRequested = false;
        void this.enqueue(async generation => {
            this.files.clear(); this.directories.clear(); this.frontier.clear(); this.fileParents.clear(); this.childDirectories.clear(); this.roots.clear();
            this.additions = []; this.removals = [];
            this.updates.fire({ files: [], ids: [], reset: true });
            this.errors = 0; this.limited = false;
            this.maximum = vscode.workspace.getConfiguration('searchByFilename').get('maxIndexedFiles', 500000);
            for (const folder of vscode.workspace.workspaceFolders ?? []) {
                const config = vscode.workspace.getConfiguration(undefined, folder.uri);
                const excludes = { ...config.get<Excludes>('files.exclude', {}), ...config.get<Excludes>('search.exclude', {}) };
                this.roots.set(folder.uri.toString(), { folder, rules: new IgnoreRules([], excludes), useIgnore: config.get('search.useIgnoreFiles', true) });
            }
            this.flush();
            await this.run([...this.roots].map(([root, value]) => ({ root, path: '', normal: true, rules: value.rules })), generation);
            if (includeIgnored) {
                this.expanded = true; this.expandRequested = true;
                const tasks = [...this.frontier.values()]; this.frontier.clear(); await this.run(tasks, generation);
            }
        });
    }
    /** Coalesced event batches reconcile only changed parents; existing subtrees are not traversed. */
    events(uris: vscode.Uri[]): void {
        if (!this.started) { return; }
        void this.enqueue(async generation => {
            const parents = new Map<string, ScanTask>();
            const invalidRoots = new Set<string>();
            for (const uri of uris) {
                const folder = vscode.workspace.getWorkspaceFolder(uri);
                if (!folder) { continue; }
                const root = folder.uri.toString();
                if (!this.roots.has(root)) { continue; }
                const relative = uri.path.slice(folder.uri.path.replace(/\/$/, '').length + 1);
                const parent = relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : '';
                if (this.roots.get(root)?.useIgnore && ['.gitignore', '.ignore', '.rgignore'].includes(relative.slice(relative.lastIndexOf('/') + 1))) {
                    // Root-scoped invalidation keeps inherited contexts correct without touching other roots.
                    invalidRoots.add(root); continue;
                }
                // A provider may report only a deeply nested creation: locate the nearest scanned ancestor.
                let path = parent;
                while (!this.directories.has(this.key(root, path)) && path) { path = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''; }
                const task = this.directories.get(this.key(root, path));
                if (task) { parents.set(this.key(root, path), task); }
            }
            for (const root of invalidRoots) {
                const value = this.roots.get(root)!;
                await this.removeScopes([{ root, path: '', normal: true, rules: value.rules }]);
                await this.run([{ root, path: '', normal: true, rules: value.rules }], generation);
                if (this.expanded) {
                    const tasks = [...this.frontier.values()].filter(task => task.root === root);
                    tasks.forEach(task => this.frontier.delete(this.key(root, task.path)));
                    await this.run(tasks, generation);
                }
            }
            const removedScopes: ScanTask[] = [];
            const reconciliations: { task: ScanTask; entries: DirectoryEntry[]; names: Set<string> }[] = [];
            for (const task of parents.values()) {
                if (invalidRoots.has(task.root)) { continue; }
                if (generation !== this.generation) { return; }
                let entries: DirectoryEntry[];
                try { entries = await this.entries(task); }
                catch (error) {
                    if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') { removedScopes.push(task); }
                    else { this.errors++; }
                    continue;
                }
                const names = new Set(entries.map(entry => entry.name));
                const fileNames = new Set(entries.filter(entry => !entry.directory && !entry.symlink).map(entry => entry.name));
                const key = this.key(task.root, task.path);
                for (const id of this.fileParents.get(key) ?? []) {
                    const file = this.files.get(id);
                    if (file && !fileNames.has(file.name)) { this.files.delete(id); this.removals.push(id); this.fileParents.get(key)?.delete(id); }
                }
                const dirs = new Set(entries.filter(entry => entry.directory && !entry.symlink).map(entry => task.path ? task.path + '/' + entry.name : entry.name));
                for (const path of this.childDirectories.get(key) ?? []) { if (!dirs.has(path)) { removedScopes.push({ ...task, path }); } }
                this.childDirectories.set(key, dirs);
                for (const entry of entries.filter(entry => entry.directory && !entry.symlink)) {
                    const path = task.path ? task.path + '/' + entry.name : entry.name;
                    const existing = this.directories.get(this.key(task.root, path));
                    const normal = task.normal && !task.rules.excluded(path, true, names);
                    if (existing && existing.normal !== normal) { removedScopes.push({ ...task, path }); }
                }
                reconciliations.push({ task, entries, names });
            }
            if (removedScopes.length) { await this.removeScopes(removedScopes); }
            for (const { task, entries, names } of reconciliations) {
                if (!this.directories.has(this.key(task.root, task.path))) { continue; }
                const newTasks: ScanTask[] = [];
                let processed = 0;
                for (const entry of entries) {
                    if (++processed % 1024 === 0) { this.flush(); await new Promise<void>(resolve => setImmediate(resolve)); }
                    if (this.disposed || generation !== this.generation) { return; }
                    if (entry.symlink) { continue; }
                    const path = task.path ? task.path + '/' + entry.name : entry.name;
                    const normal = task.normal && !task.rules.excluded(path, entry.directory, names);
                    if (!entry.directory) { this.add(task, entry, normal); }
                    else if (!this.directories.has(this.key(task.root, path))) {
                        const child = { ...task, path, normal };
                        if (normal || this.expanded) { newTasks.push(child); }
                        else { this.frontier.set(this.key(task.root, path), child); }
                    }
                }
                await this.run(newTasks, generation);
            }
        });
    }
    private async removeScopes(tasks: ScanTask[]): Promise<void> {
        const generation = this.generation;
        const scopes = new Map<string, Set<string>>();
        for (const task of tasks) { let paths = scopes.get(task.root); if (!paths) { paths = new Set(); scopes.set(task.root, paths); } paths.add(task.path); }
        const contains = (root: string, path: string) => {
            const paths = scopes.get(root); if (!paths) { return false; }
            for (;;) { if (paths.has(path)) { return true; } if (!path) { return false; } path = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''; }
        };
        let processed = 0;
        for (const [id, file] of this.files) {
            if (++processed % 2048 === 0) { this.flush(); await new Promise<void>(resolve => setImmediate(resolve)); }
            if (this.disposed || generation !== this.generation) { return; }
            const folder = this.roots.get(file.root)!.folder.uri;
            const path = file.uri.path.slice(folder.path.replace(/\/$/, '').length + 1);
            if (contains(file.root, path)) {
                this.files.delete(id); this.removals.push(id);
                const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
                this.fileParents.get(this.key(file.root, parent))?.delete(id);
            }
        }
        for (const map of [this.directories, this.frontier]) {
            for (const [key, value] of map) {
                if (contains(value.root, value.path)) { map.delete(key); this.fileParents.delete(key); this.childDirectories.delete(key); }
            }
        }
    }
    whenIdle(): Promise<void> { return this.chain; }
    dispose(): void {
        this.disposed = true; this.generation++; this.files.clear(); this.directories.clear(); this.frontier.clear();
        this.fileParents.clear(); this.childDirectories.clear(); this.roots.clear(); this.additions = []; this.removals = [];
        this.changed.dispose(); this.updates.dispose();
    }
}
