import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IgnoreRules } from '../indexing/IgnoreRules';
test('Git semantics: negation, anchored and directory patterns, nested overrides', () => {
    const root = new IgnoreRules([], {}, false).extend('', ['*.log\n!important.log\n/build/\ncache/']);
    assert.equal(root.excluded('x.log', false), true);
    assert.equal(root.excluded('important.log', false), false);
    assert.equal(root.excluded('build', true), true);
    assert.equal(root.excluded('nested/build', true), false);
    assert.equal(root.excluded('nested/cache', true), true);
    const nested = root.extend('nested', ['!visible.log\n/hidden.txt']);
    assert.equal(nested.excluded('nested/visible.log', false), false);
    assert.equal(nested.excluded('nested/hidden.txt', false), true);
    assert.equal(nested.excluded('other/hidden.txt', false), false);
});
test('dotfiles, glob settings, false overrides and conditional siblings', () => {
    const rules = new IgnoreRules([], { '**/dist': true, '**/*.js': { when: '$(basename).ts' }, '**/*.txt': false }, false);
    assert.equal(rules.excluded('dist', true), true);
    assert.equal(rules.excluded('.env', false), false);
    assert.equal(rules.excluded('src/App.js', false, new Set(['App.ts'])), true);
    assert.equal(rules.excluded('src/App.js', false), false);
    assert.equal(rules.excluded('readme.txt', false), false);
});
test('explicit platform case semantics', () => {
    assert.equal(new IgnoreRules([], {}, true).extend('', ['APP.TS']).excluded('app.ts', false), true);
    assert.equal(new IgnoreRules([], {}, false).extend('', ['APP.TS']).excluded('app.ts', false), false);
});
