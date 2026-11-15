import {CollaborationError,type CollaborationAdapter,type Scope} from '../../shared/src/collaboration';
import {ReviewStore} from '../../shared/src/store/store';
import type {HuddleOptions} from './options';
import {LocalBackend,type LocalStorageLimits} from './local-backend';
import {browserRuntime} from './local-runtime';

export type LocalAdapter=CollaborationAdapter&{
 setDisplayName(name:string,signal:AbortSignal):Promise<void>;
 storageInfo(signal:AbortSignal):Promise<{kind:'local';databaseName:string;datasetId:string;bytes:number;maxBytes:number;maxRecords:number}>;
 cleanupImports(scope:Scope,signal:AbortSignal,limit?:number):Promise<{removed:number;retained:number}>;
};
export type LocalReviewOptions=Omit<HuddleOptions,'adapter'|'workspace'|'environment'|'reviewMode'|'onDisplayNameChange'>&{
 workspace?:string;environment?:string;localStorage?:LocalStorageLimits;uploadBytes?:number;
};
export function createLocalOptions(options:LocalReviewOptions):HuddleOptions&{adapter:LocalAdapter;reviewMode:'local'}{
 if(!options||typeof options.namespace!=='string'||!options.namespace.trim()||options.namespace.length>512)throw new Error('Provide a local review namespace of at most 512 characters.');
 const {localStorage,uploadBytes=4*1024*1024,workspace='personal',environment='local',...settings}=options;
 if(![workspace,environment].every(value=>typeof value==='string'&&value.trim()&&value.length<=512)||!Number.isSafeInteger(uploadBytes)||uploadBytes<1||uploadBytes>8*1024*1024)throw new Error('Provide valid local scopes and an upload limit of 1 byte–8 MiB.');
 const backend=new LocalBackend(options.namespace,localStorage),check=(scope:Scope,signal:AbortSignal)=>{signal.throwIfAborted();if(scope.workspace!==workspace)throw new CollaborationError('forbidden','This local adapter belongs to a different workspace.');};
 const store=new ReviewStore(backend,async(scope,signal)=>{check(scope,signal);return {actor:backend.actor,capabilities:{directory:false,mentions:false,assignment:false,commentColors:true}};},undefined,{limits:{maxBytes:uploadBytes,maxRecords:20000},batchSize:100},browserRuntime);
 const prepare=async(scope:Scope,signal:AbortSignal)=>{check(scope,signal);await backend.prepare(signal);};
 const adapter:LocalAdapter={
  async session(scope,signal){await prepare(scope,signal);return store.session(scope,signal);},
  async list(scope,query,signal){await prepare(scope,signal);return store.list(scope,query,signal);},
  async detail(scope,id,query,signal){await prepare(scope,signal);return store.detail(scope,id,query,signal);},
  async create(scope,input,signal){await prepare(scope,signal);return store.create(scope,input,signal);},
  async reply(scope,id,input,signal){await prepare(scope,signal);return store.reply(scope,id,input,signal);},
  async update(scope,id,input,signal){await prepare(scope,signal);return store.update(scope,id,input,signal);},
  async changes(scope,cursor,signal){await prepare(scope,signal);return store.changes(scope,cursor,signal);},
  async export(scope,format,signal){await prepare({workspace:scope.workspace,environment:scope.environments[0]||environment},signal);return store.export(scope,format,signal);},
  async stageImport(scope,chunks,signal){await prepare(scope,signal);return store.stageImport(scope,chunks,signal);},
  async previewImport(scope,input,signal){await prepare(scope,signal);return store.previewImport(scope,input,signal);},
  async executeImport(scope,input,signal){await prepare(scope,signal);return store.executeImport(scope,input,signal);},
  async importProgress(scope,id,signal){await prepare(scope,signal);return store.importProgress(scope,id,signal);},
  async setDisplayName(name,signal){if(typeof name!=='string'||name.length>80)throw new CollaborationError('validation','Choose a name of at most 80 characters.');await backend.rename(name,signal);},
  async storageInfo(signal){await backend.prepare(signal);return backend.info();},
  async cleanupImports(scope,signal,limit){await prepare(scope,signal);return store.cleanupImports(scope,signal,limit);},
  subscribe(scope,change,_error,signal){check(scope,signal);return backend.subscribe(change,signal);},
 };
 return {...settings,workspace,environment,adapter,reviewMode:'local',onDisplayNameChange:(name,signal)=>adapter.setDisplayName(name,signal),transferLimits:{...settings.transferLimits,uploadBytes:Math.min(uploadBytes,settings.transferLimits?.uploadBytes??uploadBytes)}};
}
