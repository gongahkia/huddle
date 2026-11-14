import type {Capabilities,CollaborationAdapter,Json} from '../../shared/src/collaboration';
export type HuddleOptions = {
  adapter: CollaborationAdapter; namespace: string; workspace: string; environment: string; release?: string;
  allowedQueryParameters?: string[]; includeHash?: boolean; pageIdentity?: (sanitizedUrl: URL) => string;
  excludeElement?: (element: Element) => boolean; redact?: (text: string, field: string) => string; viewContext?: () => Json;
  capabilities?: Partial<Capabilities>; persistence?: 'local' | 'memory' | 'disabled'; styleNonce?: string;
  launcher?: 'floating' | 'hidden'; requestTimeoutMs?: number; onError?: (error: Error) => void;
};
export function validateOptions(options: HuddleOptions): void {
  if (!options || typeof options !== 'object') throw new Error('Provide Huddle adapter options.');
  if (['serverUrl','projectId','accessToken'].some(key => key in options)) throw new Error('Huddle v0.2 requires a host collaboration adapter. Remove serverUrl, projectId and accessToken; see the migration guide.');
  if (!options.adapter || ['session','list','detail','create','reply','update','changes','export','stageImport','previewImport','executeImport','importProgress'].some(key => typeof Reflect.get(options.adapter,key) !== 'function')) throw new Error('Provide a complete host collaboration adapter.');
  for (const field of ['namespace','workspace','environment'] as const) if (typeof options[field] !== 'string' || !options[field].trim() || options[field].length > 512) throw new Error(`Provide a nonempty ${field} of at most 512 characters.`);
  if (options.launcher !== undefined && !['floating','hidden'].includes(options.launcher)) throw new Error('launcher must be floating or hidden.');
  if (options.persistence !== undefined && !['local','memory','disabled'].includes(options.persistence)) throw new Error('persistence must be local, memory or disabled.');
  if (options.requestTimeoutMs !== undefined && (!Number.isFinite(options.requestTimeoutMs) || options.requestTimeoutMs < 100 || options.requestTimeoutMs > 120000)) throw new Error('requestTimeoutMs must be between 100 and 120000.');
}
