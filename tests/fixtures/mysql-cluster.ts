import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {closeSync,openSync} from 'node:fs';
import {access,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createPool,type RowDataPacket} from 'mysql2/promise';
import {collections} from '../../packages/host/src/backend';
import {bounded} from './lifecycle';
const exec = promisify(execFile);
export async function mysqlCluster() {
  const bin = resolve(process.env.HUDDLE_TEST_MYSQL_BIN || 'output/runtime/mysql-8.4.13/bin'), basedir = resolve(bin,'..');
  try {await access(join(bin,'mysqld'));} catch {throw new Error('MySQL conformance needs mysqld. Set HUDDLE_TEST_MYSQL_BIN to its directory; no existing database URL is accepted.');}
  const directory = await mkdtemp(join(tmpdir(),'huddle-mysql-v2-')), data = join(directory,'data'), socket = join(directory,'mysql.sock'), nonce = randomUUID(), marker = join(directory,'fixture.json');
  await writeFile(marker,JSON.stringify({kind:'huddle-disposable-mysql',nonce,directory}),{mode:0o600});
  const verifyMarker = async () => {const value = JSON.parse(await readFile(marker,'utf8')); if (value.kind !== 'huddle-disposable-mysql' || value.nonce !== nonce || value.directory !== directory) throw new Error('Refusing to clean up an unverified MySQL fixture.');};
  const user = process.getuid?.() === 0 ? ['--user=root'] : [];
  try {await exec(join(bin,'mysqld'),['--no-defaults',...user,'--initialize-insecure',`--basedir=${basedir}`,`--datadir=${data}`,`--log-error=${join(directory,'initialize.log')}`],{timeout:30000,maxBuffer:2*1024*1024});}
  catch (value) {await verifyMarker(); await rm(directory,{recursive:true,force:true}); throw value;}
  const log = openSync(join(directory,'mysql.log'),'w',0o600), mysqlChild = spawn(join(bin,'mysqld'),['--no-defaults',...user,`--basedir=${basedir}`,`--datadir=${data}`,`--socket=${socket}`,'--skip-networking','--mysqlx=0','--max-connections=30','--innodb-buffer-pool-size=32M','--innodb-redo-log-capacity=16M',`--pid-file=${join(directory,'mysql.pid')}`],{stdio:['ignore',log,log]}); closeSync(log);
  let spawnError: Error | undefined; mysqlChild.once('error',value => {spawnError = value;}); const exited = new Promise<void>(done => {mysqlChild.once('exit',() => done()); mysqlChild.once('error',() => done());});
  const connection = {socketPath:socket,user:'root',charset:'utf8mb4_bin',connectTimeout:1000}, admin = createPool({...connection,connectionLimit:2}), pool = createPool({...connection,database:'huddle_fixture',connectionLimit:16});
  const prefixes = new Set<string>(); let closing: Promise<void> | undefined;
  async function close() {
    if (!closing) closing = (async () => {
      await verifyMarker(); const ended = Promise.all([pool.end(),admin.end()]);
      try {await bounded(ended,3000,() => {throw new Error('Fixture pool did not drain.');});}
      finally {if (mysqlChild.exitCode === null && mysqlChild.signalCode === null) mysqlChild.kill('SIGTERM'); await bounded(exited,5000,() => {if(mysqlChild.exitCode === null && mysqlChild.signalCode === null) mysqlChild.kill('SIGKILL');}); await exited; await ended; await verifyMarker(); await rm(directory,{recursive:true,force:true});}
    })(); return closing;
  }
  async function verify() {await verifyMarker(); const [result] = await pool.query<RowDataPacket[]>('SELECT nonce,@@datadir data,VERSION() version FROM fixture_owner'); if (result.length !== 1 || result[0].nonce !== nonce || resolve(String(result[0].data)) !== data) throw new Error('The connected database is not this task-owned MySQL fixture.'); return String(result[0].version);}
  try {
    let ready = false;
    for(let attempt=0;attempt<200;attempt++) {
      if (spawnError || mysqlChild.exitCode !== null || mysqlChild.signalCode !== null) throw new Error(`MySQL fixture failed to start: ${(await readFile(join(directory,'mysql.log'),'utf8')).slice(-2000)}`);
      try {const [info] = await admin.query<RowDataPacket[]>('SELECT @@datadir data'); if(resolve(String(info[0].data)) !== data) throw new Error('Wrong MySQL data directory.'); ready = true; break;} catch {await delay(50);}
    }
    if (!ready) throw new Error('Timed out starting the task-owned MySQL fixture.');
    await admin.execute('CREATE DATABASE huddle_fixture CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'); await pool.execute('CREATE TABLE fixture_owner(nonce VARCHAR(64) PRIMARY KEY) ENGINE=InnoDB'); await pool.execute('INSERT INTO fixture_owner VALUES(?)',[nonce]);
    const version = await verify(); if (!/^8\.4\./.test(version)) throw new Error('The maintained MySQL fixture requires real MySQL 8.4, not a substitute database.');
    return {pool,version,nonce,connection:{...connection,database:'huddle_fixture'},verify,close,
      allocatePrefix() {const prefix = `ht_${randomUUID().replaceAll('-','').slice(0,16)}_`; prefixes.add(prefix); return prefix;},
      async dropPrefix(prefix: string) {if(!prefixes.has(prefix) || !/^ht_[a-f0-9]{16}_$/.test(prefix)) throw new Error('Refusing to drop tables not created by this fixture.'); await verify(); await pool.query(`DROP TABLE IF EXISTS ${['meta',...collections].map(name => '`'+prefix+name+'`').join(',')}`); prefixes.delete(prefix);},
    };
  } catch (value) {await close(); throw value;}
}
