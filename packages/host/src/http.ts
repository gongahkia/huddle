import {CollaborationError,isCollaborationError,isByteChunk,type CollaborationAdapter,type Download,type Scope} from '../../shared/src/collaboration';
import {httpSchemas} from '../../shared/src/protocol';
import {z} from 'zod';
import {abortable} from './cancellation';
import {detailSchema,listSchema,scopeSchema,validate} from './validation';
export type HostApi = Pick<CollaborationAdapter,'session'|'list'|'detail'|'create'|'reply'|'update'|'changes'|'directory'> & Partial<Pick<CollaborationAdapter,'export'|'stageImport'|'previewImport'|'executeImport'|'importProgress'>>;
export type HostHttpOptions = {
  api(request: Request,signal: AbortSignal): HostApi | Promise<HostApi>;
  verifyMutation(request: Request,signal: AbortSignal): void | Promise<void>;
  basePath?: string; timeoutMs?: number; bodyLimitBytes?: number; uploadLimitBytes?: number;
};
export type HostHandler = (request: Request) => Promise<Response>;
const headers = {'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie, Authorization'};
const statuses = {unauthenticated:401,forbidden:403,validation:400,not_found:404,conflict:409,rate_limited:429,timeout:504,network:503,unavailable:503} as const;
export function hostHttpError(value: unknown,status?: number): Response {
  const error = isCollaborationError(value) ? value : new CollaborationError('unavailable','The host could not complete this review request.');
  const code = error.code === 'network' ? 'unavailable' : error.code;
  return Response.json({error:{code,message:error.message.slice(0,1000),...(error.retryAfterMs === undefined ? {} : {retryAfterMs:error.retryAfterMs})}},{status:status ?? statuses[code],headers:{...headers,...(error.retryAfterMs === undefined ? {} : {'Retry-After':String(Math.ceil(error.retryAfterMs/1000))})}});
}
type HttpConfiguration = Pick<HostHttpOptions,'basePath'|'timeoutMs'|'bodyLimitBytes'|'uploadLimitBytes'> & {api: unknown; verifyMutation: unknown};
export function hostHttpSettings<T extends HttpConfiguration>(input: T) {
  if(typeof input.api !== 'function' || typeof input.verifyMutation !== 'function') throw new Error('Supply the host API/session resolver and existing mutation/CSRF protection explicitly.');
  const options = {basePath:'/api/huddle/v2',timeoutMs:15000,bodyLimitBytes:1024*1024,uploadLimitBytes:32*1024*1024,...input};
  options.basePath = options.basePath.replace(/\/$/,'');
  if(!options.basePath.startsWith('/') || options.basePath.startsWith('//') || /[?#\\%]/.test(options.basePath) || options.basePath === '') throw new Error('Use a same-origin host API path without URL encoding, a query or a fragment.');
  for(const value of [options.timeoutMs,options.bodyLimitBytes,options.uploadLimitBytes]) if(!Number.isSafeInteger(value) || value < 1 || value > 1024*1024*1024) throw new Error('Host HTTP limits must be positive bounded integers.');
  return options;
}
async function* bytes(request: Request,limit: number,signal: AbortSignal): AsyncGenerator<Uint8Array> {
  if(!request.body) throw new CollaborationError('validation','A JSON request body is required.');
  const reader = request.body.getReader(), cancel = () => {void reader.cancel().catch(() => {});}; let size = 0;
  signal.addEventListener('abort',cancel,{once:true});
  try {while(true) {const part = await abortable(() => reader.read(),signal); signal.throwIfAborted(); if(part.done) return; size += part.value.byteLength; if(size > limit) throw new CollaborationError('validation','The feedback request exceeds the host byte limit.'); yield part.value;}}
  finally {signal.removeEventListener('abort',cancel); await reader.cancel().catch(() => {}); reader.releaseLock();}
}
async function json(request: Request,limit: number,signal: AbortSignal): Promise<unknown> {
  const chunks: Uint8Array[] = []; let size = 0;
  for await(const chunk of bytes(request,limit,signal)) {chunks.push(chunk); size += chunk.byteLength;}
  const data = new Uint8Array(size); let offset = 0; for(const chunk of chunks) {data.set(chunk,offset); offset += chunk.byteLength;}
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));} catch {throw new CollaborationError('validation','Supply a complete UTF-8 JSON request.');}
}
function query(url: URL,allowed: string[]): Record<string,string> {
  const result: Record<string,string> = Object.create(null);
  for(const [key,value] of url.searchParams) {if(!allowed.includes(key) || Object.hasOwn(result,key)) throw new CollaborationError('validation','Unknown or repeated feedback query parameter.'); result[key] = value;}
  return result;
}
const pageSize = (value: string | undefined) => {if(value === undefined) return undefined; if(!/^[1-9]\d{0,2}$/.test(value)) throw new CollaborationError('validation','Choose a feedback page limit from 1 to 100.'); return Number(value);};
const routeId = (value: string) => {try {return validate(z.string().min(1).max(512),decodeURIComponent(value));} catch {throw new CollaborationError('validation','Invalid feedback record identifier.');}};
function required<T>(value: T | undefined): T {if(value === undefined) throw new CollaborationError('unavailable','This host has not configured feedback transfers.'); return value;}
async function downloadResponse(download: Download,format: 'json'|'markdown',signal: AbortSignal,abort: () => void,cleanup: () => void) {
  if(typeof download.filename !== 'string' || !download.filename || download.filename.length > 200) throw new CollaborationError('unavailable','The host returned an invalid feedback download.');
  const iterator = download.chunks[Symbol.asyncIterator](); let closed = false, streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const onAbort = () => {try {streamController?.error(signal.reason);} catch { /* the stream already ended */ } void close().catch(() => {});};
  const close = async () => {if(closed) return; closed = true; signal.removeEventListener('abort',onAbort); cleanup(); if(iterator.return) {const end = iterator.return(); await abortable(() => end,AbortSignal.timeout(1000)).catch(() => {});}};
  try {
    const first = await abortable(() => iterator.next(),signal); if(first.done) throw new CollaborationError('unavailable','The feedback download was empty.'); let pending: IteratorResult<Uint8Array,unknown> = first;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {streamController = controller; signal.addEventListener('abort',onAbort,{once:true}); if(signal.aborted) onAbort();},
      async pull(controller) {try {signal.throwIfAborted(); const part = pending; if(part.done) {controller.close(); await close(); return;} if(!isByteChunk(part.value)) throw new Error('Invalid download chunk.'); controller.enqueue(part.value); pending = await abortable(() => iterator.next(),signal);} catch(value) {abort(); controller.error(value); await close();}},
      async cancel() {abort(); await close();},
    },{highWaterMark:0});
    return new Response(body,{headers:{...headers,'Content-Type':format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(download.filename).replace(/['()*]/g,char => '%'+char.charCodeAt(0).toString(16).toUpperCase())}`}});
  } catch(value) {abort(); await close(); throw value;}
}
export function createHostHandler(input: HostHttpOptions): HostHandler {
  const options = hostHttpSettings(input);
  return async request => {
    const controller = new AbortController(), signal = AbortSignal.any([request.signal,controller.signal]), timer = setTimeout(() => controller.abort(new CollaborationError('timeout','The host review request timed out.')),options.timeoutMs), cleanup = () => clearTimeout(timer); let streaming = false;
    try {
      const result = await abortable(async () => {
        const url = new URL(request.url); if(!url.pathname.startsWith(options.basePath+'/')) throw new CollaborationError('not_found','Review endpoint is unavailable.');
        const path = url.pathname.slice(options.basePath.length), method = request.method.toUpperCase(), mutation = ['POST','PATCH'].includes(method);
        if(!['GET','POST','PATCH'].includes(method)) throw new CollaborationError('not_found','Review endpoint is unavailable.');
        if(mutation) {await abortable(async () => options.verifyMutation(request,signal),signal); if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) throw new CollaborationError('validation','Use application/json for feedback requests.');}
        const api = await abortable(async () => options.api(request,signal),signal);
        if(path === '/exports' && method === 'POST') {
          query(url,[]); const value = validate(httpSchemas.Export,await json(request,options.bodyLimitBytes,signal)); for(const environment of value.scope.environments) await api.session({workspace:value.scope.workspace,environment},signal); const download = await required(api.export).call(api,value.scope,value.format,signal);
          const response = await downloadResponse(download,value.format,signal,() => controller.abort(),cleanup); streaming = true; return response;
        }
        const extra = path === '/threads' && method === 'GET' ? ['page','status','cursor','limit'] : /^\/threads\/[^/]+$/.test(path) && method === 'GET' ? ['commentsCursor','historyCursor','limit'] : path === '/changes' ? ['cursor'] : path === '/directory' ? ['search','cursor'] : [];
        const params = query(url,['workspace','environment',...extra]), scope: Scope = validate(scopeSchema,{workspace:params.workspace,environment:params.environment});
        if(method === 'GET' && path === '/session') return Response.json(await api.session(scope,signal),{headers});
        // Authorize before reading a potentially large upload or revealing unavailable host capabilities.
        await api.session(scope,signal);
        const detail = path.match(/^\/threads\/([^/]+)$/), replies = path.match(/^\/threads\/([^/]+)\/replies$/), job = path.match(/^\/imports\/jobs\/([^/]+)$/);
        let value: unknown, status = 200;
        if(method === 'GET' && path === '/threads') value = await api.list(scope,validate(listSchema,{page:params.page,status:params.status,cursor:params.cursor,limit:pageSize(params.limit)}),signal);
        else if(method === 'GET' && detail) value = await api.detail(scope,routeId(detail[1]),validate(detailSchema,{commentsCursor:params.commentsCursor,historyCursor:params.historyCursor,limit:pageSize(params.limit)}),signal);
        else if(method === 'POST' && path === '/threads') {value = await api.create(scope,validate(httpSchemas.Create,await json(request,options.bodyLimitBytes,signal)),signal); status = 201;}
        else if(method === 'POST' && replies) value = await api.reply(scope,routeId(replies[1]),validate(httpSchemas.Reply,await json(request,options.bodyLimitBytes,signal)),signal);
        else if(method === 'PATCH' && detail) value = await api.update(scope,routeId(detail[1]),validate(httpSchemas.Update,await json(request,options.bodyLimitBytes,signal)),signal);
        else if(method === 'GET' && path === '/changes') value = await api.changes(scope,params.cursor,signal);
        else if(method === 'GET' && path === '/directory') {if(!api.directory) throw new CollaborationError('not_found','Member directory is unavailable.'); value = await api.directory(scope,validate(z.object({search:z.string().max(1000).optional(),cursor:z.string().max(2048).optional()}).strict(),{search:params.search,cursor:params.cursor}),signal);}
        else if(method === 'POST' && path === '/imports/uploads') {let complete = false; const upload = new AbortController(), uploadSignal = AbortSignal.any([signal,upload.signal]); const chunks = (async function*() {yield* bytes(request,options.uploadLimitBytes,uploadSignal); complete = true;})(); try {value = await required(api.stageImport).call(api,scope,chunks,signal); if(!complete) throw new CollaborationError('unavailable','The host did not consume the complete import.');} finally {if(!complete) upload.abort(); await chunks.return(undefined);} status = 201;}
        else if(method === 'POST' && path === '/imports/previews') value = await required(api.previewImport).call(api,scope,validate(httpSchemas.PreviewRequest,await json(request,options.bodyLimitBytes,signal)),signal);
        else if(method === 'POST' && path === '/imports/jobs') {value = await required(api.executeImport).call(api,scope,validate(httpSchemas.Execute,await json(request,options.bodyLimitBytes,signal)),signal); status = 202;}
        else if(method === 'GET' && job) value = await required(api.importProgress).call(api,scope,routeId(job[1]),signal);
        else throw new CollaborationError('not_found','Review endpoint is unavailable.');
        signal.throwIfAborted(); return Response.json(value,{status,headers});
      },signal);
      return result;
    } catch(value) {if(signal.aborted) return hostHttpError(controller.signal.aborted && isCollaborationError(controller.signal.reason) ? controller.signal.reason : new CollaborationError('timeout','The review request ended.')); return hostHttpError(value);}
    finally {if(!streaming) cleanup();}
  };
}
