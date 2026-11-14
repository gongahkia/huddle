import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {access,lstat,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {availableParallelism} from 'node:os';
const exec = promisify(execFile), version = '18.6', sha256 = '555610c24d53e4316da5b7d3fc25c279d96856d5e0e23ee308c328c5fa881d9f';
const root = resolve('output/runtime'), target = join(root,`postgresql-source-${version}`), marker = join(target,'huddle-runtime.json'), nonce = randomUUID();
await mkdir(root,{recursive:true});
let exists = false; try {await access(target); exists = true;} catch { /* create a new owned runtime */ }
if (exists) {
  const record = JSON.parse(await readFile(marker,'utf8'));
  if ((await lstat(target)).isSymbolicLink() || record.kind !== 'huddle-postgres-source' || record.version !== version || record.sha256 !== sha256 || !record.complete) throw new Error('Refusing to reuse or overwrite an unverified PostgreSQL runtime.');
  const binary = await exec(join(target,'bin/postgres'),['--version']); if (binary.stdout.trim() !== `postgres (PostgreSQL) ${version}`) throw new Error('Cached PostgreSQL version does not match the fixture pin.');
  console.log(`Verified cached PostgreSQL ${version}: ${target}/bin`);
} else {
  for (const program of ['make','cc','bison','flex']) try {await exec(program,['--version']);} catch {throw new Error(`PostgreSQL source fixture needs ${program}; install build prerequisites explicitly before retrying.`);}
  const work = await mkdtemp(join(root,'postgres-build-')); await mkdir(target,{mode:0o700});
  const record = {kind:'huddle-postgres-source',version,sha256,nonce,complete:false}; await writeFile(marker,JSON.stringify(record),{mode:0o600});
  try {
    console.log(`Downloading the pinned PostgreSQL ${version} source fixture…`);
    const response = await fetch(`https://ftp.postgresql.org/pub/source/v${version}/postgresql-${version}.tar.bz2`,{signal:AbortSignal.timeout(120000)}); if (!response.ok) throw new Error('Could not download the pinned PostgreSQL source.');
    const archive = Buffer.from(await response.arrayBuffer()); if (createHash('sha256').update(archive).digest('hex') !== sha256) throw new Error('PostgreSQL source checksum mismatch.');
    await writeFile(join(work,'source.tar.bz2'),archive); await exec('tar',['-xf',join(work,'source.tar.bz2'),'-C',work]);
    const cwd = join(work,`postgresql-${version}`), options = {cwd,maxBuffer:16*1024*1024};
    await exec('./configure',[`--prefix=${target}`,'--without-icu','--without-readline','--without-zlib'],options);
    console.log(`Building the private fixture with ${Math.min(4,availableParallelism())} compiler processes…`);
    await exec('make',['-s','-j',String(Math.min(4,availableParallelism()))],options); await exec('make',['-s','install'],options);
    await writeFile(marker,JSON.stringify({...record,complete:true}),{mode:0o600}); console.log(`Built PostgreSQL ${version}: ${target}/bin`);
  } catch (value) {
    const saved = JSON.parse(await readFile(marker,'utf8')); if (saved.nonce === nonce) await rm(target,{recursive:true,force:true}); throw value;
  } finally {await rm(work,{recursive:true,force:true});}
}
