import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes, randomUUID} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
const exec = promisify(execFile), port = process.env.HUDDLE_SMOKE_PORT || '4312', base = `http://127.0.0.1:${port}`, project = `huddle-check-${Date.now()}`;
const password = randomBytes(24).toString('hex'), env = {...process.env,HUDDLE_PORT: port,HUDDLE_BASE_URL: base,HUDDLE_BOOTSTRAP_PASSWORD: password};
const composeFiles = ['-f','compose.yml'];
if (process.env.HUDDLE_BUILD_NETWORK === 'host') {mkdirSync('output/docker',{recursive: true}); writeFileSync('output/docker/build-network.yml',`services:\n  huddle:\n    build:\n      context: ${process.cwd()}\n      network: host\n`); composeFiles.push('-f','output/docker/build-network.yml');}
const dockerArgs = process.env.DOCKER_HOST ? ['--host',process.env.DOCKER_HOST] : [];
async function compose(...args: string[]) {const result = await exec('docker',[...dockerArgs,'compose',...composeFiles,'--project-name',project,...args],{env,maxBuffer: 8 * 1024 * 1024}); return result.stdout;}
let cookie = '';
async function request(path: string, body?: unknown) {const response = await fetch(base + '/api' + path,{method: body ? 'POST' : 'GET',headers: {Origin: base,Cookie: cookie,...(body ? {'Content-Type': 'application/json'} : {})},...(body ? {body: JSON.stringify(body)} : {})}); if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`); if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie')!.split(';')[0]; return response.json();}
async function ready() {for (let i = 0; i < 40; i++) {try {await request('/health'); return;} catch {await delay(500);}} throw new Error('Docker service did not become healthy.');}
mkdirSync('output/docker',{recursive: true});
try {
 console.log('Building and bootstrapping an isolated Compose project…');
 await compose('build');
 await compose('run','--rm','-e','HUDDLE_BOOTSTRAP_PASSWORD','huddle','node','dist/cli.js','bootstrap','smoke@huddle.test','Container reviewer');
 await compose('up','-d'); await ready();
 await request('/auth/login',{email: 'smoke@huddle.test',password});
 const p = await request('/projects',{name: 'Container persistence',origins: ['http://localhost:4322'],environments: ['staging']});
 const thread = await request(`/projects/${p.id}/threads`,{requestId: randomUUID(),environment: 'staging',page: '/',pageUrl: 'http://localhost:4322/',anchor: {kind: 'page',selector: 'body',label: 'This page',quote: '',x: .5,y: .5},body: 'Persist through a container restart',mentions: []});
 await compose('restart','huddle'); await ready();
 const restored = await request(`/projects/${p.id}/threads/${thread.id}`);
 if (restored.comments[0].body !== 'Persist through a container restart') throw new Error('Comment was not preserved.');
 await compose('exec','-T','huddle','node','dist/cli.js','backup','/data/check-backup.sqlite');
 const output = {at: new Date().toISOString(),composeProject: project,result: 'passed',persistedComment: true,persistedSession: true,sqliteBackupCreated: true,ps: await compose('ps')};
 writeFileSync('output/docker/smoke.json',JSON.stringify(output,null,2) + '\n'); console.log(JSON.stringify(output,null,2));
} finally {await compose('down','--volumes','--remove-orphans');}
