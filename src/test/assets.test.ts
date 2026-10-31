import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sidebarHtml } from '../ui/sidebarHtml';

test('Marketplace uses the supplied PNG and Activity Bar uses a separate monochrome SVG', async () => {
    const manifest = JSON.parse(await readFile('package.json', 'utf8')) as {
        icon: string; contributes: { viewsContainers: { activitybar: { icon: string }[] } };
    };
    assert.equal(manifest.icon, 'resources/icon.png');
    assert.equal(manifest.contributes.viewsContainers.activitybar[0]?.icon, 'resources/search.svg');
    const png = await readFile(manifest.icon);
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(png.readUInt32BE(16), 256); assert.equal(png.readUInt32BE(20), 256);
    assert.ok((await readFile('.vscodeignore', 'utf8')).includes('!' + manifest.icon));
    const svg = await readFile('resources/search.svg', 'utf8');
    assert.match(svg, /viewBox="0 0 24 24"/);
    // SVG editors may serialize presentation attributes as inline CSS instead.
    assert.match(svg, /stroke(?:\s*=\s*["']|\s*:\s*)#c5c5c5/i);
    assert.match(svg, /<circle/);
    assert.ok(!svg.includes('<image'), 'Activity Bar icon must remain lightweight vector artwork');
});

test('sidebar groups the input and all accessible toggles in one search control', () => {
    const html = sidebarHtml({ nonce: 'test', cspSource: 'test-resource:', styleUri: 'sidebar.css', scriptUri: 'sidebar.js',
        options: { ignoreCase: true, useRegex: false, includeIgnored: false } });
    assert.match(html, /class="search" role="search"/);
    assert.match(html, /role="group" aria-label="Search options"/);
    assert.equal((html.match(/data-option=/g) ?? []).length, 3);
    assert.match(html, /data-option="ignoreCase"[^>]*aria-pressed="true"/);
    assert.match(html, /data-option="useRegex"[^>]*aria-pressed="false"/);
    assert.ok(html.indexOf('id="query"') < html.indexOf('class="toggles"'));
});
