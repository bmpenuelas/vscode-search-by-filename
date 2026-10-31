const vscode = acquireVsCodeApi();
const query = document.getElementById('query');
const results = document.getElementById('results');
const status = document.getElementById('status');
const more = document.getElementById('more');
let previous = vscode.getState();
if (previous && typeof previous.query === 'string') { query.value = previous.query; }
query.addEventListener('input', () => { vscode.setState({ query: query.value }); vscode.postMessage({ type: 'query', value: query.value }); });
document.querySelectorAll('[data-option]').forEach(button => button.addEventListener('click', () => vscode.postMessage({ type: 'toggle', key: button.dataset.option })));
more.addEventListener('click', () => vscode.postMessage({ type: 'more' }));
results.addEventListener('keydown', event => {
    const buttons = [...results.querySelectorAll('button')];
    let index = buttons.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { index++; }
    else if (event.key === 'ArrowUp') { index--; }
    else if (event.key === 'Home') { index = 0; }
    else if (event.key === 'End') { index = buttons.length - 1; }
    else { return; }
    event.preventDefault(); buttons[Math.max(0, Math.min(buttons.length - 1, index))]?.focus();
});
query.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); results.querySelector('button')?.focus(); } });
window.addEventListener('message', ({ data }) => {
    if (data.type === 'focus') { if (typeof data.query === 'string') { query.value = data.query; } query.focus(); }
    if (data.type === 'busy') { results.setAttribute('aria-busy', 'true'); status.textContent = 'Searching…'; status.classList.remove('error'); }
    if (data.type === 'results' || data.type === 'options') {
        for (const button of document.querySelectorAll('[data-option]')) {
            const checked = !!data.options[button.dataset.option];
            button.setAttribute('aria-pressed', String(checked));
            button.title = button.getAttribute('aria-label') + ': ' + (checked ? 'on' : 'off');
        }
    }
    if (data.type !== 'results') { return; }
    results.setAttribute('aria-busy', 'false');
    status.textContent = data.status; status.classList.toggle('error', data.error);
    const activeId = results.contains(document.activeElement) ? document.activeElement.dataset.id : undefined;
    const fragment = document.createDocumentFragment();
    for (const entry of data.entries) {
        const button = document.createElement('button'); button.className = 'result'; button.title = entry.path; button.dataset.id = entry.id;
        const name = document.createElement('span'); name.className = 'filename'; name.textContent = entry.name;
        const path = document.createElement('span'); path.className = 'path'; path.textContent = entry.path;
        button.append(name, path); button.addEventListener('click', () => vscode.postMessage({ type: 'open', id: entry.id }));
        fragment.append(button);
    }
    if (!data.entries.length && !data.error) { const empty = document.createElement('p'); empty.textContent = 'No matching files.'; fragment.append(empty); }
    results.replaceChildren(fragment); more.hidden = !data.more;
    if (activeId) { [...results.querySelectorAll('button')].find(button => button.dataset.id === activeId)?.focus({ preventScroll: true }); }
});
vscode.postMessage({ type: 'ready' });
