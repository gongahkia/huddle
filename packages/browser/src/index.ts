import type {Actor, Anchor, Member, Page, ReviewContext, Thread, ThreadDetail} from '@huddle/shared';
import {anchorWarnings, buildAnchor, pageAnchor, pickTarget, resolveAnchor, type ResolvedAnchor} from './anchor';
import {LocalStore, remainderAfterSave, requestTracker} from './storage';
import {Api, ApiError, ChangeStream, connect} from './transport';
import {styles} from './styles';
export type {Anchor, ReviewContext} from '@huddle/shared';
export type HuddleOptions = {
  serverUrl: string; projectId: string; environment: string; release?: string;
  allowedQueryParameters?: string[]; includeHash?: boolean; pageIdentity?: (sanitizedUrl: URL) => string;
  accessToken?: string;
};
export type Huddle = {open(): void; close(): void; updateContext(context: Partial<Pick<HuddleOptions,'environment' | 'release'>>): void; destroy(): void};
const instances = new WeakMap<Document, Huddle>();
type Draft = {body: string; mentions: string[]; anchor?: Anchor; threadId?: string};
export function mount(options: HuddleOptions): Huddle {
  const prior = instances.get(document); if (prior) return prior;
  const settings = {...options}; const serverUrl = new URL(settings.serverUrl);
  if (!['http:','https:'].includes(serverUrl.protocol) || serverUrl.username || serverUrl.password) throw new Error('Use an HTTP(S) Huddle server URL.');
  const api = new Api(serverUrl.origin,settings.projectId), life = new AbortController(); api.token = settings.accessToken || '';
  let actor: Actor | undefined, members: Member[] = [], opened = false, destroyed = false, pinning = false, reattach = false;
  let threads: Thread[] = [], selected: ThreadDetail | undefined, anchor: Anchor | undefined, body = '', mentionIds: string[] = [];
  let busy = false, error = '', notice = '', loading = false, allPages = false, resolved = false, nextCursor: number | null = null;
  let stream: ChangeStream | undefined, loadSequence = 0, detailSequence = 0, queuedRefresh: ReturnType<typeof setTimeout> | undefined;
  let store: LocalStore | undefined, seen: Record<string,string> = {}, draftKey = '', restoredTarget = '';
  let currentContext = getContext(), geometryFrame = 0, resolveFrame = 0, resolutions = new Map<string,ResolvedAnchor>();
  const requests = requestTracker();
  const host = document.createElement('div'); host.dataset.huddleRoot = ''; host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const shadow = host.attachShadow({mode: 'open'}), style = document.createElement('style'); style.textContent = styles;
  const surface = document.createElement('div'); surface.className = 'surface'; surface.setAttribute('popover','manual');
  const ui = document.createElement('div'), pins = document.createElement('div'), highlight = document.createElement('div'); highlight.className = 'highlight'; highlight.hidden = true;
  surface.append(pins,highlight,ui); shadow.append(style,surface); document.documentElement.append(host);
  function topLayer() {if (!surface.matches(':popover-open') && typeof surface.showPopover === 'function') {try {surface.showPopover();} catch { /* fallback fixed host */ }}}
  topLayer();
  function getContext(): ReviewContext {
    const url = new URL(location.href); url.username = ''; url.password = '';
    for (const name of [...url.searchParams.keys()]) if (!settings.allowedQueryParameters?.includes(name)) url.searchParams.delete(name);
    if (!settings.includeHash) url.hash = '';
    return {environment: settings.environment,page: settings.pageIdentity?.(new URL(url)) || `${url.pathname}${url.search}${url.hash}`,pageUrl: url.href,release: settings.release};
  }
  function setupStorage() {
    if (!actor) return;
    store = new LocalStore(JSON.stringify([api.baseUrl,actor.id,settings.projectId,currentContext.environment]));
    seen = store.read<Record<string,string>>('seen') || {}; draftKey = `draft:${currentContext.page}`;
    const draft = store.read<Draft>(draftKey);
    if (draft && typeof draft.body === 'string') {body = draft.body.slice(0,3000); mentionIds = Array.isArray(draft.mentions) ? draft.mentions.slice(0,30) : []; anchor = draft.anchor; restoredTarget = draft.threadId || ''; notice = 'Restored your unsent comment from this device.';}
  }
  function persistDraft() {
    if (!store) return;
    if (!body.trim()) {store.remove(draftKey); return;}
    store.write(draftKey,{body,mentions: mentionIds,anchor,threadId: anchor ? undefined : selected?.id} satisfies Draft);
  }
  function unread(t: Thread) {return !!t.latestComment && t.latestComment.authorId !== actor?.id && seen[t.id] !== t.latestComment.id;}
  function markRead(t: Thread) {if (t.latestComment) {seen[t.id] = t.latestComment.id; seen = Object.fromEntries(Object.entries(seen).slice(-1000)); store?.write('seen',seen);}}
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) => {const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node;};
  function button(text: string, action: () => void, cls = '') {const b = el('button',text,cls); b.type = 'button'; b.addEventListener('click',action); return b;}
  function link(text: string, href: string) {const a = el('a',text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;}
  function setError(e: unknown) {if (destroyed || life.signal.aborted) return; error = e instanceof Error ? e.message : 'Could not complete this action.'; if (e instanceof ApiError && [401,403].includes(e.status)) {stream?.stop(); actor = undefined; api.token = ''; threads = []; selected = undefined; members = []; resolutions.clear();} render();}
  function render() {
    if (destroyed) return;
    const previousFocus = shadow.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    const focusId = previousFocus?.id, selectionStart = previousFocus && 'selectionStart' in previousFocus ? previousFocus.selectionStart : null;
    const oldScroll = shadow.querySelector('.content')?.scrollTop || 0;
    ui.replaceChildren();
    if (pinning) {pins.replaceChildren(); const note = el('div',undefined,'pick-note'); note.append(el('span',reattach ? 'Click the new target. Escape to cancel.' : 'Click an element to comment. Escape to cancel.'),button('Cancel',cancelPin)); ui.append(note); return;}
    if (!opened) {const count = threads.filter(t => t.status === 'open' && unread(t)).length; const launch = button(`Huddle${count ? ` · ${count} new` : ''}`,() => controller.open(),'launcher'); launch.setAttribute('aria-label','Open Huddle'); ui.append(launch); pins.replaceChildren(); return;}
    const panel = el('aside',undefined,'panel'); panel.setAttribute('aria-label','Huddle feedback');
    const header = el('header'); const heading = el('div',undefined,'row between'); heading.append(el('h2','Huddle'),button('Close',() => controller.close())); header.append(heading,el('p',currentContext.environment,'muted'));
    const content = el('div',undefined,'content');
    if (error) {const n = el('p',error,'notice error'); n.setAttribute('role','alert'); content.append(n);}
    if (notice) {const n = el('p',notice,'notice'); n.setAttribute('role','status'); content.append(n);}
    if (!actor) {
      content.append(el('h3','Review this website together'),el('p','Connect to your Huddle project to see and leave feedback.','muted'),button(busy ? 'Connecting…' : 'Connect Huddle',() => {void authorize();},'primary'));
    } else {
      if (!anchor && !selected) renderList(header,content); else renderThread(content);
    }
    const footer = el('footer'); footer.append(link('Open project workspace',`${api.baseUrl}/?project=${encodeURIComponent(settings.projectId)}`));
    panel.append(header,content,footer); ui.append(panel); content.scrollTop = oldScroll;
    if (focusId) {const target = shadow.getElementById(focusId); target?.focus({preventScroll: true}); if (selectionStart !== null && target instanceof HTMLTextAreaElement) target.setSelectionRange(selectionStart,selectionStart);}
    scheduleResolution();
  }
  function renderList(header: HTMLElement, content: HTMLElement) {
    const actions = el('div',undefined,'row'); actions.append(button('Pin a comment',() => startPin(false),'primary'),button('Page comment',() => {anchor = pageAnchor(); selected = undefined; body = ''; mentionIds = []; error = ''; render(); shadow.getElementById('huddle-body')?.focus();})); header.append(actions);
    const filters = el('div',undefined,'row');
    for (const [label,value,change] of [['All pages',allPages,() => {allPages = !allPages; void refresh();}],['Show resolved',resolved,() => {resolved = !resolved; void refresh();}]] as const) {const l = el('label'); const check = el('input'); check.type = 'checkbox'; check.checked = value; check.addEventListener('change',change); l.append(check,document.createTextNode(label)); filters.append(l);} content.append(filters);
    for (const thread of threads.filter(t => resolved || t.status === 'open')) {
      const card = button('',() => {void chooseThread(thread.id);},'thread');
      const title = el('div',undefined,'row between'); title.append(el('strong',thread.anchor.label));
      if (unread(thread)) title.append(el('span',thread.mentionedIds.includes(actor!.id) ? 'Mentioned you · New' : 'New','badge new'));
      const found = resolutions.get(thread.id); if (found && found.state !== 'ok') title.append(el('span',found.state,'badge'));
      card.append(title,el('p',thread.latestComment?.body.slice(0,180) || ''),el('small',`${thread.latestComment?.authorName || ''} · ${thread.commentCount} comments · ${thread.status}`));
      if (thread.page !== currentContext.page) card.append(el('p',thread.page,'muted')); content.append(card);
    }
    if (!threads.length) content.append(el('p',loading ? 'Loading feedback…' : 'No feedback here yet. Start a discussion.','muted'));
    if (nextCursor && threads.length < 150) content.append(button('Load more threads',() => {void refresh(nextCursor!);}));
    if (threads.length >= 150) content.append(el('p','Showing 150 threads. Narrow the page filter or use the project workspace.','muted'));
  }
  function renderThread(content: HTMLElement) {
    content.append(button('Back to comments',() => {persistDraft(); selected = undefined; anchor = undefined; body = ''; mentionIds = []; render();}));
    const target = anchor || selected!.anchor; const box = el('div',undefined,'target'); box.append(el('h3',target.label));
    if (target.quote) box.append(el('blockquote',target.quote));
    if (selected) {
      const warning = selected.page === currentContext.page ? resolveAnchor(selected.anchor) : null;
      if (warning && warning.state !== 'ok') box.append(el('p',anchorWarnings[warning.state],'muted'));
      if (selected.page === currentContext.page) box.append(button('Locate on page',() => {const found = resolveAnchor(selected!.anchor); if (found.element) found.element.scrollIntoView({block: 'center',behavior: 'instant'}); else {notice = anchorWarnings[found.state]; render();}}));
      else box.append(link('Open original page',selected.pageUrl));
      if (actor!.role !== 'guest' && selected.page === currentContext.page) box.append(button('Reattach pin',() => startPin(true)));
    }
    content.append(box);
    for (const comment of selected?.comments || []) {const article = el('article'); article.append(el('h3',comment.authorName),el('p',comment.body)); if (comment.mentions.length) article.append(el('small',`Mentions: ${comment.mentions.map(id => members.find(m => m.id === id)?.name || 'Member').join(', ')}`)); const time = el('time',new Date(comment.createdAt).toLocaleString()); time.dateTime = comment.createdAt; article.append(time); content.append(article);}
    if (selected?.nextCursor && selected.comments.length < 250) content.append(button('Load more replies',() => {void moreReplies();}));
    if (selected && selected.commentCount > selected.comments.length && selected.comments.length >= 250) content.append(el('p','Open the workspace or export feedback for the complete history.','muted'));
    if (selected && actor!.role !== 'guest') {
      const coordination = el('div',undefined,'row'); coordination.append(button(selected.status === 'open' ? 'Resolve thread' : 'Reopen thread',() => {void patch({status: selected!.status === 'open' ? 'resolved' : 'open'});}));
      const assignLabel = el('label','Assignee'); const assign = el('select'); assign.setAttribute('aria-label','Assignee'); assign.append(new Option('Unassigned','')); for (const member of members) assign.append(new Option(member.name,member.id)); assign.value = selected.assigneeId || ''; assign.addEventListener('change',() => {void patch({assigneeId: assign.value || null});}); assignLabel.append(assign); coordination.append(assignLabel); content.append(coordination);
    }
    const form = el('form'); const label = el('label',selected ? 'Reply' : 'Your comment'); label.htmlFor = 'huddle-body'; const textarea = el('textarea'); textarea.id = 'huddle-body'; textarea.maxLength = 3000; textarea.required = true; textarea.value = body; textarea.placeholder = 'What should the team know?'; textarea.addEventListener('input',() => {body = textarea.value; persistDraft();});
    const mentions = el('fieldset'); mentions.append(el('legend','Mention members'));
    for (const member of members.slice(0,100)) {const label = el('label'); const input = el('input'); input.type = 'checkbox'; input.checked = mentionIds.includes(member.id); input.addEventListener('change',() => {mentionIds = input.checked ? [...new Set([...mentionIds,member.id])].slice(0,30) : mentionIds.filter(id => id !== member.id); persistDraft();}); label.append(input,document.createTextNode(member.name)); mentions.append(label);}
    const submit = el('button',busy ? 'Saving…' : selected ? 'Post reply' : 'Post comment','primary'); submit.type = 'submit'; submit.disabled = busy; form.append(label,textarea,mentions,submit); form.addEventListener('submit',event => {event.preventDefault(); void save();}); content.append(form);
  }
  async function authorize() {
    if (busy) return; busy = true; error = ''; render();
    try {actor = await connect(api,currentContext.environment,life.signal); setupStorage(); await initialize();} catch (e) {setError(e);} finally {busy = false; render();}
  }
  async function initialize() {
    members = await api.request<Member[]>(api.project('/members')); await refresh();
    if (restoredTarget) {const id = restoredTarget; restoredTarget = ''; try {selected = await api.request<ThreadDetail>(api.project(`/threads/${id}`));} catch {anchor = pageAnchor(); notice = 'The original thread is unavailable. Your draft is kept as a page comment.';} render();}
  }
  async function refresh(before?: number) {
    if (!actor || destroyed) return; const seq = ++loadSequence; const page = currentContext.page; loading = true;
    const params = new URLSearchParams({environment: currentContext.environment,limit: '30'}); if (!allPages) params.set('page',page); if (before) params.set('before',String(before));
    try {const result = await api.request<Page<Thread>>(api.project(`/threads?${params}`)); if (destroyed || seq !== loadSequence || page !== currentContext.page) return;
      const first = store?.read('baseline') === null; threads = before ? [...threads,...result.items].slice(0,150) : result.items;
      if (first) {for (const t of threads) markRead(t); store?.write('baseline',true);}
      nextCursor = result.nextCursor;
      if (!stream) {stream = new ChangeStream(api,result.cursor,event => {if (event.environment === currentContext.environment) scheduleRefresh();},(message,terminal) => {notice = message; if (terminal) {actor = undefined; api.token = ''; threads = []; selected = undefined; members = []; resolutions.clear(); stream?.stop(); stream = undefined;} render();}); stream.start();}
      render();
    } catch (e) {setError(e);} finally {if (seq === loadSequence) loading = false;}
  }
  function scheduleRefresh() {if (destroyed) return; clearTimeout(queuedRefresh); queuedRefresh = setTimeout(() => {void refresh(); if (selected) void loadDetail(selected.id);},60);}
  async function loadDetail(id: string) {
    const seq = ++detailSequence; try {const result = await api.request<ThreadDetail>(api.project(`/threads/${id}`)); if (destroyed || seq !== detailSequence || selected?.id !== id) return; selected = result; markRead(result); render();} catch (e) {setError(e);}
  }
  async function chooseThread(id: string) {
    persistDraft(); body = ''; mentionIds = []; anchor = undefined; selected = threads.find(t => t.id === id) ? {...threads.find(t => t.id === id)!,comments: [],history: [],nextCursor: null} : undefined;
    error = ''; const draft = store?.read<Draft>(draftKey); if (draft?.threadId === id) {body = draft.body; mentionIds = draft.mentions;}
    await loadDetail(id); render();
  }
  async function moreReplies() {if (!selected?.nextCursor) return; const id = selected.id, after = selected.nextCursor; try {const more = await api.request<ThreadDetail>(api.project(`/threads/${id}?after=${after}`)); if (selected?.id !== id) return; selected = {...more,comments: [...selected.comments,...more.comments].slice(0,250)}; render();} catch (e) {setError(e);}}
  async function save() {
    if (busy || !body.trim() || (!anchor && !selected)) return;
    busy = true; error = ''; const sent = body, sentMentions = [...mentionIds], target = anchor, id = selected?.id, savedKey = draftKey, savedStore = store;
    const payload = target ? {...currentContext,anchor: target,body: sent,mentions: sentMentions} : {body: sent,mentions: sentMentions};
    const requestId = requests.idFor({path: target ? 'new' : id,payload}); render();
    try {
      const result = await api.request<ThreadDetail>(api.project(target ? '/threads' : `/threads/${id}/replies`),'POST',{...payload,requestId}); requests.clear();
      const saved = savedStore?.read<Draft>(savedKey); if (saved?.body === sent && JSON.stringify(saved.mentions) === JSON.stringify(sentMentions)) savedStore?.remove(savedKey,saved);
      if (draftKey === savedKey && anchor === target && selected?.id === id) {body = remainderAfterSave(body,sent); if (body.trim()) {selected = result; anchor = undefined; persistDraft();} else {selected = result; anchor = undefined; mentionIds = [];} markRead(result);}
      notice = 'Comment saved.'; await refresh();
    } catch (e) {error = e instanceof Error ? e.message : 'Save failed. Your draft is kept on this device.'; persistDraft();} finally {busy = false; render();}
  }
  async function patch(change: {status?: 'open' | 'resolved'; assigneeId?: string | null; anchor?: Anchor}) {
    if (!selected || busy) return; busy = true; const id = selected.id; error = '';
    try {const updated = await api.request<ThreadDetail>(api.project(`/threads/${id}`),'PATCH',{...change,expectedVersion: selected.version,requestId: crypto.randomUUID()}); if (selected?.id === id) selected = updated; await refresh();}
    catch (e) {setError(e); if (selected) await loadDetail(selected.id);} finally {busy = false; render();}
  }
  function cancelPin() {pinning = false; reattach = false; highlight.hidden = true; opened = true; render();}
  function startPin(isReattach: boolean) {persistDraft(); pinning = true; reattach = isReattach; error = ''; render();}
  function pointer(event: PointerEvent) {
    if (!pinning || event.composedPath().includes(host)) return;
    const target = event.composedPath().find(node => node instanceof Element) as Element | undefined; if (!target) return;
    const r = pickTarget(target).getBoundingClientRect(); highlight.hidden = false; Object.assign(highlight.style,{left: `${r.left}px`,top: `${r.top}px`,width: `${r.width}px`,height: `${r.height}px`});
  }
  function click(event: MouseEvent) {
    if (!pinning || event.composedPath().includes(host)) return;
    const target = event.composedPath().find(node => node instanceof Element) as Element | undefined; if (!target) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const element = pickTarget(target), rect = element.getBoundingClientRect(); const built = buildAnchor(element,{quote: window.getSelection()?.toString() || '',x: (event.clientX - rect.left) / Math.max(1,rect.width),y: (event.clientY - rect.top) / Math.max(1,rect.height)});
    const update = reattach; cancelPin();
    if (update) void patch({anchor: built}); else {selected = undefined; anchor = built; body = ''; mentionIds = []; persistDraft(); render(); shadow.getElementById('huddle-body')?.focus();}
  }
  function geometry() {
    geometryFrame = 0; pins.replaceChildren(); if (!opened || pinning || document.visibilityState === 'hidden') return;
    for (const [i,t] of threads.entries()) {
      if (t.page !== currentContext.page || (t.status === 'resolved' && !resolved)) continue;
      const found = resolutions.get(t.id); if (!found?.element?.isConnected || ['missing','hidden','ambiguous'].includes(found.state)) continue;
      const rect = found.element.getBoundingClientRect(); if (!rect.width || !rect.height) continue;
      const x = rect.left + rect.width * t.anchor.x, y = rect.top + rect.height * t.anchor.y; if (y < 0 || y > innerHeight || x < 0 || x > innerWidth) continue;
      const pin = button(String(i + 1),() => {void chooseThread(t.id);},`pin${found.state !== 'ok' ? ' warning' : ''}`); pin.setAttribute('aria-label',`Open feedback: ${t.anchor.label}`); pin.style.left = `${x}px`; pin.style.top = `${y}px`; pins.append(pin);
    }
  }
  function scheduleGeometry() {if (!geometryFrame && !destroyed && opened) geometryFrame = requestAnimationFrame(geometry);}
  function scheduleResolution() {
    if (resolveFrame || destroyed || !opened || document.visibilityState === 'hidden') return;
    resolveFrame = requestAnimationFrame(() => {resolveFrame = 0; resolutions = new Map(threads.filter(t => t.page === currentContext.page).map(t => [t.id,resolveAnchor(t.anchor)])); scheduleGeometry();});
  }
  const observer = new MutationObserver(records => {
    if (records.every(r => r.target === host || r.target.getRootNode() === shadow)) return;
    // Re-resolve only after page mutations, never on a periodic DOM scan.
    routeChange(); scheduleResolution();
    const modal = [...document.querySelectorAll('dialog[open]')].find(el => el.matches(':modal'));
    const parent = modal || document.documentElement; if (host.parentElement !== parent) {parent.append(host); topLayer();}
    const top = document.querySelector('dialog[open],:popover-open'); if (top && top !== surface && opened) {try {surface.hidePopover(); topLayer();} catch { /* unsupported */ }}
  }); observer.observe(document.documentElement,{childList: true,subtree: true,attributes: true,attributeFilter: ['hidden','open','class','style','aria-expanded'],characterData: true});
  function routeChange() {
    if (destroyed) return;
    const next = getContext(); if (JSON.stringify(next) === JSON.stringify(currentContext)) return;
    persistDraft(); currentContext = next; loadSequence++; detailSequence++; selected = undefined; anchor = undefined; body = ''; mentionIds = []; threads = []; resolutions.clear(); notice = ''; error = ''; setupStorage(); render(); void refresh();
  }
  const onVisibility = () => {if (document.visibilityState === 'hidden') {stream?.pause(); cancelAnimationFrame(geometryFrame); cancelAnimationFrame(resolveFrame); geometryFrame = resolveFrame = 0;} else {stream?.start(); routeChange(); scheduleResolution();}};
  const keydown = (event: KeyboardEvent) => {if (event.key === 'Escape') {if (pinning) {event.preventDefault(); cancelPin();} else if (opened && event.composedPath().includes(host)) controller.close();}};
  // Observe History API calls while preserving originals and other wrappers.
  const originalPush = history.pushState, originalReplace = history.replaceState;
  const push: History['pushState'] = function(this: History,...args) {originalPush.apply(this,args); routeChange();};
  const replace: History['replaceState'] = function(this: History,...args) {originalReplace.apply(this,args); routeChange();};
  history.pushState = push; history.replaceState = replace;
  window.addEventListener('pointermove',pointer,{signal: life.signal,passive: true}); window.addEventListener('click',click,{signal: life.signal,capture: true});
  window.addEventListener('keydown',keydown,{signal: life.signal}); window.addEventListener('scroll',scheduleGeometry,{signal: life.signal,capture: true,passive: true});
  window.addEventListener('resize',scheduleResolution,{signal: life.signal}); window.addEventListener('popstate',routeChange,{signal: life.signal}); window.addEventListener('hashchange',routeChange,{signal: life.signal});
  document.addEventListener('visibilitychange',onVisibility,{signal: life.signal});
  const controller: Huddle = {
    open() {if (destroyed) return; opened = true; topLayer(); render(); shadow.querySelector<HTMLElement>('.panel button')?.focus(); if (api.token && !actor) void api.request<{actor: Actor}>('/api/session').then(async result => {actor = result.actor; setupStorage(); await initialize();}).catch(setError); else if (actor) void refresh();},
    close() {persistDraft(); opened = false; pinning = false; highlight.hidden = true; render(); shadow.querySelector<HTMLElement>('.launcher')?.focus();},
    updateContext(context) {const changedEnvironment = context.environment && context.environment !== settings.environment; Object.assign(settings,context); if (changedEnvironment) {stream?.stop(); stream = undefined; actor = undefined; api.token = '';} routeChange();},
    destroy() {if (destroyed) return; persistDraft(); destroyed = true; life.abort(); api.destroy(); stream?.stop(); observer.disconnect(); cancelAnimationFrame(geometryFrame); cancelAnimationFrame(resolveFrame); clearTimeout(queuedRefresh); if (history.pushState === push) history.pushState = originalPush; if (history.replaceState === replace) history.replaceState = originalReplace; host.remove(); instances.delete(document); threads = []; selected = undefined; actor = undefined; members = []; resolutions.clear();},
  };
  instances.set(document,controller); render(); return controller;
}
