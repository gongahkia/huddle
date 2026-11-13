import type {Actor, Change} from '@huddle/shared';
export class ApiError extends Error {constructor(public status: number, message: string) {super(message);}}
export class Api {
  token = ''; private lifetime = new AbortController();
  constructor(readonly baseUrl: string, readonly projectId: string) {}
  async request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`,{method,credentials: 'omit',signal: signal ? AbortSignal.any([signal,this.lifetime.signal]) : this.lifetime.signal,headers: {Authorization: `Bearer ${this.token}`,...(body ? {'Content-Type': 'application/json'} : {})},...(body ? {body: JSON.stringify(body)} : {})});
    const result = await response.json(); if (!response.ok) throw new ApiError(response.status,result.error || 'Could not complete the request.'); return result as T;
  }
  project(path: string) {return `/api/projects/${encodeURIComponent(this.projectId)}${path}`;}
  destroy() {this.lifetime.abort(); this.token = '';}
}
const b64 = (value: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export async function connect(api: Api, environment: string, signal: AbortSignal): Promise<Actor> {
  const popup = window.open('about:blank',`huddle-${crypto.randomUUID()}`,'popup,width=500,height=720');
  if (!popup) throw new Error('Allow the Huddle connection window, then try again.');
  const verifier = b64(crypto.getRandomValues(new Uint8Array(32))), state = crypto.randomUUID();
  const challenge = b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
  const url = new URL('/connect',api.baseUrl); url.search = new URLSearchParams({projectId: api.projectId,environment,origin: location.origin,challenge,state}).toString();
  return new Promise((resolve,reject) => {
    let completed = false, exchanging = false;
    const finish = (error?: Error, actor?: Actor) => {if (completed) return; completed = true; clearTimeout(timeout); clearInterval(closed); window.removeEventListener('message',message); signal.removeEventListener('abort',aborted); popup.close(); if (error) reject(error); else resolve(actor!);};
    const message = (event: MessageEvent) => {
      if (event.origin !== api.baseUrl || event.source !== popup || event.data?.type !== 'huddle:authorized' || event.data?.state !== state || typeof event.data?.code !== 'string') return;
      if (exchanging) return; exchanging = true;
      void fetch(`${api.baseUrl}/api/auth/exchange`,{method: 'POST',credentials: 'omit',signal,headers: {'Content-Type': 'application/json'},body: JSON.stringify({code: event.data.code,verifier})}).then(async response => {const data = await response.json(); if (!response.ok) throw new Error(data.error); api.token = data.token; finish(undefined,data.actor);}).catch(error => finish(error));
    };
    const aborted = () => finish(new Error('Connection cancelled.'));
    const timeout = setTimeout(() => finish(new Error('Connection timed out. Try again.')),120000);
    const closed = setInterval(() => {if (popup.closed && !exchanging) finish(new Error('Connection window closed.'));},1000);
    window.addEventListener('message',message); signal.addEventListener('abort',aborted,{once: true});
    if (signal.aborted) aborted(); else popup.location.href = url.href;
  });
}
export class ChangeStream {
  private controller?: AbortController; private retry?: ReturnType<typeof setTimeout>; private stopped = false; private attempt = 0;
  constructor(private api: Api, private cursor: number, private onChange: (event: Change) => void, private onError: (message: string, terminal: boolean) => void) {}
  start() {if (this.stopped || this.controller || document.visibilityState === 'hidden') return; this.controller = new AbortController(); void this.run(this.controller);}
  pause() {this.controller?.abort(); this.controller = undefined; clearTimeout(this.retry);}
  stop() {this.stopped = true; this.pause();}
  private async run(controller: AbortController) {
    try {
      const response = await fetch(`${this.api.baseUrl}${this.api.project('/events')}?after=${this.cursor}`,{headers: {Authorization: `Bearer ${this.api.token}`},credentials: 'omit',signal: controller.signal});
      if (!response.ok || !response.body) {const terminal = [401,403,404].includes(response.status); this.onError(terminal ? 'Review access expired or was revoked. Connect again.' : 'Reconnecting to Huddle…',terminal); if (terminal) this.stopped = true; throw new Error('Stream unavailable');}
      this.attempt = 0; const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = '';
      try {while (!controller.signal.aborted) {
        const {value,done} = await reader.read(); if (done) break; pending += decoder.decode(value,{stream: true});
        if (pending.length > 65536) throw new Error('Oversized stream message.');
        let separator: number;
        while ((separator = pending.indexOf('\n\n')) !== -1) {
          const packet = pending.slice(0,separator); pending = pending.slice(separator + 2);
          if (packet.includes('event: revoked')) {this.onError('Review access expired or was revoked. Connect again.',true); this.stopped = true; controller.abort(); break;}
          const data = packet.split('\n').find(line => line.startsWith('data: ')); if (!data) continue;
          const event = JSON.parse(data.slice(6)) as Change;
          if (Number.isSafeInteger(event.seq) && event.seq > this.cursor && typeof event.threadId === 'string') {this.onChange(event); this.cursor = event.seq;}
        }
      }} finally {await reader.cancel().catch(() => {}); reader.releaseLock();}
    } catch {if (!controller.signal.aborted && !this.stopped) this.onError('Connection interrupted. Reconnecting…',false);}
    finally {
      if (this.controller === controller) {this.controller = undefined; if (!this.stopped && !controller.signal.aborted) this.retry = setTimeout(() => this.start(),Math.min(30000,500 * 2 ** this.attempt++));}
    }
  }
}
