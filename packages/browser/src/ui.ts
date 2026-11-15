import {ArrowDownUp,ArrowLeft,Check,FileText,Info,LocateFixed,MessageCircle,PanelRightClose,PanelRightOpen,Pin,RefreshCw,RotateCcw,X,createElement} from 'lucide';
const icons = {close:X,collapse:PanelRightClose,expand:PanelRightOpen,transfer:ArrowDownUp,refresh:RefreshCw,pin:Pin,page:FileText,back:ArrowLeft,locate:LocateFixed,check:Check,reopen:RotateCcw,info:Info,comment:MessageCircle};
export type Icon = keyof typeof icons;
export function icon(name: Icon): SVGElement {return createElement(icons[name],{class:'icon','aria-hidden':'true',focusable:'false'});}
export function excerpt(value: string,limit = 240): string {
  const text = value.replace(/\s+/g,' ').trim(); if(text.length <= limit) return text;
  const slice = text.slice(0,limit), space = slice.lastIndexOf(' '); return slice.slice(0,space > limit * .6 ? space : limit).trimEnd()+'…';
}
