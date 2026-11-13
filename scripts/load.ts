import {fork} from 'node:child_process';
import {mkdtempSync, rmSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir, cpus, totalmem, release} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {Database} from '../apps/server/src/database';
import {createSession} from '../apps/server/src/auth';
const seconds = Number(process.env.HUDDLE_LOAD_SECONDS || 600), clients = 100, interval = 30000;
if (!Number.isFinite(seconds) || seconds < 30 || seconds > 3600) throw new Error('Use a test duration between 30 and 3600 seconds. Acceptance requires 600.');
const directory = mkdtempSync(join(tmpdir(),'huddle-load-')), path = join(directory,'benchmark.sqlite'), projectId = randomUUID(), origin = 'http://review.huddle.test';
const db = new Database(path), tokens: string[] = [], threadIds: string[] = [];
db.transaction(() => {
 db.run('INSERT INTO projects VALUES(?,?,?,?,?)',projectId,'Disposable load fixture',JSON.stringify([origin]),'["staging"]',new Date().toISOString());
 for (let i = 0; i < clients; i++) {const id = randomUUID(); db.run("INSERT INTO users(id,name,email,role) VALUES(?,?,?,'member')",id,`Reviewer ${i}`,`load-${i}@huddle.test`); db.run('INSERT INTO memberships VALUES(?,?)',projectId,id); tokens.push(createSession(db,id,{projectId,environment: 'staging',origin}));}
 for (let i = 0; i < 1000; i++) {const id = randomUUID(), now = new Date().toISOString(); threadIds.push(id);
  db.run('INSERT INTO threads(id,project_id,environment,page,page_url,anchor,created_at,updated_at,updated_seq) VALUES(?,?,?,?,?,?,?,?,?)',id,projectId,'staging',`/page/${i}`,`${origin}/page/${i}`,JSON.stringify({kind: 'page',selector: 'body',label: 'This page',quote: '',x: .5,y: .5}),now,now,i + 1);
  for (let j = 0; j < 20; j++) db.run('INSERT INTO comments(id,thread_id,author_name,body,created_at) VALUES(?,?,?,?,?)',randomUUID(),id,'Fixture reviewer',`Seed comment ${i}/${j}: A useful observation about interface behavior and the surrounding review context.`,now);
  db.run('INSERT INTO events(project_id,environment,thread_id,type,created_at) VALUES(?,?,?,?,?)',projectId,'staging',id,'seeded',now);
 }
}); db.close();
const child = fork('scripts/load-server.ts',[],{execArgv: ['--import','tsx'],env: {...process.env,HUDDLE_DATABASE: path},stdio: ['ignore','pipe','pipe','ipc']});
const errors: string[] = [], serverRss: number[] = [], generatorRss: number[] = [], dbBytes: number[] = [], cpuSamples: {user: number; system: number}[] = [];
let audit = {comments: 0,requests: 0,events: 0};
const ready = new Promise<string>((resolve,reject) => {child.on('message',(raw: unknown) => {const message = raw as {type: string; baseUrl: string; memory: {rss: number}; cpu: {user: number; system: number}; databaseBytes: number; walBytes: number; comments: number; requests: number; events: number}; if (message.type === 'ready') resolve(message.baseUrl); if (message.type === 'sample') {serverRss.push(message.memory.rss); cpuSamples.push(message.cpu); dbBytes.push(message.databaseBytes + message.walBytes); generatorRss.push(process.memoryUsage().rss);} if (message.type === 'audit') audit = message;}); child.once('error',reject); child.once('exit',code => {if (code) reject(new Error(`Benchmark server exited ${code}`));});});
const controller = new AbortController(); let baseUrl = ''; const mutationLatencies: number[] = [], visibilityLatencies: number[] = [];
const pending = new Map<string,{started: number; writer: number; seen: Set<number>}>();
let writes = 0, observations = 0;
try {
 baseUrl = await Promise.race([ready,delay(15000).then(() => {throw new Error('Benchmark server did not start.');})]);
 const headers = (i: number) => ({Authorization: `Bearer ${tokens[i]}`,Origin: origin});
 const streamReady: Promise<void>[] = [];
 const readers = Array.from({length: clients},(_,i) => {
  let connected!: () => void; streamReady.push(new Promise(resolve => {connected = resolve;}));
  return (async () => {const response = await fetch(`${baseUrl}/api/projects/${projectId}/events?after=1000`,{headers: headers(i),signal: controller.signal}); if (!response.ok) throw new Error(`Stream ${i}: ${response.status}`); const reader = response.body!.getReader(), decoder = new TextDecoder(); connected(); let text = '';
   try {while (!controller.signal.aborted) {const packet = await reader.read(); if (packet.done) break; text += decoder.decode(packet.value,{stream: true}); let end: number; while ((end = text.indexOf('\n\n')) >= 0) {const part = text.slice(0,end); text = text.slice(end + 2); const data = part.split('\n').find(l => l.startsWith('data: ')); if (!data) continue; const event = JSON.parse(data.slice(6)) as {threadId: string}; const active = pending.get(event.threadId); if (active && i !== active.writer && !active.seen.has(i)) {active.seen.add(i); observations++; visibilityLatencies.push(performance.now() - active.started);}}}
   } finally {await reader.cancel().catch(() => {}); reader.releaseLock();}
  })().catch(error => {if (!controller.signal.aborted) {errors.push(String(error)); connected();}});
 });
 await Promise.all(streamReady); const startedAt = performance.now(), rounds = Math.ceil(seconds * 1000 / interval);
 console.log(`100 live streams connected. Running ${seconds}s with 1000 threads / 20000 comments.`);
 const progress = setInterval(() => console.log(`${Math.round((performance.now() - startedAt) / 1000)}s: ${writes} writes; ${observations} peer observations`),30000);
 await Promise.all(Array.from({length: clients},(_,i) => (async () => {
  const listing = await fetch(`${baseUrl}/api/projects/${projectId}/threads?environment=staging`,{headers: headers(i)}); if (!listing.ok) errors.push(`List ${i}: ${listing.status}`); await listing.arrayBuffer();
  for (let round = 0; round < rounds; round++) {
   const target = startedAt + round * interval + i * interval / clients; if (target >= startedAt + seconds * 1000) break;
   await delay(Math.max(0,target - performance.now()));
   const threadId = threadIds[i]; const previous = pending.get(threadId); if (previous && previous.seen.size !== clients - 1) errors.push(`Missing ${clients - 1 - previous.seen.size} peer observations before next write for ${i}`);
   const started = performance.now(); pending.set(threadId,{started,writer: i,seen: new Set()});
   const response = await fetch(`${baseUrl}/api/projects/${projectId}/threads/${threadId}/replies`,{method: 'POST',headers: {...headers(i),'Content-Type': 'application/json'},body: JSON.stringify({requestId: randomUUID(),body: `Load review ${i}/${round}`,mentions: []})}); await response.arrayBuffer();
   mutationLatencies.push(performance.now() - started); if (!response.ok) errors.push(`Mutation ${i}/${round}: ${response.status}`); else writes++;
  }
 })().catch(e => {errors.push(String(e));})));
 await delay(Math.max(0,startedAt + seconds * 1000 - performance.now()) + 500); clearInterval(progress);
 for (const [id,entry] of pending) if (entry.seen.size !== clients - 1) errors.push(`Missing final peer observations for ${id}`);
 child.send('audit'); await delay(200); controller.abort(); await Promise.all(readers);
 const percentile = (values: number[], p: number) => [...values].sort((a,b) => a - b)[Math.max(0,Math.ceil(values.length * p) - 1)] || 0;
 const report = {at: new Date().toISOString(),durationSeconds: seconds,clients,seedThreads: 1000,seedComments: 20000,writes,expectedWrites: clients * seconds / 30,peerObservations: observations,expectedPeerObservations: writes * 99,mutationP95Ms: percentile(mutationLatencies,.95),visibilityP95Ms: percentile(visibilityLatencies,.95),peakServerRssBytes: Math.max(...serverRss),peakGeneratorRssBytes: Math.max(...generatorRss),peakDatabaseAndWalBytes: Math.max(...dbBytes),serverCpuMicroseconds: cpuSamples.at(-1),audit,errors,reference: {node: process.version,os: release(),cpu: cpus()[0]?.model,logicalCpus: cpus().length,totalMemoryBytes: totalmem(),server: 'Separate Node process; no CPU/memory cgroup cap; same-machine loopback load generator'}};
 mkdirSync('output/load',{recursive: true}); writeFileSync('output/load/latest.json',JSON.stringify(report,null,2) + '\n'); console.log(JSON.stringify(report,null,2));
 if (errors.length || writes !== clients * seconds / 30 || audit.comments !== 20000 + writes || audit.requests !== writes || observations !== writes * 99 || report.mutationP95Ms >= 500 || report.visibilityP95Ms >= 2000) process.exitCode = 1;
} finally {controller.abort(); child.kill('SIGTERM'); if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => child.once('exit',resolve)); rmSync(directory,{recursive: true,force: true});}
