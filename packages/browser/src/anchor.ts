import type {Anchor} from '@huddle/shared';

// Adapted from Pronto's feedback anchor engine. See NOTICE.
export type AnchorState = 'ok' | 'relocated' | 'changed' | 'missing' | 'hidden' | 'ambiguous';
export type ResolvedAnchor = {element: Element | null; state: AnchorState};
const controls = 'button,a[href],input,textarea,select,summary,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="switch"]';
const textual = 'label,h1,h2,h3,h4,h5,h6,p,li,td,th,img,figcaption,blockquote';
const clean = (v: string) => v.trim().replace(/\s+/g, ' ').slice(0, 120);
const quote = (v: string) => `"${v.replace(/["\\\n\r]/g, c => `\\${c.charCodeAt(0).toString(16)} `)}"`;
export function labelFor(el: Element): string {
  return clean(el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('placeholder') || el.textContent || el.tagName) || 'Page element';
}
export function stableKey(el: Element): string | null {
  for (const attr of ['data-huddle-id', 'data-feedback-id', 'data-testid']) {
    const value = el.getAttribute(attr); if (value) return `[${attr}=${quote(value)}]`;
  }
  if (el.id && !/^(:|«|radix-|headlessui-|react-aria|__)/.test(el.id) && !/[:«»]/.test(el.id)) return `[id=${quote(el.id)}]`;
  return null;
}
export function selectorFor(el: Element): string {
  const parts: string[] = [];
  for (let node: Element | null = el, depth = 0; node && depth < 40; node = node.parentElement, depth++) {
    const stable = stableKey(node);
    if (stable && node.ownerDocument.querySelectorAll(stable).length === 1) {parts.unshift(stable); break;}
    const tag = node.tagName.toLowerCase();
    if (tag === 'body' || tag === 'html') {parts.unshift(tag); break;}
    const peers = node.parentElement ? [...node.parentElement.children].filter(p => p.tagName === node!.tagName) : [node];
    parts.unshift(`${tag}:nth-of-type(${peers.indexOf(node) + 1})`);
  }
  const selector = parts.join(' > ');
  return selector.length <= 1800 ? selector : ''; // Invalid overlong paths must not silently target elsewhere.
}
export function pickTarget(el: Element): Element {return el.closest(controls) || el.closest('[data-huddle-id],[data-feedback-id]') || el.closest(textual) || el;}
function contextFor(el: Element): string {
  for (let parent = el.parentElement, i = 0; parent && i < 4; parent = parent.parentElement, i++) {
    if (parent.matches('body,html')) break;
    const key = stableKey(parent);
    const heading = parent.querySelector('h1,h2,h3,h4,h5,h6');
    if (key || parent.getAttribute('aria-label') || heading) return clean([key, parent.getAttribute('aria-label'), heading?.textContent].filter(Boolean).join(' '));
  }
  return '';
}
export function pageAnchor(): Anchor {return {kind: 'page', selector: 'body', label: 'This page', quote: '', x: .95, y: .05};}
export function buildAnchor(el: Element, details: {quote?: string; x: number; y: number}): Anchor {
  return {kind: 'element', selector: selectorFor(el), label: labelFor(el), tag: el.tagName.toLowerCase(),
    stableKey: stableKey(el) || undefined, context: contextFor(el), quote: (details.quote || '').slice(0, 300),
    x: Math.max(0, Math.min(1, details.x)), y: Math.max(0, Math.min(1, details.y)),
    viewport: {width: el.ownerDocument.defaultView?.innerWidth || 0, height: el.ownerDocument.defaultView?.innerHeight || 0}};
}
const visible = (el: Element) => {const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.closest('[hidden],[inert]');};
const excluded = (el: Element) => !!el.closest('[data-huddle-root],[data-feedback-ui]');
export function resolveAnchor(anchor: Anchor, doc: Document = document): ResolvedAnchor {
  if (anchor.kind === 'page') return {element: doc.body, state: 'ok'};
  let direct: Element | null = null;
  try {const all = doc.querySelectorAll(anchor.selector); if (all.length === 1) direct = all[0];} catch { /* malformed import */ }
  if (direct && (excluded(direct) || (anchor.tag && direct.tagName.toLowerCase() !== anchor.tag))) direct = null;
  const matching = (e: Element) => !excluded(e) && labelFor(e) === anchor.label && (!anchor.context || contextFor(e) === anchor.context);
  if (anchor.stableKey) {
    try {const stable = doc.querySelectorAll(anchor.stableKey);
      if (stable.length === 1 && matching(stable[0])) return {element: stable[0], state: visible(stable[0]) ? (stable[0] === direct ? 'ok' : 'relocated') : 'hidden'};
    } catch { /* malformed import */ }
  }
  let matches: Element[] = [];
  try {matches = [...doc.querySelectorAll(anchor.tag || '*')].filter(matching);} catch { /* malformed tag */ }
  if (matches.length > 1) return {element: null, state: 'ambiguous'};
  if (matches.length === 1) return {element: matches[0], state: visible(matches[0]) ? (matches[0] === direct ? 'ok' : 'relocated') : 'hidden'};
  if (direct) return {element: direct, state: visible(direct) ? 'changed' : 'hidden'};
  return {element: null, state: 'missing'};
}
export const anchorWarnings: Record<AnchorState, string> = {
  ok: '', relocated: 'The target moved. Check this pin.', changed: 'The target changed. Reattach this pin if needed.',
  missing: 'Target missing. Open the original view or reattach this pin.', hidden: 'Target is currently hidden.', ambiguous: 'Several targets match. Reattach this pin to avoid pointing to the wrong element.',
};
