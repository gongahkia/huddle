import {readFile,realpath,lstat} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {Pool,type PoolConfig} from 'pg';
import {createPool,type PoolOptions,type RowDataPacket} from 'mysql2/promise';
import {MongoClient} from 'mongodb';
import {ReviewStore,CollaborationError,type Backend,type Identity,type Scope} from '@huddle/host';
import {SqliteBackend} from '@huddle/host/sqlite';
import {PostgresBackend} from '@huddle/host/postgres';
import {MysqlBackend} from '@huddle/host/mysql';
import {MongodbBackend} from '@huddle/host/mongodb';

// Disposable host examples only. Production integrations supply their existing session/policy/pool.
export const databases = ['sqlite','postgres','mysql','mongodb'] as const;
export const frameworks = ['next','express','fastify'] as const;
export type Database = typeof databases[number];
export type Framework = typeof frameworks[number];
export type FixtureUser = Identity & {internal: boolean; csrf: string};
type Destination = {datasetId: string} & ({kind:'sqlite';path:string} | {kind:'postgres';connection:PoolConfig;schema:string;nonce:string} | {kind:'mysql';connection:PoolOptions;prefix:string;nonce:string;dataDirectory:string} | {kind:'mongodb';uri:string;prefix:string;nonce:string;dataDirectory:string;setName:string});
export type FixtureConfig = {schema:'huddle.host.fixture.v2';nonce:string;directory:string;origins:Record<Framework,string>;sessions:Record<string,FixtureUser>;destinations:Record<Framework,Record<Database,Destination>>};
export type FixtureState = {nonce:string;revoked:string[];unavailable:string[]};
const nativeSessions = new WeakMap<object,FixtureUser | null>(), connections = new Map<string,Promise<{backend:Backend;dispose():Promise<unknown>}>>();
let configuration: Promise<FixtureConfig> | undefined, closing = false;
export function fixtureConfiguration(): Promise<FixtureConfig> {
  if(!configuration) configuration = (async () => {
    const file = process.env.HUDDLE_HOST_FIXTURE; if(!file) throw new Error('These examples require an explicitly owned HUDDLE_HOST_FIXTURE; no application database URL is accepted.');
    const config = JSON.parse(await readFile(file,'utf8')) as FixtureConfig, directory = await realpath(dirname(file));
    if(config.schema !== 'huddle.host.fixture.v2' || !/^[a-f0-9-]{36}$/.test(config.nonce) || config.directory !== directory || (await lstat(dirname(file))).isSymbolicLink()) throw new Error('Unverified host fixture configuration.');
    const owner = JSON.parse(await readFile(join(directory,'owner.json'),'utf8'));
    if(owner.schema !== config.schema || owner.nonce !== config.nonce || owner.directory !== directory) throw new Error('Unverified host fixture owner.');
    for(const framework of frameworks) {const url = new URL(config.origins[framework]); if(url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.origin !== config.origins[framework]) throw new Error('Host fixture origins must be explicit loopback origins.');}
    return config;
  })(); return configuration;
}
async function state(): Promise<FixtureState> {const config = await fixtureConfiguration(), value = JSON.parse(await readFile(join(config.directory,'state.json'),'utf8')) as FixtureState; if(value.nonce !== config.nonce || !Array.isArray(value.revoked) || !Array.isArray(value.unavailable)) throw new Error('Unverified host fixture state.'); return value;}
function sessionCookie(cookie: string) {return cookie.split(';').map(value => value.trim()).find(value => value.startsWith('fixture_session='))?.slice('fixture_session='.length);}
async function readSession(cookie: string | null) {const config = await fixtureConfiguration(), token = sessionCookie(cookie || ''); return token && Object.hasOwn(config.sessions,token) ? config.sessions[token] : null;}
export async function rememberHostSession(native: object,cookie: string | undefined) {nativeSessions.set(native,await readSession(cookie || null));}
async function actor(request: Request,framework: Framework,native?: object) {
  if(framework !== 'next' && (!native || !nativeSessions.has(native))) throw new Error('The host session middleware did not run.');
  const user = native ? nativeSessions.get(native) : await readSession(request.headers.get('Cookie'));
  if(!user) throw new CollaborationError('unauthenticated','Use the host application login.'); if(!user.internal) throw new CollaborationError('forbidden','Internal review access required.'); return user;
}
const allowedScope = (scope: Scope) => {if(scope.workspace !== 'team' || !['preview','production'].includes(scope.environment)) throw new CollaborationError('forbidden','This review scope is not authorized by the host.');};
async function openBackend(framework: Framework,database: Database) {
  const config = await fixtureConfiguration(), destination = config.destinations[framework][database];
  if(destination.kind !== database) throw new Error('The host database selection does not match its fixture.');
  let backend: Backend, dispose: () => Promise<unknown> = async () => {};
  const guard = (scope?: Scope) => {if(scope) allowedScope(scope);};
  try {
    if(destination.kind === 'sqlite') {const path = await realpath(destination.path); if(dirname(path) !== config.directory || (await lstat(destination.path)).isSymbolicLink()) throw new Error('Unverified SQLite fixture path.'); backend = new SqliteBackend(path);}
    else if(destination.kind === 'postgres') {
      if(!/^huddle_test_[a-f0-9]{32}$/.test(destination.schema)) throw new Error('Unverified PostgreSQL fixture schema.'); const pool = new Pool({...destination.connection,max:4,connectionTimeoutMillis:1000,idleTimeoutMillis:1000}); dispose = () => pool.end();
      let idleFailure = false; pool.on('error',() => {idleFailure = true;}); dispose = async () => {await pool.end(); if(idleFailure) throw new Error('The host PostgreSQL fixture reported an idle connection error.');}; const proof = await pool.query("SELECT current_setting('huddle.fixture_nonce') nonce"); if(proof.rows[0].nonce !== destination.nonce) throw new Error('Wrong PostgreSQL fixture.');
      backend = await PostgresBackend.open(pool,{schema:destination.schema,beforeQuery:query => guard(query.scope)});
    } else if(destination.kind === 'mysql') {
      if(!/^ht_[a-f0-9]{16}_$/.test(destination.prefix)) throw new Error('Unverified MySQL fixture prefix.'); const pool = createPool({...destination.connection,connectionLimit:4}); dispose = () => pool.end();
      const [proof] = await pool.query<RowDataPacket[]>('SELECT nonce,@@datadir data FROM fixture_owner'); if(proof.length !== 1 || proof[0].nonce !== destination.nonce || resolve(String(proof[0].data)) !== resolve(destination.dataDirectory)) throw new Error('Wrong MySQL fixture.');
      backend = await MysqlBackend.open(pool,{prefix:destination.prefix,beforeQuery:query => guard(query.scope)});
    } else {
      if(!/^ht_[a-f0-9]{16}_$/.test(destination.prefix)) throw new Error('Unverified MongoDB fixture prefix.'); const client = new MongoClient(destination.uri,{serverSelectionTimeoutMS:1000,connectTimeoutMS:1000,socketTimeoutMS:2000,maxPoolSize:4}); dispose = () => client.close();
      const db = client.db('huddle_fixture'), proof = await db.collection('fixture_owner').findOne({nonce:destination.nonce}), serverInfo = await client.db('admin').command({getCmdLineOpts:1}), hello = await client.db('admin').command({hello:1});
      if(!proof || resolve(serverInfo.parsed.storage.dbPath) !== resolve(destination.dataDirectory) || hello.setName !== destination.setName) throw new Error('Wrong MongoDB fixture.');
      backend = await MongodbBackend.open(client,db,{prefix:destination.prefix,beforeOperation:operation => guard(operation.scope)});
    }
    if(backend.datasetId !== destination.datasetId) {await backend.close(); throw new Error('The selected database is not the installed host fixture dataset.');}
    return {backend,dispose};
  } catch(value) {await dispose(); throw value;}
}
function backendFor(framework: Framework,database: Database) {if(closing) throw new Error('Host fixture is closing.'); const key = framework+':'+database; let pending = connections.get(key); if(!pending) {pending = openBackend(framework,database); connections.set(key,pending); void pending.catch(() => connections.delete(key));} return pending;}
export async function fixtureOptions(framework: Framework,databaseName: string) {
  if(!databases.includes(databaseName as Database)) throw new CollaborationError('not_found','Review database fixture is unavailable.'); const database = databaseName as Database, config = await fixtureConfiguration(), key = framework+':'+database;
  return {
    origin:config.origins[framework],basePath:'/api/review/'+database,
    async api(request: Request,signal: AbortSignal,native?: object) {
      signal.throwIfAborted(); const user = await actor(request,framework,native); if((await state()).unavailable.includes(key)) throw new Error('Private fixture backend detail must not reach the browser.'); const connection = await backendFor(framework,database);
      return new ReviewStore(connection.backend,async scope => {allowedScope(scope); if((await state()).revoked.includes(key+':'+user.id)) throw new CollaborationError('forbidden','Internal review access was revoked.'); return {actor:{id:user.id,name:user.name},capabilities:{mentions:false,assignment:false,directory:false,commentColors:true}};});
    },
    async verifyMutation(request: Request,signal: AbortSignal,native?: object) {signal.throwIfAborted(); const user = await actor(request,framework,native); if(request.headers.get('Origin') !== config.origins[framework] || request.headers.get('X-Fixture-CSRF') !== user.csrf) throw new CollaborationError('forbidden','The host CSRF check failed.');},
  };
}
export async function closeFixtureRuntime() {closing = true; const results = await Promise.allSettled([...connections.values()]); for(const result of results) if(result.status === 'fulfilled') {try {await result.value.backend.close();} finally {await result.value.dispose();}} connections.clear();}
