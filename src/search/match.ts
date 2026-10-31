import { Options, SearchFile, SearchResult } from './SearchTypes';

export function matcher(query: string, options: Options): (file: SearchFile) => number {
    if (query.length > 512) { throw new Error('Queries are limited to 512 characters.'); }
    if (options.useRegex) {
        const regex = new RegExp(query, options.ignoreCase ? 'i' : '');
        return file => regex.test(file.name) ? 0 : -1;
    }
    const normalized = options.ignoreCase ? query.toLowerCase() : query;
    return file => {
        const name = options.ignoreCase ? file.lowerName : file.name;
        const position = name.indexOf(normalized);
        return position < 0 ? -1 : name === normalized ? 0 : position === 0 ? 1 : 2;
    };
}

interface Ranked { file: SearchFile; rank: number }
function compare(a: Ranked, b: Ranked): number {
    return a.rank - b.rank || a.file.name.length - b.file.name.length ||
        a.file.relativePath.length - b.file.relativePath.length ||
        (a.file.relativePath < b.file.relativePath ? -1 : a.file.relativePath > b.file.relativePath ? 1 : 0) ||
        (a.file.id < b.file.id ? -1 : a.file.id > b.file.id ? 1 : 0);
}

/** A max heap retains only the best K matches: O(N log K), O(K) result memory. */
export async function search(files: Iterable<SearchFile>, query: string, options: Options,
    limit: number, cancelled: () => boolean = () => false): Promise<SearchResult> {
    let test: ReturnType<typeof matcher>;
    try { test = matcher(query, options); }
    catch (error) { return { ids: [], total: 0, error: String(error instanceof Error ? error.message : error) }; }
    const heap: Ranked[] = [];
    let total = 0, processed = 0;
    limit = Math.max(1, Math.min(2000, Math.floor(limit)));
    for (const file of files) {
        if (++processed % 2048 === 0) {
            await new Promise<void>(resolve => setImmediate(resolve));
            if (cancelled()) { return { ids: [], total: 0 }; }
        }
        if (!options.includeIgnored && !file.normal) { continue; }
        const rank = test(file);
        if (rank < 0) { continue; }
        total++;
        const item = { file, rank };
        if (heap.length < limit) {
            heap.push(item);
            let child = heap.length - 1;
            while (child > 0) {
                const parent = (child - 1) >> 1;
                if (compare(heap[parent]!, item) >= 0) { break; }
                heap[child] = heap[parent]!; child = parent;
            }
            heap[child] = item;
        } else if (compare(item, heap[0]!) < 0) {
            let parent = 0;
            while (parent * 2 + 1 < heap.length) {
                let child = parent * 2 + 1;
                if (child + 1 < heap.length && compare(heap[child + 1]!, heap[child]!) > 0) { child++; }
                if (compare(item, heap[child]!) >= 0) { break; }
                heap[parent] = heap[child]!; parent = child;
            }
            heap[parent] = item;
        }
    }
    heap.sort(compare);
    return { ids: heap.map(item => item.file.id), total };
}
