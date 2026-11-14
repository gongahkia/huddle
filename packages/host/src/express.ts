import type {RequestHandler,Request as ExpressRequest} from 'express';
import {createHostHandler,hostHttpSettings,type HostHttpOptions} from './http';
import {hostOrigin,nodeHttp} from './node-http';
export type ExpressOptions = Omit<HostHttpOptions,'api'|'verifyMutation'> & {origin: string; api(request: Request,signal: AbortSignal,hostRequest: ExpressRequest): ReturnType<HostHttpOptions['api']>; verifyMutation(request: Request,signal: AbortSignal,hostRequest: ExpressRequest): ReturnType<HostHttpOptions['verifyMutation']>};
export function createExpressMiddleware(input: ExpressOptions): RequestHandler {
  const options = hostHttpSettings(input), origin = hostOrigin(input.origin);
  return async (request,response,next) => {const path = request.originalUrl, pathname = path.split('?')[0]; if(pathname !== options.basePath && !pathname.startsWith(options.basePath+'/')) {next(); return;} const handler = createHostHandler({...options,api:(web,signal) => options.api(web,signal,request),verifyMutation:(web,signal) => options.verifyMutation(web,signal,request)}); await nodeHttp(request,response,handler,origin,path,request.body);};
}
