import {exportFeedback as shared,type ExportAccess} from '../../shared/src/store/export';
import type {Backend} from './backend';
import type {ExportScope} from '../../shared/src/collaboration';
import {nodeRuntime} from './runtime';
export {records,type ExportAccess} from '../../shared/src/store/export';
export function exportFeedback(backend:Backend,access:ExportAccess,scope:ExportScope,format:'json'|'markdown',signal:AbortSignal,timeoutMs:number){return shared(backend,access,scope,format,signal,timeoutMs,nodeRuntime);}
