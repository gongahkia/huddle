import {readFileSync, statSync} from 'node:fs';
import {Database} from '../apps/server/src/database';
import {importPronto} from '../apps/server/src/import';
import type {Actor} from '@huddle/shared';
const [file,projectId,environment,origin] = process.argv.slice(2);
if (!file || !projectId || !environment || !origin) throw new Error('Usage: pnpm import:pronto FILE PROJECT_ID ENVIRONMENT ORIGIN');
if (statSync(file).size > 64 * 1024 * 1024) throw new Error('Import file exceeds 64 MiB.');
const db = new Database(process.env.HUDDLE_DATABASE || '.data/huddle.sqlite');
try {
 const user = db.get<{id: string; name: string}>("SELECT id,name FROM users WHERE role='administrator' LIMIT 1"); if (!user) throw new Error('Bootstrap an administrator first.');
 const actor: Actor = {...user,role: 'administrator',sessionId: 'local-cli'};
 console.log(importPronto(db,actor,JSON.parse(readFileSync(file,'utf8')),{projectId,environment,origin}));
} finally {db.close();}
