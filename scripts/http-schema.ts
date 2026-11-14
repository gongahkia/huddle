import {mkdir,writeFile} from 'node:fs/promises';
import {z} from 'zod';
import {httpSchemas as schemas} from '../packages/shared/src/protocol';

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
