import * as vscode from 'vscode';
import { OptionKey, Options, optionKeys } from '../search/SearchTypes';
export class SettingsManager implements vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<Options>();
    readonly onDidChange = this.changed.event;
    private readonly listener: vscode.Disposable;
    options: Options;
    constructor(private readonly state: vscode.Memento) {
        this.options = this.load();
        this.listener = vscode.workspace.onDidChangeConfiguration(event => {
            if (optionKeys.some(key => event.affectsConfiguration('searchByFilename.' + key))) { this.options = this.load(); this.changed.fire(this.options); }
        });
    }
    private load(): Options {
        const saved = this.state.get<Partial<Options>>('options', {});
        const config = vscode.workspace.getConfiguration('searchByFilename');
        const get = (key: OptionKey, fallback: boolean): boolean => {
            const value = config.inspect<boolean>(key);
            return value?.workspaceFolderValue ?? value?.workspaceValue ?? value?.globalValue ?? saved[key] ?? fallback;
        };
        return { ignoreCase: get('ignoreCase', true), useRegex: get('useRegex', false), includeIgnored: get('includeIgnored', false) };
    }
    toggle(key: OptionKey): void {
        this.options = { ...this.options, [key]: !this.options[key] };
        void this.state.update('options', this.options).then(undefined, () => vscode.window.showWarningMessage('Could not save filename search options.'));
        this.changed.fire(this.options);
    }
    dispose(): void { this.listener.dispose(); this.changed.dispose(); }
}
