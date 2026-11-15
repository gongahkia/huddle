import {CollaborationError,type Attribution,type Comment,type Counts,type FeedbackSnapshot,type History,type Identity,type ImportMapping,type ImportPreview,type Provenance,type Scope,type Thread} from '../collaboration';
import type {Backend,RecordValue,Transaction} from './backend';
import {portableShapes} from '../portable';
import {createValidation,validate} from './validation';

export type ImportRecord = Thread | Comment | History;
export type Planned = {collection:'threads'|'comments'|'history'; source:ImportRecord; row:RecordValue<ImportRecord>; receipt:string; binding:string; hash:string};
export type Plan = {records:Planned[]; scopes:Scope[]; counts:Counts; authors:Attribution[]};
export type Receipt = {hash:string; binding:string; id:string};
export function createImportPlanner(runtime:import('./runtime').Runtime) {
const {digest}=createValidation(runtime);
function content(record:ImportRecord): unknown {
  const attribution = (value:Attribution) => ({id:value.id,name:value.name}), {provenance:_provenance,...value} = record;
  if('createdBy' in value) return {...value,createdBy:attribution(value.createdBy),assignee:value.assignee ? attribution(value.assignee) : null,latestComment:value.latestComment ? content(value.latestComment) : null};
  if('author' in value) return {...value,author:attribution(value.author),mentions:value.mentions.map(attribution)};
  return {...value,actor:attribution(value.actor)};
}
const sourceScope = (thread:Thread): Scope => ({workspace:thread.workspace,environment:thread.environment});
function provenance(datasetId:string,record:ImportRecord | Attribution,context:Partial<Provenance> = {}): Provenance {
  let previous:NonNullable<Provenance['previous']> = [];
  if(record.provenance) {const {previous:chain,...head} = record.provenance; previous = [head,...(chain || [])];}
  return {datasetId,recordId:record.id,digest:digest(record),...context,...(previous.length ? {previous} : {})};
}
function importPlan(data:FeedbackSnapshot,scope:Scope,mapping:ImportMapping,members:Map<string,Map<string,Identity>>,backendDatasetId:string): Plan {
  for(const [from,to] of Object.entries(mapping.originMap)) for(const value of [from,to]) {
    let url:URL; try {url = new URL(value);} catch {throw new CollaborationError('validation','Map exact HTTP(S) origins.');}
    if(!['http:','https:'].includes(url.protocol) || url.username || url.password || url.origin !== value) throw new CollaborationError('validation','Map exact HTTP(S) origins without paths or credentials.');
  }
  if(Object.keys(mapping.environmentMap).some(key => !data.snapshot.scope.environments.includes(key))) throw new CollaborationError('validation','An environment mapping does not belong to this file.');
  const authors = new Map<string,Attribution>(), records:Planned[] = [], scopes = new Map<string,Scope>();
  const comments = new Map<string,Comment[]>(), history = new Map<string,History[]>();
  for(const item of data.comments) {const items = comments.get(item.threadId) || []; items.push(item); comments.set(item.threadId,items);}
  for(const item of data.history) {const items = history.get(item.threadId) || []; items.push(item); history.set(item.threadId,items);}
  // Include empty environments so authorization does not depend on record counts.
  for(const environment of data.snapshot.scope.environments) {const target = Object.hasOwn(mapping.environmentMap,environment) ? mapping.environmentMap[environment] : environment; scopes.set(target,{workspace:scope.workspace,environment:target});}
  for(const thread of data.threads) {
    const environment = Object.hasOwn(mapping.environmentMap,thread.environment) ? mapping.environmentMap[thread.environment] : thread.environment, target = scopes.get(environment)!;
    const native = data.datasetId === backendDatasetId && thread.workspace === target.workspace && thread.environment === target.environment;
    const id = (collection:Planned['collection'],recordId:string) => native ? recordId : `import:${digest({datasetId:data.datasetId,collection,id:recordId,scope:target})}`;
    const threadId = id('threads',thread.id);
    const attribution = (item:Attribution): Attribution => {
      authors.set(digest(item),item); const mapped = Object.hasOwn(mapping.identityMap,item.id) ? members.get(environment)?.get(mapping.identityMap[item.id]) : undefined;
      if(Object.hasOwn(mapping.identityMap,item.id) && !mapped) throw new CollaborationError('validation','Choose host-approved members for every mapped environment.');
      return {...(mapped || {id:item.id,name:item.name}),provenance:provenance(data.datasetId,item,{identity:{id:item.id,name:item.name}})};
    };
    const add = (collection:Planned['collection'],source:ImportRecord,value:ImportRecord) => {
      validate<ImportRecord>(collection === 'threads' ? portableShapes.thread : collection === 'comments' ? portableShapes.comment : portableShapes.history,value,64);
      const hash = digest(source), receipt = digest({datasetId:data.datasetId,collection,id:source.id}), binding = digest({scope:target,mapping});
      records.push({collection,source,receipt,binding,hash,row:{...target,id:value.id,time:new Date('updatedAt' in value ? value.updatedAt : value.createdAt).toISOString(),threadId:collection === 'threads' ? undefined : threadId,status:collection === 'threads' ? thread.status : undefined,page:collection === 'threads' ? (value as Thread).page : undefined,data:value}});
    };
    const converted = (comments.get(thread.id) || []).map(item => ({...item,id:id('comments',item.id),threadId,author:attribution(item.author),mentions:item.mentions.map(attribution),provenance:provenance(data.datasetId,item)}));
    // Publish the header last; unfinished children are invisible through all public reads.
    for(const [index,item] of (comments.get(thread.id) || []).entries()) add('comments',item,converted[index]);
    for(const item of history.get(thread.id) || []) {const entry = item.data, details = item.action === 'replied' && entry && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.commentId === 'string' && data.comments.some(comment => comment.id === entry.commentId && comment.threadId === thread.id) ? {...entry,commentId:id('comments',entry.commentId)} : entry; add('history',item,{...item,id:id('history',item.id),threadId,data:details,actor:attribution(item.actor),provenance:provenance(data.datasetId,item)});}
    const url = new URL(thread.pageUrl), origin = Object.hasOwn(mapping.originMap,url.origin) ? mapping.originMap[url.origin] : undefined;
    const pageUrl = origin ? origin+url.pathname+url.search+url.hash : thread.pageUrl;
    const page = origin && thread.page.startsWith(url.origin) && (thread.page.length === url.origin.length || ['/', '?', '#'].includes(thread.page[url.origin.length])) ? origin+thread.page.slice(url.origin.length) : thread.page;
    const latest = [...converted].sort((a,b) => Date.parse(b.createdAt)-Date.parse(a.createdAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))[0] || null;
    add('threads',thread,{...thread,...target,id:threadId,page,pageUrl,createdBy:attribution(thread.createdBy),assignee:thread.assignee ? attribution(thread.assignee) : null,latestComment:latest,provenance:provenance(data.datasetId,thread,{scope:sourceScope(thread),page:thread.page,pageUrl:thread.pageUrl})});
  }
  if(Object.keys(mapping.identityMap).some(id => ![...authors.values()].some(author => author.id === id))) throw new CollaborationError('validation','An identity mapping does not belong to this file.');
  return {records,scopes:[...scopes.values()],counts:data.counts,authors:[...authors.values()]};
}
async function collision(tx:Transaction,backend:Backend,datasetId:string,record:Planned): Promise<string | undefined> {
  const scope = {workspace:record.row.workspace,environment:record.row.environment}, receipt = await tx.get<Receipt>('provenance',scope,record.receipt), existing = await tx.get<ImportRecord>(record.collection,scope,record.row.id);
  if(receipt) return receipt.data.hash === record.hash && receipt.data.binding === record.binding ? undefined : 'Source content or mapping conflicts with recorded provenance.';
  const incoming = record.source.id === record.row.id ? existing : await tx.get<ImportRecord>(record.collection,scope,record.source.id);
  if(incoming && incoming.id !== existing?.id) return 'Incoming source ID already belongs to destination feedback.';
  if(!existing) return;
  const chain = [existing.data.provenance,...(existing.data.provenance?.previous || [])];
  const source = record.source.provenance, returning = [source,...(source?.previous || [])];
  const same = digest(content(existing.data)) === digest(content(record.row.data));
  if(same && (datasetId === backend.datasetId || chain.some(item => item?.datasetId === datasetId && item.recordId === record.source.id && item.digest === record.hash) || returning.some(item => item?.datasetId === backend.datasetId && item.recordId === existing.id && item.digest === digest(existing.data)))) return;
  return 'Destination ID already belongs to unrelated feedback.';
}
async function conflicts(tx:Transaction,backend:Backend,datasetId:string,plan:Plan,check:() => Promise<void>): Promise<ImportPreview['conflicts']> {
  const result:ImportPreview['conflicts'] = [];
  for(const [index,record] of plan.records.entries()) {if(index % 100 === 0) await check(); const reason = await collision(tx,backend,datasetId,record); if(reason) result.push({recordId:record.source.id,reason});}
  return result;
}

return {importPlan,collision,conflicts};
}
