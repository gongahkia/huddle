import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {closeSync,openSync} from 'node:fs';
import {access,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';
const exec = promisify(execFile);
async function bounded<T>(promise: Promise<T>,ms: number,onTimeout: () => T | Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {return await Promise.race([promise,new Promise<T>((resolve,reject) => {timer = setTimeout(() => {Promise.resolve().then(onTimeout).then(resolve,reject);},ms);})]);}
  finally {clearTimeout(timer);}
}
export async function postgresCluster() {
  const bin = resolve(process.env.HUDDLE_TEST_PG_BIN || 'output/runtime/postgresql-18.6/usr/bin');
  try {await access(join(bin,'initdb')); await access(join(bin,'postgres'));} catch {throw new Error('PostgreSQL conformance needs server binaries. Set HUDDLE_TEST_PG_BIN to their directory; no existing database URL is accepted.');}
  let share: string | undefined;
  for (const candidate of [resolve(bin,'../share/postgresql'),resolve(bin,'../share')]) {try {await access(join(candidate,'postgres.bki')); share = candidate; break;} catch { /* native initdb can use its compiled distribution layout */ }}
  const directory = await mkdtemp(join(tmpdir(),'huddle-pg-v2-')), data = join(directory,'data'), socket = join(directory,'socket'), nonce = randomUUID(), marker = join(directory,'fixture.json');
  await mkdir(socket,{mode:0o700}); await writeFile(marker,JSON.stringify({kind:'huddle-disposable-postgres',nonce,directory}),{mode:0o600});
  const verifyMarker = async () => {const value = JSON.parse(await readFile(marker,'utf8')); if (value.kind !== 'huddle-disposable-postgres' || value.nonce !== nonce || value.directory !== directory) throw new Error('Refusing to clean up an unverified PostgreSQL fixture.');};
  try {await exec(join(bin,'initdb'),['-D',data,...(share ? ['-L',share] : []),'--username=huddle_fixture','--auth=trust','--encoding=UTF8','--locale=C','--locale-provider=libc'],{timeout:20000,maxBuffer:2*1024*1024});}
  catch (value) {await verifyMarker(); await rm(directory,{recursive:true,force:true}); throw value;}
  const log = openSync(join(directory,'postgres.log'),'w',0o600);
  const postgresChild = spawn(join(bin,'postgres'),['-D',data,'-h','','-k',socket,'-p','5432','-c',`huddle.fixture_nonce=${nonce}`,'-c','max_connections=30','-c','shared_buffers=16MB'],{stdio:['ignore',log,log]}); closeSync(log);
  let spawnError: Error | undefined; postgresChild.once('error',value => {spawnError = value;});
  const exited = new Promise<void>(done => {postgresChild.once('exit',() => done()); postgresChild.once('error',() => done());});
  const pool = new Pool({host:socket,port:5432,user:'huddle_fixture',database:'postgres',max:16,connectionTimeoutMillis:1000,idleTimeoutMillis:1000});
  const idleErrors: Error[] = []; pool.on('error',value => idleErrors.push(value));
  const schemas = new Set<string>(); let closing: Promise<void> | undefined;
  async function close() {
    if (!closing) closing = (async () => {
      await verifyMarker();
      const ended = pool.end();
      try {await bounded(ended,3000,() => {throw new Error('Fixture pool did not drain.');});}
      finally {
        if (postgresChild.exitCode === null && postgresChild.signalCode === null) postgresChild.kill('SIGTERM');
        await bounded(exited,5000,() => {if(postgresChild.exitCode === null && postgresChild.signalCode === null) postgresChild.kill('SIGKILL');}); await exited;
        await ended; await verifyMarker(); await rm(directory,{recursive:true,force:true});
      }
    })(); return closing;
  }
  async function verify() {await verifyMarker(); const result = await pool.query("SELECT current_setting('huddle.fixture_nonce') nonce,current_setting('server_version') version"); if (result.rows[0].nonce !== nonce) throw new Error('The connected database is not this task-owned PostgreSQL fixture.'); return String(result.rows[0].version);}
  try {
    let version: string | undefined;
    for (let attempt=0;attempt<100;attempt++) {
      if (spawnError || postgresChild.exitCode !== null || postgresChild.signalCode !== null) throw new Error(`PostgreSQL fixture failed to start: ${(await readFile(join(directory,'postgres.log'),'utf8')).slice(-2000)}`);
      try {version = await verify(); break;} catch {await delay(50);}
    }
    if (!version) throw new Error('Timed out starting the task-owned PostgreSQL fixture.');
    return {
      pool,version,idleErrors,verify,close,nonce,connection:{host:socket,port:5432,user:'huddle_fixture',database:'postgres'},
      allocateSchema() {const schema = `huddle_test_${randomUUID().replaceAll('-','')}`; schemas.add(schema); return schema;},
      async dropSchema(schema: string) {if (!schemas.has(schema) || !/^huddle_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Refusing to drop a schema not created by this fixture.'); await verify(); await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); schemas.delete(schema);},
    };
  } catch (value) {await close(); throw value;}
}
