import esbuild from 'esbuild';
import { readdir, mkdir } from 'node:fs/promises';
const tests = (await readdir('src/test')).filter(x=>x.endsWith('.test.ts'));
const options = {entryPoints: ['src/extension.ts','src/search/worker.ts','src/search/match.ts','src/ui/sidebarHtml.ts','src/test/integration.ts','src/test/debugSmoke.ts'],outbase:'src',outdir:'dist',bundle:true,platform:'node',target:'node22',external:['vscode'],sourcemap:true,logLevel:'info'};
await mkdir('dist',{recursive:true});
const unitOptions = {...options, entryPoints:tests.map(x=>'src/test/'+x), external:[], alias:{vscode:'./src/test/vscodeMock.ts'}};
if(process.argv.includes('--watch')) {for(const config of [options,unitOptions]) {const context=await esbuild.context(config);await context.watch();}} else {await esbuild.build(options);if(tests.length) await esbuild.build(unitOptions);}
