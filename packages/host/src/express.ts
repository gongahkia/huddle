import type {RequestHandler} from 'express';
import {createHostHandler,hostHttpSettings,type HostHttpOptions} from './http';
import {hostOrigin,nodeHttp} from './node-http';
export type ExpressOptions = HostHttpOptions & {origin: string};
export function createExpressMiddleware(input: ExpressOptions): RequestHandler {
  const options = hostHttpSettings(input), handler = createHostHandler(options), origin = hostOrigin(input.origin);
  return async (request,response,next) => {const path = request.originalUrl, pathname = path.split('?')[0]; if(pathname !== options.basePath && !pathname.startsWith(options.basePath+'/')) {next(); return;} await nodeHttp(request,response,handler,origin,path,request.body);};
}
