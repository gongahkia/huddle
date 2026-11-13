import {readFileSync, statSync} from 'node:fs';
import {backup} from 'node:sqlite';
import {z} from 'zod';
import {Database} from '../apps/server/src/database';
import {bootstrap} from '../apps/server/src/auth';
import {importPronto} from '../apps/server/src/import';
import type {Actor} from '@huddle/shared';
const [command,...args] = process.argv.slice(2), path = process.env.HUDDLE_DATABASE || '.data/huddle.sqlite';
const db = new Database(path);
try {
 if (command === 'bootstrap') {
  const [email,name = 'Administrator'] = args;
  bootstrap(db,z.string().email().parse(email),z.string().min(1).max(80).parse(name),process.env.HUDDLE_BOOTSTRAP_PASSWORD || ''); console.log('Administrator created.');
 } else if (command === 'backup') {
  if (!args[0] || args[0] === path) throw new Error('Provide a distinct backup destination path.');
  await backup(db.raw,args[0]); console.log('Consistent SQLite backup written.');
 } else if (command === 'import-pronto') {
  const [file,projectId,environment,origin] = args;
  if (!file || !projectId || !environment || !origin || statSync(file).size > 64 * 1024 * 1024) throw new Error('Usage: import-pronto FILE PROJECT_ID ENVIRONMENT ORIGIN (file ≤64 MiB).');
  const user = db.get<{id: string; name: string}>("SELECT id,name FROM users WHERE role='administrator' LIMIT 1"); if (!user) throw new Error('Bootstrap an administrator first.');
  const actor: Actor = {...user,role: 'administrator',sessionId: 'local-cli'};
  console.log(importPronto(db,actor,JSON.parse(readFileSync(file,'utf8')),{projectId,environment,origin}));
 } else throw new Error('Commands: bootstrap EMAIL [NAME] | backup DESTINATION | import-pronto FILE PROJECT_ID ENVIRONMENT ORIGIN');
} finally {db.close();}
