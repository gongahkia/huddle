import {COMMENT_COLORS,type CommentColor,type Anchor,type Context,type Detail,type Identity,type Session,type Thread,type Update} from '../../shared/src/collaboration';
import {isCollaborationError,CollaborationError} from '../../shared/src/collaboration';
import {anchorWarnings,buildAnchor,pageAnchor,pickTarget,resolveAnchor,type ResolvedAnchor} from './anchor';
import {LocalStore,MemoryStorage,remainderAfterSave,requestTracker} from './storage';
import {operation} from './operations';
import {validateOptions,type HuddleOptions} from './options';
import {styles} from './styles';
import {createTransfers} from './transfers';
import {excerpt,icon,type Icon} from './ui';
import {placePin} from './pin-layout';
import {attachMentions} from './mentions';
import {createPresentation} from './presentation';
export type {HuddleOptions} from './options';
export type {Anchor,Context as ReviewContext} from '../../shared/src/collaboration';
export type Huddle = {open(): void; collapse(): void; close(): void; updateContext(context: Partial<Pick<HuddleOptions,'workspace' | 'environment' | 'release'>>): void; destroy(): void};
const instances = new WeakMap<Document,{controller: Huddle; settings: HuddleOptions; owner?: symbol}>();
type CapturedContext = Omit<Context,'workspace' | 'environment'>;
type Draft = {body: string; mentions: string[]; anchor?: Anchor; threadId?: string; context?: CapturedContext; color?:CommentColor; mentionNames?:Record<string,string>};
export function mount(options: HuddleOptions): Huddle {return mountForOwner(options);}
export function mountForOwner(options: HuddleOptions,owner?: symbol): Huddle {
  if (typeof document === 'undefined' || typeof window === 'undefined') throw new Error('Mount Huddle in a browser lifecycle hook after hydration, not during server rendering.');
  validateOptions(options);
  const settings = {...options}, adapter = settings.adapter;
  const prior = instances.get(document);
  if (prior) {
    if (prior.owner !== owner) throw new Error('Huddle is already owned by another integration. Remove that installation before mounting a helper.');
    if ((Object.keys({...prior.settings,...settings}) as (keyof HuddleOptions)[]).some(key => prior.settings[key] !== settings[key])) throw new Error('Huddle is already mounted with different settings. Destroy it before changing the installation.');
    return prior.controller;
  }
  if (document.querySelector('[data-huddle-root]')) throw new Error('Another copy of Huddle is already mounted. Install the widget once per page.');
  const life = new AbortController(), memory = new MemoryStorage();
  let preferenceStorage:Storage|null=memory;if(settings.persistence==='disabled')preferenceStorage=null;else if(!settings.persistence||settings.persistence==='local'){try{preferenceStorage=window.localStorage;}catch{/* use memory */}}
  const preferences=new LocalStore(JSON.stringify([settings.namespace,'presentation']),preferenceStorage,memory);
  let composerCleanup:(()=>void)|undefined,motion=false,color:CommentColor='green';const mentionNames=new Map<string,string>();
  let contextLife = new AbortController(), epoch = 0, session: Session | undefined, members: Identity[] = [];
  let memberCursor:string | undefined, memberNext:string | null = null, memberSearch = '', appliedMemberSearch = '', memberLoading = false, memberLoaded = false, memberSequence = 0;
  let draftContext: CapturedContext | undefined;
  let opened = settings.launcher!=='hidden', destroyed = false, pinning = false, reattach = false, busy = false, loading = false, detailLoading = false, connecting = false, stale = false;
  let collapsed = opened, scopeExpanded = false, previewId: string | undefined, previewHovered = false, previewTimer: ReturnType<typeof setTimeout> | undefined;
  const pinNodes = new Map<string,HTMLButtonElement>();
  let threads: Thread[] = [], selected: Detail | undefined, anchor: Anchor | undefined, body = '', mentionIds: string[] = [];
  let error = '', notice = '', allPages = false, resolved = false, nextCursor: string | null = null, cursor: string | undefined;
  let listCursor: string | undefined, commentCursor: string | undefined, historyCursor: string | undefined;
  let assignmentExpanded=false,historyExpanded = false, contextExpanded = false, historyEntry:string | undefined, pendingFocus:string | undefined;
  let loadSequence = 0, detailSequence = 0, pollTimer: ReturnType<typeof setTimeout> | undefined, polling = false, pollAttempt = 0;
  let unsubscribe: (() => void) | undefined, subscriptionLife: AbortController | undefined, updateQueued = false;
  let store: LocalStore | undefined, seen: Record<string,string> = {}, draftKey = '', restoredTarget = '', opener: HTMLElement | null = null;
  const scope = () => ({workspace: settings.workspace,environment: settings.environment});
  let currentContext = getContext(), geometryFrame = 0, resolveFrame = 0, resolutions = new Map<string,ResolvedAnchor>();
  const requests = requestTracker(() => store ? {store,key: `request:${draftKey}`} : undefined);
  const updates = requestTracker(() => store ? {store,key: `update:${draftKey}`} : undefined);
  const host = document.createElement('div'); host.dataset.huddleRoot = ''; host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const shadow = host.attachShadow({mode: 'open'}), style = document.createElement('style'); style.textContent = styles; if (settings.styleNonce) style.nonce = settings.styleNonce;
  const surface = document.createElement('div'); surface.className = 'surface'; surface.setAttribute('popover','manual');
  const ui = document.createElement('div'), pins = document.createElement('div'), highlight = document.createElement('div'); highlight.className = 'highlight'; highlight.hidden = true;
  const preview = document.createElement('div'); preview.className = 'pin-preview'; preview.id = 'huddle-pin-preview'; preview.setAttribute('role','tooltip'); preview.hidden = true;
  preview.addEventListener('pointerenter',() => {previewHovered = true; clearTimeout(previewTimer);}); preview.addEventListener('pointerleave',() => {previewHovered = false; deferHidePreview();});
  const presentation=createPresentation(surface,life.signal,preferences);
  ui.className='ui-layer';surface.append(pins,highlight,ui,preview); shadow.append(style,surface); document.documentElement.append(host);
  const call = <T>(run: (signal: AbortSignal) => Promise<T>) => operation(run,AbortSignal.any([life.signal,contextLife.signal]),settings.requestTimeoutMs);
  const active = () => opened && !destroyed && document.visibilityState !== 'hidden';
  const capability = (name: 'mentions' | 'assignment' | 'directory' | 'commentColors') => !!session?.capabilities[name] && settings.capabilities?.[name] !== false;
  function topLayer() {try {if(typeof surface.showPopover === 'function') {if(!surface.matches(':popover-open')) surface.showPopover(); return;}} catch { /* use the fixed host when native top-layer entry is unavailable */ } surface.removeAttribute('popover');}
  function notify(value: unknown) {try {settings.onError?.(value instanceof Error ? value : new Error('Review could not complete this action.'));} catch { /* host diagnostics must not break navigation */ }}
  function redact(value: string,field: string) {const result = settings.redact ? settings.redact(value,field) : value; if (typeof result !== 'string') throw new Error('The redaction hook must return a string.'); return result;}
  function capturedAnchor(anchor:Anchor) {const result = {...anchor}; for(const key of ['selector','label','quote','tag','stableKey','context'] as const) if(result[key] !== undefined) result[key] = redact(result[key]!,`anchor.${key}`); return result;}
  function getContext(): Context {
    const url = new URL(location.href); url.username = ''; url.password = '';
    for (const name of [...url.searchParams.keys()]) if (!settings.allowedQueryParameters?.includes(name)) url.searchParams.delete(name);
    if (!settings.includeHash) url.hash = '';
    let page = `${url.pathname}${url.search}${url.hash}`;
    try {const custom = settings.pageIdentity?.(new URL(url)); if (typeof custom === 'string' && custom.length > 0 && custom.length <= 4096) page = custom;} catch (value) {notify(value);}
    return {...scope(),page,pageUrl: url.href,release: settings.release};
  }
  function setupStorage() {
    if (!session) return;
    let storage: Storage | null = memory;
    if (settings.persistence === 'disabled') storage = null;
    else if (!settings.persistence || settings.persistence === 'local') {try {storage = window.localStorage;} catch { /* memory fallback */ }}
    store = new LocalStore(JSON.stringify([settings.namespace,settings.workspace,session.actor.id,settings.environment]),storage,settings.persistence === 'disabled' ? undefined : memory);
    const preferred=store.read<CommentColor>('comment-color');if(COMMENT_COLORS.includes(preferred!))color=preferred!;
    seen = store.read<Record<string,string>>('seen') || {}; draftKey = `draft:${currentContext.page}`;
    const draft = store.read<Draft>(draftKey);
    if (draft && typeof draft.body === 'string') {body = draft.body.slice(0,3000); mentionIds = capability('mentions') && Array.isArray(draft.mentions) ? draft.mentions.slice(0,30) : []; anchor = draft.anchor; draftContext = draft.context;if(draft.color&&COMMENT_COLORS.includes(draft.color))color=draft.color;for(const [id,name] of Object.entries(draft.mentionNames||{}))if(typeof name==='string'&&name.length<=1000&&draft.mentions.includes(id))mentionNames.set(id,name); restoredTarget = draft.threadId || ''; notice = 'Restored your unsent comment from this device.';}
  }
  function persistDraft() {
    if (!store || !session) return;
    if (!body.trim()) {store.remove(draftKey); return;}
    store.write(draftKey,{body,mentions: mentionIds,color,mentionNames:Object.fromEntries(mentionIds.map(id=>[id,mentionNames.get(id)||members.find(member=>member.id===id)?.name||'Selected member'])),anchor,context: draftContext,threadId: anchor ? undefined : selected?.thread.id} satisfies Draft);
  }
  function unread(t: Thread) {return !!t.latestComment && t.latestComment.author.id !== session?.actor.id && seen[t.id] !== t.latestComment.id;}
  function markRead(t: Thread) {if (t.latestComment) {seen[t.id] = t.latestComment.id; seen = Object.fromEntries(Object.entries(seen).slice(-1000)); store?.write('seen',seen);}}
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K,text?: string,cls?: string) => {const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node;};
  function button(text: string,action: () => void,cls = '') {const node = el('button',text,cls); node.type = 'button'; if(text) node.id = 'huddle-action-'+text.toLowerCase().replace(/[^a-z0-9]+/g,'-'); node.disabled = busy || loading || detailLoading || memberLoading; node.addEventListener('click',action); return node;}
  function action(label: string,name: Icon,run: () => void,compact = true,cls = '') {const node = button(label,run,`action ${compact ? 'icon-button' : ''} ${cls}`); node.replaceChildren(icon(name),el('span',label,compact ? 'sr-only' : undefined)); node.setAttribute('aria-label',label); node.title = label; return node;}
  function link(text: string,href: string) {const node = el('a',text); try {const url = new URL(href); if (['http:','https:'].includes(url.protocol) && !url.username && !url.password) {node.href = url.href; node.target = '_blank'; node.rel = 'noopener noreferrer';}} catch { /* imported URLs remain inert */ } return node;}
  function stopUpdates() {clearTimeout(pollTimer); pollTimer = undefined; subscriptionLife?.abort(); subscriptionLife = undefined; const cleanup = unsubscribe; unsubscribe = undefined; try {cleanup?.();} catch (value) {notify(value);}}
  function invalidate() {stopUpdates(); contextLife.abort(); contextLife = new AbortController(); epoch++; loadSequence++; detailSequence++; memberSequence++; memberLoading = false; polling = false; connecting = false; busy = false; loading = detailLoading = false; transfers.cancel();}
  function clearPrivate() {requests.forget(); updates.forget(); session = undefined; members = []; memberCursor = undefined; memberNext = null; memberSearch = appliedMemberSearch = ''; memberLoaded = false; transfers.reset(); threads = []; selected = undefined; anchor = undefined; body = ''; mentionIds = []; draftContext = undefined; store = undefined; seen = {}; restoredTarget = ''; resolutions.clear(); clearPins(); pinning = false; highlight.hidden = true;}
  function setError(value: unknown) {
    if (destroyed || (value instanceof Error && value.name === 'AbortError')) return;
    notify(value); error = isCollaborationError(value) ? value.message : 'Review could not complete this action. Your draft is kept.';
    if (isCollaborationError(value) && ['unauthenticated','forbidden'].includes(value.code)) {persistDraft(); invalidate(); clearPrivate(); notice = 'Review access is unavailable. Sign in through this application or contact your team.';}
    render();
  }
  const transfers = createTransfers({adapter,scope,parentSignal:() => AbortSignal.any([life.signal,contextLife.signal]),authorized:resolveSession,storage:() => store,render,error:setError,report:notify,updated:() => {void refresh().catch(() => {});},directory:directoryControls,canMapMembers:() => capability('directory') && !!adapter.directory,members:() => members,environments:settings.exportEnvironments,uploadBytes:settings.transferLimits?.uploadBytes,downloadBytes:settings.transferLimits?.downloadBytes,timeoutMs:settings.requestTimeoutMs});
  function render() {
    if (destroyed) return;
    host.toggleAttribute('data-huddle-open',opened || pinning);
    host.toggleAttribute('data-huddle-collapsed',opened && collapsed && !pinning);
    const focused = shadow.activeElement as HTMLElement | null, focusId = focused?.id || (document.activeElement === document.body || document.activeElement === host ? pendingFocus : undefined);
    const textControl = focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement && ['text','search','url','tel'].includes(focused.type), selection = textControl ? {start:focused.selectionStart,end:focused.selectionEnd} : undefined;
    const scroll = shadow.querySelector('.content')?.scrollTop || 0;composerCleanup?.();composerCleanup=undefined;presentation.begin(ui,motion);motion=false;ui.replaceChildren();
    if (pinning) {clearPins(); const note = el('div',undefined,'pick-note'), message = el('span',notice || (reattach ? 'Click the new target. Escape to cancel.' : 'Click an element to comment. Escape to cancel.')), cancel = button('Cancel',cancelPin); cancel.disabled = false; message.setAttribute('role','status'); note.append(message,cancel); ui.append(note); return;}
    if(!opened && settings.launcher==='hidden') {clearPins();return;}
    if (!opened || collapsed) {
      const dock=el('aside',undefined,'review-dock');dock.setAttribute('aria-label','Collapsed Huddle feedback');
      const handle=action('Move feedback toolbar','grip',()=>{});handle.disabled=false;handle.classList.add('drag-handle');
      const expand=action('Expand feedback','expand',()=>controller.open(),false);expand.disabled=false;expand.setAttribute('aria-expanded','false');expand.setAttribute('aria-controls','huddle-panel');
      dock.append(handle,expand);if(opened){const status=el('span',error?'Feedback unavailable':connecting?'Loading feedback…':stale?'Updates paused':'Pins visible','muted');if(error||stale)status.setAttribute('role','status');dock.append(status);}
      ui.append(dock);presentation.attach(dock,handle);presentation.finish(ui);if(opened)scheduleResolution();else clearPins();return;
    }
    const panel = el('aside',undefined,'panel'); panel.id = 'huddle-panel'; panel.setAttribute('aria-label','Huddle feedback');
    const header = el('header'), heading = el('div',undefined,'row between'), brand = el('div',undefined,'brand'), tools = el('div',undefined,'row tools'); brand.append(icon('comment'),el('h2','Huddle'));
    const info = action('Review details','info',() => {scopeExpanded = !scopeExpanded; render();}); info.setAttribute('aria-expanded',String(scopeExpanded)); info.setAttribute('aria-controls','huddle-scope');
    if(session) tools.append(action('Transfer feedback','transfer',() => {persistDraft(); transfers.open();}),action('Refresh feedback','refresh',() => {void initialize();}));
    const collapse = action('Collapse feedback','collapse',() => controller.collapse()); collapse.disabled = false; collapse.setAttribute('aria-expanded','true'); collapse.setAttribute('aria-controls','huddle-panel'); tools.append(collapse); heading.append(brand,tools); header.append(heading);
    const content = el('div',undefined,'content');
    if(scopeExpanded) {const details = el('div',undefined,'scope-details'); details.id = 'huddle-scope'; details.append(el('h3','Review details'));if(session)details.append(el('p','Reviewing as '+session.actor.name));details.append(el('p',`Workspace: ${currentContext.workspace}`),el('p',`Environment: ${currentContext.environment}`)); if(currentContext.release) details.append(el('p',`Release: ${currentContext.release}`)); if(session&&settings.onDisplayNameChange){const rename=el('form'),label=el('label','Your name (optional)'),field=el('input');field.id='huddle-display-name';field.placeholder=session.actor.name;field.maxLength=80;field.setAttribute('autocomplete','nickname');label.htmlFor=field.id;label.append(field);const submit=el('button','Update name');submit.type='submit';submit.disabled=busy;rename.append(label,submit);rename.addEventListener('submit',event=>{event.preventDefault();void changeDisplayName(field.value);});details.append(rename);}content.append(details);}
    content.setAttribute('aria-busy',String(busy || loading || detailLoading || connecting));
    if(stale) {const status = el('p','Feedback may be out of date. Refresh when connected.','notice'); status.setAttribute('role','status'); content.append(status);}
    if (error) {const node = el('p',error,'notice error'); node.setAttribute('role','alert'); content.append(node);}
    if (notice) {const node = el('p',notice,'notice'); node.setAttribute('role','status'); content.append(node);}
    if (!session) content.append(el('p',connecting ? 'Checking review access…' : 'Use your application’s existing sign-in to access team feedback.','muted'),button('Check access again',() => {void initialize();}));
    else {if(transfers.active()) transfers.render(content,currentContext.page); else if (!anchor && !selected) renderList(header,content); else renderThread(content);}
    const footer = el('footer',undefined,'panel-footer'); const reviewer=session&&settings.onDisplayNameChange?button(session.actor.name,()=>{scopeExpanded=true;render();shadow.getElementById('huddle-display-name')?.focus();},'quiet'):el('span',session?.actor.name||'Feedback','muted');if(reviewer instanceof HTMLButtonElement){reviewer.setAttribute('aria-label','Edit reviewer name');reviewer.title='Change your display name';}footer.append(reviewer,info);
    panel.append(header,content,footer); ui.append(panel); content.scrollTop = scroll;presentation.finish(ui);
    pendingFocus = undefined;
    if (focusId) {const target = shadow.getElementById(focusId); if(target && 'disabled' in target && target.disabled) pendingFocus = focusId; else {const next = target || shadow.querySelector<HTMLElement>('.content button:not([disabled])'); next?.focus({preventScroll: true}); if(selection && (next instanceof HTMLTextAreaElement || next instanceof HTMLInputElement) && selection.start !== null && selection.end !== null) next.setSelectionRange(selection.start,selection.end);}}
    scheduleResolution();
  }
  function pageComment() {try {draftContext = capturedContext(); anchor = capturedAnchor(pageAnchor()); selected = undefined; body = ''; mentionIds = []; error = ''; render(); shadow.getElementById('huddle-body')?.focus();} catch (value) {setError(value);}}
  function directoryControls(parent:HTMLElement) {
    if(!capability('directory') || !adapter.directory) return;
    const label = el('label','Search approved members'), search = el('input'); search.id = 'huddle-member-search'; label.htmlFor = search.id; search.type = 'search'; search.value = memberSearch; search.addEventListener('input',() => {memberSearch = search.value;}); search.addEventListener('keydown',event => {if(event.key === 'Enter') {event.preventDefault(); appliedMemberSearch = memberSearch; memberCursor = undefined; void loadDirectory();}}); label.append(search); const submit = button(memberLoading ? 'Loading members…' : 'Search members',() => {appliedMemberSearch = memberSearch; memberCursor = undefined; void loadDirectory();}); submit.id = 'huddle-search-members'; parent.append(label,submit);
    if(memberCursor) parent.append(button('First members',() => {memberCursor = undefined; void loadDirectory();})); if(memberNext) parent.append(button('Next members',() => {memberCursor = memberNext!; void loadDirectory();}));
  }
  async function loadDirectory() {
    if(!session || !capability('directory') || !adapter.directory) return; const stamp = epoch, sequence = ++memberSequence; memberLoading = true; render();
    try {const result = await call(signal => adapter.directory!(scope(),{search:appliedMemberSearch || undefined,cursor:memberCursor},signal)); if(stamp !== epoch || sequence !== memberSequence) return; if(!Array.isArray(result.items) || result.items.length > 100 || result.items.some(item => !item?.id || typeof item.name !== 'string') || result.nextCursor !== null && typeof result.nextCursor !== 'string') throw new CollaborationError('unavailable','The host member directory returned an invalid page.'); members = result.items;for(const member of members)mentionNames.set(member.id,member.name); memberNext = result.nextCursor; memberLoaded = true;}
    catch(value) {if(stamp === epoch && sequence === memberSequence) setError(value);}
    finally {if(stamp === epoch && sequence === memberSequence) {memberLoading = false; render();}}
  }
  function paint(node:HTMLElement,value?:CommentColor){const palette={green:'#175f4c',blue:'#1d4ed8',violet:'#6d28d9',amber:'#92400e',rose:'#be123c',slate:'#334155'};if(value&&COMMENT_COLORS.includes(value)){node.style.setProperty('--huddle-comment-color',palette[value]);node.dataset.color=value;}else{node.style.removeProperty('--huddle-comment-color');delete node.dataset.color;}}
  function targetBadge(state:Exclude<ResolvedAnchor['state'],'ok'>){const badge=el('span',undefined,'badge target-state');badge.setAttribute('role','img');badge.setAttribute('aria-label',anchorWarnings[state]);badge.title=anchorWarnings[state];badge.append(icon(state==='hidden'?'hidden':'warning'));return badge;}
  function renderList(header: HTMLElement,content: HTMLElement) {
    const actions = el('div',undefined,'row compose-actions'); actions.append(action('Pin a comment','pin',() => startPin(false),false,'primary'),action('Page comment','page',pageComment,false)); header.append(actions);
    const listHeading = el('div',undefined,'row between list-heading'); listHeading.append(el('h3',allPages ? 'All comments' : 'This page'),el('small',`${threads.length}${nextCursor ? '+' : ''} ${threads.length === 1 ? 'thread' : 'threads'}`)); content.append(listHeading);
    const filters = el('div',undefined,'row filters');
    for (const [label,value,change] of [['All pages',allPages,() => {allPages = !allPages; listCursor = undefined; void refresh().catch(() => {});}],['Show resolved',resolved,() => {resolved = !resolved; listCursor = undefined; void refresh().catch(() => {});}]] as const) {const labelNode = el('label'), check = el('input'); check.type = 'checkbox'; check.checked = value; check.addEventListener('change',change); labelNode.append(check,document.createTextNode(label)); filters.append(labelNode);} content.append(filters);
    for (const thread of threads) {
      const card = button('',() => {void chooseThread(thread.id);},'thread'), title = el('div',undefined,'row between'); card.id = 'huddle-thread-'+encodeURIComponent(thread.id); title.append(el('strong',thread.anchor.label));
      if (unread(thread)) title.append(el('span','New','badge new'));
      const found = resolutions.get(thread.id); if (found && found.state !== 'ok') title.append(targetBadge(found.state));
      paint(card,thread.color);card.append(title,el('p',excerpt(thread.latestComment?.body || '',180),'thread-excerpt'),el('small',`${thread.latestComment?.author.name || ''} · ${thread.commentCount} ${thread.commentCount === 1 ? 'comment' : 'comments'}`)); if(thread.status === 'resolved') title.append(el('span','Resolved','badge'));
      if (thread.page !== currentContext.page) card.append(el('p',thread.page,'muted')); content.append(card);
    }
    if (!threads.length) {const empty = el('div',undefined,'empty-state'); empty.append(icon('comment'),el('h3',loading ? 'Loading feedback…' : 'No comments yet'),el('p','Pin a comment to an element, or leave a note about this page.','muted')); content.append(empty);}
    if (listCursor) content.append(button('First threads',() => {listCursor = undefined; void refresh().catch(() => {});}));
    if (nextCursor !== null) content.append(button('Next threads',() => {listCursor = nextCursor!; void refresh().catch(() => {});}));
  }
  function renderThread(content: HTMLElement) {
    content.append(action('Back to comments','back',() => {persistDraft(); selected = undefined; anchor = undefined; body = ''; mentionIds = []; render();},false,'quiet'));
    const thread = selected?.thread, target = anchor || thread!.anchor, box = el('div',undefined,'target'); box.append(el('h3',target.label)); if (target.quote) box.append(el('blockquote',target.quote));
    if (thread) {
      if (thread.page === currentContext.page) {const warning = resolveAnchor(thread.anchor); if (warning.state !== 'ok') box.append(el('p',anchorWarnings[warning.state],'muted')); const targetActions = el('div',undefined,'row'); targetActions.append(action('Locate on page','locate',() => {const found = resolveAnchor(thread.anchor); if (found.element && !excluded(found.element)) found.element.scrollIntoView({block: 'center',behavior: 'instant'}); else {notice = 'Target is unavailable or excluded.'; render();}},false,'quiet'),action('Reattach pin','pin',() => startPin(true))); box.append(targetActions);}
      else box.append(link('Open original page',thread.pageUrl));
      const context = el('details'), summary = el('summary','Captured context'); summary.id = 'huddle-captured-context'; context.open = contextExpanded; context.addEventListener('toggle',() => {if(context.isConnected) contextExpanded = context.open;}); context.append(summary,el('p',`Page: ${thread.page}`),el('p',`Environment: ${thread.environment}${thread.release ? ' · Release: '+thread.release : ''}`),link('Page URL',thread.pageUrl)); if(thread.viewContext !== undefined) context.append(el('pre',JSON.stringify(thread.viewContext,null,2))); if(thread.provenance) context.append(el('p',`Source: ${thread.provenance.datasetId} · ${thread.provenance.recordId}`)); box.append(context);
    }
    if (anchor && draftContext?.viewContext !== undefined) box.append(el('p','Captured view context'),el('pre',JSON.stringify(draftContext.viewContext,null,2)));
    content.append(box);
    for (const comment of selected?.comments.items || []) {const article = el('article');paint(article,comment.color);article.className='comment';article.append(el('h3',comment.author.name),el('p',comment.body)); if (comment.mentions.length) article.append(el('small',`Mentions: ${comment.mentions.map(item => item.name).join(', ')}`)); const time = el('time',new Date(comment.createdAt).toLocaleString()); time.dateTime = comment.createdAt; article.append(time); content.append(article);}
    if (selected) {
      if (commentCursor) content.append(button('First replies',() => {commentCursor = undefined; void loadDetail(selected!.thread.id).catch(() => {});}));
      if (selected.comments.nextCursor !== null) content.append(button('Next replies',() => {commentCursor = selected!.comments.nextCursor!; void loadDetail(selected!.thread.id).catch(() => {});}));
      const history = el('details'), summary = el('summary','Thread history'); summary.id = 'huddle-history'; history.open = historyExpanded; history.addEventListener('toggle',() => {if(history.isConnected) historyExpanded = history.open;}); history.append(summary);
      for (const record of selected.history.items) {const entry = el('details'), label = el('summary',`${record.actor.name} · ${record.action} · ${new Date(record.createdAt).toLocaleString()}`); label.id = 'huddle-history-'+encodeURIComponent(record.id); entry.open = historyEntry === record.id; entry.append(label); if(entry.open) entry.append(el('pre',JSON.stringify({actor:record.actor,data:record.data,provenance:record.provenance},null,2))); entry.addEventListener('toggle',() => {if(!entry.isConnected) return; if(entry.open && historyEntry !== record.id) {historyEntry = record.id; render();} else if(!entry.open && historyEntry === record.id) historyEntry = undefined;}); history.append(entry);}
      if (historyCursor) history.append(button('First history',() => {historyCursor = undefined; void loadDetail(selected!.thread.id).catch(() => {});}));
      if (selected.history.nextCursor !== null) history.append(button('Next history',() => {historyCursor = selected!.history.nextCursor!; void loadDetail(selected!.thread.id).catch(() => {});}));
      content.append(history);
      const coordination = el('div',undefined,'row'); coordination.append(action(thread!.status === 'open' ? 'Resolve thread' : 'Reopen thread',thread!.status === 'open' ? 'check' : 'reopen',() => {void patch({status: thread!.status === 'open' ? 'resolved' : 'open'});},false));
      if (capability('assignment') && capability('directory') && adapter.directory) {const people=el('details'),summary=el('summary','Assignment');people.open=assignmentExpanded;people.addEventListener('toggle',()=>{if(people.isConnected)assignmentExpanded=people.open;});people.append(summary);const directory=el('div');if(!memberLoaded)directory.append(button('Load assignment members',()=>{void loadDirectory();}));else directoryControls(directory);people.append(directory);const label = el('label','Assignee'), assign = el('select'); assign.setAttribute('aria-label','Assignee'); assign.append(new Option('Unassigned','')); for (const member of members) assign.append(new Option(member.name,member.id)); if (thread!.assignee && !members.some(item => item.id === thread!.assignee!.id)) {const current = new Option(`${thread!.assignee.name} (current attribution)`,thread!.assignee.id); current.disabled = true; assign.append(current);} assign.value = thread!.assignee?.id || ''; assign.addEventListener('change',() => {void patch({assigneeId: assign.value || null});}); label.append(assign); people.append(label);coordination.append(people);}
      content.append(coordination);
    }
    const form = el('form'), label = el('label',selected ? 'Reply' : 'Your comment'); label.htmlFor = 'huddle-body'; const textarea = el('textarea'); textarea.id = 'huddle-body'; textarea.maxLength = 3000; textarea.required = true; textarea.value = body; textarea.addEventListener('input',() => {body = textarea.value; persistDraft();}); form.append(label,textarea);
    if(capability('mentions')&&capability('directory')&&adapter.directory)composerCleanup=attachMentions({textarea,parent:form,selected:mentionIds.map(id=>({id,name:mentionNames.get(id)||members.find(member=>member.id===id)?.name||'Selected member'})),signal:AbortSignal.any([life.signal,contextLife.signal]),search:(query,signal)=>call(inner=>adapter.directory!(scope(),query,AbortSignal.any([inner,signal]))),change:selection=>{mentionIds=selection.map(member=>member.id);for(const member of selection)mentionNames.set(member.id,member.name);persistDraft();},error:value=>{if(isCollaborationError(value)&&['forbidden','unauthenticated'].includes(value.code))setError(value);else notify(value);}});
    if(capability('commentColors')){const palette=el('fieldset',undefined,'color-picker');palette.append(el('legend','Comment color'));for(const value of COMMENT_COLORS){const option=el('label'),radio=el('input');radio.type='radio';radio.name='huddle-comment-color';radio.value=value;radio.checked=color===value;radio.setAttribute('aria-label',value[0].toUpperCase()+value.slice(1));radio.disabled=busy;radio.addEventListener('change',()=>{color=value;store?.write('comment-color',color);persistDraft();});const swatch=el('span',undefined,'color-swatch');paint(swatch,value);option.title=value[0].toUpperCase()+value.slice(1);option.append(radio,swatch);palette.append(option);}form.append(palette);}
    const submit = el('button',busy ? 'Saving…' : selected ? 'Post reply' : 'Post comment','primary'); submit.id = 'huddle-submit-comment'; submit.type = 'submit'; submit.disabled = busy; form.append(submit); form.addEventListener('submit',event => {event.preventDefault(); void save();}); content.append(form);
  }
  async function changeDisplayName(value:string){if(!settings.onDisplayNameChange||!session||busy)return;const stamp=epoch;busy=true;error='';render();try{await call(signal=>settings.onDisplayNameChange!(value.trim(),signal));if(stamp===epoch)await resolveSession();}catch(value){if(stamp===epoch)setError(value);}finally{if(stamp===epoch){busy=false;render();}}}
  async function resolveSession(): Promise<boolean> {
    const stamp = epoch, result = await call(signal => adapter.session(scope(),signal));
    if (stamp !== epoch || destroyed) return false;
    if (result.scope.workspace !== settings.workspace || result.scope.environment !== settings.environment || !result.actor?.id || !result.actor.name) throw new CollaborationError('forbidden','The host did not authorize this review scope.');
    if (session && session.actor.id !== result.actor.id) {persistDraft(); invalidate(); clearPrivate(); cursor = undefined; listCursor = undefined; session = result; setupStorage(); queueMicrotask(() => {if (active()) void initialize();}); return false;}
    const first = !session; session = result; if (first) setupStorage();
    return true;
  }
  async function initialize() {
    if (!active() || connecting) return; if (polling) {updateQueued = true; return;} stopUpdates(); connecting = true; error = ''; const stamp = epoch; render();
    try {
      if (!await resolveSession() || stamp !== epoch) return;
      const baseline = await call(signal => adapter.changes(scope(),undefined,signal)); if (stamp !== epoch) return; cursor = baseline.cursor;
      await refresh();
      if (restoredTarget && stamp === epoch) {const id = restoredTarget; restoredTarget = ''; try {const result = await call(signal => adapter.detail(scope(),id,{},signal)); if (stamp === epoch) selected = result;} catch (value) {if (stamp === epoch && isCollaborationError(value) && value.code === 'not_found') {anchor = capturedAnchor(pageAnchor()); notice = 'The original thread is unavailable. Your draft is kept as a page comment.';} else throw value;}}
      if (stamp === epoch) {pollAttempt = 0; startUpdates();}
    } catch (value) {if (stamp === epoch) {setError(value); if (stamp === epoch && (!(isCollaborationError(value)) || ['network','timeout','rate_limited','unavailable'].includes(value.code))) schedulePoll(backoff(value));}}
    finally {if (stamp === epoch) {connecting = false; render();}}
  }
  async function refresh() {
    if (!session || !active()) return;
    const seq = ++loadSequence, stamp = epoch; loading = true; render();
    try {
      const result = await call(signal => adapter.list(scope(),{page: allPages ? undefined : currentContext.page,status: resolved ? undefined : 'open',cursor: listCursor,limit: 50},signal));
      if (stamp !== epoch || seq !== loadSequence) return;
      threads = result.items.slice(0,100); nextCursor = result.nextCursor; error = ''; stale = false;
      if (store?.read('baseline') === null) {for (const thread of threads) markRead(thread); store.write('baseline',true);}
    } catch (value) {if (stamp === epoch && seq === loadSequence) {stale = true; setError(value); throw value;}}
    finally {if (stamp === epoch && seq === loadSequence) {loading = false; render();}}
  }
  async function loadDetail(id: string) {
    const seq = ++detailSequence, stamp = epoch; detailLoading = true; render();
    try {const result = await call(signal => adapter.detail(scope(),id,{commentsCursor: commentCursor,historyCursor,limit: 50},signal)); if (stamp !== epoch || seq !== detailSequence || selected?.thread.id !== id) return; selected = result; markRead(result.thread);}
    catch (value) {if (stamp === epoch && seq === detailSequence) {stale = true; setError(value); throw value;}}
    finally {if(stamp === epoch && seq === detailSequence) {detailLoading = false; render();}}
  }
  async function chooseThread(id: string) {
    persistDraft(); const thread = threads.find(item => item.id === id); if (!thread) return;
    body = ''; mentionIds = []; anchor = undefined; commentCursor = historyCursor = undefined; historyExpanded = contextExpanded = false; historyEntry = undefined;
    selected = {thread,comments: {items: [],nextCursor: null},history: {items: [],nextCursor: null}}; error = '';
    const draft = store?.read<Draft>(draftKey); if (draft?.threadId === id) {body = draft.body; mentionIds = draft.mentions;}
    collapsed = false; hidePreview(); render(); shadow.getElementById('huddle-action-back-to-comments')?.focus(); try {await loadDetail(id);} catch { /* detail error is rendered */ }
  }
  function capturedContext(): Omit<Context,'workspace' | 'environment'> {
    const {workspace: _workspace,environment: _environment,...context} = currentContext;
    const result = {...context,page: redact(context.page,'page'),pageUrl: redact(context.pageUrl,'pageUrl'),release: context.release === undefined ? undefined : redact(context.release,'release')};
    if (settings.viewContext) {
      let budget = 1000;
      const clean = (value: unknown,depth: number): unknown => {
        if (depth > 16 || --budget < 0) throw new Error('View context is too complex.');
        if (typeof value === 'string') return redact(value,'viewContext');
        if (typeof value === 'number') {if (!Number.isFinite(value)) throw new Error('View context numbers must be finite.'); return value;}
        if (value === null || typeof value === 'boolean') return value;
        if (Array.isArray(value)) return value.map(item => clean(item,depth + 1));
        if (value && typeof value === 'object' && [Object.prototype,null].includes(Object.getPrototypeOf(value))) {
          const entries = Object.entries(value).map(([key,item]) => [redact(key,'viewContextKey'),clean(item,depth + 1)] as const);
          if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new Error('Redacted context keys collide.');
          return Object.fromEntries(entries);
        }
        throw new Error('View context must contain only JSON values.');
      };
      const viewContext = clean(settings.viewContext(),0) as Context['viewContext'];
      if (new TextEncoder().encode(JSON.stringify(viewContext)).byteLength > 8192) throw new Error('View context must be bounded JSON (at most 8 KiB).');
      return {...result,viewContext};
    }
    return result;
  }
  async function save() {
    if (busy || !session || !body.trim() || (!anchor && !selected)) return;
    busy = true; error = ''; const stamp = epoch, sent = body, sentMentions = capability('mentions') ? [...mentionIds] : [],sentColor=capability('commentColors')?color:undefined, target = anchor, id = selected?.thread.id, savedKey = draftKey, savedStore = store;
    render();
    try {
      if (!await resolveSession() || stamp !== epoch) return;
      const context = target ? (draftContext ||= capturedContext()) : undefined;
      persistDraft();
      const payload = target ? {...context,anchor: target,body: sent,color:sentColor,mentions: sentMentions} : {body: sent,color:sentColor,mentions: sentMentions};
      const idempotencyKey = requests.idFor({scope: scope(),actor: session!.actor.id,path: target ? 'new' : id,payload});
      const result = target ? await call(signal => adapter.create(scope(),{...context!,anchor: target,body: sent,color:sentColor,mentions: sentMentions,idempotencyKey},signal)) : await call(signal => adapter.reply(scope(),id!,{body: sent,color:sentColor,mentions: sentMentions,idempotencyKey},signal));
      if (stamp !== epoch) return; requests.clear();
      const saved = savedStore?.read<Draft>(savedKey); if (saved?.body === sent && JSON.stringify(saved.mentions) === JSON.stringify(sentMentions)) savedStore?.remove(savedKey,saved);
      if (draftKey === savedKey && anchor === target && selected?.thread.id === id) {body = remainderAfterSave(body,sent); selected = result; anchor = undefined; if (body.trim()) persistDraft(); else mentionIds = []; markRead(result.thread);}
      notice = 'Comment saved.'; await refresh();
    } catch (value) {if (stamp === epoch) {persistDraft(); setError(value);}}
    finally {if (stamp === epoch) {busy = false; render();}}
  }
  async function patch(change: Omit<Update,'expectedVersion' | 'idempotencyKey'>) {
    if (!selected || busy || !session) return; busy = true; const stamp = epoch, id = selected.thread.id; error = ''; render();
    const payload = {...change,expectedVersion: selected.thread.version};
    try {
      if (!await resolveSession() || stamp !== epoch) return;
      const idempotencyKey = updates.idFor({scope: scope(),actor: session!.actor.id,id,payload});
      const result = await call(signal => adapter.update(scope(),id,{...payload,idempotencyKey},signal)); if (stamp !== epoch) return; updates.clear(); if (selected?.thread.id === id) selected = result; await refresh();
    } catch (value) {if (stamp === epoch) {setError(value); if (isCollaborationError(value) && value.code === 'conflict' && selected) {try {await loadDetail(id);} catch { /* keep the conflict visible */ } notice = 'The thread changed. Review the current version before trying again.';}}}
    finally {if (stamp === epoch) {busy = false; render();}}
  }
  function backoff(value: unknown) {const server = isCollaborationError(value) ? value.retryAfterMs || 0 : 0; return Math.min(120000,Math.max(server,Math.min(30000,1000 * 2 ** Math.min(pollAttempt++,5)) * (.75 + Math.random() * .25)));}
  function schedulePoll(delay = 10000) {clearTimeout(pollTimer); pollTimer = undefined; if (active()) pollTimer = setTimeout(() => {pollTimer = undefined; if (session) void poll(); else void initialize();},delay);}
  async function poll() {
    if (!active() || !session) return; if (connecting) {schedulePoll(); return;} if (polling) {updateQueued = true; return;} polling = true; const stamp = epoch; let delay = 10000;
    try {
      if (!await resolveSession() || stamp !== epoch) return;
      const result = await call(signal => adapter.changes(scope(),cursor,signal)); if (stamp !== epoch) return;
      if (result.reset) {listCursor = commentCursor = historyCursor = undefined; threads = []; resolutions.clear();}
      if (result.items.length || result.reset || stale) {await refresh(); if (selected) await loadDetail(selected.thread.id);}
      if (stamp !== epoch) return; cursor = result.cursor; notice = ''; error = ''; pollAttempt = 0; if (result.hasMore) delay = 0;
    } catch (value) {if (stamp === epoch) {setError(value); delay = backoff(value);}}
    finally {if (stamp === epoch) {polling = false; render(); const queued = updateQueued; updateQueued = false; schedulePoll(queued ? 0 : delay);}}
  }
  function startUpdates() {
    stopUpdates(); schedulePoll();
    if (!adapter.subscribe || !active() || !session) return;
    const subscription = new AbortController(); subscriptionLife = subscription; const stamp = epoch;
    try {const cleanup = adapter.subscribe(scope(),() => {if (stamp === epoch) schedulePoll(60);},value => {if (stamp !== epoch) return; setError(value); if (stamp === epoch && session) {stopUpdates(); schedulePoll();}},AbortSignal.any([life.signal,contextLife.signal,subscription.signal])); if (stamp !== epoch || subscription.signal.aborted) cleanup(); else unsubscribe = cleanup;}
    catch (value) {setError(value); if (session) schedulePoll();}
  }
  function cancelPin() {pinning = false; reattach = false; highlight.hidden = true; opened = true; render();}
  function startPin(isReattach: boolean) {persistDraft(); pinning = true; reattach = isReattach; error = notice = ''; render();}
  function excluded(element: Element): boolean {
    if (element.closest('[data-huddle-root],[data-feedback-ui],[data-huddle-exclude],input[type=password],textarea')) return true;
    try {for (let node: Element | null = element; node; node = node.parentElement) if (settings.excludeElement?.(node)) return true;} catch (value) {notify(value); return true;}
    return false;
  }
  function selectedQuote(element:Element): string {
    const selection = window.getSelection(); if(!selection?.rangeCount) return ''; const range = selection.getRangeAt(0), common = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    if(!common || !element.contains(common) || excluded(common)) return '';
    const descendants = [...element.querySelectorAll('*')]; if(descendants.length > 1000 || [element,...descendants].some(node => (excluded(node) || node.matches('input,textarea,select')) && range.intersectsNode(node))) return '';
    return selection.toString();
  }
  function excludedText(element:Element): boolean {let count = 0; for(const child of element.querySelectorAll('*')) if(++count > 1000 || excluded(child)) return true; return false;}
  function pointer(event: PointerEvent) {
    if (!pinning || event.composedPath().includes(host)) return;
    const target = event.composedPath().find(node => node instanceof Element) as Element | undefined; if (!target) return;
    const element = pickTarget(target); if (excluded(element)) {highlight.hidden = true; return;}
    const rect = element.getBoundingClientRect(); highlight.hidden = false; Object.assign(highlight.style,{left: `${rect.left}px`,top: `${rect.top}px`,width: `${rect.width}px`,height: `${rect.height}px`});
  }
  function click(event: MouseEvent) {
    if (!pinning || event.composedPath().includes(host)) return;
    const target = event.composedPath().find(node => node instanceof Element) as Element | undefined; if (!target) return;
    event.preventDefault(); event.stopImmediatePropagation(); const element = pickTarget(target);
    if (excluded(element) || excludedText(element)) {notice = 'This element contains excluded content or is too broad to capture. Choose a more specific target or use a page comment.'; render(); return;}
    try {
      const rect = element.getBoundingClientRect(), built = capturedAnchor(buildAnchor(element,{quote:selectedQuote(element),x: (event.clientX - rect.left) / Math.max(1,rect.width),y: (event.clientY - rect.top) / Math.max(1,rect.height)}));
      for(let parent = element.parentElement,index = 0; parent && index < 4 && !parent.matches('body,html'); parent = parent.parentElement,index++) {const heading = parent.querySelector('h1,h2,h3,h4,h5,h6'); if(heading && (excluded(heading) || excludedText(heading))) built.context = '';}
      const update = reattach; notice = ''; cancelPin();
      if (update) void patch({anchor: built}); else {draftContext = capturedContext(); selected = undefined; anchor = built; body = ''; mentionIds = []; persistDraft(); render(); shadow.getElementById('huddle-body')?.focus();}
    } catch (value) {cancelPin(); setError(value);}
  }
  function hidePreview() {clearTimeout(previewTimer); previewTimer = undefined; previewId = undefined; previewHovered = false; preview.hidden = true; preview.replaceChildren(); for(const pin of pinNodes.values()) pin.removeAttribute('aria-describedby');}
  function clearPins() {hidePreview(); pinNodes.clear(); pins.replaceChildren();}
  function deferHidePreview() {clearTimeout(previewTimer); previewTimer = setTimeout(() => {if(!previewHovered && !pins.contains(shadow.activeElement)) hidePreview();},120);}
  function showPreview(id: string) {clearTimeout(previewTimer); previewId = id; renderPreview();}
  function renderPreview() {
    if(!previewId) return;
    const thread = threads.find(item => item.id === previewId), pin = pinNodes.get(previewId);
    if(!thread || !pin || !opened || pinning) {hidePreview(); return;}
    for(const node of pinNodes.values()) node.removeAttribute('aria-describedby');
    pin.setAttribute('aria-describedby',preview.id); preview.replaceChildren(el('strong',thread.anchor.label),el('p',excerpt(thread.latestComment?.body || 'Open this thread to read the discussion.')),el('small',`${thread.latestComment?.author.name || ''} · ${thread.commentCount} ${thread.commentCount === 1 ? 'comment' : 'comments'}`)); preview.hidden = false;
    preview.style.maxHeight = '';
    const rect = pin.getBoundingClientRect(), width = preview.offsetWidth; let height = preview.offsetHeight;
    const rightFits = rect.right + width + 10 <= innerWidth - 12, leftFits = rect.left - width - 10 >= 12;
    const left = rightFits ? rect.right + 10 : leftFits ? rect.left - width - 10 : (rect.left + rect.right - width) / 2;
    let top = rect.top;
    if(!rightFits && !leftFits) {
      const below = innerHeight - rect.bottom - 22, above = rect.top - 22, useBelow = below >= height || below >= above;
      preview.style.maxHeight = `${Math.max(24,useBelow ? below : above)}px`; height = preview.offsetHeight;
      top = useBelow ? rect.bottom + 10 : rect.top - height - 10;
    }
    preview.style.left = `${Math.max(12,Math.min(left,innerWidth - width - 12))}px`;
    preview.style.top = `${Math.max(12,Math.min(top,innerHeight - height - 12))}px`;
  }
  function geometry() {
    geometryFrame = 0; if (!opened || pinning || document.visibilityState === 'hidden') {clearPins(); return;}
    const visible = new Set<string>(), placed: {x:number;y:number}[] = [];
    for (const [i,t] of threads.entries()) {
      if (t.page !== currentContext.page || (t.status === 'resolved' && !resolved)) continue;
      const found = resolutions.get(t.id); if (!found?.element?.isConnected || excluded(found.element) || ['missing','hidden','ambiguous'].includes(found.state)) continue;
      const rect = found.element.getBoundingClientRect(); if (!rect.width || !rect.height) continue;
      const x = rect.left + rect.width * t.anchor.x, y = rect.top + rect.height * t.anchor.y; if (y < 0 || y > innerHeight || x < 0 || x > innerWidth) continue;
      const position = placePin({x,y},placed,{width:innerWidth,height:innerHeight}); placed.push(position);
      visible.add(t.id); let pin = pinNodes.get(t.id);
      if(!pin) {
        pin = button('',() => {void chooseThread(t.id);},'pin'); pin.id = 'huddle-pin-'+encodeURIComponent(t.id);
        pin.addEventListener('pointerenter',() => showPreview(t.id)); pin.addEventListener('pointerleave',deferHidePreview); pin.addEventListener('focus',() => showPreview(t.id)); pin.addEventListener('blur',deferHidePreview);
        pinNodes.set(t.id,pin); pins.append(pin);
      }
      pin.replaceChildren(icon('bubble'),el('span',String(i+1),'pin-number'));paint(pin,t.color); pin.disabled = busy; pin.classList.toggle('warning',found.state !== 'ok'); pin.classList.toggle('selected',selected?.thread.id === t.id); pin.setAttribute('aria-label',`Open feedback: ${t.anchor.label}`); pin.style.left = `${position.x}px`; pin.style.top = `${position.y}px`;
    }
    for(const [id,pin] of pinNodes) if(!visible.has(id)) {pin.remove(); pinNodes.delete(id);}
    renderPreview();
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
    const scopeChanged = next.workspace !== currentContext.workspace || next.environment !== currentContext.environment;
    persistDraft(); invalidate(); transfers.reset(); clearPins(); currentContext = next; draftContext = undefined; selected = undefined; anchor = undefined; body = ''; mentionIds = []; threads = []; resolutions.clear(); notice = ''; error = ''; cursor = undefined; listCursor = commentCursor = historyCursor = undefined; restoredTarget = '';
    if (scopeChanged) clearPrivate(); else setupStorage(); render(); if (active()) void initialize();
  }
  const onVisibility = () => {if (document.visibilityState === 'hidden') {persistDraft(); invalidate(); clearPins(); cancelAnimationFrame(geometryFrame); cancelAnimationFrame(resolveFrame); geometryFrame = resolveFrame = 0;} else {routeChange(); if (active()) void initialize(); scheduleResolution();}};
  const keydown = (event: KeyboardEvent) => {if (event.key === 'Escape') {if (!preview.hidden) {event.preventDefault(); hidePreview();} else if (pinning) {event.preventDefault(); cancelPin();} else if (opened && event.composedPath().includes(host)) {event.preventDefault(); controller.collapse();}}};
  const originalPush = history.pushState, originalReplace = history.replaceState;
  const push: History['pushState'] = function(this: History,...args) {originalPush.apply(this,args); routeChange();};
  const replace: History['replaceState'] = function(this: History,...args) {originalReplace.apply(this,args); routeChange();};
  history.pushState = push; history.replaceState = replace;
  window.addEventListener('pointermove',pointer,{signal: life.signal,passive: true}); window.addEventListener('click',click,{signal: life.signal,capture: true});
  window.addEventListener('keydown',keydown,{signal: life.signal}); window.addEventListener('scroll',scheduleGeometry,{signal: life.signal,capture: true,passive: true});
  window.addEventListener('resize',scheduleResolution,{signal: life.signal}); window.addEventListener('popstate',routeChange,{signal: life.signal}); window.addEventListener('hashchange',routeChange,{signal: life.signal});
  document.addEventListener('visibilitychange',onVisibility,{signal: life.signal});
  window.addEventListener('online',() => {if (active()) void initialize();},{signal: life.signal});
  document.addEventListener('toggle',event => {if (event.composedPath().includes(host) || !(event.target instanceof HTMLElement) || !event.target.matches('[popover]')) return; try {surface.hidePopover(); topLayer();} catch { /* fixed-host fallback */ } scheduleResolution();},{capture: true,signal: life.signal});
  const controller: Huddle = {
    open() {if (destroyed) return;if(!opened||collapsed){let focused=document.activeElement;while(focused?.shadowRoot?.activeElement)focused=focused.shadowRoot.activeElement;if(focused instanceof HTMLElement&&focused.getRootNode()!==shadow&&!host.contains(focused)&&!focused.matches('body,html'))opener=focused;} if(opened) {if(collapsed) {collapsed = false;motion=true; render(); shadow.getElementById('huddle-action-collapse-feedback')?.focus();} return;} let focused = document.activeElement; while(focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement; opener = focused instanceof HTMLElement && focused.getRootNode() !== shadow && !host.contains(focused) ? focused : null; opened = true; collapsed = false;motion=true; topLayer(); render(); shadow.getElementById('huddle-action-collapse-feedback')?.focus(); void initialize();},
    collapse() {if(destroyed || !opened || pinning || collapsed) return; persistDraft(); hidePreview(); collapsed = true;motion=true; render(); shadow.getElementById('huddle-action-expand-feedback')?.focus();},
    close() {if (destroyed) return; persistDraft(); invalidate(); clearPrivate(); cursor = undefined; listCursor = commentCursor = historyCursor = undefined; opened = false; collapsed = false; pinning = false; highlight.hidden = true; render(); if (opener?.isConnected) opener.focus(); else shadow.getElementById('huddle-action-expand-feedback')?.focus();},
    updateContext(context) {if (destroyed) return; validateOptions({...settings,...context}); Object.assign(settings,context); routeChange();},
    destroy() {if (destroyed) return; persistDraft(); destroyed = true;composerCleanup?.(); invalidate(); life.abort(); observer.disconnect(); cancelAnimationFrame(geometryFrame); cancelAnimationFrame(resolveFrame); if (history.pushState === push) history.pushState = originalPush; if (history.replaceState === replace) history.replaceState = originalReplace; host.remove(); instances.delete(document); clearPrivate(); ui.replaceChildren(); memory.clear(); if (opened && opener?.isConnected) opener.focus();},
  };
  instances.set(document,{controller,settings,owner}); topLayer(); render();if(opened)void initialize(); return controller;
}
