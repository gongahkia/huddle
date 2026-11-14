import {mkdtemp,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {collections,type RecordValue} from '../../packages/host/src/backend';
import {postgresCluster} from './postgres-cluster';
import {mysqlCluster} from './mysql-cluster';
import {mongodbCluster} from './mongodb-cluster';
import {installSqlite,SqliteBackend} from '../../packages/host/src/sqlite';
import {installPostgres,PostgresBackend} from '../../packages/host/src/postgres';
import {installMysql,MysqlBackend} from '../../packages/host/src/mysql';
import {installMongodb,MongodbBackend} from '../../packages/host/src/mongodb';
import {type FixtureConfig,type FixtureState,type Framework,type Database} from '../../examples/hosts/fixture-runtime';
async function port() {const socket = createServer(); await new Promise<void>((done,reject) => {socket.once('error',reject); socket.listen(0,'127.0.0.1',done);}); const address = socket.address(); if(!address || typeof address === 'string') throw new Error('No host fixture port.'); await new Promise<void>((done,reject) => socket.close(error => error ? reject(error) : done())); return address.port;}
export async function hostMatrixFixture() {
  const directory = await mkdtemp(join(tmpdir(),'huddle-host-matrix-')), nonce = randomUUID(), schema = 'huddle.host.fixture.v2' as const, marker = join(directory,'owner.json'), file = join(directory,'config.json'); await writeFile(marker,JSON.stringify({schema,nonce,directory}),{mode:0o600});
  const verify = async () => {const owner = JSON.parse(await readFile(marker,'utf8')); if(owner.schema !== schema || owner.nonce !== nonce || owner.directory !== directory) throw new Error('Refusing unverified host matrix cleanup.');};
  let postgres: Awaited<ReturnType<typeof postgresCluster>> | undefined, mysql: Awaited<ReturnType<typeof mysqlCluster>> | undefined, mongodb: Awaited<ReturnType<typeof mongodbCluster>> | undefined, closing: Promise<void> | undefined;
  const config: FixtureConfig = {schema,nonce,directory,origins:{} as FixtureConfig['origins'],destinations:{} as FixtureConfig['destinations'],sessions:{}};
  async function close() {if(!closing) closing = (async () => {await verify(); const results = await Promise.allSettled([postgres?.close(),mysql?.close(),mongodb?.close()]); await verify(); await rm(directory,{recursive:true,force:true}); const failures = results.filter(result => result.status === 'rejected'); if(failures.length) throw new Error('A task-owned host matrix database did not shut down cleanly.'); if(postgres?.idleErrors.length) throw new Error('The owned PostgreSQL fixture reported idle errors.');})(); return closing;}
  async function setState(value: Omit<FixtureState,'nonce'>) {await verify(); const temporary = join(directory,'state-'+randomUUID()+'.json'); await writeFile(temporary,JSON.stringify({...value,nonce}),{mode:0o600}); await rename(temporary,join(directory,'state.json'));}
  try {
    // Every runtime provisions its own marked data directory; none accepts a database URL.
    const started = await Promise.allSettled([postgresCluster(),mysqlCluster(),mongodbCluster()]);
    if(started[0].status === 'fulfilled') postgres = started[0].value; if(started[1].status === 'fulfilled') mysql = started[1].value; if(started[2].status === 'fulfilled') mongodb = started[2].value;
    if(!postgres || !mysql || !mongodb) throw new Error('Host matrix needs all four real database runtimes; run the fixture preparation commands.');
    const pg = postgres, my = mysql, mongo = mongodb, mysqlInfo = (await my.pool.query('SELECT @@datadir data'))[0] as {data:string}[], mongoInfo = await mongo.client.db('admin').command({getCmdLineOpts:1}), mongoHello = await mongo.client.db('admin').command({hello:1});
    for(const framework of ['next','express','fastify'] as Framework[]) {
      config.origins[framework] = 'http://127.0.0.1:'+await port(); const destinations = {} as FixtureConfig['destinations'][Framework]; config.destinations[framework] = destinations;
      const path = join(directory,framework+'.sqlite'); installSqlite(path); const sqlite = new SqliteBackend(path); destinations.sqlite = {kind:'sqlite',path,datasetId:sqlite.datasetId}; await sqlite.close();
      const pgSchema = pg.allocateSchema(); await installPostgres(pg.pool,{schema:pgSchema}); const pgBackend = await PostgresBackend.open(pg.pool,{schema:pgSchema}); destinations.postgres = {kind:'postgres',connection:pg.connection,schema:pgSchema,nonce:pg.nonce,datasetId:pgBackend.datasetId}; await pgBackend.close();
      const myPrefix = my.allocatePrefix(); await installMysql(my.pool,{prefix:myPrefix}); const myBackend = await MysqlBackend.open(my.pool,{prefix:myPrefix}); destinations.mysql = {kind:'mysql',connection:my.connection,prefix:myPrefix,nonce:my.nonce,dataDirectory:mysqlInfo[0].data,datasetId:myBackend.datasetId}; await myBackend.close();
      const mongoPrefix = mongo.allocatePrefix(); await installMongodb(mongo.client,mongo.database,{prefix:mongoPrefix}); const mongoBackend = await MongodbBackend.open(mongo.client,mongo.database,{prefix:mongoPrefix}); destinations.mongodb = {kind:'mongodb',uri:mongo.uri,prefix:mongoPrefix,nonce:mongo.nonce,dataDirectory:mongoInfo.parsed.storage.dbPath,setName:mongoHello.setName,datasetId:mongoBackend.datasetId}; await mongoBackend.close();
    }
    const sessions = {alex:randomUUID(),morgan:randomUUID(),guest:randomUUID()}; for(const [name,token] of Object.entries(sessions)) config.sessions[token] = {id:'host:'+name,name,internal:name !== 'guest',csrf:randomUUID()};
    await setState({revoked:[],unavailable:[]}); await writeFile(file,JSON.stringify(config),{mode:0o600});
    const sqliteDestination = config.destinations.next.sqlite; if(sqliteDestination.kind !== 'sqlite') throw new Error('Wrong SQLite fixture selection.'); const sqlite = new DatabaseSync(sqliteDestination.path); let sqliteVersion: string; try {sqliteVersion = String(sqlite.prepare('SELECT sqlite_version() version').get()!.version);} finally {sqlite.close();}
    async function inspect(framework: Framework,database: Database) {
      await verify(); const destination = config.destinations[framework][database]; let backend;
      if(destination.kind === 'sqlite') backend = new SqliteBackend(destination.path); else if(destination.kind === 'postgres') {await pg.verify(); backend = await PostgresBackend.open(pg.pool,{schema:destination.schema});} else if(destination.kind === 'mysql') {await my.verify(); backend = await MysqlBackend.open(my.pool,{prefix:destination.prefix});} else {await mongo.verify(); backend = await MongodbBackend.open(mongo.client,mongo.database,{prefix:destination.prefix});}
      try {return await backend.snapshot(new AbortController().signal,async tx => {
        const output: Record<string,unknown[]> = {};
        for(const collection of collections) {const all: RecordValue[] = []; let after: {time:string;id:string} | undefined; while(true) {const page = await tx.scan(collection,{workspace:'team',environment:'preview'},{limit:100,after}); all.push(...page); if(page.length < 100) break; const last = page.at(-1)!; after = {time:last.time,id:last.id};} output[collection] = all;}
        return {datasetId:backend.datasetId,cursorSecret:backend.cursorSecret,records:output};
      });} finally {await backend.close();}
    }
    return {directory,file,nonce,config,sessions,verify,setState,close,versions:{sqlite:sqliteVersion,postgres:pg.version,mysql:my.version,mongodb:mongo.version},inspect,
      async inspectThreads(framework: Framework,database: Database) {return (await inspect(framework,database)).records.threads as RecordValue[];},
    };
  } catch(value) {await close(); throw value;}
}
