import type {Capabilities,CollaborationAdapter,Json} from '../../shared/src/collaboration';
export type HuddleOptions = {
  adapter: CollaborationAdapter; namespace: string; workspace: string; environment: string; release?: string;
  allowedQueryParameters?: string[]; includeHash?: boolean; pageIdentity?: (sanitizedUrl: URL) => string;
  excludeElement?: (element: Element) => boolean; redact?: (text: string, field: string) => string; viewContext?: () => Json;
  capabilities?: Partial<Capabilities>; persistence?: 'local' | 'memory' | 'disabled'; styleNonce?: string;
  onDisplayNameChange?: (name:string,signal:AbortSignal) => Promise<void>;
  launcher?: 'floating' | 'hidden'; requestTimeoutMs?: number; onError?: (error: Error) => void;
  exportEnvironments?: string[]; transferLimits?: {uploadBytes?:number;downloadBytes?:number};
};
export function validateOptions(options: HuddleOptions): void {
  if (!options || typeof options !== 'object') throw new Error('Provide Huddle adapter options.');
  if (['serverUrl','projectId','accessToken'].some(key => key in options)) throw new Error('Huddle v0.2 requires a host collaboration adapter. Remove serverUrl, projectId and accessToken; see the migration guide.');
  if (!options.adapter || ['session','list','detail','create','reply','update','changes','export','stageImport','previewImport','executeImport','importProgress'].some(key => typeof Reflect.get(options.adapter,key) !== 'function')) throw new Error('Provide a complete host collaboration adapter.');
  for (const field of ['namespace','workspace','environment'] as const) if (typeof options[field] !== 'string' || !options[field].trim() || options[field].length > 512) throw new Error(`Provide a nonempty ${field} of at most 512 characters.`);
  if(options.onDisplayNameChange !== undefined && typeof options.onDisplayNameChange !== 'function')throw new Error('onDisplayNameChange must be a host callback.');
  if (options.launcher !== undefined && !['floating','hidden'].includes(options.launcher)) throw new Error('launcher must be floating or hidden.');
  if (options.persistence !== undefined && !['local','memory','disabled'].includes(options.persistence)) throw new Error('persistence must be local, memory or disabled.');
  if (options.requestTimeoutMs !== undefined && (!Number.isFinite(options.requestTimeoutMs) || options.requestTimeoutMs < 100 || options.requestTimeoutMs > 120000)) throw new Error('requestTimeoutMs must be between 100 and 120000.');
  if(options.exportEnvironments !== undefined && (!Array.isArray(options.exportEnvironments) || options.exportEnvironments.length > 1000 || options.exportEnvironments.some(value => typeof value !== 'string' || !value.length || value.length > 512))) throw new Error('Provide at most 1000 export environment IDs of at most 512 characters.');
  if(options.transferLimits !== undefined) {if(!options.transferLimits || typeof options.transferLimits !== 'object' || Array.isArray(options.transferLimits)) throw new Error('Provide a browser transfer limits object.'); for(const [name,value] of Object.entries(options.transferLimits)) if(!['uploadBytes','downloadBytes'].includes(name) || value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > (name === 'uploadBytes' ? 64 : 1024)*1024*1024)) throw new Error('Provide positive bounded browser transfer limits (64 MiB upload, 1 GiB download maximum).');}
}
