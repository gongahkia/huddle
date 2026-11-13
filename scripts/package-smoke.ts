import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
const exec = promisify(execFile), dir = mkdtempSync(join(tmpdir(),'huddle-package-'));
try {
 const archiveDir = join(dir,'archives');
 await exec('pnpm',['--dir','packages/browser','pack','--pack-destination',archiveDir]);
 const file = join(archiveDir,'huddle-browser-0.1.0.tgz');
 writeFileSync(join(dir,'package.json'),JSON.stringify({private: true,type: 'module'}));
 await exec('npm',['install','--ignore-scripts','--no-audit','--no-fund',file],{cwd: dir});
 writeFileSync(join(dir,'consumer.ts'),`import {mount,type HuddleOptions,type Anchor} from '@huddle/browser';\nconst options:HuddleOptions={serverUrl:'http://localhost:4310',projectId:'test',environment:'staging'};\nconst api=mount(options);api.open();api.close();api.updateContext({release:'v2'});api.destroy();\nconst anchor:Anchor={kind:'page',selector:'body',label:'This page',quote:'',x:0,y:0};void anchor;\n`);
 writeFileSync(join(dir,'tsconfig.json'),JSON.stringify({compilerOptions: {target: 'ES2023',module: 'NodeNext',moduleResolution: 'NodeNext',strict: true,noEmit: true,types: [],lib: ['ES2023','DOM']},files: ['consumer.ts']}));
 await exec(process.execPath,[resolve('node_modules/typescript/bin/tsc'),'-p',join(dir,'tsconfig.json')]);
 await exec(process.execPath,['--input-type=module','-e',"const module = await import('@huddle/browser'); if (typeof module.mount !== 'function') throw new Error('Missing mount export');"],{cwd: dir});
 if (readFileSync(join(dir,'node_modules/@huddle/browser/dist/index.d.ts'),'utf8').includes('@huddle/shared')) throw new Error('Declarations leak a workspace dependency.');
 console.log('Packed browser module installs, typechecks and imports without browser globals in a fresh external consumer.');
} finally {rmSync(dir,{recursive: true,force: true});}
