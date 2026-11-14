import {randomBytes,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {MongoClient,Db,ClientSession,Document,Filter,IndexDescription} from 'mongodb';
import {CollaborationError,isCollaborationError,type Scope} from '../../shared/src/collaboration';
import {collections,scopedTransaction,type Backend,type Collection,type RecordValue,type Scan,type Transaction} from './backend';
import {abortable} from './cancellation';
import {digest} from './validation';

export type MongodbOptions = {prefix?: string; timeoutMs?: number; snapshotTimeoutMs?: number; beforeOperation?: (operation: {operation: string; collection?: string; scope?: Scope}) => void | Promise<void>};
type Options = Required<Omit<MongodbOptions,'beforeOperation'>> & Pick<MongodbOptions,'beforeOperation'>;
const version = '1', collation = {locale:'simple'};
function settings(input: MongodbOptions): Options {const result = {prefix:'huddle_',timeoutMs:15000,snapshotTimeoutMs:120000,...input}; if(!/^[a-z][a-z0-9_]{0,23}$/.test(result.prefix)) throw new Error('Use a lowercase MongoDB collection prefix of at most 24 characters.'); for(const value of [result.timeoutMs,result.snapshotTimeoutMs]) if(!Number.isSafeInteger(value) || value < 1 || value > 86400000) throw new Error('MongoDB timeouts must be positive integers of at most one day.'); return result;}
const name = (prefix: string,collection: Collection | 'meta') => {if(collection !== 'meta' && !collections.includes(collection)) throw new Error('Unknown feedback collection.'); return prefix+collection;};
const errorCode = (value: unknown) => value && typeof value === 'object' && 'code' in value ? value.code : undefined;
function label(value: unknown,text: string) {return !!value && typeof value === 'object' && 'hasErrorLabel' in value && typeof value.hasErrorLabel === 'function' && value.hasErrorLabel(text);}
function failure(value: unknown): Error {if(isCollaborationError(value)) return value; const code = errorCode(value); if([24,50,262].includes(Number(code))) return new CollaborationError('timeout','Feedback storage timed out. Retry explicitly with the original request key.'); if([112,11000].includes(Number(code))) return new CollaborationError('conflict','Feedback changed concurrently. Refetch before retrying.'); return new CollaborationError('unavailable','Feedback MongoDB storage could not complete this operation.');}
function guard(options: Options,signal: AbortSignal,pending?: Set<Promise<unknown>>) {return async <T>(operation: string,collection: string | undefined,scope: Scope | undefined,run: () => Promise<T>): Promise<T> => {signal.throwIfAborted(); await abortable(async () => options.beforeOperation?.({operation,collection,scope}),signal); signal.throwIfAborted(); const work = Promise.resolve().then(() => {signal.throwIfAborted(); return run();}); pending?.add(work); void work.then(() => pending?.delete(work),() => pending?.delete(work)); return abortable(() => work,signal);};}
type Row = {_id: string; scopeKey: string; workspace: string; environment: string; id: string; time: string; data: string; threadId?: string; status?: string; page?: string; pageKey?: string; actorId?: string; actorKey?: string; expiresAt?: number; fence?: string};
const where = (scope: Scope) => ({scopeKey:digest({workspace:scope.workspace,environment:scope.environment}),workspace:JSON.stringify(scope.workspace),environment:JSON.stringify(scope.environment)});
function encode(record: RecordValue): Row {const row = {...record,...where(record),_id:digest({scope:{workspace:record.workspace,environment:record.environment},id:record.id}),data:JSON.stringify(record.data),page:record.page === undefined ? undefined : JSON.stringify(record.page),pageKey:record.page === undefined ? undefined : digest(record.page),actorId:record.actorId === undefined ? undefined : JSON.stringify(record.actorId),actorKey:record.actorId === undefined ? undefined : digest(record.actorId)}; return Object.fromEntries(Object.entries(row).filter(([,value]) => value !== undefined)) as Row;}
const decode = <T>(row: Row): RecordValue<T> => ({id:row.id,workspace:JSON.parse(row.workspace),environment:JSON.parse(row.environment),time:row.time,data:JSON.parse(row.data),threadId:row.threadId,status:row.status,page:row.page === undefined ? undefined : JSON.parse(row.page),actorId:row.actorId === undefined ? undefined : JSON.parse(row.actorId),expiresAt:row.expiresAt});
function view(db: Db,options: Options,signal: AbortSignal,session: ClientSession,readOnly: boolean,pending: Set<Promise<unknown>>): Transaction {
  const checked = guard(options,signal,pending), mutationOptions = {session,signal,maxTimeMS:options.timeoutMs}, operationOptions = {...mutationOptions,collation};
  return {
    async get<T>(collection: Collection,scope: Scope,id: string) {const target = name(options.prefix,collection), row = await checked('get',target,scope,() => db.collection<Row>(target).findOne({...where(scope),id},operationOptions)); return row ? decode<T>(row) : undefined;},
    async scan<T>(collection: Collection,scope: Scope,input: Scan) {
      if(!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 101) throw new CollaborationError('validation','Invalid feedback page limit.');
      const clauses: Document[] = [where(scope)];
      for(const key of ['threadId','status','page','actorId'] as const) if(input[key] !== undefined) {clauses.push({[key]:key === 'page' || key === 'actorId' ? JSON.stringify(input[key]) : input[key]}); if(key === 'page' || key === 'actorId') clauses.push({[key === 'page' ? 'pageKey' : 'actorKey']:digest(input[key])});}
      for(const boundary of ['after','before'] as const) if(input[boundary]) {const edge = input[boundary]!, op = boundary === 'after' ? '$gt' : '$lt'; clauses.push({$or:[{time:{[op]:edge.time}},{time:edge.time,id:{[op]:edge.id}}]});}
      const target = name(options.prefix,collection), direction = input.direction === 'desc' ? -1 : 1;
      return checked('scan',target,scope,async () => {const cursor = db.collection<Row>(target).find({$and:clauses} as Filter<Row>,{...operationOptions,sort:{time:direction,id:direction},limit:input.limit}); try {return (await cursor.toArray()).map(row => decode<T>(row));} finally {await cursor.close();}});
    },
    async put(collection,record,insert) {if(readOnly) throw new CollaborationError('forbidden','A feedback snapshot cannot write records.'); const target = name(options.prefix,collection), scope = {workspace:record.workspace,environment:record.environment}, row = encode(record); await checked(insert ? 'insert' : 'replace',target,scope,async () => {if(insert) await db.collection<Row>(target).insertOne(row,mutationOptions); else {const result = await db.collection<Row>(target).replaceOne({...where(scope),id:record.id},row,operationOptions); if(result.matchedCount !== 1) throw new CollaborationError('conflict','Feedback changed during the transaction.');}});},
  };
}
const indexes: IndexDescription[] = [
  {name:'scope_id',key:{scopeKey:1,id:1},unique:true}, {name:'scope_order',key:{scopeKey:1,time:1,id:1}},
  {name:'scope_thread',key:{scopeKey:1,threadId:1,time:1,id:1}}, {name:'scope_status',key:{scopeKey:1,status:1,time:1,id:1}},
  {name:'scope_page',key:{scopeKey:1,pageKey:1,time:1,id:1}}, {name:'scope_actor',key:{scopeKey:1,actorKey:1,expiresAt:1}},
];
async function replica(db: Db,options: Options,signal: AbortSignal) {const hello = await guard(options,signal)('topology',undefined,undefined,() => db.command({hello:1},{signal})); if(!hello.setName || hello.logicalSessionTimeoutMinutes === undefined) throw new CollaborationError('unavailable','Feedback MongoDB storage requires a transaction-capable replica set. Standalone MongoDB is unsupported.');}
async function validateCollections(db: Db,options: Options,signal: AbortSignal) {
  const names = ['meta',...collections].map(collection => name(options.prefix,collection as Collection | 'meta')), checked = guard(options,signal);
  const info = await checked('collections',undefined,undefined,() => db.listCollections({name:{$in:names}},{nameOnly:false,signal}).toArray());
  if(info.length !== names.length || info.some(item => item.type !== 'collection' || (item.options?.collation && item.options.collation.locale !== 'simple') || item.options?.capped)) throw new CollaborationError('unavailable','Install ordinary feedback collections with simple collation explicitly before opening storage.');
  for(const collection of collections) {const target = name(options.prefix,collection), actual = await checked('indexes',target,undefined,() => db.collection(target).listIndexes({maxTimeMS:options.timeoutMs,...{signal}}).toArray()); if(indexes.some(expected => !actual.some(item => item.name === expected.name && JSON.stringify(item.key) === JSON.stringify(expected.key) && !!item.unique === !!expected.unique && !item.sparse && !item.partialFilterExpression && !item.hidden && item.expireAfterSeconds === undefined && (!item.collation || item.collation.locale === 'simple')))) throw new CollaborationError('unavailable','Feedback MongoDB indexes do not match schema version 1. Run a verified upgrade explicitly.');}
}
function validateClient(client: MongoClient,db: Db,options: Options) {
  if(db.client !== client) throw new CollaborationError('validation','Use the same host MongoClient for the database and feedback sessions.');
  for(const value of [client.options.serverSelectionTimeoutMS,client.options.connectTimeoutMS,client.options.socketTimeoutMS]) if(!Number.isFinite(value) || value <= 0 || value > options.timeoutMs) throw new CollaborationError('unavailable','Configure finite host MongoDB selection, connection and socket timeouts no greater than the feedback write deadline.');
}
export async function installMongodb(client: MongoClient,db: Db,input: MongodbOptions = {},signal = new AbortController().signal) {
  const options = settings(input), combined = AbortSignal.any([signal,AbortSignal.timeout(options.snapshotTimeoutMs)]), checked = guard(options,combined);
  try {
    validateClient(client,db,options); await replica(db,options,combined); const meta = db.collection<{_id: string; schema: string; dataset: string; cursorSecret: string}>(name(options.prefix,'meta'));
    const previous = await checked('metadata',meta.collectionName,undefined,() => meta.findOne({_id:'installation'},{signal:combined})); if(previous && previous.schema !== version) throw new CollaborationError('unavailable','Unsupported MongoDB feedback schema version. Run its documented upgrade explicitly.');
    for(const collection of ['meta',...collections] as const) {const target = name(options.prefix,collection); try {await checked('installCollection',target,undefined,() => db.command({create:target,collation,maxTimeMS:options.timeoutMs,writeConcern:{w:'majority'}},{signal:combined}));} catch(value) {if(errorCode(value) !== 48) throw value;} if(collection !== 'meta') await checked('installIndexes',target,undefined,() => db.command({createIndexes:target,indexes,maxTimeMS:options.timeoutMs,writeConcern:{w:'majority'}},{signal:combined}));}
    await validateCollections(db,options,combined);
    const session = client.startSession(), pending = new Set<Promise<unknown>>(), transaction = guard(options,combined,pending);
    try {session.startTransaction({readConcern:{level:'snapshot'},writeConcern:{w:'majority'},readPreference:'primary',maxCommitTimeMS:options.timeoutMs}); await transaction('installMetadata',meta.collectionName,undefined,() => meta.updateOne({_id:'installation'},{$setOnInsert:{schema:version,dataset:randomUUID(),cursorSecret:randomBytes(32).toString('hex')}},{session,upsert:true,...{signal:combined}})); await transaction('commit',undefined,undefined,() => session.commitTransaction());} finally {await Promise.allSettled([...pending]); await session.endSession();}
  } catch(value) {if(combined.aborted) {if(signal.aborted) throw signal.reason; throw new CollaborationError('timeout','Feedback storage installation timed out.');} throw failure(value);}
}
export class MongodbBackend implements Backend {
  private lifetime = new AbortController(); private active = new Set<Promise<unknown>>(); private closing?: Promise<void>;
  private constructor(private client: MongoClient,private db: Db,private options: Options,readonly datasetId: string,readonly cursorSecret: string) {}
  static async open(client: MongoClient,db: Db,input: MongodbOptions = {},signal = new AbortController().signal) {
    const options = settings(input), combined = AbortSignal.any([signal,AbortSignal.timeout(options.timeoutMs)]);
    try {validateClient(client,db,options); await replica(db,options,combined); await validateCollections(db,options,combined); const meta = await guard(options,combined)('metadata',name(options.prefix,'meta'),undefined,() => db.collection(name(options.prefix,'meta')).findOne({_id:'installation'} as Document,{signal:combined})); if(meta?.schema !== version || typeof meta.dataset !== 'string' || typeof meta.cursorSecret !== 'string') throw new CollaborationError('unavailable','Install the MongoDB feedback schema explicitly before opening it.'); return new MongodbBackend(client,db,options,meta.dataset,meta.cursorSecret);}
    catch(value) {if(signal.aborted) throw signal.reason; if(combined.aborted) throw new CollaborationError('timeout','Feedback storage timed out.'); throw failure(value);}
  }
  private async execute<T>(scope: Scope | undefined,signal: AbortSignal,readOnly: boolean,run: (tx: Transaction) => Promise<T>) {
    const combined = AbortSignal.any([signal,this.lifetime.signal,AbortSignal.timeout(readOnly ? this.options.snapshotTimeoutMs : this.options.timeoutMs)]); combined.throwIfAborted();
    const work = (async () => {
      for(let attempt=0;;attempt++) {
        combined.throwIfAborted(); const session = this.client.startSession(), pending = new Set<Promise<unknown>>(), checked = guard(this.options,combined,pending); let beforeCallback = true, committing = false;
        try {
          session.startTransaction({readConcern:{level:'snapshot'},writeConcern:{w:'majority'},readPreference:'primary',maxCommitTimeMS:this.options.timeoutMs});
          if(scope) {const row = encode({...scope,id:'clock',time:'',data:{value:'0'}}), target = name(this.options.prefix,'scopes'); await checked('scopeLock',target,scope,() => this.db.collection<Row>(target).updateOne({_id:row._id},{$set:{fence:randomUUID()},$setOnInsert:row},{session,upsert:true,...{signal:combined}}));}
          beforeCallback = false; const tx = view(this.db,this.options,combined,session,readOnly,pending), result = await abortable(() => run(scope ? scopedTransaction(tx,scope) : tx),combined); combined.throwIfAborted(); committing = true;
          await checked('commit',undefined,scope,() => session.commitTransaction()); return result;
        } catch(value) {if(combined.aborted) throw combined.reason; if(committing || isCollaborationError(value) || (!label(value,'TransientTransactionError') && !(beforeCallback && errorCode(value) === 11000))) throw failure(value);}
        finally {await Promise.allSettled([...pending]); await session.endSession();}
        // Only aborted transaction attempts are retried; uncertain commits require the original request key.
        await delay(Math.min(50,5*(attempt+1)),undefined,{signal:combined});
      }
    })(); this.active.add(work); void work.then(() => this.active.delete(work),() => this.active.delete(work));
    try {return await abortable(() => work,combined);} catch(value) {if(this.lifetime.signal.aborted) throw this.lifetime.signal.reason; if(signal.aborted) throw signal.reason; if(combined.aborted) throw new CollaborationError('timeout','Feedback storage timed out.'); throw value;}
  }
  transaction<T>(scope: Scope,signal: AbortSignal,run: (tx: Transaction) => Promise<T>) {return this.execute(scope,signal,false,run);}
  snapshot<T>(signal: AbortSignal,run: (tx: Transaction) => Promise<T>) {return this.execute(undefined,signal,true,run);}
  async close() {if(!this.closing) {this.lifetime.abort(new CollaborationError('unavailable','Feedback storage is closed.')); this.closing = Promise.allSettled([...this.active]).then(() => {});} return this.closing;}
}
