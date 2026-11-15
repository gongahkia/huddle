import {CollaborationError,type Identity,type Page} from '../../shared/src/collaboration';

type Selection = {start:number;end:number;query:string};
export function mentionQuery(value:string,caret:number):Selection | undefined {
  const prefix=value.slice(0,caret),start=prefix.lastIndexOf('@');
  if(start<0 || start>0 && !/\s/.test(prefix[start-1]))return;
  const query=prefix.slice(start+1);if(query.length>100 || /[@\n\r]/.test(query))return;
  return {start,end:caret,query};
}
type Options = {
  textarea:HTMLTextAreaElement;parent:HTMLElement;selected:Identity[];signal:AbortSignal;
  search(query:{search?:string;cursor?:string},signal:AbortSignal):Promise<Page<Identity>>;
  change(selected:Identity[]):void;error(value:unknown):void;
};
export function attachMentions(options:Options):() => void {
  const {textarea,parent}=options,life=new AbortController(),signal=AbortSignal.any([life.signal,options.signal]);
  const popup=document.createElement('div'),list=document.createElement('div'),status=document.createElement('p'),paging=document.createElement('div'),chips=document.createElement('div');
  popup.className='mention-popup';popup.hidden=true;list.id='huddle-mention-suggestions';list.setAttribute('role','listbox');list.setAttribute('aria-label','Mention members');status.setAttribute('role','status');status.className='muted';paging.className='row mention-paging';chips.className='mention-chips';popup.append(status,list,paging);parent.append(popup,chips);
  textarea.setAttribute('role','combobox');textarea.setAttribute('aria-multiline','true');textarea.setAttribute('aria-autocomplete','list');textarea.setAttribute('aria-haspopup','listbox');textarea.setAttribute('aria-controls',list.id);textarea.setAttribute('aria-expanded','false');textarea.setAttribute('aria-describedby','huddle-mention-help');
  const help=document.createElement('p');help.id='huddle-mention-help';help.className='composer-hint';help.textContent='Type @ to mention someone · up to 30 people';parent.append(help);
  let selected=[...options.selected],items:Identity[]=[],active=0,selection:Selection|undefined,next:string|null=null,cursor:string|undefined,request:AbortController|undefined,timer:ReturnType<typeof setTimeout>|undefined,sequence=0,composing=false;
  function close() {clearTimeout(timer);request?.abort();sequence++;popup.hidden=true;textarea.setAttribute('aria-expanded','false');textarea.removeAttribute('aria-activedescendant');}
  function drawChips() {
    chips.replaceChildren();for(const member of selected){const chip=document.createElement('button');chip.type='button';chip.className='mention-chip';chip.textContent='@'+member.name+' ×';chip.setAttribute('aria-label','Remove mention '+member.name);chip.addEventListener('click',()=>{selected=selected.filter(item=>item.id!==member.id);options.change(selected);drawChips();textarea.focus();},{signal});chips.append(chip);}
  }
  function highlight() {for(const [index,option] of [...list.children].entries()){option.setAttribute('aria-selected',String(index===active));if(index===active){textarea.setAttribute('aria-activedescendant',option.id);option.scrollIntoView?.({block:'nearest'});}}}
  function choose(member:Identity) {
    if(!selection || selected.length>=30 && !selected.some(item=>item.id===member.id))return;
    const text='@'+member.name+' ';if(textarea.value.length-(selection.end-selection.start)+text.length>textarea.maxLength)return;
    textarea.setRangeText(text,selection.start,selection.end,'end');if(!selected.some(item=>item.id===member.id))selected.push(member);options.change(selected);close();drawChips();textarea.focus();textarea.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function draw() {
    list.replaceChildren();paging.replaceChildren();active=0;
    status.textContent=selected.length>=30?'Mention limit reached. Remove a mention to choose someone else.':items.length?'Choose a person · ↑ ↓ then Enter':'No matching members';
    for(const [index,member] of items.entries()){const option=document.createElement('div');option.id='huddle-mention-option-'+index;option.setAttribute('role','option');option.className='mention-option';option.textContent=member.name;const disabled=selected.length>=30 && !selected.some(item=>item.id===member.id);option.setAttribute('aria-disabled',String(disabled));option.addEventListener('pointerdown',event=>event.preventDefault(),{signal});option.addEventListener('click',()=>{if(!disabled)choose(member);},{signal});list.append(option);}
    const more=(label:string,run:()=>void)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',run,{signal});paging.append(button);};
    if(cursor)more('First suggestions',()=>{cursor=undefined;void load();});if(next)more('More suggestions',()=>{cursor=next!;void load();});highlight();
  }
  async function load() {
    if(!selection || signal.aborted)return;request?.abort();request=new AbortController();const stamp=++sequence;popup.hidden=false;textarea.setAttribute('aria-expanded','true');status.textContent='Finding people…';list.replaceChildren();paging.replaceChildren();
    try {const result=await options.search({search:selection.query || undefined,cursor},AbortSignal.any([signal,request.signal]));if(stamp!==sequence || signal.aborted)return;
      if(!Array.isArray(result.items)||result.items.length>100||result.items.some(item=>!item?.id||!item.name)||result.nextCursor!==null&&typeof result.nextCursor!=='string')throw new CollaborationError('unavailable','The host member directory returned an invalid page.');
      items=result.items;next=result.nextCursor;draw();
    }catch(value){if(stamp!==sequence || signal.aborted || request.signal.aborted)return;status.textContent='Could not load people. Type again to retry.';options.error(value);}
  }
  function changed() {
    if(composing)return;const remaining=selected.filter(item=>textarea.value.includes('@'+item.name));if(remaining.length!==selected.length){selected=remaining;options.change(selected);drawChips();}
    selection=mentionQuery(textarea.value,textarea.selectionStart);if(!selection){close();return;}cursor=undefined;request?.abort();sequence++;clearTimeout(timer);timer=setTimeout(()=>{void load();},150);
  }
  textarea.addEventListener('input',changed,{signal});textarea.addEventListener('click',changed,{signal});
  textarea.addEventListener('compositionstart',()=>{composing=true;close();},{signal});textarea.addEventListener('compositionend',()=>{composing=false;changed();},{signal});
  textarea.addEventListener('keydown',event=>{if(composing||event.isComposing||popup.hidden)return;if(['ArrowDown','ArrowUp'].includes(event.key)&&items.length){event.preventDefault();active=(active+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;highlight();}else if(event.key==='Enter'&&items[active]){event.preventDefault();choose(items[active]);}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}else if(event.key==='Tab')close();},{signal});
  textarea.addEventListener('blur',()=>{clearTimeout(timer);timer=setTimeout(()=>{if(!popup.contains(textarea.getRootNode() instanceof ShadowRoot ? (textarea.getRootNode() as ShadowRoot).activeElement : document.activeElement))close();},120);},{signal});
  signal.addEventListener('abort',()=>{close();popup.remove();chips.remove();help.remove();},{once:true});drawChips();
  return ()=>life.abort();
}
