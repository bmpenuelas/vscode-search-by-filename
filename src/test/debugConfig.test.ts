import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('F5 launches the extension, not the auto-exiting integration runner', async () => {
    const launch = JSON.parse(await readFile('.vscode/launch.json', 'utf8')) as {
        configurations: { type: string; request: string; runtimeExecutable?: string; args?: string[]; preLaunchTask?: string; address?: string; port?: number }[];
    };
    const main = launch.configurations[0]!;
    assert.equal(main.type, 'extensionHost');
    assert.equal(main.request, 'launch');
    assert.equal(main.runtimeExecutable, undefined);
    assert.equal(main.preLaunchTask, 'npm: compile');
    assert.deepEqual(main.args, ['--extensionDevelopmentPath=${workspaceFolder}']);
    assert.ok(!main.args?.some(argument => argument.startsWith('--extensionTestsPath')));
    assert.equal(launch.configurations.length, 1);
});

test('first crash-isolation experiment changes only debugger network inspection', async () => {
    const settings = JSON.parse(await readFile('.vscode/settings.json', 'utf8')) as Record<string, unknown>;
    assert.equal(settings['debug.javascript.enableNetworkView'], false);
    assert.deepEqual(Object.keys(settings).filter(key => key.startsWith('debug.')), ['debug.javascript.enableNetworkView']);
});
