import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {cp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {basename,join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const exec = promisify(execFile), root = resolve('.'), output = resolve('output/frameworks');
const manifest = JSON.parse(await readFile('package.json','utf8')), pkg = JSON.parse(await readFile('packages/browser/package.json','utf8'));
await mkdir('output/packages',{recursive: true}); await exec('pnpm',['--dir','packages/browser','pack','--pack-destination',resolve('output/packages')]);
const archive = resolve(`output/packages/huddle-browser-${pkg.version}.tgz`), sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
const fixtures = [
 {name: 'nuxt',peers: ['nuxt','vue','typescript'],command: ['nuxt','build'],port: 4323},
 {name: 'sveltekit',peers: ['@sveltejs/kit','@sveltejs/adapter-node','@sveltejs/vite-plugin-svelte','@opentelemetry/api','svelte','vite','typescript'],command: ['vite','build'],port: 4324},
 {name: 'astro',peers: ['astro','@astrojs/node','typescript'],command: ['astro','build'],port: 4325},
];
const evidence: unknown[] = [];
const ignored = new Set(['node_modules','.next','.nuxt','.output','.svelte-kit','.astro','dist','build']);
for (const fixture of fixtures) {
 const dir = join(output,fixture.name); await rm(dir,{recursive: true,force: true});
 await cp(join(root,'examples',fixture.name),dir,{recursive: true,filter: path => !ignored.has(basename(path))});
 const dependencies = Object.fromEntries(fixture.peers.map(name => [name,manifest.dependencies[name] || manifest.devDependencies[name]]));
 await writeFile(join(dir,'package.json'),JSON.stringify({name: `huddle-fixture-${fixture.name}`,private: true,type: 'module',dependencies: {...dependencies,'@huddle/browser': `file:${archive}`}},null,2));
 await cp('.npmrc',join(dir,'.npmrc'));
 console.log(`${fixture.name}: installing the packed browser package in an isolated production fixture…`);
 try {
  await exec('pnpm',['install','--ignore-workspace','--ignore-scripts','--no-frozen-lockfile'],{cwd: dir,maxBuffer: 8 * 1024 * 1024});
  console.log(`${fixture.name}: building production client/server…`);
  await exec('pnpm',['exec',...fixture.command],{cwd: dir,env: {...process.env,NUXT_TELEMETRY_DISABLED: '1',ASTRO_TELEMETRY_DISABLED: '1'},maxBuffer: 8 * 1024 * 1024});
 } catch (cause) {
  const error = cause as Error & {stdout?: string; stderr?: string};
  console.error(error.stdout?.slice(-7000),error.stderr?.slice(-3000)); throw error;
 }
 const installed = JSON.parse(await readFile(join(dir,'node_modules/@huddle/browser/package.json'),'utf8'));
 evidence.push({framework: fixture.name,version: dependencies[fixture.name === 'sveltekit' ? '@sveltejs/kit' : fixture.name],port: fixture.port,packageVersion: installed.version,packageSource: 'installed tarball',productionBuild: 'passed'});
 console.log(`${fixture.name}: production fixture ready on port ${fixture.port}.`);
}
await writeFile(join(output,'evidence.json'),JSON.stringify({at: new Date().toISOString(),packageSha256: sha256,fixtures: evidence},null,2) + '\n');
