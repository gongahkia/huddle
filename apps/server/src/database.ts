import {DatabaseSync, type SQLInputValue} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

export class Database {
  readonly raw: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), {recursive: true});
    this.raw = new DatabaseSync(path);
    this.raw.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE,password TEXT,role TEXT NOT NULL DEFAULT 'member');
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,origins TEXT NOT NULL,environments TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memberships(project_id TEXT REFERENCES projects(id),user_id TEXT REFERENCES users(id),PRIMARY KEY(project_id,user_id));
CREATE TABLE IF NOT EXISTS invitations(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),kind TEXT NOT NULL,hash TEXT UNIQUE NOT NULL,expires_at INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),grant_id TEXT REFERENCES invitations(id),project_id TEXT REFERENCES projects(id),environment TEXT,origin TEXT,expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_grant ON sessions(grant_id);
CREATE TABLE IF NOT EXISTS auth_codes(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,grant_id TEXT,project_id TEXT NOT NULL,environment TEXT NOT NULL,origin TEXT NOT NULL,challenge TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),environment TEXT NOT NULL,page TEXT NOT NULL,page_url TEXT NOT NULL,release TEXT,anchor TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',assignee_id TEXT REFERENCES users(id),version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,updated_seq INTEGER NOT NULL DEFAULT 0,source_id TEXT,UNIQUE(project_id,source_id));
CREATE INDEX IF NOT EXISTS threads_scope ON threads(project_id,environment,updated_seq DESC);
CREATE TABLE IF NOT EXISTS comments(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,thread_id TEXT NOT NULL REFERENCES threads(id),author_id TEXT REFERENCES users(id),author_name TEXT NOT NULL,body TEXT NOT NULL,mentions TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,source_id TEXT,UNIQUE(thread_id,source_id));
CREATE INDEX IF NOT EXISTS comments_thread ON comments(thread_id,seq);
CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY AUTOINCREMENT,thread_id TEXT NOT NULL REFERENCES threads(id),actor_name TEXT NOT NULL,action TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS history_thread ON history(thread_id,id);
CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT NOT NULL,environment TEXT NOT NULL,thread_id TEXT NOT NULL,type TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_scope ON events(project_id,seq);
CREATE TABLE IF NOT EXISTS requests(actor_id TEXT NOT NULL,project_id TEXT NOT NULL,request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,response TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(actor_id,project_id,request_id));
CREATE TABLE IF NOT EXISTS schema_version(version INTEGER NOT NULL);
INSERT INTO schema_version SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM schema_version);
`);
  }
  get<T>(sql: string, ...args: SQLInputValue[]): T | undefined {return this.raw.prepare(sql).get(...args) as T | undefined;}
  all<T>(sql: string, ...args: SQLInputValue[]): T[] {return this.raw.prepare(sql).all(...args) as T[];}
  run(sql: string, ...args: SQLInputValue[]) {return this.raw.prepare(sql).run(...args);}
  transaction<T>(fn: () => T): T {this.raw.exec('BEGIN IMMEDIATE'); try {const value = fn(); this.raw.exec('COMMIT'); return value;} catch (error) {this.raw.exec('ROLLBACK'); throw error;}}
  id() {return randomUUID();}
  close() {this.raw.close();}
}
