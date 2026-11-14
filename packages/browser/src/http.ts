import {isCollaborationError,CollaborationError,type CollaborationAdapter,type ErrorCode,type Scope} from '../../shared/src/collaboration';
import {operation} from './operations';
import {ByteCollector} from './bytes';
export type HttpOptions = {
  basePath?: string; fetch?: typeof fetch; timeoutMs?: number; maxUploadBytes?: number;
  headers?: (method: string,path: string,signal: AbortSignal) => HeadersInit | Promise<HeadersInit>;
};
const codes: Record<number,ErrorCode> = {400: 'validation',401: 'unauthenticated',403: 'forbidden',404: 'not_found',408: 'timeout',409: 'conflict',413: 'validation',422: 'validation',429: 'rate_limited',504: 'timeout'};
export function createHttpAdapter(options: HttpOptions = {}): CollaborationAdapter {
  const base = (options.basePath || '/api/huddle/v2').replace(/\/$/,'');
  if (!base.startsWith('/') || base.startsWith('//') || /[?#\\]/.test(base)) throw new Error('Use a same-origin HTTP base path without a query or fragment.');
  const timeout = options.timeoutMs ?? 15000, maxUpload = options.maxUploadBytes ?? 32 * 1024 * 1024;
  if (!Number.isFinite(timeout) || timeout < 100 || timeout > 120000 || !Number.isSafeInteger(maxUpload) || maxUpload < 1) throw new Error('Invalid HTTP timeout or upload limit.');
  const encode = encodeURIComponent;
  function url(path: string,scope?: Scope,query: object = {}) {
    const params = new URLSearchParams();
    for (const [key,value] of Object.entries({...scope,...query})) if (value !== undefined) params.set(key,String(value));
    return base + path + (params.size ? `?${params}` : '');
  }
  async function response(path: string,method: string,signal: AbortSignal,body?: unknown) {
    const headers = new Headers(await options.headers?.(method,path,signal)); if (body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type','application/json');
    signal.throwIfAborted();
    try {
      const result = await (options.fetch || globalThis.fetch)(path,{method,credentials: 'same-origin',signal,headers,body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body)});
      if(signal.aborted) {void result.body?.cancel().catch(() => {}); signal.throwIfAborted();}
      if (result.ok) return result;
      let message = 'The host could not complete this review request.', retryAfterMs: number | undefined;
      try {const value = await result.json(); if (value?.error?.code === (codes[result.status] || 'unavailable') && typeof value.error.message === 'string' && value.error.message.length <= 1000) message = value.error.message; if (Number.isSafeInteger(value?.error?.retryAfterMs) && value.error.retryAfterMs >= 0) retryAfterMs = value.error.retryAfterMs;} catch { /* do not expose raw proxy or backend errors */ }
      throw new CollaborationError(codes[result.status] || 'unavailable',message,retryAfterMs);
    } catch (value) {
      if (signal.aborted || isCollaborationError(value)) throw value;
      throw new CollaborationError('network','Could not reach this application. Your draft is kept; check your connection.');
    }
  }
  async function request<T>(path: string,method: string,signal: AbortSignal,body?: unknown): Promise<T> {
    return operation(async inner => {
      const result = await response(path,method,inner,body);
      try {return await result.json() as T;} catch (value) {if (inner.aborted) throw value; throw new CollaborationError('unavailable','The host returned an unreadable review response.');}
    },signal,timeout);
  }
  return {
    session: (scope,signal) => request(url('/session',scope),'GET',signal),
    list: (scope,query,signal) => request(url('/threads',scope,query),'GET',signal),
    detail: (scope,id,query,signal) => request(url(`/threads/${encode(id)}`,scope,query),'GET',signal),
    create: (scope,input,signal) => request(url('/threads',scope),'POST',signal,input),
    reply: (scope,id,input,signal) => request(url(`/threads/${encode(id)}/replies`,scope),'POST',signal,input),
    update: (scope,id,input,signal) => request(url(`/threads/${encode(id)}`,scope),'PATCH',signal,input),
    changes: (scope,cursor,signal) => request(url('/changes',scope,{cursor}),'GET',signal),
    directory: (scope,query,signal) => request(url('/directory',scope,query),'GET',signal),
    async export(scope,format,signal) {
      const controller = new AbortController(), combined = AbortSignal.any([signal,controller.signal]);
      const timer = setTimeout(() => controller.abort(new CollaborationError('timeout','The host export timed out.')),timeout);
      try {
        const result = await operation(inner => response(url('/exports'),'POST',inner,{scope,format}),combined,timeout); if (!result.body) throw new CollaborationError('unavailable','The export response was empty.');
        const reader = result.body.getReader(); let cleaned = false;
        const cancel = () => {if(cleaned) return; cleaned = true; clearTimeout(timer); combined.removeEventListener('abort',cancel); void reader.cancel().catch(() => {}); reader.releaseLock();};
        combined.addEventListener('abort',cancel,{once: true});
        if(combined.aborted) {cancel(); combined.throwIfAborted();}
        const source = (async function*() {
          try {while (true) {combined.throwIfAborted(); const part = await operation(() => reader.read(),combined,timeout); if (part.done) break; yield part.value;} }
          finally {cancel();}
        })();
        const chunks:AsyncIterableIterator<Uint8Array> = {[Symbol.asyncIterator]() {return this;},next:() => source.next(),return:async () => {cancel(); return source.return(undefined);},throw:async value => {cancel(); return source.throw(value);}};
        return {filename: `huddle-feedback.${format === 'json' ? 'json' : 'md'}`,contentType: format === 'json' ? 'application/json' : 'text/markdown',chunks};
      } catch (value) {clearTimeout(timer); if (combined.aborted) throw signal.aborted ? signal.reason : new CollaborationError('timeout','The host export timed out.'); throw value;}
    },
    async stageImport(scope,chunks,signal) {
      const iterator = chunks[Symbol.asyncIterator](); let ended = false;
      try {return await operation(async inner => {
        const bytes = new ByteCollector(maxUpload,'upload');
        while(true) {const next = await operation(() => iterator.next(),inner,timeout); if(next.done) {ended = true; break;} bytes.add(next.value);}
        return request<Awaited<ReturnType<CollaborationAdapter['stageImport']>>>(url('/imports/uploads',scope),'POST',inner,bytes.blob('application/json'));
      },signal,timeout);} finally {if(!ended && iterator.return) void Promise.resolve().then(() => iterator.return!()).catch(() => {});}
    },
    previewImport: (scope,input,signal) => request(url('/imports/previews',scope),'POST',signal,input),
    executeImport: (scope,input,signal) => request(url('/imports/jobs',scope),'POST',signal,input),
    importProgress: (scope,id,signal) => request(url(`/imports/jobs/${encode(id)}`,scope),'GET',signal),
  };
}
