import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {build} from 'esbuild';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const exec = promisify(execFile), directory = mkdtempSync(join(tmpdir(),'huddle-consumers-'));
const root = JSON.parse(readFileSync('package.json','utf8')), pkg = JSON.parse(readFileSync('packages/browser/package.json','utf8'));
const peers = Object.keys(pkg.peerDependencies) as string[];
const cases = [
 {entry: '',peers: [],symbol: 'mount',call: '(() => {const widget=helper(options);widget.open();widget.close();widget.updateContext({release:"v2"});widget.destroy();return widget;})()'},
 {entry: 'http',peers: [],symbol: 'createHttpAdapter',call: 'helper()'},
 {entry: 'react',peers: ['react'],symbol: 'useHuddle',call: 'helper(options)'},
 {entry: 'preact',peers: ['preact'],symbol: 'useHuddle',call: 'helper(options)'},
 {entry: 'vue',peers: ['vue'],symbol: 'useHuddle',call: 'helper(() => options)'},
 {entry: 'svelte',peers: ['svelte'],symbol: 'huddle',call: 'helper(document.body,options)'},
 {entry: 'solid',peers: ['solid-js'],symbol: 'createHuddle',call: 'helper(() => options)'},
 {entry: 'angular',peers: ['@angular/core','rxjs'],symbol: 'injectHuddle',call: 'helper(() => options)'},
 {entry: 'astro',peers: [],symbol: 'installHuddle',call: 'helper(options)'},
];
const results: unknown[] = [];
try {
 const archives = join(directory,'archives'); await exec('pnpm',['--dir','packages/browser','pack','--pack-destination',archives]);
 const archive = join(archives,`huddle-browser-${pkg.version}.tgz`);
 for (const item of cases) {
  const dir = join(directory,item.entry || 'core'); mkdirSync(dir);
  const dependencies = Object.fromEntries(item.peers.map(peer => [peer,root.dependencies[peer] || root.devDependencies[peer]]));
  writeFileSync(join(dir,'package.json'),JSON.stringify({private: true,type: 'module',dependencies: {...dependencies,'@huddle/browser': `file:${archive}`}}));
  await exec('npm',['install','--ignore-scripts','--no-audit','--no-fund'],{cwd: dir,maxBuffer: 2 * 1024 * 1024});
  for (const peer of peers) if (!item.peers.includes(peer) && existsSync(join(dir,'node_modules',peer,'package.json'))) throw new Error(`${item.entry || 'core'} unnecessarily installed ${peer}`);
  const entry = '@huddle/browser' + (item.entry ? `/${item.entry}` : '');
  writeFileSync(join(dir,'consumer.ts'),`import {${item.symbol} as helper} from '${entry}';import type {HuddleOptions} from '@huddle/browser';\nconst options:HuddleOptions={adapter:{} as import('@huddle/browser').CollaborationAdapter,namespace:'consumer',workspace:'team',environment:'staging'};\n// @ts-expect-error Configuration fields must retain their declared types.\nconst invalid:HuddleOptions={...options,environment:123};void invalid;\nexport function integration(){return ${item.call};}\nconsole.log(helper);\n`);
  const files = ['consumer.ts'];
  if(!item.entry) {
   const installedRoot = join(dir,'node_modules/@huddle/browser'), guide = readFileSync(join(installedRoot,'README.md'),'utf8'), example = guide.match(/```ts\n([\s\S]*?)```/)?.[1]; if(!example) throw new Error('The installed browser guide has no TypeScript integration example.');
   for(const path of [...guide.matchAll(/\]\(\.\/([^#)]+)\)/g)].map(match => match[1])) if(!existsSync(join(installedRoot,path))) throw new Error('The installed guide links to a missing package file: '+path);
   writeFileSync(join(dir,'readme-example.ts'),"const applicationCsrfToken='disposable-consumer-csrf';\n"+example); files.push('readme-example.ts');
  }
  writeFileSync(join(dir,'tsconfig.json'),JSON.stringify({compilerOptions: {target: 'ES2023',module: 'NodeNext',moduleResolution: 'NodeNext',strict: true,noEmit: true,skipLibCheck: false,types: [],lib: ['ES2023','DOM','DOM.Iterable']},files}));
  await exec(process.execPath,[resolve('node_modules/typescript/bin/tsc'),'-p',join(dir,'tsconfig.json')],{maxBuffer: 1024 * 1024});
  await exec(process.execPath,['--input-type=module','-e',`const module=await import('${entry}');if(typeof module.${item.symbol}!=='function')throw Error('Missing export');if('mountForOwner' in module)throw Error('Private ownership seam leaked');`],{cwd: dir});
  const bundle = await build({absWorkingDir: dir,entryPoints: ['consumer.ts'],bundle: true,platform: 'browser',format: 'esm',target: 'es2022',minify:true,write: false,metafile: true,logLevel: 'silent'});
  const inputs = Object.keys(bundle.metafile!.inputs);
  for (const peer of peers) if (!item.peers.includes(peer) && inputs.some(input => input.includes(`node_modules/${peer}/`))) throw new Error(`${entry} bundled another framework: ${peer}`);
  const declaration = readFileSync(join(dir,'node_modules/@huddle/browser/dist',item.entry ? `${item.entry}.d.ts` : 'index.d.ts'),'utf8');
  if (declaration.includes('@huddle/shared') || declaration.includes('packages/browser/src')) throw new Error('Declarations leak a repository dependency.');
  const gzipBytes = bundle.outputFiles.reduce((sum,file) => sum+gzipSync(file.contents).byteLength,0), bundleBytes = bundle.outputFiles.reduce((sum,file) => sum+file.contents.byteLength,0);
  const sdkAttributedBytes = Object.values(bundle.metafile!.outputs).reduce((sum,output) => sum+Object.entries(output.inputs).filter(([path]) => path.includes('node_modules/@huddle/browser/')).reduce((sum,[,input]) => sum+input.bytesInOutput,0),0);
  const installedVersions = Object.fromEntries(['@huddle/browser',...item.peers].map(name => [name,JSON.parse(readFileSync(join(dir,'node_modules',name,'package.json'),'utf8')).version]));
  if(!item.peers.length && gzipBytes > 75*1024) throw new Error(`${entry} exceeds the complete consumer 75 KiB gzip ceiling.`);
  results.push({entry,installedFrameworks: item.peers,installedVersions,ssrImport: 'passed',typecheck: 'passed',browserBundle: 'passed',bundleInputs: inputs.length,bundleBytes,gzipBytes,sdkAttributedBytes,includesFrameworkRuntime:item.peers.some(peer => inputs.some(path => path.includes(`node_modules/${peer}/`)))});
  console.log(`${entry}: installed, typechecked, SSR imported and bundled with only its required framework (${gzipBytes} bytes gzip for this consumer graph).`);
 }
 mkdirSync('output/package',{recursive: true}); writeFileSync('output/package/consumers.json',JSON.stringify({at: new Date().toISOString(),node:process.version,version: pkg.version,archiveSha256:createHash('sha256').update(readFileSync(archive)).digest('hex'),measurement:'Minified isolated integration consumer; gzip includes its selected framework runtime, and SDK-attributed bytes are uncompressed esbuild output attribution.',results},null,2) + '\n');
} finally {rmSync(directory,{recursive: true,force: true});}
