import type {Actor, Change} from '@huddle/shared';
export class ApiError extends Error {constructor(public status: number, message: string, options?: ErrorOptions) {super(message,options);}}
export async function jsonRequest<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(),timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal,deadline.signal]) : deadline.signal;
  try {
    const response = await fetch(url,{...init,signal});
    let result: {error?: unknown};
    try {result = await response.json();} catch (cause) {
      if (signal.aborted) throw cause;
      throw new ApiError(response.ok ? 502 : response.status,'Huddle returned an unreadable response. Try again.',{cause});
    }
    if (!response.ok) throw new ApiError(response.status,typeof result?.error === 'string' ? result.error : 'Huddle could not complete the request. Try again.');
    return result as T;
  } catch (cause) {
    if (deadline.signal.aborted && !init.signal?.aborted) throw new ApiError(408,'Huddle request timed out. Your draft is kept; try again.',{cause});
    if (!signal.aborted && cause instanceof TypeError) throw new ApiError(0,'Could not reach Huddle. Check your connection and try again.',{cause});
    throw cause;
  } finally {clearTimeout(timer);}
}
export class Api {
  token = ''; private lifetime = new AbortController();
  constructor(readonly baseUrl: string, readonly projectId: string, readonly timeoutMs = 15000) {}
  async request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    return jsonRequest<T>(`${this.baseUrl}${path}`,{method,credentials: 'omit',signal: signal ? AbortSignal.any([signal,this.lifetime.signal]) : this.lifetime.signal,headers: {Authorization: `Bearer ${this.token}`,...(body ? {'Content-Type': 'application/json'} : {})},...(body ? {body: JSON.stringify(body)} : {})},this.timeoutMs);
  }
  project(path: string) {return `/api/projects/${encodeURIComponent(this.projectId)}${path}`;}
  destroy() {this.lifetime.abort(); this.token = '';}
}
const b64 = (value: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export async function connect(api: Api, environment: string, signal: AbortSignal): Promise<Actor> {
  signal.throwIfAborted();
  const popup = window.open('about:blank',`huddle-${crypto.randomUUID()}`,'popup,width=500,height=720');
  if (!popup) throw new Error('Allow the Huddle connection window, then try again.');
  const verifier = b64(crypto.getRandomValues(new Uint8Array(32))), state = crypto.randomUUID();
  let challenge: string;
  try {challenge = b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))); signal.throwIfAborted();} catch (error) {popup.close(); throw error;}
  const url = new URL('/connect',api.baseUrl); url.search = new URLSearchParams({projectId: api.projectId,environment,origin: location.origin,challenge,state}).toString();
  return new Promise((resolve,reject) => {
    let completed = false, exchanging = false;
    const finish = (error?: Error, actor?: Actor) => {if (completed) return; completed = true; clearTimeout(timeout); clearInterval(closed); window.removeEventListener('message',message); signal.removeEventListener('abort',aborted); popup.close(); if (error) reject(error); else resolve(actor!);};
    const message = (event: MessageEvent) => {
      if (event.origin !== api.baseUrl || event.source !== popup || event.data?.type !== 'huddle:authorized' || event.data?.state !== state || typeof event.data?.code !== 'string') return;
      if (exchanging) return; exchanging = true;
      void jsonRequest<{token: string; actor: Actor}>(`${api.baseUrl}/api/auth/exchange`,{method: 'POST',credentials: 'omit',signal,headers: {'Content-Type': 'application/json'},body: JSON.stringify({code: event.data.code,verifier})},api.timeoutMs).then(data => {if (completed || signal.aborted) return; api.token = data.token; finish(undefined,data.actor);}).catch(error => finish(error));
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
  start() {if (this.stopped || this.controller || document.visibilityState === 'hidden') return; clearTimeout(this.retry); this.retry = undefined; this.controller = new AbortController(); void this.run(this.controller);}
  pause() {this.controller?.abort(); this.controller = undefined; clearTimeout(this.retry); this.retry = undefined;}
  stop() {this.stopped = true; this.pause();}
  private async run(controller: AbortController) {
    let stalled = false, connected = false;
    let watchdog: ReturnType<typeof setTimeout>;
    const arm = () => {clearTimeout(watchdog); watchdog = setTimeout(() => {stalled = true; controller.abort();},45000);};
    arm();
    try {
      const response = await fetch(`${this.api.baseUrl}${this.api.project('/events')}?after=${this.cursor}`,{headers: {Authorization: `Bearer ${this.api.token}`},credentials: 'omit',signal: controller.signal});
      if (!response.ok || !response.body) {const terminal = [401,403,404].includes(response.status); this.onError(terminal ? 'Review access expired or was revoked. Connect again.' : 'Reconnecting to Huddle…',terminal); if (terminal) this.stopped = true; throw new Error('Stream unavailable');}
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = '';
      try {while (!controller.signal.aborted) {
        const {value,done} = await reader.read(); if (done) break; arm(); this.attempt = 0;
        if (!connected) {connected = true; this.onError('',false);}
        pending = (pending + decoder.decode(value,{stream: true})).replace(/\r\n/g,'\n');
        let separator: number;
        while ((separator = pending.indexOf('\n\n')) !== -1) {
          const packet = pending.slice(0,separator); pending = pending.slice(separator + 2);
          if (packet.length > 65536) throw new Error('Oversized stream message.');
          if (packet.split('\n').includes('event: revoked')) {this.onError('Review access expired or was revoked. Connect again.',true); this.stopped = true; controller.abort(); break;}
          const data = packet.split('\n').find(line => line.startsWith('data: ')); if (!data) continue;
          const event = JSON.parse(data.slice(6)) as Change;
          if (event && Number.isSafeInteger(event.seq) && event.seq > this.cursor && typeof event.threadId === 'string' && typeof event.environment === 'string' && typeof event.type === 'string') {this.onChange(event); this.cursor = event.seq;}
        }
        if (pending.length > 65536) throw new Error('Oversized stream message.');
      }} finally {await reader.cancel().catch(() => {}); reader.releaseLock();}
    } catch {if ((stalled || !controller.signal.aborted) && !this.stopped) this.onError('Connection interrupted. Reconnecting…',false);}
    finally {
      clearTimeout(watchdog!);
      if (this.controller === controller) {this.controller = undefined; if (!this.stopped && (stalled || !controller.signal.aborted)) {const delay = Math.min(30000,500 * 2 ** Math.min(this.attempt++,7)) * (.75 + Math.random() * .25); this.retry = setTimeout(() => this.start(),delay);}}
    }
  }
}
