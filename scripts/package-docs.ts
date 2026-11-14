import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {dirname,join,relative,resolve} from 'node:path';

export function assertPackagedDocs(root:string) {
  const files = ['README.md',...readdirSync(join(root,'dist/docs'),{recursive:true,encoding:'utf8'}).filter(file => file.endsWith('.md')).map(file => join('dist/docs',file))];
  for(const file of files) for(const match of readFileSync(join(root,file),'utf8').matchAll(/\]\(([^)]+)\)/g)) {
    const link = match[1].split('#',1)[0];if(!link || /^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith('//')) continue;
    const target = resolve(root,dirname(file),link), path = relative(root,target);
    if(path.startsWith('..') || !existsSync(target)) throw new Error(`Packaged guide ${file} links to an unavailable package file: ${link}`);
  }
}
