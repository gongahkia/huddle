import {spawn} from 'node:child_process';
import {closeSync,openSync} from 'node:fs';
import {access,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {MongoClient} from 'mongodb';
import {collections} from '../../packages/host/src/backend';
import {bounded} from './lifecycle';
async function unusedPort() {const server = createServer(); await new Promise<void>((done,reject) => {server.once('error',reject); server.listen(0,'127.0.0.1',done);}); const address = server.address(); if(!address || typeof address === 'string') throw new Error('No disposable MongoDB port.'); await new Promise<void>((done,reject) => server.close(error => error ? reject(error) : done())); return address.port;}
export async function mongodbCluster(replicaSet = true) {
  const bin = resolve(process.env.HUDDLE_TEST_MONGODB_BIN || 'output/runtime/mongodb-fixture-8.0.38/bin');
  try {await access(join(bin,'mongod'));} catch {throw new Error('MongoDB conformance needs mongod. Set HUDDLE_TEST_MONGODB_BIN; no existing database URL is accepted.');}
  const directory = await mkdtemp(join(tmpdir(),'huddle-mongodb-v2-')), data = join(directory,'data'), nonce = randomUUID(), marker = join(directory,'fixture.json'), setName = 'ht_'+nonce.replaceAll('-',''), port = await unusedPort(); await mkdir(data,{mode:0o700});
  await writeFile(marker,JSON.stringify({kind:'huddle-disposable-mongodb',nonce,directory}),{mode:0o600});
  const verifyMarker = async () => {const value = JSON.parse(await readFile(marker,'utf8')); if(value.kind !== 'huddle-disposable-mongodb' || value.nonce !== nonce || value.directory !== directory) throw new Error('Refusing to clean up an unverified MongoDB fixture.');};
  const log = openSync(join(directory,'mongodb.log'),'w',0o600), child = spawn(join(bin,'mongod'),['--dbpath',data,'--bind_ip','127.0.0.1','--port',String(port),'--nounixsocket','--wiredTigerCacheSizeGB','0.25','--setParameter','diagnosticDataCollectionEnabled=false','--setParameter','enableTestCommands=1',...(replicaSet ? ['--replSet',setName] : [])],{stdio:['ignore',log,log]}); closeSync(log);
  let spawnError: Error | undefined; child.once('error',error => {spawnError = error;}); const exited = new Promise<void>(done => {child.once('exit',() => done()); child.once('error',() => done());});
  const uri = `mongodb://127.0.0.1:${port}/?directConnection=true`, client = new MongoClient(uri,{serverSelectionTimeoutMS:500,connectTimeoutMS:500,socketTimeoutMS:2000}), database = client.db('huddle_fixture'), prefixes = new Set<string>(); let closing: Promise<void> | undefined;
  async function stop() {await verifyMarker(); if(child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await bounded(exited,5000,() => {if(child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');}); await exited;}
  async function close() {if(!closing) closing = (async () => {await verifyMarker(); try {await client.close();} finally {await stop(); await verifyMarker(); await rm(directory,{recursive:true,force:true});}})(); return closing;}
  async function verifyProcess() {await verifyMarker(); const config = await client.db('admin').command({getCmdLineOpts:1}); if(resolve(config.parsed.storage.dbPath) !== data || (replicaSet && (config.parsed.replication.replSetName ?? config.parsed.replication.replSet) !== setName)) throw new Error('The connected process is not this task-owned MongoDB fixture.');}
  async function verify() {await verifyProcess(); const owner = await database.collection('fixture_owner').findOne({nonce}); if(!owner) throw new Error('The connected database is not this owned MongoDB fixture.'); return String((await client.db('admin').command({buildInfo:1})).version);}
  try {
    let ready = false, lastError = '';
    for(let attempt=0;attempt<80;attempt++) {if(spawnError || child.exitCode !== null || child.signalCode !== null) throw new Error(`MongoDB fixture failed to start: ${(await readFile(join(directory,'mongodb.log'),'utf8')).slice(-2000)}`); try {await client.connect(); await client.db('admin').command({ping:1}); ready = true; break;} catch(value) {lastError = value instanceof Error ? value.message : 'Unknown fixture failure'; await delay(50);}}
    if(!ready) throw new Error(`Timed out starting the task-owned MongoDB fixture: ${lastError}; ${(await readFile(join(directory,'mongodb.log'),'utf8')).slice(-3000)}`); await verifyProcess();
    if(replicaSet) {await client.db('admin').command({replSetInitiate:{_id:setName,members:[{_id:0,host:`127.0.0.1:${port}`} ]}}); let primary = false; for(let attempt=0;attempt<200;attempt++) {if((await client.db('admin').command({hello:1})).isWritablePrimary) {primary = true; break;} await delay(50);} if(!primary) throw new Error('Disposable MongoDB replica set did not become primary.');}
    await database.collection('fixture_owner').insertOne({nonce},{writeConcern:{w:'majority'}}); const version = await verify(); if(!/^8\.0\./.test(version)) throw new Error('The pinned MongoDB fixture requires MongoDB 8.0.');
    return {client,database,version,nonce,uri,verify,close,stop,allocatePrefix() {const prefix = `ht_${randomUUID().replaceAll('-','').slice(0,16)}_`; prefixes.add(prefix); return prefix;},async dropPrefix(prefix: string) {if(!prefixes.has(prefix) || !/^ht_[a-f0-9]{16}_$/.test(prefix)) throw new Error('Refusing to drop unowned MongoDB collections.'); await verify(); const existing = new Set((await database.listCollections({},{nameOnly:true}).toArray()).map(item => item.name)); for(const suffix of ['meta',...collections]) if(existing.has(prefix+suffix)) await database.collection(prefix+suffix).drop(); prefixes.delete(prefix);}};
  } catch (value) {await close(); throw value;}
}
