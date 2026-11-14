import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {postgresCluster} from '../tests/fixtures/postgres-cluster';
import {mysqlCluster} from '../tests/fixtures/mysql-cluster';
import {mongodbCluster} from '../tests/fixtures/mongodb-cluster';
import {assertPackagedDocs} from './package-docs';
const flags = process.argv.slice(2); if(flags.length > 1 || flags.some(flag => !['--postgres','--mysql','--mongodb'].includes(flag))) throw new Error('Select one packed host backend: default SQLite, --postgres, --mysql or --mongodb.');
const database = flags[0]?.slice(2) || 'sqlite';
let mongodb: Awaited<ReturnType<typeof mongodbCluster>> | undefined;
let postgres: Awaited<ReturnType<typeof postgresCluster>> | undefined, mysql: Awaited<ReturnType<typeof mysqlCluster>> | undefined;
const exec = promisify(execFile), dir = await mkdtemp(join(tmpdir(),'huddle-host-consumer-'));
try {
  const root = JSON.parse(await readFile('package.json','utf8')), metadata = JSON.parse(await readFile('packages/host/package.json','utf8'));
  await readFile(`packages/host/dist/${database}.js`);
  let imports = "import {installSqlite,SqliteBackend} from '@huddle/host/sqlite';", setup = "const path='./disposable.sqlite';installSqlite(path);let backend=new SqliteBackend(path);", reopen = 'new SqliteBackend(path)', finish = '', dependencies = {}, development: string[] = [];
  if(database === 'postgres') {
    postgres = await postgresCluster(); const schema = postgres.allocateSchema(); await writeFile(join(dir,'fixture.json'),JSON.stringify({connection:postgres.connection,nonce:postgres.nonce,schema}),{mode:0o600});
    imports = "import {installPostgres,PostgresBackend} from '@huddle/host/postgres';import {Pool} from 'pg';import {readFile} from 'node:fs/promises';";
    setup = "const fixture=JSON.parse(await readFile('./fixture.json','utf8'));const pool=new Pool(fixture.connection);const proof=await pool.query(\"select current_setting('huddle.fixture_nonce') nonce\");assert.equal(proof.rows[0].nonce,fixture.nonce);await installPostgres(pool,{schema:fixture.schema});let backend=await PostgresBackend.open(pool,{schema:fixture.schema});";
    reopen = 'await PostgresBackend.open(pool,{schema:fixture.schema})'; finish = "assert.equal((await pool.query('SELECT 1 alive')).rows[0].alive,1);await pool.end();";
    dependencies = {pg:root.devDependencies.pg}; development = [`@types/pg@${root.devDependencies['@types/pg']}`];
  } else if(database === 'mysql') {
    mysql = await mysqlCluster(); const prefix = mysql.allocatePrefix(); await writeFile(join(dir,'fixture.json'),JSON.stringify({connection:mysql.connection,nonce:mysql.nonce,prefix}),{mode:0o600});
    imports = "import {installMysql,MysqlBackend} from '@huddle/host/mysql';import {createPool,type RowDataPacket} from 'mysql2/promise';import {readFile} from 'node:fs/promises';";
    setup = "const fixture=JSON.parse(await readFile('./fixture.json','utf8'));const pool=createPool(fixture.connection);const [proof]=await pool.query<RowDataPacket[]>('SELECT nonce FROM fixture_owner');assert.equal(proof[0].nonce,fixture.nonce);await installMysql(pool,{prefix:fixture.prefix});let backend=await MysqlBackend.open(pool,{prefix:fixture.prefix});";
    reopen = 'await MysqlBackend.open(pool,{prefix:fixture.prefix})'; finish = "const [alive]=await pool.query<RowDataPacket[]>('SELECT 1 alive');assert.equal(alive[0].alive,1);await pool.end();";
    dependencies = {mysql2:root.devDependencies.mysql2};
  }
  if(database === 'mongodb') {
    mongodb = await mongodbCluster(); const prefix = mongodb.allocatePrefix(); await writeFile(join(dir,'fixture.json'),JSON.stringify({uri:mongodb.uri,nonce:mongodb.nonce,prefix}),{mode:0o600});
    imports = "import {installMongodb,MongodbBackend} from '@huddle/host/mongodb';import {MongoClient} from 'mongodb';import {readFile} from 'node:fs/promises';";
    setup = "const fixture=JSON.parse(await readFile('./fixture.json','utf8'));const client=new MongoClient(fixture.uri,{serverSelectionTimeoutMS:1000,connectTimeoutMS:1000,socketTimeoutMS:2000});const db=client.db('huddle_fixture');const proof=await db.collection('fixture_owner').findOne({nonce:fixture.nonce});assert.equal(proof?.nonce,fixture.nonce);await installMongodb(client,db,{prefix:fixture.prefix});let backend=await MongodbBackend.open(client,db,{prefix:fixture.prefix});";
    reopen = 'await MongodbBackend.open(client,db,{prefix:fixture.prefix})'; finish = "assert.equal((await db.command({ping:1})).ok,1);await client.close();";
    dependencies = {mongodb:root.devDependencies.mongodb};
  }
  await exec('pnpm',['--dir','packages/host','pack','--pack-destination',join(dir,'archive')]);
  await writeFile(join(dir,'package.json'),JSON.stringify({private:true,type:'module',dependencies:{...dependencies,'@huddle/host':`file:${join(dir,'archive',`huddle-host-${metadata.version}.tgz`)}`}}));
  await exec('npm',['install','--ignore-scripts','--no-audit','--no-fund'],{cwd:dir});
  assertPackagedDocs(join(dir,'node_modules/@huddle/host'));
  const source = `import {ReviewStore,CollaborationError,type Scope} from '@huddle/host';
${imports}
import assert from 'node:assert/strict';
${setup}
const authorize=async(scope:Scope)=>{if(scope.workspace!=='team')throw new CollaborationError('forbidden','Denied');return {actor:{id:'host:actor',name:'Consumer'},capabilities:{mentions:false,assignment:false,directory:false}}};
const scope={workspace:'team',environment:'preview'},signal=new AbortController().signal;
let store=new ReviewStore(backend,authorize);
const input={idempotencyKey:'consumer-retry',page:'/',pageUrl:'https://example.test/',anchor:{kind:'page' as const,selector:'body',label:'Page',quote:'',x:0,y:0},body:'From a packed server consumer'};
const saved=await store.create(scope,input,signal);await backend.close();backend=${reopen};store=new ReviewStore(backend,authorize);
assert.equal((await store.create(scope,input,signal)).thread.id,saved.thread.id);
assert.equal((await store.list(scope,{},signal)).items.length,1);
await assert.rejects(store.detail({...scope,workspace:'denied'},saved.thread.id,{},signal),{code:'forbidden'});
await backend.close();${finish}console.log('Packed ${database} host consumer: install, typecheck, persistence, retry and denial passed.');
`;
  await writeFile(join(dir,'consumer.ts'),source);
  await writeFile(join(dir,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2023',module:'NodeNext',moduleResolution:'NodeNext',strict:true,skipLibCheck:false,types:['node'],lib:['ES2023','DOM'],outDir:'compiled'},files:['consumer.ts']}));
  // Node types stay a consumer development dependency, never a browser runtime dependency.
  await exec('npm',['install','--save-dev',`@types/node@${root.devDependencies['@types/node']}`,...development,'--ignore-scripts','--no-audit','--no-fund'],{cwd:dir});
  await exec(process.execPath,[resolve('node_modules/typescript/bin/tsc'),'-p',join(dir,'tsconfig.json')],{maxBuffer:2*1024*1024});
  const result = await exec(process.execPath,[join(dir,'compiled/consumer.js')],{cwd:dir}); console.log(result.stdout.trim());
  await mkdir('output/package',{recursive:true}); await writeFile(`output/package/host-consumer${database === 'sqlite' ? '' : '-'+database}.json`,JSON.stringify({version:metadata.version,node:process.version,backend:database,databaseVersion:postgres?.version ?? mysql?.version ?? mongodb?.version,install:'passed',typecheck:'passed',persistence:'passed',retry:'passed',denial:'passed'},null,2)+'\n');
} finally {try {await postgres?.close(); await mysql?.close(); await mongodb?.close();} finally {await rm(dir,{recursive:true,force:true});}}
