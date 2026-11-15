import {ReviewStore as SharedReviewStore,createAnonymousIdentity as anonymous,type Authorize,type Directory,type TransferOptions} from '../../shared/src/store/store';
import type {Backend} from './backend';
import {nodeRuntime} from './runtime';
export * from '../../shared/src/store/store';
export class ReviewStore extends SharedReviewStore {
 constructor(backend:Backend,authorize:Authorize,members?:Directory,options:TransferOptions={}) {super(backend,authorize,members,options,nodeRuntime);}
}
export function createAnonymousIdentity(){return anonymous(nodeRuntime);}
