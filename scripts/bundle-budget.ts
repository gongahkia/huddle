import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {dirname,resolve} from 'node:path';
const meta = JSON.parse(await readFile('output/build/browser-meta.json','utf8')) as {outputs: Record<string,{imports: {path: string; external?: boolean}[]}>};
const outputs = new Map(Object.entries(meta.outputs).map(([path,value]) => [resolve(path),value]));
async function graph(path: string, seen = new Set<string>()): Promise<number> {
 path = resolve(path); if (seen.has(path)) return 0; seen.add(path);
 const record = outputs.get(path); let bytes = gzipSync(await readFile(path)).byteLength;
 for (const dependency of record?.imports || []) {if (dependency.external) throw new Error(`Core unexpectedly requires ${dependency.path}`); const target = outputs.has(resolve(dependency.path)) ? resolve(dependency.path) : resolve(dirname(path),dependency.path); bytes += await graph(target,seen);}
 return bytes;
}
for (const file of ['dist/public/embed.js','packages/browser/dist/huddle.js']) {const bytes = await graph(file); console.log(`${file}: ${bytes} bytes gzip including shared chunks (budget 76800)`); if (bytes > 75 * 1024) throw new Error('Widget exceeds 75 KiB gzip.');}
