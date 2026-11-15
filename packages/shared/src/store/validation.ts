import {encodeText,decodeText,encodeBytes,decodeBytes,type Runtime} from './runtime';
import {z} from 'zod';
import {CollaborationError} from '../collaboration';
export const scopeSchema = z.object({workspace: z.string().min(1).max(512),environment: z.string().min(1).max(512)}).strict();
export const identitySchema = z.object({id: z.string().min(1).max(512),name: z.string().min(1).max(1000)}).strict();
const optionalCursor = z.string().min(1).max(2048).optional();
export const listSchema = z.object({page: z.string().max(4096).optional(),status: z.enum(['open','resolved']).optional(),cursor: optionalCursor,limit: z.number().int().min(1).max(100).optional()}).strict();
export const detailSchema = z.object({commentsCursor: optionalCursor,historyCursor: optionalCursor,limit: z.number().int().min(1).max(100).optional()}).strict();
export function validate<T>(schema: z.ZodType<T>,input: unknown,maxDepth = 32): T {
  // Check depth/cycles before recursive Zod schemas can exhaust the stack.
  const queue = [{value: input,depth: 0}]; let count = 0;
  while (queue.length) {
    const {value,depth} = queue.pop()!;
    if (depth > maxDepth || ++count > 10000) throw new CollaborationError('validation','Feedback input is too complex.');
    if (value && typeof value === 'object') for (const child of Object.values(value)) queue.push({value: child,depth: depth + 1});
  }
  const result = schema.safeParse(input); if (!result.success) throw new CollaborationError('validation','Invalid feedback request.'); return result.data;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([,item]) => item !== undefined).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([key,item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function createValidation(runtime:Runtime) {
const digest=(value:unknown)=>{const hash=runtime.hash();hash.update(canonical(value));return hash.digest('hex');};
function encodeCursor(secret: string,binding: unknown,position: unknown): string {
  const payload = encodeText(JSON.stringify({binding:digest(binding),position}));
  return `${payload}.${encodeBytes(runtime.hmac(secret,payload)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')}`;
}
function decodeCursor<T>(secret: string,binding: unknown,cursor: string,schema: z.ZodType<T>): T {
  try {
    if (cursor.length > 2048) throw new Error(); const [payload,signature,extra] = cursor.split('.'); if (!payload || !signature || extra !== undefined) throw new Error();
    const expected = runtime.hmac(secret,payload), received = decodeBytes(signature.replaceAll('-','+').replaceAll('_','/'));
    if (received.length !== expected.length || !runtime.equal(received,expected)) throw new Error();
    const decoded = JSON.parse(decodeText(payload)); if (decoded.binding !== digest(binding)) throw new Error();
    return schema.parse(decoded.position);
  } catch {throw new CollaborationError('validation','Invalid or mismatched feedback cursor.');}
}

return {digest,encodeCursor,decodeCursor};
}
