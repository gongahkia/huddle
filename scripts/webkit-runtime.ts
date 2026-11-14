import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {access,lstat,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {webkit} from '@playwright/test';
const exec = promisify(execFile), root = resolve('output/runtime'), target = join(root,'webkit-compat-1'), marker = join(target,'huddle-runtime.json'), nonce = randomUUID();
const dependencies = [
  {file:'libicu74_74.2-1ubuntu3.1_amd64.deb',path:'i/icu',sha256:'c9a70989678660eed9a1e904c74fa043da8bec8e2036856fc16e31ced79b04f8'},
  {file:'libxml2_2.9.14+dfsg-1.3ubuntu3.10_amd64.deb',path:'libx/libxml2',sha256:'c5a065f85c1e6f605741e365e40cad71c3ceb0e85e2791400bd35b8896e12ad1'},
];
const pin = dependencies.map(item => item.sha256).join(':')+':complex-text:1', wpe = join(dirname(webkit.executablePath()),'minibrowser-wpe'), launcher = join(target,'webkit');
const sha = (bytes:Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const quote = (value:string) => "'"+value.replaceAll("'","'\\''")+"'";
if(process.platform !== 'linux' || process.arch !== 'x64') throw new Error('This optional private WebKit compatibility runtime supports Linux x86_64 only. Use native Playwright dependencies on other platforms.');
await access(join(wpe,'bin/MiniBrowser')); await mkdir(root,{recursive:true});
let existing = false; try {await access(target); existing = true;} catch { /* create only a new private runtime */ }
if(existing) {
  const record = JSON.parse(await readFile(marker,'utf8'));
  if((await lstat(target)).isSymbolicLink() || record.kind !== 'huddle-webkit-compat' || record.pin !== pin || record.wpe !== wpe || !record.complete || !Array.isArray(record.files)) throw new Error('Refusing to reuse or overwrite an unverified WebKit runtime.');
  for(const item of record.files as {name:string;sha256:string}[]) {if(!/^lib[^/]+\.so(?:\.[0-9]+)*$/.test(item.name) || sha(await readFile(join(target,'usr/lib/x86_64-linux-gnu',item.name))) !== item.sha256) throw new Error('Cached WebKit library checksum mismatch.');}
  if(sha(await readFile(launcher)) !== record.launcherSha256) throw new Error('Cached WebKit launcher checksum mismatch.');
} else {
  await mkdir(target,{mode:0o700}); const record = {kind:'huddle-webkit-compat',pin,wpe,nonce,complete:false}; await writeFile(marker,JSON.stringify(record),{mode:0o600});
  try {
    for(const item of dependencies) {
      const response = await fetch(`https://archive.ubuntu.com/ubuntu/pool/main/${item.path}/${item.file}`,{signal:AbortSignal.timeout(120000)}); if(!response.ok) throw new Error('Could not download a pinned WebKit compatibility dependency.');
      const bytes = Buffer.from(await response.arrayBuffer()); if(sha(bytes) !== item.sha256) throw new Error('WebKit compatibility dependency checksum mismatch.');
      const archive = join(target,item.file), tar = join(target,item.file+'.data.tar'); await writeFile(archive,bytes);
      const members = (await exec('ar',['t',archive])).stdout.trim().split('\n'), member = members.find(name => /^data\.tar\.(xz|zst|gz)$/.test(name)); if(!member) throw new Error('Unsupported Debian data archive.');
      await writeFile(tar,(await exec('ar',['p',archive,member],{encoding:'buffer',maxBuffer:64*1024*1024})).stdout); await exec('bsdtar',['-xf',tar,'-C',target]); await rm(tar);
    }
    const values = {WEBKIT_FORCE_COMPLEX_TEXT:'1',WEBKIT_EXEC_PATH:join(wpe,'bin'),WEBKIT_INJECTED_BUNDLE_PATH:join(wpe,'lib'),WEBKIT_INSPECTOR_RESOURCES_PATH:join(wpe,'share'),LD_LIBRARY_PATH:[join(target,'usr/lib/x86_64-linux-gnu'),join(wpe,'lib'),join(wpe,'sys/lib')].join(':')};
    const script = '#!/bin/sh\n'+Object.entries(values).map(([key,value]) => 'export '+key+'='+quote(value)+'\n').join('')+'exec '+quote(join(wpe,'bin/MiniBrowser'))+' "$@"\n'; await writeFile(launcher,script,{mode:0o700});
    const directory = join(target,'usr/lib/x86_64-linux-gnu'), files = []; for(const name of await readdir(directory)) if(/^lib[^/]+\.so(?:\.[0-9]+)*$/.test(name)) files.push({name,sha256:sha(await readFile(join(directory,name)))});
    await writeFile(marker,JSON.stringify({...record,complete:true,files,launcherSha256:sha(script)}),{mode:0o600});
  } catch(value) {const saved = JSON.parse(await readFile(marker,'utf8')); if(saved.nonce === nonce) await rm(target,{recursive:true,force:true}); throw value;}
}
// Use the original browser binary and sandbox settings; only its private ABI libraries differ.
const browser = await webkit.launch({executablePath:launcher,headless:true});
try {const page = await browser.newPage(); await page.setContent('<button>Runtime check</button>'); if(await page.getByRole('button').innerText() !== 'Runtime check') throw new Error('The WebKit runtime probe failed.'); console.log(`Verified private WebKit ${browser.version()}. Run with HUDDLE_WEBKIT_EXECUTABLE=${quote(launcher)}`);}
finally {await browser.close();}
