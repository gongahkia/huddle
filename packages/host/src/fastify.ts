import type {FastifyPluginAsync,FastifyRequest} from 'fastify';
import {CollaborationError} from '../../shared/src/collaboration';
import {createHostHandler,hostHttpError,hostHttpSettings,type HostHttpOptions} from './http';
import {hostOrigin,nodeHttp} from './node-http';
export type FastifyOptions = Omit<HostHttpOptions,'api'|'verifyMutation'> & {origin: string; api(request: Request,signal: AbortSignal,hostRequest: FastifyRequest): ReturnType<HostHttpOptions['api']>; verifyMutation(request: Request,signal: AbortSignal,hostRequest: FastifyRequest): ReturnType<HostHttpOptions['verifyMutation']>};
export function createFastifyPlugin(input: FastifyOptions): FastifyPluginAsync {
  const options = hostHttpSettings(input), origin = hostOrigin(input.origin);
  return async app => {
    app.removeAllContentTypeParsers(); app.addContentTypeParser('*',{parseAs:'buffer',bodyLimit:Math.max(options.bodyLimitBytes,options.uploadLimitBytes)},(_request,body,done) => done(null,body));
    app.setErrorHandler(async (error,_request,reply) => {const tooLarge = typeof error === 'object' && error !== null && 'code' in error && error.code === 'FST_ERR_CTP_BODY_TOO_LARGE', result = hostHttpError(tooLarge ? new CollaborationError('validation','The feedback request exceeds the host byte limit.') : error,tooLarge ? 413 : undefined); reply.code(result.status); result.headers.forEach((value,name) => reply.header(name,value)); return reply.send(await result.text());});
    app.route({method:['GET','POST','PATCH'],url:options.basePath+'/*',handler:async (request,reply) => {const handler = createHostHandler({...options,api:(web,signal) => options.api(web,signal,request),verifyMutation:(web,signal) => options.verifyMutation(web,signal,request)}); await nodeHttp(request.raw,reply.raw,handler,origin,request.raw.url,request.body,async result => {reply.code(result.status); result.headers.forEach((value,name) => {if(name !== 'set-cookie') reply.header(name,value);}); const cookies = result.headers.getSetCookie(); if(cookies.length) reply.header('Set-Cookie',cookies); await reply.send(result.body ?? '');});}});
  };
}
