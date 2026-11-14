import {PassThrough,Readable} from 'node:stream';
import {once} from 'node:events';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {CollaborationError} from '../../shared/src/collaboration';
import {abortable} from './cancellation';
import {hostHttpError,type HostHandler} from './http';
export function hostOrigin(value: string) {const url = new URL(value); if(!['http:','https:'].includes(url.protocol) || url.username || url.password || value.replace(/\/$/,'') !== url.origin) throw new Error('Supply the canonical host HTTP(S) origin without a path or credentials.'); return url.origin;}
export async function nodeHttp(request: IncomingMessage,response: ServerResponse,handler: HostHandler,origin: string,path = request.url || '/',parsedBody?: unknown,sendResponse?: (result: Response) => Promise<void>) {
  const controller = new AbortController(), signal = controller.signal, disconnected = () => controller.abort(new DOMException('The host connection ended.','AbortError')), closed = () => {if(!response.writableFinished) disconnected();};
  request.on('aborted',disconnected); request.on('error',disconnected); response.on('close',closed); response.on('error',disconnected); let requestBody: PassThrough | undefined, web: Request | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if(!path.startsWith('/') || path.startsWith('//')) throw new CollaborationError('validation','Invalid host request path.');
    const headers = new Headers(); for(const [name,value] of Object.entries(request.headers)) if(value !== undefined) headers.set(name,Array.isArray(value) ? value.join(name === 'cookie' ? '; ' : ', ') : value);
    const method = request.method || 'GET', init: RequestInit & {duplex?: 'half'} = {method,headers,signal};
    if(!['GET','HEAD'].includes(method)) {
      if(parsedBody !== undefined) {if(parsedBody instanceof Uint8Array) init.body = Uint8Array.from(parsedBody); else {if(new URL(path,origin).pathname.endsWith('/imports/uploads')) throw new CollaborationError('validation','Mount feedback uploads before the host JSON parser, preserving exact bytes.'); init.body = JSON.stringify(parsedBody);}}
      else {if(request.readableEnded) throw new CollaborationError('validation','The host already consumed this feedback request body.'); requestBody = new PassThrough(); request.pipe(requestBody); init.body = Readable.toWeb(requestBody) as ReadableStream<Uint8Array>; init.duplex = 'half';}
    }
    web = new Request(new URL(path,origin),init); const result = await handler(web); signal.throwIfAborted();
    if(requestBody && !request.complete) response.setHeader('Connection','close');
    if(sendResponse) {await sendResponse(result); return;}
    response.statusCode = result.status; result.headers.forEach((value,name) => {if(name !== 'set-cookie') response.setHeader(name,value);}); const cookies = result.headers.getSetCookie(); if(cookies.length) response.setHeader('Set-Cookie',cookies);
    if(result.body) {reader = result.body.getReader(); while(true) {const part = await abortable(() => reader!.read(),signal); if(part.done) break; if(!response.write(part.value)) await once(response,'drain',{signal});}}
    response.end(); if(!response.writableFinished) await once(response,'finish',{signal});
  } catch(value) {
    if(response.headersSent || signal.aborted) response.destroy();
    else if(sendResponse) await sendResponse(hostHttpError(value));
    else {const error = hostHttpError(value); response.statusCode = error.status; error.headers.forEach((item,name) => response.setHeader(name,item)); response.end(await error.text()); if(!response.writableFinished) await once(response,'finish',{signal}).catch(() => {});}
  } finally {
    controller.abort(); request.removeListener('aborted',disconnected); request.removeListener('error',disconnected); response.removeListener('close',closed); response.removeListener('error',disconnected);
    if(reader) {await reader.cancel().catch(() => {}); reader.releaseLock();}
    if(web?.body && !web.body.locked) await web.body.cancel().catch(() => {});
    if(requestBody) {request.unpipe(requestBody); requestBody.destroy();}
  }
}
