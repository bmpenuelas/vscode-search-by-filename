import { parentPort } from 'node:worker_threads';
import { search } from './match';
import { Options, SearchFile } from './SearchTypes';

const files = new Map<string, SearchFile>();
const cancelled = new Set<number>();
const active = new Set<number>();
interface Message { type: string; files?: SearchFile[]; ids?: string[]; reset?: boolean; request: number; query: string; options: Options; limit: number }
parentPort!.on('message', (message: Message) => {
    if (message.type === 'update') {
        if (message.reset) { files.clear(); }
        for (const id of message.ids ?? []) { files.delete(id); }
        for (const file of message.files ?? []) { files.set(file.id, file); }
    } else if (message.type === 'cancel') { if (active.has(message.request)) { cancelled.add(message.request); } }
    else if (message.type === 'search') {
        active.add(message.request);
        void search(files.values(), message.query, message.options, message.limit, () => cancelled.has(message.request))
            .then(result => { parentPort!.postMessage({ request: message.request, result }); active.delete(message.request); cancelled.delete(message.request); });
    }
});
