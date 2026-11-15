import {CollaborationError,isCollaborationError,type Identity,type Scope} from '../../shared/src/collaboration';
import {createAnonymousIdentity} from '../../shared/src/store/store';
import {assertRemovable,collections,scopedTransaction,type Backend,type Collection,type RecordValue,type Scan,type Transaction} from '../../shared/src/store/backend';
import {browserRuntime} from './local-runtime';

type Metadata={schema:'huddle.local.v1';namespace:string;datasetId:string;cursorSecret:string;actor:Identity;revision:number;bytes:number};
type Stored={collection:Collection;record:RecordValue};
type Loaded={metadata:Metadata;rows:Map<string,Stored>};
export type LocalStorageLimits={maxBytes?:number;maxRecords?:number};
const key=(collection:Collection,scope:Scope,id:string)=>JSON.stringify([collection,scope.workspace,scope.environment,id]);
const sameScope=(a:Scope,b:Scope)=>a.workspace===b.workspace&&a.environment===b.environment;
const compare=(a:{time:string;id:string},b:{time:string;id:string})=>a.time<b.time?-1:a.time>b.time?1:a.id<b.id?-1:a.id>b.id?1:0;
const unavailable=()=>new CollaborationError('unavailable','Local feedback storage is unavailable. No feedback was saved. Allow browser storage and retry; saved feedback is never replaced with a memory-only copy.');
function storageError(value:unknown):never {if(isCollaborationError(value))throw value;throw unavailable();}
function request<T>(value:IDBRequest<T>):Promise<T>{return new Promise((resolve,reject)=>{value.onsuccess=()=>resolve(value.result);value.onerror=()=>reject(value.error);});}
function finished(tx:IDBTransaction,signal:AbortSignal):Promise<void>{
 const done=new Promise<void>((resolve,reject)=>{const abort=()=>{try{tx.abort();}catch{/* already complete */}};signal.addEventListener('abort',abort,{once:true});
  const end=(failure?:unknown)=>{signal.removeEventListener('abort',abort);if(failure)reject(signal.aborted?signal.reason:failure);else resolve();};
  tx.oncomplete=()=>end();tx.onabort=()=>end(tx.error||unavailable());tx.onerror=()=>{};if(signal.aborted)abort();
 });void done.catch(()=>{});return done;
}
function memoryTransaction(loaded:Loaded,writable:boolean):{tx:Transaction;dirty:Map<string,Stored|null>}{
 const dirty=new Map<string,Stored|null>(),indexes=new Map<string,Stored[]>();
 const tx:Transaction={
  async get<T>(collection:Collection,scope:Scope,id:string){const found=loaded.rows.get(key(collection,scope,id));return found?structuredClone(found.record) as RecordValue<T>:undefined;},
  async scan<T>(collection:Collection,scope:Scope,query:Scan){
   const indexKey=JSON.stringify([collection,scope.workspace,scope.environment]);let rows=indexes.get(indexKey);
   if(!rows){rows=[...loaded.rows.values()].filter(value=>value.collection===collection&&sameScope(value.record,scope)).sort((a,b)=>compare(a.record,b.record));indexes.set(indexKey,rows);}
   const selected=rows.filter(({record})=>(query.threadId===undefined||record.threadId===query.threadId)&&(query.status===undefined||record.status===query.status)&&(query.page===undefined||record.page===query.page)&&(query.actorId===undefined||record.actorId===query.actorId)&&(query.expiresBefore===undefined||record.expiresAt!==undefined&&record.expiresAt<query.expiresBefore)&&(!query.after||compare(record,query.after)>0)&&(!query.before||compare(record,query.before)<0));
   if(query.direction==='desc')selected.reverse();return structuredClone(selected.slice(0,query.limit).map(value=>value.record)) as RecordValue<T>[];
  },
  async put(collection,record,insert){
   if(!writable)throw new CollaborationError('unavailable','A local snapshot cannot write feedback.');
   const id=key(collection,record,record.id),exists=loaded.rows.has(id);if(insert&&exists||!insert&&!exists)throw new CollaborationError('conflict','Local feedback changed. Retry the original action.');
   const value={collection,record:structuredClone(record)};loaded.rows.set(id,value);dirty.set(id,value);indexes.clear();
  },
  async remove(collection,scope,id){if(!writable)throw new CollaborationError('unavailable','A local snapshot cannot delete feedback.');await assertRemovable(tx,collection,scope,id);const recordKey=key(collection,scope,id);loaded.rows.delete(recordKey);dirty.set(recordKey,null);indexes.clear();},
 };return {tx,dirty};
}

// each native connection is operation-owned; export backpressure never holds an IDB transaction open.
export class LocalBackend implements Backend {
 readonly databaseName:string;readonly maxBytes:number;readonly maxRecords:number;
 private metadata:Metadata|undefined;private queued:Promise<unknown>=Promise.resolve();
 constructor(readonly namespace:string,limits:LocalStorageLimits={}){
  this.databaseName='huddle-local:'+namespace;this.maxBytes=limits.maxBytes??32*1024*1024;this.maxRecords=limits.maxRecords??20000;
  if(!Number.isSafeInteger(this.maxBytes)||this.maxBytes<1024||this.maxBytes>64*1024*1024||!Number.isSafeInteger(this.maxRecords)||this.maxRecords<1||this.maxRecords>100000)throw new Error('Local storage limits must be 1 KiB–64 MiB and 1–100,000 records.');
 }
 get datasetId(){if(!this.metadata)throw unavailable();return this.metadata.datasetId;}
 get cursorSecret(){if(!this.metadata)throw unavailable();return this.metadata.cursorSecret;}
 get actor(){if(!this.metadata)throw unavailable();return structuredClone(this.metadata.actor);}
 private async connect(signal:AbortSignal):Promise<IDBDatabase>{
  signal.throwIfAborted();if(typeof indexedDB==='undefined')throw unavailable();
  return new Promise((resolve,reject)=>{let pending=true;let opening:IDBOpenDBRequest;
   const cancel=()=>{if(pending){pending=false;signal.removeEventListener('abort',cancel);reject(signal.reason);}};
   const fail=(value:unknown)=>{if(pending){pending=false;signal.removeEventListener('abort',cancel);reject(value);}};
   try{opening=indexedDB.open(this.databaseName,1);}catch{reject(unavailable());return;}
   signal.addEventListener('abort',cancel,{once:true});
   opening.onupgradeneeded=event=>{const db=opening.result;if(!pending||event.oldVersion!==0){opening.transaction?.abort();return;}db.createObjectStore('metadata');db.createObjectStore('records');};
   opening.onblocked=()=>fail(new CollaborationError('unavailable','Local feedback is open in an incompatible tab. Close that tab and retry.'));
   opening.onerror=()=>fail(unavailable());opening.onsuccess=()=>{const db=opening.result;signal.removeEventListener('abort',cancel);if(!pending||signal.aborted){db.close();if(pending)fail(signal.reason);return;}pending=false;db.onversionchange=()=>db.close();resolve(db);};
  });
 }
 private checkMetadata(value:unknown):Metadata{
  const item=value as Metadata;if(!item||item.schema!=='huddle.local.v1'||item.namespace!==this.namespace||typeof item.datasetId!=='string'||typeof item.cursorSecret!=='string'||!item.actor?.id||typeof item.actor.name!=='string'||!Number.isSafeInteger(item.revision)||item.revision<0||!Number.isSafeInteger(item.bytes)||item.bytes<0)throw new CollaborationError('unavailable','This local feedback database has an unsupported or damaged format. Preserve it and export a verified backup before changing storage.');
  if(this.metadata&&this.metadata.datasetId!==item.datasetId)throw new CollaborationError('unavailable','The local feedback dataset changed. Reload the page before continuing.');return item;
 }
 async prepare(signal:AbortSignal):Promise<void>{
  let db:IDBDatabase|undefined;
  try{db=await this.connect(signal);const tx=db.transaction('metadata','readwrite'),done=finished(tx,signal),store=tx.objectStore('metadata'),reading=store.get('identity');
   reading.onsuccess=()=>{if(reading.result===undefined){const metadata:Metadata={schema:'huddle.local.v1',namespace:this.namespace,datasetId:'local:'+browserRuntime.uuid(),cursorSecret:browserRuntime.uuid()+browserRuntime.uuid(),actor:createAnonymousIdentity(browserRuntime),revision:0,bytes:0};store.add(metadata,'identity');}};
   await done;const read=db.transaction('metadata','readonly'),end=finished(read,signal),value=await request(read.objectStore('metadata').get('identity'));await end;this.metadata=this.checkMetadata(value);
  }catch(value){if(signal.aborted)throw signal.reason;storageError(value);}finally{db?.close();}
 }
 private async load(signal:AbortSignal):Promise<Loaded>{
  let db:IDBDatabase|undefined;
  try{db=await this.connect(signal);const tx=db.transaction(['metadata','records'],'readonly'),done=finished(tx,signal),meta=request(tx.objectStore('metadata').get('identity')),records=request(tx.objectStore('records').getAll(undefined,this.maxRecords+1));
   const [value,values]=await Promise.all([meta,records]);await done;const metadata=this.checkMetadata(value);if(metadata.bytes>this.maxBytes||values.length>this.maxRecords)throw new CollaborationError('unavailable','Local feedback exceeds this installation’s storage limits. Increase the configured limit to export the complete dataset.');
   const rows=new Map<string,Stored>();for(const value of values){const item=value as Stored;if(!item||!collections.includes(item.collection)||!item.record||typeof item.record.id!=='string'||typeof item.record.workspace!=='string'||typeof item.record.environment!=='string'||typeof item.record.time!=='string')throw unavailable();const id=key(item.collection,item.record,item.record.id);if(rows.has(id))throw unavailable();rows.set(id,item);}
   this.metadata=metadata;return {metadata:structuredClone(metadata),rows};
  }catch(value){if(signal.aborted)throw signal.reason;return storageError(value);}finally{db?.close();}
 }
 private serialize<T>(signal:AbortSignal,run:()=>Promise<T>):Promise<T>{
  if(typeof navigator!=='undefined'&&navigator.locks?.request)return navigator.locks.request(this.databaseName,{mode:'exclusive',signal},run);
  const next=this.queued.catch(()=>{}).then(()=>{signal.throwIfAborted();return run();});this.queued=next;return next;
 }
 private async commit(loaded:Loaded,dirty:Map<string,Stored|null>,signal:AbortSignal,actor?:Identity):Promise<void>{
  if(!dirty.size&&!actor)return;signal.throwIfAborted();const bytes=[...loaded.rows.entries()].reduce((sum,[id,row])=>sum+new TextEncoder().encode(id+JSON.stringify(row)).byteLength,0);
  if(bytes>this.maxBytes||loaded.rows.size>this.maxRecords)throw new CollaborationError('unavailable','Local feedback storage is full. This action was not saved. Export existing feedback or increase the configured local limit, then retry.');
  let db:IDBDatabase|undefined;
  try{db=await this.connect(signal);const tx=db.transaction(['metadata','records'],'readwrite'),done=finished(tx,signal),store=tx.objectStore('metadata'),read=store.get('identity');let conflict=false;
   read.onsuccess=()=>{const current=read.result as Metadata;if(!current||current.datasetId!==loaded.metadata.datasetId||current.revision!==loaded.metadata.revision){conflict=true;tx.abort();return;}
    const records=tx.objectStore('records');for(const [id,row] of dirty)if(row)records.put(row,id);else records.delete(id);store.put({...current,revision:current.revision+1,bytes,actor:actor||current.actor},'identity');};
   try{await done;}catch(value){if(conflict)throw new CollaborationError('conflict','Local feedback changed in another tab. Retry the original action.');throw value;}
   this.metadata={...loaded.metadata,revision:loaded.metadata.revision+1,bytes,actor:actor||loaded.metadata.actor};this.broadcast();
  }catch(value){if(signal.aborted)throw signal.reason;storageError(value);}finally{db?.close();}
 }
 async transaction<T>(scope:Scope,signal:AbortSignal,run:(tx:Transaction)=>Promise<T>):Promise<T>{return this.serialize(signal,async()=>{const loaded=await this.load(signal),{tx,dirty}=memoryTransaction(loaded,true),result=await run(scopedTransaction(tx,scope));signal.throwIfAborted();await this.commit(loaded,dirty,signal);return result;});}
 async snapshot<T>(signal:AbortSignal,run:(tx:Transaction)=>Promise<T>):Promise<T>{const loaded=await this.load(signal);signal.throwIfAborted();return run(memoryTransaction(loaded,false).tx);}
 async rename(name:string,signal:AbortSignal):Promise<void>{await this.prepare(signal);return this.serialize(signal,async()=>{const loaded=await this.load(signal),current=loaded.metadata.actor,actor=name.trim()?{...current,name:name.trim()}: {...current,name:createAnonymousIdentity(browserRuntime).name};await this.commit(loaded,new Map(),signal,actor);});}
 info(){return {kind:'local' as const,databaseName:this.databaseName,datasetId:this.datasetId,bytes:this.metadata!.bytes,maxBytes:this.maxBytes,maxRecords:this.maxRecords};}
 subscribe(change:()=>void,signal:AbortSignal):()=>void{if(typeof BroadcastChannel==='undefined')return ()=>{};const channel=new BroadcastChannel(this.databaseName),close=()=>channel.close();channel.addEventListener('message',change,{signal});signal.addEventListener('abort',close,{once:true});return ()=>{signal.removeEventListener('abort',close);close();};}
 private broadcast(){if(typeof BroadcastChannel==='undefined')return;const channel=new BroadcastChannel(this.databaseName);channel.postMessage({changed:true});channel.close();}
 async close():Promise<void>{/* connections are closed by their owning operation */}
}
