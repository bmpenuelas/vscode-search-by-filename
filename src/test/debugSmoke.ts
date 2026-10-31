import * as vscode from 'vscode';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import assert from 'node:assert/strict';

/** Exercise the real js-debug extensionHost launch path, not only the test runner. */
export async function run(): Promise<void> {
    try { await checkDebugHost(); }
    catch (error) {
        console.error('Debug smoke failed:', error);
        await new Promise(resolve => setTimeout(resolve, 500));
        throw error;
    }
}

async function checkDebugHost(): Promise<void> {
    const projectPath = process.env.SEARCH_BY_FILENAME_PROJECT;
    assert.ok(projectPath, 'Missing target project path');
    const launch = JSON.parse(await readFile(path.join(projectPath, '.vscode/launch.json'), 'utf8')) as {
        configurations: vscode.DebugConfiguration[];
    };
    const template = launch.configurations.find(config => config.type === 'extensionHost');
    assert.ok(template);
    const config = JSON.parse(JSON.stringify(template)
        .replaceAll('${workspaceFolder}', projectPath.replaceAll('\\', '/'))
        .replaceAll('${execPath}', process.execPath.replaceAll('\\', '/'))) as vscode.DebugConfiguration;
    config.name = 'Search by filename debug smoke';
    delete config.preLaunchTask; // The npm runner already compiled the extension.
    config.args = [...config.args as string[], '--extensionTestsPath=', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'];
    config.timeout = 30000;
    config.trace = { logFile: path.join(projectPath, '.vscode-test/debug-smoke.log') };
    let rootSession: vscode.DebugSession | undefined;
    let session: vscode.DebugSession | undefined;
    let terminated = false;
    const started = vscode.debug.onDidStartDebugSession(value => {
        if (value.name === config.name) { rootSession = value; }
        let parent = value.parentSession;
        while (parent) {
            if (parent.name === config.name && value.name.startsWith('Extension Host')) { session = value; }
            parent = parent.parentSession;
        }
        console.log(`Debug session started: ${value.type} (${value.name})`);
    });
    const ended = vscode.debug.onDidTerminateDebugSession(value => {
        if (value.id === session?.id) { terminated = true; }
    });
    const until = async (condition: () => boolean) => {
        const deadline = Date.now() + 30000;
        while (!condition()) {
            if (Date.now() > deadline) { throw new Error('Timed out waiting for the debug session'); }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    };
    try {
        console.log('Starting the extensionHost debugger with the configured/default debugger settings.');
        assert.ok(await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], config));
        await until(() => !!session);
        assert.ok(session && !terminated, 'Debug host terminated during startup');
        // Observed failures abort in about one second, before the first exthost log.
        await new Promise(resolve => setTimeout(resolve, 10000));
        assert.equal(terminated, false, 'Extension Host closed unexpectedly after launch');
        const response = await Promise.race([
            session.customRequest('evaluate', { expression: 'process.pid', context: 'repl' }) as Promise<{ result: string }>,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Debugger evaluation timed out')), 5000))
        ]);
        assert.match(response.result, /^\d+$/);
        console.log(`F5-path debug host stayed alive and responded to debugger evaluation (PID ${response.result}).`);
    } finally {
        if (session && !terminated) { await vscode.debug.stopDebugging(session); }
        if (rootSession) { await vscode.debug.stopDebugging(rootSession); }
        started.dispose(); ended.dispose();
    }
}
