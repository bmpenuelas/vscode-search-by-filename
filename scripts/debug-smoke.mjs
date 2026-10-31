import { runTests } from '@vscode/test-electron';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

// Isolate test settings from the user's editor/profile and preserve the real worktree.
const fixtureRoot = path.resolve('.test-workspaces');
await mkdir(fixtureRoot, { recursive: true });
const fixture = await mkdtemp(path.join(fixtureRoot, 'debug-smoke-'));
if (path.dirname(fixture) !== fixtureRoot) { throw new Error('Unexpected debug fixture location'); }
try {
    await mkdir(path.join(fixture, '.vscode'));
    let settings = '{}';
    try { settings = await readFile('.vscode/settings.json', 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') { throw error; } }
    await writeFile(path.join(fixture, '.vscode/settings.json'), settings);
    const driver = path.join(fixture, 'driver');
    await mkdir(driver);
    await writeFile(path.join(driver, 'package.json'), JSON.stringify({
        name: 'filename-debug-test-driver', publisher: 'bmpenuelas', version: '0.0.0', engines: { vscode: '^1.109.0' }
    }));
    await runTests({
        version: process.env.VSCODE_VERSION ?? 'stable',
        // Using the target as the test driver makes VS Code reuse/reload the test window
        // when the debugger launches it, terminating the runner instead of testing F5.
        extensionDevelopmentPath: driver,
        extensionTestsPath: path.resolve('dist/test/debugSmoke.js'),
        extensionTestsEnv: { SEARCH_BY_FILENAME_PROJECT: process.cwd() },
        launchArgs: [fixture, '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust'],
        ...(process.env.VSCODE_EXECUTABLE_PATH ? { vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH } : {})
    });
} finally {
    await rm(fixture, { recursive: true, force: true });
}
