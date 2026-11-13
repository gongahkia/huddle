import {expect, it} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../apps/server/src/app';
import {bootstrap, createSession} from '../apps/server/src/auth';
import type {Actor} from '@huddle/shared';
it('streams live changes, catches up beyond one batch, honors reconnect IDs and releases listeners',async () => {
 const directory = mkdtempSync(join(tmpdir(),'huddle-stream-'));
 const f = await createApp({dbPath: join(directory,'db.sqlite'),rateLimits: false});
 const id = bootstrap(f.db,'a@example.test','Admin','test-password-long'), token = createSession(f.db,id), projectId = randomUUID();
 f.db.run('INSERT INTO projects VALUES(?,?,?,?,?)',projectId,'Test','["http://localhost:4320"]','["staging"]',new Date().toISOString());
 const actor: Actor = {id,name: 'Admin',role: 'administrator',sessionId: 'test'};
 const input = () => ({requestId: randomUUID(),environment: 'staging',page: '/',pageUrl: 'http://localhost:4320/',anchor: {kind: 'page' as const,selector: 'body',label: 'This page',quote: '',x: .5,y: .5},body: 'note',mentions: []});
 const controller = new AbortController();
 try {
  for (let i = 0; i < 510; i++) f.store.create(actor,projectId,input());
  const address = await f.app.listen({host: '127.0.0.1',port: 0});
  const response = await fetch(`${address}/api/projects/${projectId}/events?after=0`,{headers: {cookie: `huddle_session=${token}`},signal: controller.signal});
  const reader = response.body!.getReader(), decoder = new TextDecoder(); let text = '';
  const until = async (needle: string) => {const timeout = setTimeout(() => controller.abort(),3000); try {while (!text.includes(needle)) {const packet = await reader.read(); if (packet.done) throw new Error('Stream ended early.'); text += decoder.decode(packet.value);}} finally {clearTimeout(timeout);}};
  await until('id: 510\n'); expect(f.store.listeners.size).toBe(1);
  f.store.create(actor,projectId,input()); await until('id: 511\n'); controller.abort(); await reader.cancel().catch(() => {});
  const reconnect = new AbortController();
  const next = await fetch(`${address}/api/projects/${projectId}/events?after=0`,{headers: {cookie: `huddle_session=${token}`,'Last-Event-ID': '510'},signal: reconnect.signal});
  const nextReader = next.body!.getReader(); const chunk = decoder.decode((await nextReader.read()).value); expect(chunk).toContain('id: 511'); expect(chunk).not.toContain('id: 510'); reconnect.abort(); await nextReader.cancel().catch(() => {});
 } finally {controller.abort(); await f.app.close(); expect(f.store.listeners.size).toBe(0); rmSync(directory,{recursive: true,force: true});}
});
