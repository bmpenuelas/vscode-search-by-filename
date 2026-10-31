import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import {writeFile} from 'node:fs/promises';
const {search} = createRequire(import.meta.url)('../dist/search/match.js');
const options={ignoreCase:true,useRegex:false,includeIgnored:false};
const rows=[];
for(const count of [1000,10000,100000,500000]) {
 const startMemory=process.memoryUsage().heapUsed;
 let start=performance.now();
 const files=new Map();
 for(let i=0;i<count;i++) {
  const name=`${i%7===0?'App':'component'}-${i}.test.ts`;
  const id=`file:///workspace/src/group-${i%100}/${name}`;
  files.set(id,{id,name,lowerName:name.toLowerCase(),relativePath:`src/group-${i%100}/${name}`,normal:true});
 }
 const construction=performance.now()-start;
 const heap=(process.memoryUsage().heapUsed-startMemory)/1024/1024;
 start=performance.now();
 for(let i=0;i<1000;i++) files.set(`new${i}`,{id:`new${i}`,name:'new.ts',lowerName:'new.ts',relativePath:'new.ts',normal:true});
 const insertion=performance.now()-start;
 start=performance.now();for(let i=0;i<1000;i++)files.delete(`new${i}`);
 const deletion=performance.now()-start;
 async function measure(query,settings) {
  await search(files.values(),query,settings,200);
  const times=[];
  for(let i=0;i<5;i++) {const now=performance.now();await search(files.values(),query,settings,200);times.push(performance.now()-now);}
  return times.sort((a,b)=>a-b)[2];
 }
 rows.push({files:count,constructMs:construction,insert1000Ms:insertion,delete1000Ms:deletion,
  literalMs:await measure('app',options),caseSensitiveMs:await measure('App',{...options,ignoreCase:false}),
  regexMs:await measure('^App-\\d+\\.test\\.ts$',{...options,useRegex:true}),rankingTop200Ms:await measure('',options),approxHeapMiB:heap});
 files.clear();
}
const rounded=rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,key==='files'?value:Math.round(value*100)/100])));
console.table(rounded);
await writeFile('BENCHMARKS.json',JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,date:new Date().toISOString(),note:'Synthetic metadata construction (not filesystem I/O). Search includes bounded ranking; median of 5 warmed runs, top 200. Heap delta is approximate, without forced GC; excludes URI objects and worker mirror.',results:rounded},null,2)+'\n');
