import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
const exec = promisify(execFile), dir = await mkdtemp(join(tmpdir(),'huddle-host-consumer-'));
try {
  const metadata = JSON.parse(await readFile('packages/host/package.json','utf8'));
  await exec('pnpm',['--dir','packages/host','pack','--pack-destination',join(dir,'archive')]);
  await writeFile(join(dir,'package.json'),JSON.stringify({private:true,type:'module',dependencies:{'@huddle/host':`file:${join(dir,'archive',`huddle-host-${metadata.version}.tgz`)}`}}));
  await exec('npm',['install','--ignore-scripts','--no-audit','--no-fund'],{cwd:dir});
  const source = `import {ReviewStore,CollaborationError,type Scope} from '@huddle/host';
import {installSqlite,SqliteBackend} from '@huddle/host/sqlite';
import assert from 'node:assert/strict';
const path='./disposable.sqlite';installSqlite(path);let backend=new SqliteBackend(path);
const authorize=async(scope:Scope)=>{if(scope.workspace!=='team')throw new CollaborationError('forbidden','Denied');return {actor:{id:'host:actor',name:'Consumer'},capabilities:{mentions:false,assignment:false,directory:false}}};
const scope={workspace:'team',environment:'preview'},signal=new AbortController().signal;
let store=new ReviewStore(backend,authorize);
const input={idempotencyKey:'consumer-retry',page:'/',pageUrl:'https://example.test/',anchor:{kind:'page' as const,selector:'body',label:'Page',quote:'',x:0,y:0},body:'From a packed server consumer'};
const saved=await store.create(scope,input,signal);await backend.close();backend=new SqliteBackend(path);store=new ReviewStore(backend,authorize);
assert.equal((await store.create(scope,input,signal)).thread.id,saved.thread.id);
assert.equal((await store.list(scope,{},signal)).items.length,1);
await assert.rejects(store.detail({...scope,workspace:'denied'},saved.thread.id,{},signal),{code:'forbidden'});
await backend.close();console.log('Packed host consumer: install, typecheck, persistence, retry and denial passed.');
`;
  await writeFile(join(dir,'consumer.ts'),source);
  await writeFile(join(dir,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2023',module:'NodeNext',moduleResolution:'NodeNext',strict:true,skipLibCheck:false,types:['node'],lib:['ES2023','DOM'],outDir:'compiled'},files:['consumer.ts']}));
  // Node types stay a consumer development dependency, never a browser runtime dependency.
  const root = JSON.parse(await readFile('package.json','utf8'));
  await exec('npm',['install','--save-dev',`@types/node@${root.devDependencies['@types/node']}`,'--ignore-scripts','--no-audit','--no-fund'],{cwd:dir});
  await exec(process.execPath,[resolve('node_modules/typescript/bin/tsc'),'-p',join(dir,'tsconfig.json')],{maxBuffer:2*1024*1024});
  const result = await exec(process.execPath,[join(dir,'compiled/consumer.js')],{cwd:dir}); console.log(result.stdout.trim());
  await mkdir('output/package',{recursive:true}); await writeFile('output/package/host-consumer.json',JSON.stringify({version:metadata.version,node:process.version,install:'passed',typecheck:'passed',persistence:'passed',retry:'passed',denial:'passed'},null,2)+'\n');
} finally {await rm(dir,{recursive:true,force:true});}
