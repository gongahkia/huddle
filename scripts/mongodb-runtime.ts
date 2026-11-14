import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {access,lstat,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const exec = promisify(execFile), version = '8.0.38', sha256 = '2885d4382bd47b96bfaf3edc7dec0ef44463e3e2a79479f584d20deb6182cda9';
if(process.platform !== 'linux' || process.arch !== 'x64') throw new Error('The pinned MongoDB fixture supports Linux x86_64. Supply native MongoDB 8.0 through HUDDLE_TEST_MONGODB_BIN on other systems.');
const root = resolve('output/runtime'), target = join(root,`mongodb-fixture-${version}`), marker = join(target,'huddle-runtime.json'), nonce = randomUUID(); await mkdir(root,{recursive:true});
let exists = false; try {await access(target); exists = true;} catch { /* create a new owned runtime */ }
if(exists) {
  const saved = JSON.parse(await readFile(marker,'utf8')); if((await lstat(target)).isSymbolicLink() || saved.kind !== 'huddle-mongodb-binary' || saved.version !== version || saved.sha256 !== sha256 || !saved.complete) throw new Error('Refusing to reuse or overwrite an unverified MongoDB runtime.');
  const binary = await exec(join(target,'bin/mongod'),['--version']); if(!binary.stdout.startsWith(`db version v${version}\n`)) throw new Error('Cached MongoDB binary does not match the fixture pin.'); console.log(`Verified cached MongoDB ${version}: ${target}/bin`);
} else {
  const work = await mkdtemp(join(root,'mongodb-extract-')); await mkdir(target,{mode:0o700}); const record = {kind:'huddle-mongodb-binary',version,sha256,nonce,complete:false}; await writeFile(marker,JSON.stringify(record),{mode:0o600});
  try {
    console.log(`Downloading the pinned MongoDB ${version} Ubuntu 24.04 fixture…`);
    const response = await fetch(`https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2404-${version}.tgz`,{signal:AbortSignal.timeout(120000)}); if(!response.ok) throw new Error('Could not download the pinned MongoDB fixture.'); const bytes = Buffer.from(await response.arrayBuffer()); if(createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('MongoDB fixture checksum mismatch.');
    await writeFile(join(work,'mongodb.tgz'),bytes); await exec('tar',['-xf',join(work,'mongodb.tgz'),'-C',target,'--strip-components=1']); const binary = await exec(join(target,'bin/mongod'),['--version']); if(!binary.stdout.startsWith(`db version v${version}\n`)) throw new Error('Extracted MongoDB binary does not match the fixture pin.');
    await writeFile(marker,JSON.stringify({...record,complete:true}),{mode:0o600}); console.log(`Prepared private MongoDB ${version}: ${target}/bin`);
  } catch(value) {const saved = JSON.parse(await readFile(marker,'utf8')); if(saved.nonce === nonce) await rm(target,{recursive:true,force:true}); throw value;}
  finally {await rm(work,{recursive:true,force:true});}
}
