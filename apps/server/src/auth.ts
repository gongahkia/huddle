import {createHash, randomBytes, scryptSync, timingSafeEqual} from 'node:crypto';
import type {FastifyRequest} from 'fastify';
import type {Actor, Role} from '@huddle/shared';
import {Database} from './database';
export class HttpError extends Error {constructor(public statusCode: number, message: string) {super(message);}}
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');
export function passwordHash(password: string) {const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password,salt,32).toString('hex')}`;}
export function passwordMatches(password: string, value: string) {try {const [salt, expected] = value.split(':'); const actual = scryptSync(password,salt,32); return timingSafeEqual(actual,Buffer.from(expected,'hex'));} catch {return false;}}
export function bootstrap(db: Database, email: string, name: string, password: string) {
  if (db.get('SELECT id FROM users LIMIT 1')) throw new Error('Bootstrap requires an empty Huddle database.');
  if (password.length < 12) throw new Error('Choose a password of at least 12 characters.');
  const id = db.id(); db.run("INSERT INTO users(id,name,email,password,role) VALUES(?,?,?,?,'administrator')",id,name,email.toLowerCase(),passwordHash(password)); return id;
}
export type Session = {id: string; user_id: string; grant_id: string | null; project_id: string | null; environment: string | null; origin: string | null; expires_at: number};
export function createSession(db: Database, userId: string, scope: {grantId?: string; projectId?: string; environment?: string; origin?: string} = {}) {
  const token = secret(); db.run('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)',hash(token),userId,scope.grantId || null,scope.projectId || null,scope.environment || null,scope.origin || null,Date.now() + (scope.origin ? 3600000 : 7 * 86400000)); return token;
}
export function resolveSession(db: Database, token: string): Actor {
  const row = db.get<Session & {name: string; role: Role}>(`SELECT s.*,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?`,hash(token),Date.now());
  if (!row) throw new HttpError(401,'Your session expired. Connect again.');
  if (row.grant_id && !db.get('SELECT id FROM invitations WHERE id=? AND revoked=0 AND expires_at>?',row.grant_id,Date.now())) throw new HttpError(401,'This invitation expired or was revoked.');
  return {id: row.user_id,name: row.name,role: row.role,sessionId: row.id,grantId: row.grant_id || undefined,projectId: row.project_id || undefined,environment: row.environment || undefined,origin: row.origin || undefined};
}
export function authenticate(db: Database, request: FastifyRequest, serviceOrigin: string): Actor {
  const header = request.headers.authorization;
  const cookie = request.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('huddle_session='))?.slice(15);
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  const actor = resolveSession(db,bearer || cookie || '');
  if (actor.origin) {
    if (!bearer || request.headers.origin !== actor.origin) throw new HttpError(403,'Review access is bound to its website origin.');
  } else if (request.headers.origin && request.headers.origin !== serviceOrigin) throw new HttpError(403,'Use Connect Huddle to authorize this website.');
  if (!actor.origin && !['GET','HEAD','OPTIONS'].includes(request.method) && request.headers.origin !== serviceOrigin) throw new HttpError(403,'A same-origin request is required.');
  return actor;
}
export function projectAccess(db: Database, actor: Actor, projectId: string, environment?: string) {
  const project = db.get<{id: string; name: string; origins: string; environments: string}>('SELECT * FROM projects WHERE id=?',projectId);
  if (!project || (actor.projectId && actor.projectId !== projectId)) throw new HttpError(404,'Project not found.');
  if (actor.role !== 'administrator' && !(actor.role === 'guest' && actor.projectId === projectId) && !db.get('SELECT 1 FROM memberships WHERE project_id=? AND user_id=?',projectId,actor.id)) throw new HttpError(404,'Project not found.');
  if (actor.environment && environment && actor.environment !== environment) throw new HttpError(403,'Review access is limited to its environment.');
  if (actor.origin && !(JSON.parse(project.origins) as string[]).includes(actor.origin)) throw new HttpError(403,'This website is no longer allowed.');
  if (environment && !(JSON.parse(project.environments) as string[]).includes(environment)) throw new HttpError(400,'Choose a configured environment.');
  return {...project,origins: JSON.parse(project.origins) as string[],environments: JSON.parse(project.environments) as string[]};
}
export function requireMember(actor: Actor) {if (actor.role === 'guest') throw new HttpError(403,'A project member is required.');}
export function requireAdmin(actor: Actor) {if (actor.role !== 'administrator' || actor.origin) throw new HttpError(403,'Administrator access is required.');}
