import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {postgresCluster} from '../tests/fixtures/postgres-cluster';
const postgres = process.argv.includes('--postgres');
let cluster: Awaited<ReturnType<typeof postgresCluster>> | undefined;
const exec = promisify(execFile), dir = await mkdtemp(join(tmpdir(),'huddle-host-consumer-'));
try {
  const root = JSON.parse(await readFile('package.json','utf8'));
  if (postgres) {await readFile('packages/host/dist/postgres.js'); cluster = await postgresCluster();}
  const metadata = JSON.parse(await readFile('packages/host/package.json','utf8'));
  await exec('pnpm',['--dir','packages/host','pack','--pack-destination',join(dir,'archive')]);
  await writeFile(join(dir,'package.json'),JSON.stringify({private:true,type:'module',dependencies:{...(postgres ? {pg:root.devDependencies.pg} : {}),'@huddle/host':`file:${join(dir,'archive',`huddle-host-${metadata.version}.tgz`)}`}}));
  await exec('npm',['install','--ignore-scripts','--no-audit','--no-fund'],{cwd:dir});
  const schema = cluster?.allocateSchema();
  if (cluster) await writeFile(join(dir,'fixture.json'),JSON.stringify({connection:cluster.connection,nonce:cluster.nonce,schema}),{mode:0o600});
  let source = `import {ReviewStore,CollaborationError,type Scope} from '@huddle/host';
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
  if (postgres) {
    source = source.replace("import {installSqlite,SqliteBackend} from '@huddle/host/sqlite';","import {installPostgres,PostgresBackend} from '@huddle/host/postgres';import {Pool} from 'pg';import {readFile} from 'node:fs/promises';");
    source = source.replace("const path='./disposable.sqlite';installSqlite(path);let backend=new SqliteBackend(path);","const fixture=JSON.parse(await readFile('./fixture.json','utf8'));const pool=new Pool(fixture.connection);const proof=await pool.query(\"select current_setting('huddle.fixture_nonce') nonce\");assert.equal(proof.rows[0].nonce,fixture.nonce);await installPostgres(pool,{schema:fixture.schema});let backend=await PostgresBackend.open(pool,{schema:fixture.schema});");
    source = source.replace('backend=new SqliteBackend(path);','backend=await PostgresBackend.open(pool,{schema:fixture.schema});');
    source = source.replace("await backend.close();console.log(","await backend.close();assert.equal((await pool.query('SELECT 1 alive')).rows[0].alive,1);await pool.end();console.log(");
  }
  await writeFile(join(dir,'consumer.ts'),source);
  await writeFile(join(dir,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2023',module:'NodeNext',moduleResolution:'NodeNext',strict:true,skipLibCheck:false,types:['node'],lib:['ES2023','DOM'],outDir:'compiled'},files:['consumer.ts']}));
  // Node types stay a consumer development dependency, never a browser runtime dependency.
  await exec('npm',['install','--save-dev',`@types/node@${root.devDependencies['@types/node']}`,...(postgres ? [`@types/pg@${root.devDependencies['@types/pg']}`] : []),'--ignore-scripts','--no-audit','--no-fund'],{cwd:dir});
  await exec(process.execPath,[resolve('node_modules/typescript/bin/tsc'),'-p',join(dir,'tsconfig.json')],{maxBuffer:2*1024*1024});
  const result = await exec(process.execPath,[join(dir,'compiled/consumer.js')],{cwd:dir}); console.log(result.stdout.trim());
  await mkdir('output/package',{recursive:true}); await writeFile(`output/package/host-consumer${postgres ? '-postgres' : ''}.json`,JSON.stringify({version:metadata.version,node:process.version,backend:postgres ? 'postgres' : 'sqlite',databaseVersion:cluster?.version,install:'passed',typecheck:'passed',persistence:'passed',retry:'passed',denial:'passed'},null,2)+'\n');
} finally {try {await cluster?.close();} finally {await rm(dir,{recursive:true,force:true});}}
