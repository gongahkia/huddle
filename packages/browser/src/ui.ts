const paths = {
  close: 'm6 6 12 12M6 18 18 6',
  collapse: 'M4 4h16v16H4zM14 4v16m-7-11 3 3-3 3',
  expand: 'M4 4h16v16H4zM14 4v16m-4-11-3 3 3 3',
  transfer: 'M8 3v12m-4-4 4 4 4-4m4 10V9m-4 4 4-4 4 4',
  refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1',
  pin: 'm16 3 5 5-4 1-3 5v3l-3-3-5 3 3-5-3-3h3l5-3zM8 16l-5 5',
  page: 'M5 3h10l4 4v14H5zM14 3v5h5M9 12h6m-6 4h4',
  back: 'm12 5-7 7 7 7M5 12h15',
  locate: 'M12 2v4m0 12v4M2 12h4m12 0h4M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0',
  check: 'm5 12 4 4L19 6',
  reopen: 'M4 4v6h6M4 10a8 8 0 1 1 1 8',
  info: 'M12 11v6m0-10v1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  comment: 'M21 11a8 8 0 0 1-8 8H8l-5 3V11a9 9 0 0 1 18 0z',
} as const;
export type Icon = keyof typeof paths;
export function icon(name: Icon): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'), path = document.createElementNS(svg.namespaceURI,'path');
  for(const [name,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'})) svg.setAttribute(name,value);
  svg.classList.add('icon'); path.setAttribute('d',paths[name]); svg.append(path); return svg;
}
export function excerpt(value: string,limit = 240): string {
  const text = value.replace(/\s+/g,' ').trim(); if(text.length <= limit) return text;
  const slice = text.slice(0,limit), space = slice.lastIndexOf(' '); return slice.slice(0,space > limit * .6 ? space : limit).trimEnd()+'…';
}
