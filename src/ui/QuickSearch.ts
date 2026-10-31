import * as vscode from 'vscode';
import { IndexedFile } from '../indexing/FileIndex';
import { OptionKey, optionKeys } from '../search/SearchTypes';
import { openFile, SearchSession, Services } from './SearchSession';

export interface FileItem extends vscode.QuickPickItem { file?: IndexedFile; more?: boolean }
export function fileItem(file: IndexedFile): FileItem {
    // alwaysShow bypasses QuickPick's fuzzy filter, including for queries like ^App.*\.ts$.
    return { label: file.name.replace(/\$\(/g, '＄('), description: file.relativePath.replace(/\$\(/g, '＄('), alwaysShow: true, file };
}
export class QuickSearch implements vscode.Disposable {
    private picker?: vscode.QuickPick<FileItem>;
    private close?: () => void;
    constructor(private readonly services: Services) {}
    show(): void {
        if (this.picker) { this.picker.show(); return; }
        const picker = vscode.window.createQuickPick<FileItem>(); this.picker = picker;
        picker.placeholder = 'Search filenames'; picker.matchOnDescription = false; picker.matchOnDetail = false;
        const buttons = new Map<vscode.QuickInputButton, OptionKey>();
        const updateButtons = () => {
            buttons.clear();
            const labels = ['Ignore case', 'Regular expression', 'Include ignored and excluded files'];
            const icons = ['case-sensitive', 'regex', 'exclude'];
            picker.buttons = optionKeys.map((key, index) => {
                const button: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon(icons[index]!),
                    location: vscode.QuickInputButtonLocation.Input, toggle: { checked: this.services.settings.options[key] },
                    tooltip: `${labels[index]}: ${this.services.settings.options[key] ? 'on' : 'off'}` };
                buttons.set(button, key); return button;
            });
        };
        const session = new SearchSession(this.services, (result, files) => {
            const active = picker.activeItems[0]?.file?.id;
            picker.items = [...files.map(fileItem), ...(result.total > files.length && session.limit < 2000 ? [{ label: 'Show more results…', alwaysShow: true, more: true }] : [])];
            const previous = picker.items.find(item => item.file?.id === active);
            if (previous) { picker.activeItems = [previous]; }
            picker.busy = this.services.index.busy;
            picker.title = result.error ?? `${result.total.toLocaleString()} matches · ${files.length} shown · ${this.services.index.status}`;
        }, () => { picker.busy = true; });
        updateButtons();
        let closed = false;
        const listeners: vscode.Disposable[] = [
            picker.onDidChangeValue(value => session.schedule(value)),
            picker.onDidTriggerButton(button => { const key = buttons.get(button); if (key) { this.services.settings.toggle(key); } }),
            this.services.settings.onDidChange(updateButtons),
            picker.onDidAccept(() => {
                const selected = picker.selectedItems[0];
                if (selected?.more) { session.more(); }
                else if (selected?.file) { void openFile(selected.file, this.services.index); picker.hide(); }
            }),
            picker.onDidHide(() => this.close?.())
        ];
        this.close = () => {
            if (closed) { return; } closed = true;
            session.dispose(); listeners.forEach(listener => listener.dispose()); picker.dispose();
            this.picker = undefined; this.close = undefined;
        };
        picker.show(); session.schedule();
    }
    dispose(): void { this.close?.(); }
}
