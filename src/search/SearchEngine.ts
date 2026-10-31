import { Worker } from 'node:worker_threads';
import { Options, SearchFile, SearchResult } from './SearchTypes';

export class SearchEngine {
    private worker?: Worker;
    private ready: Promise<void> = Promise.resolve();
    private disposed = false;
    private request = 0;
    private readonly waiting = new Set<number>();
    private readonly pending = new Map<number, { finish: (result: SearchResult) => void; timer: NodeJS.Timeout }>();
    constructor(private readonly workerPath: string, private readonly snapshot: () => Iterable<SearchFile>) {}
    update(files: SearchFile[], ids: string[] = [], reset = false): void { this.worker?.postMessage({ type: 'update', files, ids, reset }); }
    private ensureWorker(): Worker {
        if (!this.worker) {
            const worker = new Worker(this.workerPath);
            this.worker = worker;
            worker.on('message', ({ request, result }: { request: number; result: SearchResult }) => {
                const pending = this.pending.get(request);
                if (pending) { clearTimeout(pending.timer); this.pending.delete(request); pending.finish(result); }
            });
            worker.on('error', () => { if (this.worker === worker) { this.reset('Search worker failed. Retry the search.'); } });
            worker.on('exit', () => { if (this.worker === worker) { this.reset('Search worker stopped. Retry the search.'); } });
            this.ready = (async () => {
                let batch: SearchFile[] = [];
                for (const file of this.snapshot()) {
                    if (this.worker !== worker) { return; }
                    // Keep Uri objects and root metadata in the host, not in the worker mirror.
                    batch.push({ id: file.id, name: file.name, lowerName: file.lowerName, relativePath: file.relativePath, normal: file.normal });
                    if (batch.length === 4096) {
                        worker.postMessage({ type: 'update', files: batch }); batch = [];
                        await new Promise<void>(resolve => setImmediate(resolve));
                    }
                }
                if (batch.length && this.worker === worker) { worker.postMessage({ type: 'update', files: batch }); }
            })();
        }
        return this.worker;
    }
    async search(query: string, options: Options, limit: number, signal: AbortSignal): Promise<SearchResult> {
        if (signal.aborted || this.disposed) { return { ids: [], total: 0 }; }
        let worker: Worker;
        try { worker = this.ensureWorker(); }
        catch { return { ids: [], total: 0, error: 'Could not start the search worker. Reload the window and retry.' }; }
        const request = ++this.request;
        this.waiting.add(request);
        const cancelStartup = () => {
            this.waiting.delete(request);
            if (!this.waiting.size && !this.pending.size && this.worker === worker) { this.reset('Search cancelled.'); }
        };
        signal.addEventListener('abort', cancelStartup, { once: true });
        try { await this.ready; }
        catch { return { ids: [], total: 0, error: 'Could not initialize the search worker. Retry the query.' }; }
        finally { signal.removeEventListener('abort', cancelStartup); this.waiting.delete(request); }
        if (signal.aborted || this.disposed) { return { ids: [], total: 0 }; }
        if (this.worker !== worker) { return { ids: [], total: 0, error: 'Search worker restarted. Retry the query.' }; }
        return new Promise(resolve => {
            const abort = () => {
                worker.postMessage({ type: 'cancel', request });
                const pending = this.pending.get(request);
                if (pending) { clearTimeout(pending.timer); this.pending.delete(request); pending.finish({ ids: [], total: 0 }); }
                // A regex can be stuck inside a single .test(); termination is the only safe interruption.
                if (options.useRegex) { this.reset('Regex search cancelled. Retry the current query.'); }
            };
            signal.addEventListener('abort', abort, { once: true });
            this.pending.set(request, {
                finish: result => { signal.removeEventListener('abort', abort); resolve(result); },
                timer: setTimeout(() => this.reset('Search exceeded its time budget. Simplify the query and retry.'), options.useRegex ? 1500 : 15000)
            });
            worker.postMessage({ type: 'search', request, query, options, limit });
        });
    }
    private reset(error: string): void {
        const worker = this.worker; this.worker = undefined;
        this.waiting.clear();
        if (worker) { void worker.terminate(); }
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.finish({ ids: [], total: 0, error }); }
        this.pending.clear();
    }
    dispose(): void { this.disposed = true; this.reset('Search disposed.'); }
}
