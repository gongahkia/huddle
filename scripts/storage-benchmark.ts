import {mkdtempSync, rmSync, statSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Database} from '../apps/server/src/database';
import {Store} from '../apps/server/src/store';
import {bootstrap} from '../apps/server/src/auth';
import type {Actor} from '@huddle/shared';
const directory = mkdtempSync(join(tmpdir(),'huddle-growth-')), path = join(directory,'fixture.sqlite'), db = new Database(path), store = new Store(db);
try {
 const actor: Actor = {id: bootstrap(db,'benchmark@huddle.test','Fixture reviewer','temporary-fixture-password'),name: 'Fixture reviewer',role: 'administrator',sessionId: 'local-fixture'};
 const projectId = randomUUID(), ids: string[] = []; db.run('INSERT INTO projects VALUES(?,?,?,?,?)',projectId,'Storage fixture','["http://review.huddle.test"]','["staging"]',new Date().toISOString());
 db.transaction(() => {for (let i = 0; i < 1000; i++) {const id = randomUUID(), now = new Date().toISOString(); ids.push(id); db.run('INSERT INTO threads(id,project_id,environment,page,page_url,anchor,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',id,projectId,'staging',`/page/${i}`,'http://review.huddle.test/',JSON.stringify({kind: 'page',selector: 'body',label: 'This page',quote: '',x: .5,y: .5}),now,now); for (let j = 0; j < 20; j++) db.run('INSERT INTO comments(id,thread_id,author_name,body,created_at) VALUES(?,?,?,?,?)',randomUUID(),id,'Fixture reviewer',`Seed comment ${i}/${j}: A useful observation about interface behavior and the surrounding review context.`,now);}});
 db.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)'); const beforeBytes = statSync(path).size;
 for (let i = 0; i < 2000; i++) store.reply(actor,projectId,ids[i % 100],{requestId: randomUUID(),body: `Storage observation ${i}`,mentions: []});
 db.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)'); const afterBytes = statSync(path).size;
 const count = db.get<{n: number}>('SELECT COUNT(*) n FROM comments')!.n; if (count !== 22000) throw new Error('Storage fixture write audit failed.');
 const report = {at: new Date().toISOString(),seedThreads: 1000,seedComments: 20000,addedReplies: 2000,finalComments: count,checkpointedSeedBytes: beforeBytes,checkpointedFinalBytes: afterBytes,growthBytes: afterBytes - beforeBytes,notes: 'Separate focused fixture measurement, not the 600-second network run. Real Store.reply writes include history, durable events and idempotency response records. One synthetic administrator and 100 active threads. WAL truncated before each size sample.'};
 mkdirSync('output/storage',{recursive: true}); writeFileSync('output/storage/latest.json',JSON.stringify(report,null,2) + '\n'); console.log(JSON.stringify(report,null,2));
} finally {db.close(); rmSync(directory,{recursive: true,force: true});}
