import type {FastifyPluginAsync} from 'fastify';
import {CollaborationError} from '../../shared/src/collaboration';
import {createHostHandler,hostHttpError,hostHttpSettings,type HostHttpOptions} from './http';
import {hostOrigin,nodeHttp} from './node-http';
export type FastifyOptions = HostHttpOptions & {origin: string};
export function createFastifyPlugin(input: FastifyOptions): FastifyPluginAsync {
  const options = hostHttpSettings(input), handler = createHostHandler(options), origin = hostOrigin(input.origin);
  return async app => {
    app.removeAllContentTypeParsers(); app.addContentTypeParser('*',{parseAs:'buffer',bodyLimit:Math.max(options.bodyLimitBytes,options.uploadLimitBytes)},(_request,body,done) => done(null,body));
    app.setErrorHandler((error,_request,reply) => {const tooLarge = typeof error === 'object' && error !== null && 'code' in error && error.code === 'FST_ERR_CTP_BODY_TOO_LARGE', result = hostHttpError(tooLarge ? new CollaborationError('validation','The feedback request exceeds the host byte limit.') : error,tooLarge ? 413 : undefined); reply.code(result.status); result.headers.forEach((value,name) => reply.header(name,value)); void result.text().then(body => reply.send(body));});
    app.route({method:['GET','POST','PATCH'],url:options.basePath+'/*',handler:async (request,reply) => {reply.hijack(); await nodeHttp(request.raw,reply.raw,handler,origin,request.raw.url,request.body);}});
  };
}
