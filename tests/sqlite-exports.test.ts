import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {installSqlite,SqliteBackend} from '../packages/host/src/sqlite';
import {exportConformance} from './conformance/exports';
exportConformance('SQLite',async () => {const directory = await mkdtemp(join(tmpdir(),'huddle-export-')), path = join(directory,'disposable.sqlite'); installSqlite(path); const backend = new SqliteBackend(path); return {backend,async cleanup() {await backend.close(); await rm(directory,{recursive:true,force:true});}};});
