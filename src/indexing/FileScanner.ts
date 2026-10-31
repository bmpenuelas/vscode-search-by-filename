import { IgnoreRules } from './IgnoreRules';

export interface DirectoryEntry { name: string; directory: boolean; symlink: boolean }
export interface ScanTask { root: string; path: string; normal: boolean; rules: IgnoreRules }
export interface ScanHost {
    read(task: ScanTask): Promise<DirectoryEntry[]>;
    rules(task: ScanTask, entries: DirectoryEntry[]): Promise<IgnoreRules>;
    file(task: ScanTask, entry: DirectoryEntry, normal: boolean): boolean;
    pruned(task: ScanTask): void;
    error(task: ScanTask, error: unknown): void;
    progress(): void;
}
/** Iterative, bounded batches; no recursion, unbounded promises, or ordinary file reads. */
export async function scan(initial: ScanTask[], host: ScanHost, cancelled: () => boolean, concurrency = 8): Promise<void> {
    const queue = initial.slice();
    let head = 0, batches = 0;
    while (head < queue.length && !cancelled()) {
        const tasks = queue.slice(head, head + concurrency); head += tasks.length;
        await Promise.all(tasks.map(async task => {
            try {
                const entries = await host.read(task);
                if (cancelled()) { return; }
                const rules = task.normal ? await host.rules(task, entries) : task.rules;
                const siblings = new Set(entries.map(entry => entry.name));
                let processed = 0;
                for (const entry of entries) {
                    if (++processed % 1024 === 0) { host.progress(); await new Promise<void>(resolve => setImmediate(resolve)); }
                    if (cancelled()) { return; }
                    if (!entry.name || entry.name === '.' || entry.name === '..' || entry.name.includes('/') || entry.name.includes('\0')) { continue; }
                    if (entry.symlink) { continue; }
                    const path = task.path ? task.path + '/' + entry.name : entry.name;
                    const normal = task.normal && !rules.excluded(path, entry.directory, siblings);
                    if (entry.directory) {
                        const child = { root: task.root, path, normal, rules };
                        if (normal || !task.normal) { queue.push(child); }
                        else { host.pruned(child); }
                    } else if (!host.file(task, entry, normal)) { return; }
                }
            } catch (error) { if (!cancelled()) { host.error(task, error); } }
        }));
        if (++batches % 8 === 0) { host.progress(); await new Promise<void>(resolve => setImmediate(resolve)); }
        // Release processed contexts rather than retaining all directory metadata for the scan.
        if (head >= 4096) { queue.splice(0, head); head = 0; }
    }
    host.progress();
}
