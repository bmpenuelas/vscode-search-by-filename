import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan, ScanHost, ScanTask } from '../indexing/FileScanner';
import { IgnoreRules } from '../indexing/IgnoreRules';
test('scanner bounds concurrent reads, prunes ignored parents and does not follow symlinks', async () => {
    const rules = new IgnoreRules().extend('', ['ignored/']);
    const initial: ScanTask = { root: 'root', path: '', normal: true, rules };
    let current = 0, peak = 0, files = 0, pruned = 0;
    const reads: string[] = [];
    const host: ScanHost = {
        read: async task => {
            reads.push(task.path); peak = Math.max(peak, ++current); await new Promise(resolve => setImmediate(resolve)); current--;
            return !task.path ? [...Array.from({ length: 20 }, (_, i) => ({ name: 'dir' + i, directory: true, symlink: false })), { name: 'ignored', directory: true, symlink: false }, { name: 'link', directory: true, symlink: true }] : [{ name: 'file.ts', directory: false, symlink: false }];
        },
        rules: async task => task.rules, file: () => { files++; return true; }, pruned: () => { pruned++; }, error: error => { throw error; }, progress() {}
    };
    await scan([initial], host, () => false, 3);
    assert.ok(peak <= 3); assert.equal(peak, 3); assert.equal(files, 20); assert.equal(pruned, 1);
    assert.ok(!reads.includes('ignored')); assert.ok(!reads.includes('link'));
});
test('scanner is iterative at depth and cooperatively cancels inside large directories', async () => {
    const initial: ScanTask = { root: 'root', path: '', normal: true, rules: new IgnoreRules() };
    let directories = 0, files = 0, cancelled = false;
    const host: ScanHost = {
        read: async () => ++directories < 1000 ? [{ name: 'deep', directory: true, symlink: false }] : [{ name: 'end.ts', directory: false, symlink: false }],
        rules: async task => task.rules, file: () => { files++; return true; }, pruned() {}, error: error => { throw error; }, progress() {}
    };
    await scan([initial], host, () => false); assert.equal(directories, 1000); assert.equal(files, 1);
    host.read = async () => Array.from({ length: 10000 }, (_, i) => ({ name: `${i}.ts`, directory: false, symlink: false }));
    files = 0; host.file = () => { files++; if (files === 1500) { cancelled = true; } return true; };
    await scan([initial], host, () => cancelled); assert.equal(files, 1500);
});
