import Fastify, {type FastifyRequest} from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {z} from 'zod';
import {Database} from './database';
import {authenticate, createSession, hash, HttpError, passwordHash, passwordMatches, projectAccess, requireAdmin, requireMember, resolveSession, secret} from './auth';
import {Store} from './store';
import * as schema from './validation';
import {Readable} from 'node:stream';
import {exportProject} from './export';

export type ServerOptions = {dbPath?: string; baseUrl?: string; staticRoot?: string; rateLimits?: boolean};
export async function createApp(options: ServerOptions = {}) {
  const path = options.dbPath || process.env.HUDDLE_DATABASE || '.data/huddle.sqlite';
  const db = new Database(path), store = new Store(db);
  const baseUrl = new URL(options.baseUrl || process.env.HUDDLE_BASE_URL || 'http://localhost:4310').origin;
  const app = Fastify({bodyLimit: 16384,logger: false,requestTimeout: 15000});
  const streams = new Map<string, {actor: ReturnType<typeof authenticate>; close: () => void}>();
  const actor = (request: FastifyRequest) => authenticate(db,request,baseUrl);
  const scope = (request: FastifyRequest) => {const a = actor(request); const {projectId} = request.params as {projectId: string}; schema.identifier.parse(projectId); projectAccess(db,a,projectId); return {a,projectId};};
  const sameOrigin = (r: FastifyRequest) => {if (r.headers.origin !== baseUrl) throw new HttpError(403,'A same-origin request is required.');};
  const closeSessions = (matches: (a: ReturnType<typeof authenticate>) => boolean) => {for (const stream of streams.values()) if (matches(stream.actor)) stream.close();};
  await app.register(cors,{origin(origin, callback) {
    const allowed = !origin || origin === baseUrl || !!db.get("SELECT 1 FROM projects p,json_each(p.origins) o WHERE o.value=? LIMIT 1",origin);
    callback(null,allowed);
  },credentials: true,allowedHeaders: ['Content-Type','Authorization','Last-Event-ID'],methods: ['GET','POST','PATCH','OPTIONS'],exposedHeaders: ['Content-Disposition']});
  if (options.rateLimits !== false) await app.register(rateLimit,{max: 300,timeWindow: '1 minute',cache: 10000,keyGenerator(request) {
    const bearer = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : '';
    const cookieToken = request.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('huddle_session='))?.slice(15) || '';
    try {return `actor:${resolveSession(db,bearer || cookieToken).id}`;} catch {return `ip:${request.ip}`;}
  }});
  app.addHook('onSend',async (_req,reply,payload) => {
    reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer');
    if (_req.url.startsWith('/api/')) reply.header('Cache-Control','no-store');
    return payload;
  });
  app.setErrorHandler((error,_request,reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({error: 'Invalid request.',details: error.issues.map(i => `${i.path.join('.')}: ${i.message}`)});
    const status = error instanceof HttpError ? error.statusCode : typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 500;
    return reply.code(status >= 400 && status <= 599 ? status : 500).send({error: status < 500 && error instanceof Error ? error.message : 'The request could not be completed.'});
  });
  const cookie = (token: string) => `huddle_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${baseUrl.startsWith('https:') ? '; Secure' : ''}`;
  app.get('/api/health',async () => ({ok: !!db.get('SELECT 1')}));
  app.post('/api/auth/login',{config: {rateLimit: {max: 10,timeWindow: '1 minute'}}},async (request,reply) => {
    sameOrigin(request); const input = schema.loginSchema.parse(request.body);
    const user = db.get<{id: string; password: string}>('SELECT id,password FROM users WHERE email=?',input.email.toLowerCase());
    if (!user?.password || !passwordMatches(input.password,user.password)) throw new HttpError(401,'Email or password is incorrect.');
    reply.header('Set-Cookie',cookie(createSession(db,user.id))); return {ok: true};
  });
  app.get('/api/session',async request => ({actor: actor(request)}));
  app.post('/api/auth/logout',async (request,reply) => {const a = actor(request); db.run('DELETE FROM sessions WHERE id=?',a.sessionId); closeSessions(s => s.sessionId === a.sessionId); reply.header('Set-Cookie','huddle_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'); return {ok: true};});
  app.post('/api/auth/invitation',{config: {rateLimit: {max: 30,timeWindow: '1 minute'}}},async request => {
    sameOrigin(request); const {token} = z.object({token: z.string().min(20).max(200)}).strict().parse(request.body);
    const invite = db.get<{kind: string; projectName: string; expiresAt: number}>(`SELECT i.kind,p.name projectName,i.expires_at expiresAt FROM invitations i JOIN projects p ON p.id=i.project_id WHERE i.hash=? AND i.revoked=0 AND i.expires_at>? AND (i.kind='guest' OR i.used=0)`,hash(token),Date.now());
    if (!invite) throw new HttpError(410,'This invitation expired, was used or was revoked.'); return invite;
  });
  app.post('/api/auth/accept',{config: {rateLimit: {max: 20,timeWindow: '1 minute'}}},async (request,reply) => {
    sameOrigin(request); const input = schema.acceptSchema.parse(request.body);
    const token = db.transaction(() => {
      const invite = db.get<{id: string; project_id: string; kind: string; used: number}>('SELECT * FROM invitations WHERE hash=? AND revoked=0 AND expires_at>?',hash(input.token),Date.now());
      if (!invite || (invite.kind === 'member' && invite.used)) throw new HttpError(410,'This invitation expired, was used or was revoked.');
      let userId: string;
      if (invite.kind === 'member') {
        if (!input.email || !input.password) throw new HttpError(400,'Member invitations require an email and a password of at least 12 characters.');
        const existing = db.get<{id: string; password: string}>('SELECT id,password FROM users WHERE email=?',input.email.toLowerCase());
        if (existing && !passwordMatches(input.password,existing.password || '')) throw new HttpError(401,'Sign in using the existing account password.');
        userId = existing?.id || db.id();
        if (!existing) db.run("INSERT INTO users VALUES(?,?,?,?,'member')",userId,input.name,input.email.toLowerCase(),passwordHash(input.password));
        db.run('INSERT OR IGNORE INTO memberships VALUES(?,?)',invite.project_id,userId);
        db.run('UPDATE invitations SET used=1 WHERE id=?',invite.id); return createSession(db,userId);
      }
      userId = db.id(); db.run("INSERT INTO users(id,name,role) VALUES(?,?,'guest')",userId,input.name);
      return createSession(db,userId,{grantId: invite.id,projectId: invite.project_id});
    }); reply.header('Set-Cookie',cookie(token)); return {ok: true};
  });
  app.post('/api/auth/authorize',async request => {
    const a = actor(request); if (a.origin) throw new HttpError(403,'Authorize from the Huddle window.');
    const input = schema.authorizeSchema.parse(request.body), project = projectAccess(db,a,input.projectId,input.environment);
    if (!project.origins.includes(input.origin)) throw new HttpError(403,'This website is not allowed for the project.');
    const code = secret(); db.run('DELETE FROM auth_codes WHERE expires_at<=?',Date.now());
    db.run('INSERT INTO auth_codes VALUES(?,?,?,?,?,?,?,?)',hash(code),a.id,a.grantId || null,input.projectId,input.environment,input.origin,input.challenge,Date.now() + 60000); return {code};
  });
  app.post('/api/auth/exchange',async request => {
    const input = schema.exchangeSchema.parse(request.body);
    return db.transaction(() => {
      const code = db.get<{user_id: string; grant_id: string | null; project_id: string; environment: string; origin: string; challenge: string}>('SELECT * FROM auth_codes WHERE hash=? AND expires_at>?',hash(input.code),Date.now());
      if (!code || code.origin !== request.headers.origin || Buffer.from(hash(input.verifier),'hex').toString('base64url') !== code.challenge) throw new HttpError(403,'The review authorization could not be verified.');
      const session = createSession(db,code.user_id,{grantId: code.grant_id || undefined,projectId: code.project_id,environment: code.environment,origin: code.origin});
      const a = resolveSession(db,session); projectAccess(db,a,code.project_id,code.environment);
      db.run('DELETE FROM auth_codes WHERE hash=?',hash(input.code)); return {token: session,actor: a};
    });
  });
  app.get('/api/projects',async request => {const a = actor(request); return db.all<{id: string; name: string; origins: string; environments: string}>(`SELECT * FROM projects WHERE ?='administrator' OR id=? OR EXISTS(SELECT 1 FROM memberships m WHERE m.project_id=projects.id AND m.user_id=?) ORDER BY name`,a.origin ? 'widget' : a.role,a.projectId || '',a.origin ? '' : a.id).map(p => ({...p,origins: JSON.parse(p.origins),environments: JSON.parse(p.environments)}));});
  app.post('/api/projects',async request => {const a = actor(request); requireAdmin(a); const input = schema.projectSchema.parse(request.body), id = db.id(); db.run('INSERT INTO projects VALUES(?,?,?,?,?)',id,input.name,JSON.stringify([...new Set(input.origins)]),JSON.stringify([...new Set(input.environments)]),new Date().toISOString()); return {id,...input};});
  app.get('/api/projects/:projectId/members',async request => {const {a,projectId} = scope(request); return store.members(a,projectId);});
  app.get('/api/projects/:projectId/invitations',async request => {const {a,projectId} = scope(request); requireAdmin(a); return db.all('SELECT id,kind,expires_at,revoked,used FROM invitations WHERE project_id=? ORDER BY expires_at DESC',projectId);});
  app.post('/api/projects/:projectId/invitations',async request => {const {a,projectId} = scope(request); requireAdmin(a); const input = schema.invitationSchema.parse(request.body), token = secret(), id = db.id(), expiresAt = Date.now() + input.expiresInHours * 3600000;
    db.run('INSERT INTO invitations(id,project_id,kind,hash,expires_at) VALUES(?,?,?,?,?)',id,projectId,input.kind,hash(token),expiresAt); return {id,kind: input.kind,expiresAt,url: `${baseUrl}/invite#${token}`};});
  app.post('/api/projects/:projectId/invitations/:id/revoke',async request => {const {a,projectId} = scope(request); requireAdmin(a); const {id} = request.params as {id: string}; if (!db.run('UPDATE invitations SET revoked=1 WHERE id=? AND project_id=?',id,projectId).changes) throw new HttpError(404,'Invitation not found.'); closeSessions(s => s.grantId === id); return {ok: true};});
  app.get('/api/projects/:projectId/threads',async request => {const {a,projectId} = scope(request); return store.list(a,projectId,schema.listSchema.parse(request.query));});
  app.post('/api/projects/:projectId/threads',async request => {const {a,projectId} = scope(request); return store.create(a,projectId,schema.createSchema.parse(request.body));});
  app.get('/api/projects/:projectId/threads/:id',async request => {const {a,projectId} = scope(request); const {id} = request.params as {id: string}; const {after} = z.object({after: z.coerce.number().int().min(0).default(0)}).strict().parse(request.query); return store.detail(a,projectId,id,after);});
  app.post('/api/projects/:projectId/threads/:id/replies',async request => {const {a,projectId} = scope(request); return store.reply(a,projectId,(request.params as {id: string}).id,schema.replySchema.parse(request.body));});
  app.patch('/api/projects/:projectId/threads/:id',async request => {const {a,projectId} = scope(request); return store.patch(a,projectId,(request.params as {id: string}).id,schema.patchSchema.parse(request.body));});
  app.get('/api/projects/:projectId/changes',async request => {const {a,projectId} = scope(request); const {after} = z.object({after: z.coerce.number().int().min(0).default(0)}).strict().parse(request.query); return {items: store.changes(a,projectId,after)};});
  app.get('/api/projects/:projectId/events',async (request,reply) => {
    const {a,projectId} = scope(request); const {after} = z.object({after: z.coerce.number().int().min(0).default(0)}).strict().parse(request.query); let cursor = z.coerce.number().int().min(0).parse(request.headers['last-event-id'] || after);
    reply.hijack(); const raw = reply.raw;
    raw.writeHead(200,{'Content-Type': 'text/event-stream','Cache-Control': 'no-store','Connection': 'keep-alive','X-Accel-Buffering': 'no',...(request.headers.origin ? {'Access-Control-Allow-Origin': request.headers.origin,'Vary': 'Origin'} : {})});
    const id = db.id(); let closed = false;
    const close = () => {if (closed) return; closed = true; clearInterval(heartbeat); store.listeners.delete(listener); streams.delete(id); raw.end();};
    const send = () => {if (closed) return;
      try {const current = actor(request); projectAccess(db,current,projectId);
        let batch;
        do {
          batch = store.changes(a,projectId,cursor,500);
          for (const item of batch) {cursor = item.seq; raw.write(`id: ${item.seq}\ndata: ${JSON.stringify(item)}\n\n`);}
          if (raw.writableLength > 1024 * 1024) {close(); break;}
        } while (batch.length === 500);
      } catch {raw.write('event: revoked\ndata: {}\n\n'); close();}
    };
    const listener = (change: {projectId: string}) => {if (change.projectId === projectId) send();};
    const heartbeat = setInterval(() => {send(); if (!closed) raw.write(': heartbeat\n\n');},15000); heartbeat.unref();
    store.listeners.add(listener); streams.set(id,{actor: a,close}); raw.on('close',close);
    raw.write(': connected\n\n'); send();
  });
  app.get('/api/projects/:projectId/export',async (request,reply) => {
    const {a,projectId} = scope(request); requireMember(a); if (a.origin) throw new HttpError(403,'Export feedback from the Huddle workspace.');
    const {format} = z.object({format: z.enum(['json','markdown']).default('json')}).strict().parse(request.query);
    reply.header('Content-Type',format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8').header('Content-Disposition',`attachment; filename="huddle-feedback.${format === 'json' ? 'json' : 'md'}"`);
    return reply.send(Readable.from(exportProject(path,projectId,format)));
  });
  const staticRoot = options.staticRoot || resolve('dist/public');
  if (existsSync(staticRoot)) {await app.register(fastifyStatic,{root: staticRoot}); app.setNotFoundHandler((request,reply) => request.url.startsWith('/api/') ? reply.code(404).send({error: 'Not found.'}) : reply.sendFile('index.html'));}
  app.addHook('onClose',async () => {for (const stream of streams.values()) stream.close(); db.close();});
  return {app,db,store,baseUrl};
}
