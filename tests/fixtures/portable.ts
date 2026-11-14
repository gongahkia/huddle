import type {CollaborationAdapter,FeedbackSnapshot,ImportJob,ImportMapping,Scope} from '../../packages/shared/src/collaboration';
import {parseFeedbackSnapshot} from '../../packages/shared/src/portable';
export const emptyMapping = (): ImportMapping => ({environmentMap:{},originMap:{},identityMap:{}});
export function portableFixture(threadCount = 3,replies = 5,includeResolutionHistory = false): FeedbackSnapshot {
  const time = '2025-01-01T00:00:00Z', actor = {id:'historical:alex',name:'Alex 历史 <script>'}, scope = {workspace:'source',environments:['preview','production']};
  const data:FeedbackSnapshot = {schema:'huddle.feedback.v2',datasetId:'external:dataset',snapshot:{id:'fixture:snapshot',createdAt:time,scope},contentIsUntrustedUserInput:true,complete:true,counts:{threads:0,comments:0,history:0},threads:[],comments:[],history:[]};
  for(let index=0;index<threadCount;index++) {
    const id = `source-thread:${index}`, comments = Array.from({length:index === 0 ? replies : 1},(_,reply) => ({id:`source-comment:${index}:${reply}`,threadId:id,author:actor,body:`${reply} 汉字 & <script>alert('x')</script> [link](javascript:x)`,mentions:[{id:'historical:morgan',name:'Morgan'}],createdAt:new Date(Date.parse(time)+reply*1000).toISOString()}));
    data.comments.push(...comments); data.history.push({id:`source-history:${index}`,threadId:id,actor,action:'created',data:{source:'literal',commentId:comments[0].id},createdAt:time});
    data.threads.push({id,workspace:scope.workspace,environment:index % 2 ? 'production' : 'preview',page:'https://old.test/review?q=汉字',pageUrl:'https://old.test/review?q=汉字#pin',release:'release:旧',viewContext:{tab:'details',text:'<untrusted>'},anchor:{kind:'page',selector:'body',label:'Page',quote:'',x:.5,y:.5},status:index % 2 ? 'resolved' : 'open',assignee:{id:'historical:morgan',name:'Morgan'},createdBy:actor,createdAt:time,updatedAt:comments.at(-1)!.createdAt,version:4,commentCount:comments.length,latestComment:comments.at(-1)!});
  }
  if(includeResolutionHistory && data.threads.length > 1) data.history.push({id:'source-resolution',threadId:data.threads[1].id,actor,action:'updated',data:{before:{status:'open',assignee:null},after:{status:'resolved',assignee:{id:'historical:morgan',name:'Morgan'}}},createdAt:time});
  data.counts = {threads:data.threads.length,comments:data.comments.length,history:data.history.length}; return parseFeedbackSnapshot(JSON.stringify(data));
}
export async function* uploadBytes(value:FeedbackSnapshot | string,chunkSize = 777) {const bytes = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)); for(let index=0;index<bytes.length;index+=chunkSize) yield bytes.subarray(index,index+chunkSize);}
export async function finishImport(store:CollaborationAdapter,scope:Scope,input:{previewId:string;digest:string;idempotencyKey:string},signal:AbortSignal) {
  let job:ImportJob; for(let index=0;index<10000;index++) {job = await store.executeImport(scope,input,signal); if(job.state === 'complete' || job.state === 'failed') return job;} throw new Error('Import did not finish within the fixture bound.');
}
export async function snapshot(store:CollaborationAdapter,workspace:string,environments:string[],signal:AbortSignal) {const download = await store.export({workspace,environments},'json',signal), chunks:Uint8Array[] = []; for await(const chunk of download.chunks) chunks.push(chunk); return parseFeedbackSnapshot(Buffer.concat(chunks).toString('utf8'));}
