import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
export class Uri {
    constructor(readonly scheme: string, readonly path: string, readonly authority = '') {}
    static file(value: string): Uri { const url = pathToFileURL(value); return new Uri('file', decodeURIComponent(url.pathname)); }
    static parse(value: string): Uri { const url = new URL(value); return new Uri(url.protocol.slice(0, -1), decodeURIComponent(url.pathname), url.host); }
    static joinPath(base: Uri, ...parts: string[]): Uri { return new Uri(base.scheme, path.posix.join(base.path, ...parts), base.authority); }
    toString(): string { return `${this.scheme}://${this.authority}${this.path.split('/').map(encodeURIComponent).join('/')}`; }
    get fsPath(): string { return fileURLToPath('file://' + this.path); }
}
export class EventEmitter<T> {
    private listeners = new Set<(event: T) => unknown>();
    event = (listener: (event: T) => unknown) => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
    fire(event: T): void { for (const listener of this.listeners) { listener(event); } }
    dispose(): void { this.listeners.clear(); }
}
export const FileType = { File: 1, Directory: 2, SymbolicLink: 64 };
export class FileSystemError extends Error { constructor(readonly code: string) { super(code); } }
export interface WorkspaceFolder { uri: Uri; name: string; index: number }
export const configuration: Record<string, unknown> = {};
export const configChanges = new EventEmitter<{ affectsConfiguration: (key: string) => boolean }>();
export const folderChanges = new EventEmitter<void>();
export const watcherEvents = { create: new EventEmitter<Uri>(), change: new EventEmitter<Uri>(), delete: new EventEmitter<Uri>() };
export let directoryReads = 0;
export const workspace = {
    workspaceFolders: [] as WorkspaceFolder[],
    getConfiguration: (section?: string) => ({
        get: <T>(key: string, fallback: T): T => (configuration[section ? section + '.' + key : key] ?? fallback) as T,
        inspect: <T>(key: string) => ({ globalValue: configuration[section ? section + '.' + key : key] as T | undefined })
    }),
    onDidChangeConfiguration: configChanges.event,
    onDidChangeWorkspaceFolders: folderChanges.event,
    getWorkspaceFolder: (uri: Uri) => workspace.workspaceFolders.filter(folder => uri.scheme === folder.uri.scheme && (uri.path === folder.uri.path || uri.path.startsWith(folder.uri.path + '/'))).sort((a, b) => b.uri.path.length - a.uri.path.length)[0],
    createFileSystemWatcher: () => ({ dispose() {}, onDidCreate: watcherEvents.create.event, onDidDelete: watcherEvents.delete.event, onDidChange: watcherEvents.change.event }),
    fs: {
        readDirectory: async (uri: Uri): Promise<[string, number][]> => { directoryReads++; try { return (await fs.readdir(uri.fsPath, { withFileTypes: true })).map(entry => [entry.name, entry.isSymbolicLink() ? 64 : entry.isDirectory() ? 2 : 1]); } catch (error) { throw new FileSystemError((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'FileNotFound' : 'NoPermissions'); } },
        readFile: async (uri: Uri) => fs.readFile(uri.fsPath),
        stat: async (uri: Uri) => fs.stat(uri.fsPath)
    }
};
export class ThemeIcon { constructor(readonly id: string) {} }
export class RelativePattern { constructor(readonly base: unknown, readonly pattern: string) {} }
export const QuickInputButtonLocation = { Input: 3 };
export class MockPicker {
    value = ''; items: { label: string; alwaysShow?: boolean; file?: { id: string }; more?: boolean }[] = [];
    activeItems: typeof this.items = []; selectedItems: typeof this.items = [];
    buttons: { toggle: { checked: boolean }; location: number; tooltip: string }[] = [];
    busy = false; title = ''; disposed = false; visible = false;
    readonly values = new EventEmitter<string>(); readonly triggers = new EventEmitter<unknown>(); readonly accepts = new EventEmitter<void>(); readonly hides = new EventEmitter<void>();
    onDidChangeValue = this.values.event; onDidTriggerButton = this.triggers.event; onDidAccept = this.accepts.event; onDidHide = this.hides.event;
    show(): void { this.visible = true; }
    hide(): void { this.visible = false; this.hides.fire(); }
    dispose(): void { this.disposed = true; }
}
export const pickers: MockPicker[] = [];
export const opened: Uri[] = [];
export const commands = { executeCommand: async () => undefined };
export const window = {
    createQuickPick: () => { const picker = new MockPicker(); pickers.push(picker); return picker; },
    showTextDocument: async (uri: Uri) => { opened.push(uri); },
    showErrorMessage: async () => undefined,
    showWarningMessage: async () => undefined
};
