import {statSync} from 'node:fs';
import {createApp} from '../apps/server/src/app';
const {app,db} = await createApp();
const baseUrl = await app.listen({host: '127.0.0.1',port: 0});
process.send?.({type: 'ready',baseUrl});
const timer = setInterval(() => {
 const bytes = (path: string) => {try {return statSync(path).size;} catch {return 0;}};
 process.send?.({type: 'sample',memory: process.memoryUsage(),cpu: process.cpuUsage(),databaseBytes: bytes(process.env.HUDDLE_DATABASE!),walBytes: bytes(process.env.HUDDLE_DATABASE! + '-wal')});
},1000);
process.on('message',message => {if (message === 'audit') process.send?.({type: 'audit',comments: db.get<{n: number}>('SELECT COUNT(*) n FROM comments')!.n,requests: db.get<{n: number}>('SELECT COUNT(*) n FROM requests')!.n,events: db.get<{n: number}>('SELECT COUNT(*) n FROM events')!.n});});
process.on('SIGTERM',() => {clearInterval(timer); void app.close().then(() => process.exit(0));});
