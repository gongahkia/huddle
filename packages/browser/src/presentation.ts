import type {LocalStore} from './storage';
type Position={x:number;y:number};
export function createPresentation(surface:HTMLElement,signal:AbortSignal,store:LocalStore) {
  let position:Position|undefined,frame=0,previous:HTMLElement|undefined,transition=false;
  const animations=new Set<Animation>(),ghosts=new Set<HTMLElement>();
  const clamp=(n:number)=>Math.max(0,Math.min(1,n));
  const saved=store.read<Position>('dock-position');if(saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y))position={x:clamp(saved.x),y:clamp(saved.y)};
  function place(dock:HTMLElement) {if(!position)return;const width=Math.max(0,innerWidth-dock.offsetWidth-24),height=Math.max(0,innerHeight-dock.offsetHeight-24);Object.assign(dock.style,{right:'auto',bottom:'auto',left:12+clamp(position.x)*width+'px',top:12+clamp(position.y)*height+'px'});}
  function move(dock:HTMLElement,x:number,y:number) {position={x:clamp((x-12)/Math.max(1,innerWidth-dock.offsetWidth-24)),y:clamp((y-12)/Math.max(1,innerHeight-dock.offsetHeight-24))};place(dock);store.write('dock-position',position);}
  function attach(dock:HTMLElement,handle:HTMLButtonElement) {
    place(dock);let drag:{id:number;x:number;y:number;left:number;top:number}|undefined;
    handle.title='Drag to move. Arrow keys move; Home resets.';handle.setAttribute('aria-keyshortcuts','ArrowUp ArrowDown ArrowLeft ArrowRight Home');
    handle.addEventListener('pointerdown',event=>{if(event.button!==0||!event.isPrimary)return;event.preventDefault();const rect=dock.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};handle.setPointerCapture(event.pointerId);dock.classList.add('dragging');},{signal});
    handle.addEventListener('pointermove',event=>{if(drag?.id!==event.pointerId)return;move(dock,drag.left+event.clientX-drag.x,drag.top+event.clientY-drag.y);},{signal});
    const end=()=>{drag=undefined;dock.classList.remove('dragging');};handle.addEventListener('pointerup',end,{signal});handle.addEventListener('pointercancel',end,{signal});handle.addEventListener('lostpointercapture',end,{signal});
    handle.addEventListener('keydown',event=>{const direction:Record<string,Position>={ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1},ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0}};if(event.key==='Home'){event.preventDefault();position=undefined;store.remove('dock-position');Object.assign(dock.style,{right:'',bottom:'',left:'',top:''});}else if(direction[event.key]){event.preventDefault();const rect=dock.getBoundingClientRect(),step=event.shiftKey?64:16,delta=direction[event.key];move(dock,rect.left+delta.x*step,rect.top+delta.y*step);}},{signal});
  }
  function animate(node:HTMLElement,keyframes:Keyframe[],done?:()=>void) {if(typeof node.animate!=='function'){done?.();return;}const animation=node.animate(keyframes,{duration:190,easing:'cubic-bezier(.2,.8,.2,1)',fill:'both'});animations.add(animation);void animation.finished.catch(()=>{}).then(()=>{animations.delete(animation);animation.cancel();done?.();});}
  function begin(ui:HTMLElement,enabled:boolean) {transition=enabled&&!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;const current=ui.firstElementChild;previous=transition&&current instanceof HTMLElement ? current.cloneNode(true) as HTMLElement : undefined;}
  function finish(ui:HTMLElement) {const next=ui.firstElementChild as HTMLElement|null;if(!transition||!next){previous=undefined;return;}if(previous){const ghost=previous;ghost.inert=true;ghost.setAttribute('aria-hidden','true');ghost.classList.add('transition-ghost');for(const node of [ghost,...ghost.querySelectorAll('[id]')])node.removeAttribute('id');ghosts.add(ghost);surface.append(ghost);animate(ghost,[{opacity:1,transform:'translateY(0) scale(1)'},{opacity:0,transform:ghost.classList.contains('panel')?'translateX(28px)':'translateY(12px) scale(.96)'}],()=>{ghost.remove();ghosts.delete(ghost);});}animate(next,[{opacity:0,transform:next.classList.contains('panel')?'translateX(28px)':'translateY(12px) scale(.96)'},{opacity:1,transform:'translate(0) scale(1)'}]);previous=undefined;transition=false;}
  window.addEventListener('resize',()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{frame=0;const dock=surface.querySelector<HTMLElement>('.review-dock');if(dock)place(dock);});},{signal});
  signal.addEventListener('abort',()=>{cancelAnimationFrame(frame);for(const animation of animations)animation.cancel();for(const ghost of ghosts)ghost.remove();animations.clear();ghosts.clear();},{once:true});
  return {attach,begin,finish};
}
