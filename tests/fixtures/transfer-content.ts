import type {Attribution,Comment,FeedbackSnapshot,History,Thread} from '../../packages/shared/src/collaboration';
// Normalize only schema metadata; opaque view context/history data must remain intact.
export function transferContent(data:FeedbackSnapshot,restoreSourceIds = false) {
  const ids = new Map([...data.threads,...data.comments,...data.history].map(item => [item.id,restoreSourceIds ? item.provenance!.recordId : item.id]));
  const identity = ({provenance:_provenance,...value}:Attribution) => value;
  const comment = ({provenance:_provenance,...value}:Comment) => ({...value,id:ids.get(value.id)!,threadId:ids.get(value.threadId)!,author:identity(value.author),mentions:value.mentions.map(identity)});
  const thread = ({provenance:_provenance,...value}:Thread) => ({...value,id:ids.get(value.id)!,createdBy:identity(value.createdBy),assignee:value.assignee ? identity(value.assignee) : null,latestComment:value.latestComment ? comment(value.latestComment) : null});
  const history = ({provenance:_provenance,...value}:History) => {const details = value.data; return {...value,id:ids.get(value.id)!,threadId:ids.get(value.threadId)!,actor:identity(value.actor),data:value.action === 'replied' && details && typeof details === 'object' && !Array.isArray(details) && typeof details.commentId === 'string' && ids.has(details.commentId) ? {...details,commentId:ids.get(details.commentId)!} : details};};
  return {threads:data.threads.map(thread),comments:data.comments.map(comment),history:data.history.map(history)};
}
