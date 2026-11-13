import {createApp} from './app';
const {app} = await createApp();
const address = await app.listen({port: Number(process.env.PORT || 4310),host: process.env.HOST || '127.0.0.1'});
console.log(`Huddle listening at ${address}`);
for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,() => {void app.close().then(() => process.exit(0));});
