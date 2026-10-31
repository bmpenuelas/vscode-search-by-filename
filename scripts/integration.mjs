import {runTests} from '@vscode/test-electron';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const fixture=await mkdtemp(path.join(os.tmpdir(),'search-filename-integration-'));
try {
 await mkdir(path.join(fixture,'node_modules/example'),{recursive:true});
 await writeFile(path.join(fixture,'.gitignore'),'node_modules/\n');
 await writeFile(path.join(fixture,'App.ts'),'');
 await writeFile(path.join(fixture,'node_modules/example/ignored.js'),'');
 await runTests({version:process.env.VSCODE_VERSION ?? '1.109.0',extensionDevelopmentPath:process.cwd(),extensionTestsPath:path.resolve('dist/test/integration.js'),launchArgs:[fixture,'--disable-extensions','--skip-welcome','--skip-release-notes','--disable-workspace-trust'],...(process.env.VSCODE_EXECUTABLE_PATH ? {vscodeExecutablePath:process.env.VSCODE_EXECUTABLE_PATH}: {})});
} finally {await rm(fixture,{recursive:true,force:true});}
