import {FeedbackImports as SharedImports,type TransferOptions} from '../../shared/src/store/import';
import type {Backend,Transaction} from './backend';
import type {Identity,Scope} from '../../shared/src/collaboration';
import {nodeRuntime} from './runtime';
export type {TransferOptions};
export class FeedbackImports extends SharedImports {
 constructor(backend:Backend,access:(scope:Scope,signal:AbortSignal)=>Promise<{actor:Identity}>,lookup:((scope:Scope,ids:string[],signal:AbortSignal)=>Promise<Identity[]>)|undefined,event:(tx:Transaction,scope:Scope,id:string)=>Promise<void>,options:TransferOptions={}){super(backend,access,lookup,event,options,nodeRuntime);}
}
