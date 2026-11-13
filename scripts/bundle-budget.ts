import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
const files = ['dist/public/embed.js','packages/browser/dist/huddle.js'];
for (const file of files) {const input = await readFile(file), bytes = gzipSync(input).byteLength; console.log(`${file}: ${bytes} bytes gzip (budget 76800)`); if (bytes > 75 * 1024) throw new Error('Widget exceeds 75 KiB gzip.');}
