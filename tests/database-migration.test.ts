import {expect, it} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Database} from '../apps/server/src/database';
it('compacts legacy retry responses on upgrade without deleting discussion data',() => {
 const dir = mkdtempSync(join(tmpdir(),'huddle-migration-')), path = join(dir,'db.sqlite'); let db = new Database(path);
 try {
  db.run("INSERT INTO users(id,name,role) VALUES('user','Original reviewer','member')");
  db.run("INSERT INTO requests VALUES('user','project','request','hash',?,'2026-01-01T00:00:00Z')",JSON.stringify({id: 'thread-id',comments: [{body: 'Large duplicated content'}]}));
  db.run('UPDATE schema_version SET version=2'); db.close(); db = new Database(path);
  expect(db.get<{response: string}>('SELECT response FROM requests')!.response).toBe('{"threadId":"thread-id"}');
  expect(db.get<{name: string}>('SELECT name FROM users')!.name).toBe('Original reviewer');
  expect(db.get<{version: number}>('SELECT version FROM schema_version')!.version).toBe(3);
 } finally {db.close(); rmSync(dir,{recursive: true,force: true});}
});
