import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search } from '../search/match';
import { Options, SearchFile } from '../search/SearchTypes';
import { SearchEngine } from '../search/SearchEngine';
import * as path from 'node:path';
const options: Options = { ignoreCase: true, useRegex: false, includeIgnored: false };
const files: SearchFile[] = ['App.ts', 'app.test.ts', 'MyApp.ts', 'a+b.ts', 'hello world.ts', '日本語.ts', 'App.ts', 'ignored.ts'].map((name, index) => ({ id: String(index), name, lowerName: name.toLowerCase(), relativePath: `${index}/${name}`, normal: index !== 7 }));
test('literal exact, prefix, contains ranking and duplicates', async () => {
    const result = await search(files, 'App.ts', options, 200);
    assert.deepEqual(result.ids, ['0', '6', '2']); assert.equal(result.total, 3);
    assert.deepEqual((await search(files, 'app', options, 200)).ids, ['0', '6', '1', '2']);
    assert.deepEqual((await search(files, 'app', { ...options, ignoreCase: false }, 200)).ids, ['1']);
});
test('regex matches cannot be literal-filtered, flags are stateless', async () => {
    assert.deepEqual((await search(files, '^app\\.ts$', { ...options, useRegex: true }, 200)).ids, ['0', '6']);
    assert.equal((await search(files, '^app', { ...options, useRegex: true, ignoreCase: false }, 200)).total, 1);
    assert.deepEqual((await search(files, 'a\\+b', { ...options, useRegex: true }, 200)).ids, ['3']);
});
test('invalid regex clears results and valid queries recover', async () => {
    const invalid = await search(files, '[', { ...options, useRegex: true }, 200);
    assert.ok(invalid.error); assert.deepEqual(invalid.ids, []);
    assert.equal((await search(files, '.*', { ...options, useRegex: true }, 200)).total, 7);
    assert.ok((await search(files, 'a'.repeat(513), options, 200)).error);
});
test('spaces, Unicode, empty queries, literal metacharacters and display limits', async () => {
    for (const query of ['hello world', '日本語', 'a+b']) { assert.equal((await search(files, query, options, 200)).total, 1); }
    const result = await search(files, '', options, 2); assert.equal(result.total, 7); assert.equal(result.ids.length, 2);
    assert.equal((await search(files, '', { ...options, includeIgnored: true }, 200)).total, 8);
});
test('heap equals full ranking for bounded results', async () => {
    const synthetic = Array.from({ length: 10000 }, (_, i) => ({ id: String(i), name: `${i % 3 ? 'my-' : ''}app-${i}.ts`, lowerName: `${i % 3 ? 'my-' : ''}app-${i}.ts`, relativePath: `src/${i}.ts`, normal: true }));
    const full = await search(synthetic, 'app', options, 2000);
    assert.deepEqual((await search(synthetic, 'app', options, 37)).ids, full.ids.slice(0, 37));
});
test('cooperative cancellation', async () => {
    assert.equal((await search(Array.from({ length: 10000 }, () => files[0]!), '', options, 10, () => true)).total, 0);
});
test('worker timeout isolates catastrophic regex and recovers with a fresh worker', async () => {
    const evil = { ...files[0]!, name: 'a'.repeat(100) + '!', lowerName: 'a'.repeat(100) + '!' };
    const engine = new SearchEngine(path.resolve('dist/search/worker.js'), () => [evil]);
    try {
        const result = await engine.search('(a+)+$', { ...options, useRegex: true }, 10, new AbortController().signal);
        assert.match(result.error!, /time budget/);
        assert.equal((await engine.search('!', options, 10, new AbortController().signal)).total, 1);
    } finally { engine.dispose(); }
});
test('worker mirror applies insertion, deletion, and reset without a filesystem scan', async () => {
    const snapshot = new Map(files.map(file => [file.id, file]));
    const engine = new SearchEngine(path.resolve('dist/search/worker.js'), () => snapshot.values());
    const signal = new AbortController().signal;
    try {
        assert.equal((await engine.search('', options, 200, signal)).total, 7);
        const extra = { ...files[0]!, id: 'extra', name: 'extra.ts', lowerName: 'extra.ts' };
        engine.update([extra], ['0']);
        assert.deepEqual((await engine.search('extra', options, 200, signal)).ids, ['extra']);
        assert.deepEqual((await engine.search('^App\\.ts$', { ...options, useRegex: true }, 200, signal)).ids, ['6']);
        engine.update([extra], [], true);
        assert.equal((await engine.search('', options, 200, signal)).total, 1);
    } finally { engine.dispose(); }
});
test('closing the last consumer cancels a yielding worker initialization', async () => {
    let visited = 0;
    function* snapshot() { for (let i = 0; i < 100000; i++) { visited++; yield { ...files[0]!, id: String(i) }; } }
    const engine = new SearchEngine(path.resolve('dist/search/worker.js'), snapshot);
    const controller = new AbortController();
    try {
        const result = engine.search('', options, 200, controller.signal); controller.abort();
        assert.equal((await result).total, 0); assert.ok(visited < 100000);
    } finally { engine.dispose(); }
});
