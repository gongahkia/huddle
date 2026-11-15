import {encodeBytes,decodeBytes,concatBytes,type Runtime} from './runtime';
import {CollaborationError,isCollaborationError,isByteChunk,type Counts,type FeedbackSnapshot,type Identity,type ImportJob,type ImportMapping,type ImportPreview,type Scope} from '../collaboration';
import {defaultImportLimits,parseFeedbackSnapshot,type ImportLimits} from '../portable';
import {httpSchemas} from '../protocol';
import type {Backend,RecordValue,Transaction} from './backend';
import {abortable} from './cancellation';
import {createImportPlanner,type Receipt} from './import-plan';
import {createValidation,identitySchema,validate} from './validation';

export type TransferOptions = {limits?:Partial<ImportLimits>; batchSize?:number; ttlMs?:number; timeoutMs?:number};
type Access = (scope:Scope,signal:AbortSignal) => Promise<{actor:Identity}>;
type Lookup = (scope:Scope,ids:string[],signal:AbortSignal) => Promise<Identity[]>;
type Upload = {digest:string; chunks:number; bytes:number};
type Preview = {uploadId:string; digest:string; mapping:ImportMapping};
type Job = Preview & {previewId:string; scopes:Scope[]; expected:Counts};
type Part = {position:number; processed:Counts; rejected:ImportJob['rejected']};
const zero = (): Counts => ({threads:0,comments:0,history:0});
const unavailable = () => new CollaborationError('not_found','This import staging record is unavailable or expired.');
export class FeedbackImports {
  private readonly validation;private readonly planner;
  readonly limits:ImportLimits; readonly batchSize:number; readonly ttlMs:number; readonly timeoutMs:number;
  constructor(private backend:Backend,private access:Access,private lookup:Lookup | undefined,private event:(tx:Transaction,scope:Scope,id:string) => Promise<void>,options:TransferOptions = {},private runtime:Runtime) {
    this.validation=createValidation(runtime);this.planner=createImportPlanner(runtime);
    this.limits = {...defaultImportLimits,...options.limits}; this.batchSize = options.batchSize ?? 100; this.ttlMs = options.ttlMs ?? 86400000; this.timeoutMs = options.timeoutMs ?? 120000;
    for(const value of [...Object.values(this.limits),this.batchSize,this.ttlMs,this.timeoutMs]) if(!Number.isSafeInteger(value) || value < 1) throw new Error('Transfer limits must be positive safe integers.');
    if(this.limits.maxBytes > 64*1024*1024 || this.limits.maxRecords > 1000000 || this.limits.maxDepth > 64 || this.batchSize > 1000 || this.timeoutMs > 3600000 || this.ttlMs > 30*86400000) throw new Error('Transfer limits exceed the supported staging bounds.');
  }
  private async operation<T>(scope:Scope,external:AbortSignal,run:(signal:AbortSignal,actor:Identity) => Promise<T>): Promise<T> {
    const signal = AbortSignal.any([external,AbortSignal.timeout(this.timeoutMs)]);
    try {const {actor} = await this.access(scope,signal); return await run(signal,actor);}
    catch(value) {if(external.aborted) throw external.reason; if(signal.aborted) throw new CollaborationError('timeout','The import request timed out. Resume the acknowledged job using the same request key.'); if(isCollaborationError(value)) throw value; throw new CollaborationError('unavailable','The host could not complete this import request.');}
  }
  private async owned<T>(tx:Transaction,collection:'uploads'|'previews'|'jobs',scope:Scope,id:string,actor:Identity): Promise<RecordValue<T>> {
    const row = await tx.get<T>(collection,scope,id); if(!row || row.actorId !== actor.id || row.expiresAt === undefined || row.expiresAt <= Date.now()) throw unavailable(); return row;
  }
  private async authorize(scopes:Scope[],actor:Identity,signal:AbortSignal) {
    for(const scope of scopes) {const selected = await this.access(scope,signal); if(selected.actor.id !== actor.id) throw new CollaborationError('forbidden','The import session changed between environments.');}
  }
  async stage(scope:Scope,chunks:AsyncIterable<Uint8Array>,external:AbortSignal): Promise<{uploadId:string;digest:string}> {
    return this.operation(scope,external,async (signal,actor) => {
      const uploadId = this.runtime.uuid(), expiresAt = Date.now()+this.ttlMs, hash = this.runtime.hash(), bytes = new Uint8Array(this.limits.maxBytes); let count = 0, size = 0, persisted = 0;
      const persist = async (end:number) => {
        await this.authorize([scope],actor,signal); const data = encodeBytes(bytes.subarray(persisted,end)), id = `${uploadId}:${String(count++).padStart(8,'0')}`;
        await this.backend.transaction(scope,signal,tx => tx.put('uploads',{...scope,id,time:'',threadId:uploadId,actorId:actor.id,expiresAt,data},true)); persisted = end;
      };
      const iterator = chunks[Symbol.asyncIterator](); let ended = false;
      try {
        while(true) {
          const next = await abortable(() => iterator.next(),signal); if(next.done) {ended = true; break;} if(!isByteChunk(next.value)) throw new CollaborationError('validation','Import uploads must contain bytes.');
          if(size+next.value.byteLength > this.limits.maxBytes) throw new CollaborationError('validation','Import exceeds the configured byte limit.');
          bytes.set(next.value,size); hash.update(next.value); size += next.value.byteLength;
          while(size-persisted >= 65536) await persist(persisted+65536);
        }
        // Validate the complete file before sealing staging; discussion data is untouched.
        this.parse(bytes.subarray(0,size)); if(size > persisted) await persist(size); const fileDigest = hash.digest('hex'); await this.authorize([scope],actor,signal);
        await this.backend.transaction(scope,signal,tx => tx.put('uploads',{...scope,id:uploadId,time:'',actorId:actor.id,expiresAt,data:{digest:fileDigest,chunks:count,bytes:size} satisfies Upload},true));
        return {uploadId,digest:fileDigest};
      } finally {if(!ended && iterator.return) void Promise.resolve().then(() => iterator.return!()).catch(() => {});}
    });
  }
  private fileDigest(bytes:Uint8Array):string {const hash=this.runtime.hash();hash.update(bytes);return hash.digest('hex');}
  private parse(bytes:Uint8Array): FeedbackSnapshot {
    try {return parseFeedbackSnapshot(new TextDecoder('utf-8',{fatal:true}).decode(bytes),this.limits);}
    catch {throw new CollaborationError('validation','Import is not a complete, valid huddle.feedback.v2 snapshot within the configured limits.');}
  }
  private async file(scope:Scope,uploadId:string,fileDigest:string,actor:Identity,signal:AbortSignal): Promise<FeedbackSnapshot> {
    return this.backend.snapshot(signal,async tx => {
      const row = await this.owned<Upload>(tx,'uploads',scope,uploadId,actor); if(row.data.digest !== fileDigest) throw new CollaborationError('conflict','The import digest does not match its upload.');
      if(row.data.bytes > this.limits.maxBytes || row.data.chunks > Math.ceil(this.limits.maxBytes/65536)) throw new CollaborationError('validation','Import staging exceeds the configured limits.');
      const chunks:Uint8Array[] = []; let bytes = 0;
      for(let index=0;index<row.data.chunks;index++) {if(index % 100 === 0) await this.authorize([scope],actor,signal); const chunk = await this.owned<string>(tx,'uploads',scope,`${uploadId}:${String(index).padStart(8,'0')}`,actor), value = decodeBytes(chunk.data); bytes += value.length; if(bytes > this.limits.maxBytes) throw new CollaborationError('validation','Import staging exceeds the byte limit.'); chunks.push(value);}
      const value = concatBytes(chunks); if(bytes !== row.data.bytes || this.fileDigest(value) !== fileDigest) throw new CollaborationError('conflict','Import staging is incomplete or changed.'); return this.parse(value);
    });
  }
  private async plan(scope:Scope,preview:Preview,actor:Identity,signal:AbortSignal) {
    const data = await this.file(scope,preview.uploadId,preview.digest,actor,signal), environments = [...new Set(data.snapshot.scope.environments.map(environment => Object.hasOwn(preview.mapping.environmentMap,environment) ? preview.mapping.environmentMap[environment] : environment))], scopes = environments.map(environment => ({workspace:scope.workspace,environment}));
    await this.authorize(scopes,actor,signal); const members = new Map<string,Map<string,Identity>>(), ids = [...new Set(Object.values(preview.mapping.identityMap))];
    if(ids.length) {
      if(!this.lookup) throw new CollaborationError('validation','This host does not support explicit member mapping.');
      for(const selected of scopes) {const found:Identity[] = []; for(let offset=0;offset<ids.length;offset+=100) found.push(...await abortable(() => this.lookup!(selected,ids.slice(offset,offset+100),signal),signal)); if(found.length !== ids.length || new Set(found.map(item => item.id)).size !== ids.length || found.some(item => !ids.includes(item.id))) throw new CollaborationError('validation','Choose existing host-approved members.'); for(const item of found) validate(identitySchema,item); members.set(selected.environment,new Map(found.map(item => [item.id,item])));}
    }
    return {data,plan:this.planner.importPlan(data,scope,preview.mapping,members,this.backend.datasetId)};
  }
  async preview(scope:Scope,input:{uploadId:string;digest:string;mapping:ImportMapping},external:AbortSignal): Promise<ImportPreview> {
    return this.operation(scope,external,async (signal,actor) => {
      const parsed = validate(httpSchemas.PreviewRequest,input), {data,plan} = await this.plan(scope,parsed,actor,signal), id = this.validation.digest({scope,actor:actor.id,...parsed});
      const rejected = await this.backend.snapshot(signal,tx => this.planner.conflicts(tx,this.backend,data.datasetId,plan,() => this.authorize([scope,...plan.scopes],actor,signal)));
      const expiresAt = await this.backend.transaction(scope,signal,async tx => {
        const upload = await this.owned<Upload>(tx,'uploads',scope,parsed.uploadId,actor), previous = await tx.get<Preview>('previews',scope,id);
        await tx.put('previews',{...scope,id,time:'',actorId:actor.id,expiresAt:upload.expiresAt,data:parsed},!previous); return upload.expiresAt!;
      });
      return {id,digest:parsed.digest,scope,mapping:parsed.mapping,counts:plan.counts,historicalAuthors:plan.authors,conflicts:rejected,expiresAt:new Date(expiresAt).toISOString()};
    });
  }
  private async progressIn(tx:Transaction,scope:Scope,id:string,actor:Identity,signal:AbortSignal): Promise<ImportJob> {
    const job = await this.owned<Job>(tx,'jobs',scope,id,actor); await this.authorize(job.data.scopes,actor,signal);
    const processed = zero(), rejected:ImportJob['rejected'] = []; let done = true;
    for(const selected of job.data.scopes) {const part = await tx.get<Part>('jobs',selected,`part:${id}`); if(!part) {done = false; continue;} if(part.actorId !== actor.id || part.expiresAt! <= Date.now()) throw unavailable(); for(const kind of ['threads','comments','history'] as const) processed[kind] += part.data.processed[kind]; rejected.push(...part.data.rejected);}
    done &&= (['threads','comments','history'] as const).every(kind => processed[kind] === job.data.expected[kind]);
    return {id,state:rejected.length ? 'failed' : done ? 'complete' : Object.values(processed).some(value => value > 0) ? 'running' : 'pending',expected:job.data.expected,processed,rejected,...(rejected.length ? {error:'Import stopped at conflicting destination data. Previously committed records remain available.'} : {})};
  }
  async progress(scope:Scope,id:string,external:AbortSignal): Promise<ImportJob> {
    return this.operation(scope,external,(signal,actor) => {validate(httpSchemas.Execute.shape.previewId,id); return this.backend.snapshot(signal,tx => this.progressIn(tx,scope,id,actor,signal));});
  }
  async execute(scope:Scope,input:{previewId:string;digest:string;idempotencyKey:string},external:AbortSignal): Promise<ImportJob> {
    return this.operation(scope,external,async (signal,actor) => {
      const parsed = validate(httpSchemas.Execute,input), id = this.validation.digest({scope,actor:actor.id,key:parsed.idempotencyKey});
      const preview = await this.backend.snapshot(signal,tx => this.owned<Preview>(tx,'previews',scope,parsed.previewId,actor));
      if(parsed.digest !== preview.data.digest) throw new CollaborationError('conflict','The execution digest does not match its preview.');
      const {data,plan} = await this.plan(scope,preview.data,actor,signal), parents = new Map(plan.records.filter(record => record.collection === 'threads').map(record => [record.row.id,record]));
      const job = await this.backend.transaction(scope,signal,async tx => {
        const old = await tx.get<Job>('jobs',scope,id), value:Job = {...preview.data,previewId:preview.id,scopes:plan.scopes,expected:plan.counts};
        if(old) {if(old.actorId !== actor.id || this.validation.digest(old.data) !== this.validation.digest(value)) throw new CollaborationError('conflict','This import request key is bound to a different preview.'); if(old.expiresAt! <= Date.now()) throw unavailable(); return old;}
        const row:RecordValue<Job> = {...scope,id,time:'',actorId:actor.id,expiresAt:preview.expiresAt,data:value}; await tx.put('jobs',row,true); return row;
      });
      const before = await this.backend.snapshot(signal,tx => this.progressIn(tx,scope,id,actor,signal)); if(before.state === 'failed' || before.state === 'complete') return before;
      // One acknowledged request commits one bounded batch; GET progress never writes.
      for(const selected of plan.scopes) {
        const records = plan.records.filter(record => record.row.environment === selected.environment), partId = `part:${id}`;
        const advanced = await this.backend.transaction(selected,signal,async tx => {
          await this.authorize([scope,selected],actor,signal);
          if(job.expiresAt! <= Date.now()) throw unavailable();
          const previous = await tx.get<Part>('jobs',selected,partId), part:Part = previous ? structuredClone(previous.data) : {position:0,processed:zero(),rejected:[]};
          if(part.rejected.length || part.position >= records.length && previous) return false;
          let changed = !previous;
          for(const record of records.slice(part.position,part.position+this.batchSize)) {
            if(job.expiresAt! <= Date.now()) throw unavailable();
            await this.authorize([scope,selected],actor,signal);
            const parent = record.collection === 'threads' ? undefined : parents.get(record.row.threadId!)!, reason = (parent ? await this.planner.collision(tx,this.backend,data.datasetId,parent) : undefined) || await this.planner.collision(tx,this.backend,data.datasetId,record);
            if(reason) {part.rejected.push({recordId:record.source.id,reason}); changed = true; break;}
            const existing = await tx.get(record.collection,selected,record.row.id), receipt = await tx.get<Receipt>('provenance',selected,record.receipt);
            const published = parent ? await tx.get('threads',selected,parent.row.id) : undefined;
            if(!existing && published) {part.rejected.push({recordId:record.source.id,reason:'Import cannot append missing source records to a published destination thread.'}); changed = true; break;}
            if(!existing) {
              const staging = record.collection === 'threads' ? {} : {status:'importing',actorId:actor.id,expiresAt:job.expiresAt};
              await tx.put(record.collection,{...record.row,...staging},true);
              if(record.collection === 'threads') await this.event(tx,selected,record.row.id);
            }
            else if(parent && !published && existing.status === 'importing') await tx.put(record.collection,{...existing,actorId:actor.id,expiresAt:Math.max(existing.expiresAt || 0,job.expiresAt!)},false);
            if(!receipt) await tx.put('provenance',{...selected,id:record.receipt,time:'',data:{hash:record.hash,binding:record.binding,id:record.row.id} satisfies Receipt},true);
            part.processed[record.collection]++; part.position++; changed = true;
          }
          if(changed) await tx.put('jobs',{...selected,id:partId,time:'',actorId:actor.id,expiresAt:job.expiresAt,data:part},!previous); return changed;
        });
        if(advanced) break;
      }
      return this.backend.snapshot(signal,tx => this.progressIn(tx,scope,id,actor,signal));
    });
  }
  async cleanup(scope:Scope,external:AbortSignal,limit = 100): Promise<{removed:number;retained:number}> {
    if(!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new CollaborationError('validation','Cleanup limit must be between 1 and 1000.');
    return this.operation(scope,external,async (signal,actor) => this.backend.transaction(scope,signal,async tx => {
      let removed = 0, retained = 0;
      for(const collection of ['uploads','previews','jobs','comments','history'] as const) {
        const rows = await tx.scan(collection,scope,{actorId:actor.id,expiresBefore:Date.now(),limit:Math.min(100,limit-removed-retained)});
        for(const row of rows) {await this.authorize([scope],actor,signal); if((collection === 'comments' || collection === 'history') && row.threadId && await tx.get('threads',scope,row.threadId)) {await tx.put(collection,{...row,status:undefined,expiresAt:undefined},false); retained++;} else {await tx.remove(collection,scope,row.id); removed++;}}
        if(removed+retained >= limit) break;
      }
      return {removed,retained};
    }));
  }
}
