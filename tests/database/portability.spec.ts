import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {ReviewStore} from '../../packages/host/src/store';
import {installSqlite,SqliteBackend} from '../../packages/host/src/sqlite';
import {installPostgres,PostgresBackend} from '../../packages/host/src/postgres';
import {installMysql,MysqlBackend} from '../../packages/host/src/mysql';
import {installMongodb,MongodbBackend} from '../../packages/host/src/mongodb';
import type {FeedbackSnapshot,Provenance} from '../../packages/shared/src/collaboration';
import {postgresCluster} from '../fixtures/postgres-cluster';
import {mysqlCluster} from '../fixtures/mysql-cluster';
import {mongodbCluster} from '../fixtures/mongodb-cluster';
import {emptyMapping,finishImport,portableFixture,snapshot,uploadBytes} from '../conformance/imports';
import type {StorageFixture} from '../conformance/storage';
import {transferContent} from '../fixtures/transfer-content';

const names = ['sqlite','postgres','mysql','mongodb'] as const;
type Name = typeof names[number];
const workspace = 'portability:team', scope = {workspace,environment:'preview'}, environments = ['preview','production'], signal = () => new AbortController().signal;
const auth = async () => ({actor:{id:'host:operator',name:'Operator'},capabilities:{mentions:false,assignment:false,directory:false}});
let pg:Awaited<ReturnType<typeof postgresCluster>>, mysql:Awaited<ReturnType<typeof mysqlCluster>>, mongo:Awaited<ReturnType<typeof mongodbCluster>>;
const sources = new Map<Name,FeedbackSnapshot>(), fixtures = new Set<StorageFixture>();
async function fixture(name:Name): Promise<StorageFixture> {
  let result:StorageFixture;
  if(name === 'sqlite') {const directory = await mkdtemp(join(tmpdir(),'huddle-portability-')), path = join(directory,'disposable.sqlite'); installSqlite(path); const backend = new SqliteBackend(path); result = {backend,async cleanup() {await backend.close(); await rm(directory,{recursive:true,force:true});}};}
  else if(name === 'postgres') {const schema = pg.allocateSchema(); await installPostgres(pg.pool,{schema}); const backend = await PostgresBackend.open(pg.pool,{schema}); result = {backend,async cleanup() {await backend.close(); await pg.dropSchema(schema);}};}
  else if(name === 'mysql') {const prefix = mysql.allocatePrefix(); await installMysql(mysql.pool,{prefix}); const backend = await MysqlBackend.open(mysql.pool,{prefix}); result = {backend,async cleanup() {await backend.close(); await mysql.dropPrefix(prefix);}};}
  else {const prefix = mongo.allocatePrefix(); await installMongodb(mongo.client,mongo.database,{prefix}); const backend = await MongodbBackend.open(mongo.client,mongo.database,{prefix}); result = {backend,async cleanup() {await backend.close(); await mongo.dropPrefix(prefix);}};}
  fixtures.add(result); return result;
}
async function dispose(f:StorageFixture) {await f.cleanup(); fixtures.delete(f);}
async function transfer(store:ReviewStore,data:FeedbackSnapshot,remap = false) {
  const upload = await store.stageImport(scope,uploadBytes(data,65537),signal()), mapping = emptyMapping(); if(remap) mapping.originMap['https://old.test'] = 'https://portable.test';
  const preview = await store.previewImport(scope,{...upload,mapping},signal()); expect(preview.conflicts).toEqual([]);
  const job = await finishImport(store,scope,{previewId:preview.id,digest:preview.digest,idempotencyKey:crypto.randomUUID()},signal()); expect(job).toMatchObject({state:'complete',expected:data.counts,processed:data.counts,rejected:[]});
}
function normalized(data:FeedbackSnapshot,remap = false,restoreSourceIds = false) {
  const content = transferContent(data,restoreSourceIds);
  for(const item of content.threads) if(remap) {item.page = item.page.replace('https://old.test','https://portable.test'); item.pageUrl = new URL(item.pageUrl).href.replace('https://old.test','https://portable.test');}
  for(const kind of ['threads','comments','history'] as const) content[kind].sort((a,b) => a.id.localeCompare(b.id)); return content;
}
function retained(source:Provenance | undefined,destination:Provenance | undefined,datasetId:string,id:string) {
  expect(destination).toMatchObject({datasetId,recordId:id}); if(source) {const {previous,...head} = source; expect(destination!.previous).toEqual([head,...(previous || [])]);}
}
beforeAll(async () => {
  pg = await postgresCluster(); mysql = await mysqlCluster(); mongo = await mongodbCluster();
  console.log(`Portability fixtures: PostgreSQL ${pg.version}, MySQL ${mysql.version}, MongoDB ${mongo.version}, SQLite ${process.versions.sqlite}`);
  const input = portableFixture(108,261,true);
  input.threads[0].provenance = {datasetId:'older:dataset',recordId:'historical:thread',digest:'a'.repeat(64),scope:{workspace:'former',environment:'archived'},page:'/before',pageUrl:'https://historical.test/before'};
  input.threads[0].viewContext = {provenance:{opaque:'must survive'}}; input.history[0].data = {provenance:{opaque:'must survive'}};
  input.comments[0].author.provenance = {datasetId:'older:dataset',recordId:'former:alex',digest:'b'.repeat(64),identity:{id:'former:alex',name:'Former Alex'}};
  for(const name of names) {const f = await fixture(name), store = new ReviewStore(f.backend,auth); try {await transfer(store,input); const exported = await snapshot(store,workspace,environments,signal()); expect(exported.counts).toEqual(input.counts); sources.set(name,exported);} finally {await dispose(f);}}
},120000);
afterAll(async () => {
  const results = await Promise.allSettled([...fixtures].map(dispose));
  const closed = await Promise.allSettled([mongo,mysql,pg].filter(Boolean).map(cluster => cluster.close()));
  for(const result of [...results,...closed]) if(result.status === 'rejected') throw result.reason;
},60000);
for(const from of names) for(const to of names) it(`round trips ${from} → ${to}, preserves provenance and repeats without duplicates`,async () => {
  const source = sources.get(from)!, f = await fixture(to), store = new ReviewStore(f.backend,auth);
  try {
    await transfer(store,source,true); const first = await snapshot(store,workspace,environments,signal());
    expect(first.counts).toEqual(source.counts); const actual = normalized(first,false,true), expected = normalized(source,true); for(const kind of ['threads','comments','history'] as const) {expect(actual[kind]).toHaveLength(expected[kind].length); for(let index=0;index<actual[kind].length;index++) expect(actual[kind][index]).toEqual(expected[kind][index]);}
    for(const kind of ['threads','comments','history'] as const) for(const item of source[kind]) {const saved = first[kind].find(record => record.provenance?.recordId === item.id)!; retained(item.provenance,saved.provenance,source.datasetId,item.id);}
    const historical = source.comments.find(item => item.author.provenance?.previous?.some(previous => previous.recordId === 'former:alex'))!; const firstAuthor = first.comments.find(item => item.provenance?.recordId === historical.id)!.author;
    expect(firstAuthor.id).toBe(historical.author.id); expect(firstAuthor.provenance!.previous).toContainEqual(expect.objectContaining({identity:{id:'former:alex',name:'Former Alex'}}));
    await transfer(store,source,true); const second = await snapshot(store,workspace,environments,signal());
    expect(normalized(second)).toEqual(normalized(first)); expect(second.counts).toEqual(first.counts); expect(second.threads).toEqual(first.threads); expect(second.comments).toEqual(first.comments); expect(second.history).toEqual(first.history);
  } finally {await dispose(f);}
},120000);
