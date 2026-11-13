import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import {resolve} from 'node:path';
const app = Fastify(); await app.register(staticFiles,{root: resolve('dist/examples')});
console.log(await app.listen({port: Number(process.env.EXAMPLES_PORT || 4320),host: '127.0.0.1'}));
for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,() => {void app.close();});
