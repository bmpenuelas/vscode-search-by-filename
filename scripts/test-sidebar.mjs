import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { URL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const { sidebarHtml } = createRequire(import.meta.url)('../dist/ui/sidebarHtml.js');
const output = new URL('../.test-workspaces/sidebar-ui/', import.meta.url);
await mkdir(output, { recursive: true });
const common = {
    '--vscode-font-family': 'Segoe UI, sans-serif', '--vscode-font-size': '13px',
    '--vscode-button-background': '#007acc', '--vscode-button-foreground': '#ffffff'
};
const themes = {
    dark: { '--vscode-foreground': '#cccccc', '--vscode-sideBar-background': '#181818', '--vscode-input-background': '#313131', '--vscode-input-foreground': '#cccccc', '--vscode-input-placeholderForeground': '#989898', '--vscode-descriptionForeground': '#999999', '--vscode-inputOption-activeBackground': '#094771', '--vscode-inputOption-activeForeground': '#ffffff', '--vscode-inputOption-activeBorder': '#007acc', '--vscode-focusBorder': '#007fd4', '--vscode-toolbar-hoverBackground': '#444444' },
    light: { '--vscode-foreground': '#333333', '--vscode-sideBar-background': '#f3f3f3', '--vscode-input-background': '#ffffff', '--vscode-input-foreground': '#333333', '--vscode-input-placeholderForeground': '#767676', '--vscode-descriptionForeground': '#616161', '--vscode-inputOption-activeBackground': '#cce5ff', '--vscode-inputOption-activeForeground': '#005a9e', '--vscode-inputOption-activeBorder': '#007acc', '--vscode-focusBorder': '#007acc', '--vscode-toolbar-hoverBackground': '#e0e0e0' },
    contrast: { '--vscode-foreground': '#ffffff', '--vscode-sideBar-background': '#000000', '--vscode-input-background': '#000000', '--vscode-input-foreground': '#ffffff', '--vscode-input-placeholderForeground': '#ffffff', '--vscode-descriptionForeground': '#ffffff', '--vscode-inputOption-activeBackground': '#000000', '--vscode-inputOption-activeForeground': '#f38518', '--vscode-inputOption-activeBorder': '#f38518', '--vscode-focusBorder': '#f38518', '--vscode-contrastBorder': '#ffffff', '--vscode-toolbar-hoverBackground': '#333333' }
};
const media = new Map(await Promise.all(['sidebar.css', 'sidebar.js', 'case-sensitive.svg', 'regex.svg', 'circle-slash.svg'].map(async name => [name, await readFile(new URL('../media/' + name, import.meta.url))])));
const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    const theme = themes[url.searchParams.get('theme')] ?? themes.dark;
    if (url.pathname === '/') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(sidebarHtml({ nonce: 'sidebar-ui-test', cspSource: "'self'", styleUri: `/media/sidebar.css?theme=${url.searchParams.get('theme')}`, scriptUri: '/media/sidebar.js', options: { ignoreCase: true, useRegex: false, includeIgnored: false } }));
        return;
    }
    const name = url.pathname.slice('/media/'.length);
    const asset = url.pathname.startsWith('/media/') ? media.get(name) : undefined;
    if (!asset) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'application/javascript' : 'image/svg+xml');
    const variables = Object.entries({ ...common, ...theme }).map(([key, value]) => `${key}:${value}`).join(';');
    response.end(name.endsWith('.css') ? `:root{${variables}}\n${asset}` : asset);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
let browser;
try {
    // Use an existing browser, never download one as part of this test.
    browser = await chromium.launch({ headless: true, ...(process.env.UI_BROWSER_EXECUTABLE ? { executablePath: process.env.UI_BROWSER_EXECUTABLE } : { channel: 'msedge' }) });
    for (const theme of Object.keys(themes)) {
        for (const width of [360, 220, 150]) {
            const page = await browser.newPage({ viewport: { width, height: 240 }, deviceScaleFactor: 2 });
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); } });
            await page.addInitScript(() => {
                let state;
                window.__messages = [];
                window.acquireVsCodeApi = () => ({ getState: () => state, setState: value => { state = value; }, postMessage: message => window.__messages.push(message) });
            });
            await page.goto(`http://127.0.0.1:${address.port}/?theme=${theme}`);
            await page.waitForFunction(() => window.__messages.some(message => message.type === 'ready'));
            const input = page.getByRole('textbox', { name: 'Search filenames' });
            await input.fill('App');
            const buttons = page.getByRole('group', { name: 'Search options' }).getByRole('button');
            assert.equal(await buttons.count(), 3);
            const field = await page.getByRole('search').boundingBox();
            const inputBox = await input.boundingBox();
            for (const button of await buttons.all()) {
                const box = await button.boundingBox();
                assert.ok(box.x >= field.x && box.x + box.width <= field.x + field.width, `${theme}/${width}: toggle outside field`);
                assert.ok(box.y >= field.y && box.y + box.height <= field.y + field.height, `${theme}/${width}: toggle wrapped out of field`);
                assert.ok(inputBox.x + inputBox.width <= box.x, `${theme}/${width}: text overlaps toggles`);
            }
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${theme}/${width}: horizontal overflow`);
            await page.getByRole('button', { name: 'Regular expression', exact: true }).click();
            assert.equal(await input.inputValue(), 'App');
            assert.ok(await page.evaluate(() => window.__messages.some(message => message.type === 'toggle' && message.key === 'useRegex')));
            await page.evaluate(() => window.postMessage({ type: 'options', options: { ignoreCase: true, useRegex: true, includeIgnored: false } }, '*'));
            await page.waitForFunction(() => document.querySelector('[data-option="useRegex"]').getAttribute('aria-pressed') === 'true');
            await input.focus();
            for (const key of ['ignoreCase', 'useRegex', 'includeIgnored']) {
                await page.keyboard.press('Tab');
                assert.equal(await page.evaluate(() => document.activeElement.dataset.option), key);
            }
            assert.equal(await page.getByRole('search').evaluate(element => window.getComputedStyle(element).outlineStyle), 'solid');
            await page.evaluate(() => window.postMessage({ type: 'results', status: '3 matches', options: { ignoreCase: true, useRegex: false, includeIgnored: false }, error: false, more: false, entries: [
                { id: '1', name: 'App.ts', path: 'src/App.ts' },
                { id: '2', name: 'App.test.ts', path: 'src/tests/App.test.ts' },
                { id: '3', name: 'MyApp.tsx', path: 'packages/web/MyApp.tsx' }
            ] }, '*'));
            await page.getByRole('button', { name: 'App.ts src/App.ts', exact: true }).waitFor();
            await input.focus();
            await page.mouse.move(width - 1, 239);
            if (width === 360) { await page.screenshot({ path: fileURLToPath(new URL(`sidebar-${theme}.png`, output)) }); }
            assert.deepEqual(errors, [], `${theme}/${width}: browser/CSP errors`);
            await page.close();
            console.log(`PASS ${theme} ${width}px: inline geometry, query retention, toggle messages, keyboard focus and CSP.`);
        }
    }
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
