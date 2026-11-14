import {mkdir,writeFile} from 'node:fs/promises';
import {z} from 'zod';
import {feedbackSnapshotSchema,portableShapes as s} from '../packages/shared/src/portable';

const capabilities = z.object({mentions: z.boolean(),assignment: z.boolean(),directory: z.boolean()}).strict();
const identity = z.object({id: s.id,name: z.string().min(1).max(1000)}).strict();
const scope = z.object({workspace: s.id,environment: s.id}).strict();
const page = <T extends z.ZodType>(item: T) => z.object({items: z.array(item),nextCursor: s.id.nullable()}).strict();
const counts = z.object({threads: s.count,comments: s.count,history: s.count}).strict();
const mapping = z.object({environmentMap: z.record(z.string(),s.id),originMap: z.record(z.string(),z.string().url()),identityMap: z.record(z.string(),s.id)}).strict();
const rejected = z.array(z.object({recordId: s.id,reason: z.string()}).strict());
const mutation = {idempotencyKey: s.id};
const errors = z.enum(['unauthenticated','forbidden','validation','not_found','conflict','rate_limited','timeout','network','unavailable']);
const schemas = {
  FeedbackSnapshot: feedbackSnapshotSchema,
  Session: z.object({actor: identity,scope,capabilities}).strict(),
  ThreadPage: page(s.thread),
  Detail: z.object({thread: s.thread,comments: page(s.comment),history: page(s.history)}).strict(),
  Create: z.object({...mutation,page: z.string().min(1).max(4096),pageUrl: z.string().url().max(8192),release: z.string().max(1000).optional(),viewContext: z.json().optional(),anchor: s.anchor,body: z.string().min(1).max(100000),mentions: z.array(s.id).max(1000).optional()}).strict(),
  Reply: z.object({...mutation,body: z.string().min(1).max(100000),mentions: z.array(s.id).max(1000).optional()}).strict(),
  Update: z.object({...mutation,expectedVersion: z.number().int().positive(),status: z.enum(['open','resolved']).optional(),anchor: s.anchor.optional(),assigneeId: s.id.nullable().optional()}).strict(),
  ChangePage: z.object({items: z.array(z.object({threadId: s.id,kind: z.enum(['created','updated','imported'])}).strict()).max(100),cursor: s.id,hasMore: z.boolean(),reset: z.boolean()}).strict(),
  Directory: page(identity),
  Export: z.object({scope: s.scope,format: z.enum(['json','markdown'])}).strict(),
  Upload: z.object({uploadId: s.id,digest: z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  PreviewRequest: z.object({uploadId: s.id,digest: z.string().regex(/^[a-f0-9]{64}$/),mapping}).strict(),
  ImportPreview: z.object({id: s.id,digest: z.string().regex(/^[a-f0-9]{64}$/),scope,mapping,counts,historicalAuthors: z.array(s.attribution),conflicts: rejected,expiresAt: s.timestamp}).strict(),
  Execute: z.object({...mutation,previewId: s.id,digest: z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  ImportJob: z.object({id: s.id,state: z.enum(['pending','running','complete','failed']),expected: counts,processed: counts,rejected,error: z.string().optional()}).strict(),
  Error: z.object({error: z.object({code: errors,message: z.string(),retryAfterMs: z.number().int().nonnegative().optional()}).strict()}).strict(),
};
const ref = (name: string) => ({$ref: `#/components/schemas/${name}`});
const json = (schema: unknown) => ({'application/json': {schema}});
const parameter = (name: string, required = false, schema: unknown = {type: 'string'}) => ({name,in: 'query',required,schema});
const paths: Record<string,Record<string,unknown>> = {};
function route(method: string,path: string,response: string,status = '200',body?: string,query: string[] = []) {
  const parameters: unknown[] = path === '/exports' ? [] : [parameter('workspace',true),parameter('environment',true)];
  for (const name of query) parameters.push(parameter(name,false,name === 'limit' ? {type: 'integer',minimum: 1,maximum: 100,default: 50} : name === 'status' ? {type: 'string',enum: ['open','resolved']} : {type: 'string'}));
  if (path.includes('{id}')) parameters.push({name: 'id',in: 'path',required: true,schema: {type: 'string'}});
  const responses: Record<string,unknown> = {[status]: {description: 'Success',content: response === 'Download' ? {'application/json': {schema: ref('FeedbackSnapshot')},'text/markdown': {schema: {type: 'string'}}} : json(ref(response))}};
  for (const code of ['400','401','403','404','409','413','422','429','500','502','503','504']) responses[code] = {description: 'Typed sanitized failure',content: json(ref('Error'))};
  const requestBody = body ? {required: true,content: body === 'UploadBytes' ? {'application/json': {schema: {type: 'string',format: 'binary'}}} : json(ref(body))} : undefined;
  (paths[path] ||= {})[method] = {operationId: `${method}${path.replace(/[^a-zA-Z]/g,'_')}`,parameters,...(requestBody ? {requestBody} : {}),responses};
}
route('get','/session','Session');
route('get','/threads','ThreadPage','200',undefined,['page','status','cursor','limit']);
route('get','/threads/{id}','Detail','200',undefined,['commentsCursor','historyCursor','limit']);
route('post','/threads','Detail','201','Create');
route('post','/threads/{id}/replies','Detail','200','Reply');
route('patch','/threads/{id}','Detail','200','Update');
route('get','/changes','ChangePage','200',undefined,['cursor']);
route('get','/directory','Directory','200',undefined,['search','cursor']);
route('post','/exports','Download','200','Export');
route('post','/imports/uploads','Upload','201','UploadBytes');
route('post','/imports/previews','ImportPreview','200','PreviewRequest');
route('post','/imports/jobs','ImportJob','202','Execute');
route('get','/imports/jobs/{id}','ImportJob');
const components = {schemas: Object.fromEntries(Object.entries(schemas).map(([name,schema]) => {
  const {$schema: _dialect,...value} = z.toJSONSchema(schema);
  // Embedded JSON Schema references resolve against the OpenAPI document root.
  const embedded = JSON.parse(JSON.stringify(value, (key,item: unknown) => key === '$ref' && typeof item === 'string' && item.startsWith('#/$defs/') ? `#/components/schemas/${name}/${item.slice(2)}` : item));
  return [name,embedded];
}))};
await mkdir('docs/schema',{recursive: true});
await writeFile('docs/schema/huddle.http.v2.openapi.json',JSON.stringify({openapi: '3.1.0',info: {title: 'Huddle host collaboration API',version: '2.0.0',description: 'Host session and CSRF integration are mandatory. See collaboration-contract.md for transactional, authorization and transfer semantics.'},servers: [{url: '/api/huddle/v2'}],paths,components},null,2) + '\n');
