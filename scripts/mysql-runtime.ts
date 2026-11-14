import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {access,cp,lstat,mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const exec = promisify(execFile), version = '8.4.13', sha256 = '5dfbb764f731df40ef9e4f5d69aed32bdac8ba1af20bd96b7d40a942d83d4ed2';
const aioSha256 = 'e746fdedefa9987ad06e918af78976917aba780be8ac51d22dcb9ded324a84ab';
if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('The pinned MySQL binary fixture supports Linux x86_64. Supply a supported native mysqld through HUDDLE_TEST_MYSQL_BIN on other systems.');
const root = resolve('output/runtime'), target = join(root,`mysql-binary-${version}`), marker = join(target,'huddle-runtime.json'), nonce = randomUUID();
await mkdir(root,{recursive:true});
let exists = false; try {await access(target); exists = true;} catch { /* create a new owned runtime */ }
if (exists) {
  const record = JSON.parse(await readFile(marker,'utf8'));
  if ((await lstat(target)).isSymbolicLink() || record.kind !== 'huddle-mysql-binary' || record.version !== version || record.sha256 !== sha256 || record.aioSha256 !== aioSha256 || !record.complete) throw new Error('Refusing to reuse or overwrite an unverified MySQL runtime.');
  const binary = await exec(join(target,'bin/mysqld'),['--no-defaults','--version']); if (!binary.stdout.includes(`Ver ${version} `)) throw new Error('Cached MySQL version does not match the fixture pin.');
  console.log(`Verified cached MySQL ${version}: ${target}/bin`);
} else {
  const work = await mkdtemp(join(root,'mysql-extract-')); await mkdir(target,{mode:0o700});
  const record = {kind:'huddle-mysql-binary',version,sha256,aioSha256,nonce,complete:false}; await writeFile(marker,JSON.stringify(record),{mode:0o600});
  try {
    console.log(`Downloading the pinned MySQL ${version} binary fixture…`);
    const download = async (url: string,checksum: string,path: string) => {const response = await fetch(url,{signal:AbortSignal.timeout(120000)}); if(!response.ok) throw new Error('Could not download a pinned MySQL fixture dependency.'); const bytes = Buffer.from(await response.arrayBuffer()); if(createHash('sha256').update(bytes).digest('hex') !== checksum) throw new Error('MySQL fixture dependency checksum mismatch.'); await writeFile(path,bytes);};
    await download(`https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-${version}-linux-glibc2.28-x86_64-minimal.tar.xz`,sha256,join(work,'mysql.tar.xz'));
    await exec('tar',['-xf',join(work,'mysql.tar.xz'),'-C',target,'--strip-components=1']);
    // Keep the legacy libaio ABI private; never replace system libraries or config.
    await download('https://stable-mirror.omarchy.org/core/os/x86_64/libaio-0.3.113-5-x86_64.pkg.tar.zst',aioSha256,join(work,'aio.tar.zst'));
    await exec('tar',['-xf',join(work,'aio.tar.zst'),'-C',work,'usr/lib']); await mkdir(join(target,'lib/private'),{recursive:true});
    for (const file of await readdir(join(work,'usr/lib'))) if(file.startsWith('libaio.so')) await cp(join(work,'usr/lib',file),join(target,'lib/private',file),{verbatimSymlinks:true});
    const binary = await exec(join(target,'bin/mysqld'),['--no-defaults','--version']); if(!binary.stdout.includes(`Ver ${version} `)) throw new Error('Extracted MySQL binary did not match the fixture pin.');
    await writeFile(marker,JSON.stringify({...record,complete:true}),{mode:0o600}); console.log(`Prepared private MySQL ${version}: ${target}/bin`);
  } catch (value) {const saved = JSON.parse(await readFile(marker,'utf8')); if(saved.nonce === nonce) await rm(target,{recursive:true,force:true}); throw value;}
  finally {await rm(work,{recursive:true,force:true});}
}
