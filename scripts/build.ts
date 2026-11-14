import {build} from 'esbuild';
import {build as viteBuild} from 'vite';
import {cp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {rollup} from 'rollup';
import {dts} from 'rollup-plugin-dts';
import {resolve} from 'node:path';
import {svelte} from '@sveltejs/vite-plugin-svelte';
import solid from 'vite-plugin-solid';
await mkdir('dist/public',{recursive: true}); await rm('packages/browser/dist',{recursive: true,force: true}); await mkdir('packages/browser/dist',{recursive: true});
await build({entryPoints: ['packages/browser/src/embed.ts'],bundle: true,format: 'iife',globalName: 'Huddle',minify: true,target: 'es2022',outfile: 'dist/public/embed.js'});
const helpers = ['react','preact','vue','svelte','solid','angular','astro'];
const entries = {huddle: 'packages/browser/src/index.ts',http: 'packages/browser/src/http.ts',...Object.fromEntries(helpers.map(name => [name,`packages/browser/src/adapters/${name}.ts`]))};
const browser = await build({entryPoints: entries,bundle: true,splitting: true,format: 'esm',packages: 'external',minify: true,target: 'es2022',outdir: 'packages/browser/dist',chunkNames: 'chunks/[name]-[hash]',metafile: true});
await writeFile('packages/browser/dist/react.js',"'use client';\n" + await readFile('packages/browser/dist/react.js','utf8'));
await mkdir('output/build',{recursive: true}); await writeFile('output/build/browser-meta.json',JSON.stringify(browser.metafile));
await cp('packages/browser/dist/huddle.js','dist/public/huddle.js');
await rm('dist/public/chunks',{recursive: true,force: true}); await cp('packages/browser/dist/chunks','dist/public/chunks',{recursive: true});
await cp('NOTICE','packages/browser/NOTICE');
for (const [name,entry] of Object.entries(entries)) {
 const declarations = await rollup({input: entry,plugins: [dts({compilerOptions: {paths: {'@huddle/shared': ['./packages/shared/src/index.ts']}}})],external: id => !id.startsWith('.') && !id.startsWith('/') && id !== '@huddle/shared'});
 await declarations.write({file: `packages/browser/dist/${name === 'huddle' ? 'index' : name}.d.ts`,format: 'es'}); await declarations.close();
}
await build({entryPoints: ['apps/server/src/main.ts'],bundle: true,platform: 'node',target: 'node24',format: 'esm',packages: 'external',outfile: 'dist/server.js'});
await build({entryPoints: ['scripts/cli.ts'],bundle: true,platform: 'node',target: 'node24',format: 'esm',packages: 'external',outfile: 'dist/cli.js'});
await viteBuild({root: 'apps/manage',build: {outDir: resolve('dist/public'),emptyOutDir: false},logLevel: 'warn'});
await mkdir('dist/examples/html',{recursive: true}); await cp('examples/html/index.html','dist/examples/html/index.html'); await cp('examples/style.css','dist/examples/style.css'); await cp('dist/public/huddle.js','dist/examples/huddle.js');
await rm('dist/examples/chunks',{recursive: true,force: true}); await cp('dist/public/chunks','dist/examples/chunks',{recursive: true});
await rm('dist/examples/sdk',{recursive: true,force: true}); await cp('packages/browser/dist','dist/examples/sdk',{recursive: true});
for (const example of ['react','angular','vue','svelte','preact','solid']) {
 await viteBuild({root: `examples/${example}`,base: `/${example}/`,plugins: example === 'svelte' ? [svelte()] : example === 'solid' ? [solid()] : [],resolve: {alias: [{find: '@huddle/browser/http',replacement: resolve('packages/browser/src/http.ts')},...helpers.map(name => ({find: `@huddle/browser/${name}`,replacement: resolve(`packages/browser/src/adapters/${name}.ts`)})),{find: '@huddle/browser',replacement: resolve('packages/browser/src/index.ts')}]},build: {outDir: resolve(`dist/examples/${example}`),emptyOutDir: true},logLevel: 'warn'});
}
// The HTML example uses the same built browser module served by the example host.
const meta = JSON.parse(await readFile('package.json','utf8'));
await writeFile('dist/build.json',JSON.stringify({version: meta.version,node: process.version}) + '\n');
console.log('Built service, management UI, widget, declarations and seven framework/HTML examples.');
const hostEntries = {store:'packages/host/src/store.ts',sqlite:'packages/host/src/sqlite.ts',postgres:'packages/host/src/postgres.ts',mysql:'packages/host/src/mysql.ts',mongodb:'packages/host/src/mongodb.ts',http:'packages/host/src/http.ts',next:'packages/host/src/next.ts',express:'packages/host/src/express.ts',fastify:'packages/host/src/fastify.ts'};
await rm('packages/host/dist',{recursive:true,force:true});
await build({entryPoints:hostEntries,bundle:true,splitting:true,platform:'node',target:'node24',format:'esm',packages:'external',outdir:'packages/host/dist',chunkNames:'chunks/[name]-[hash]'});
for (const [name,entry] of Object.entries(hostEntries)) {
 const declarations = await rollup({input:entry,plugins:[dts()],external:id => !id.startsWith('.') && !id.startsWith('/')});
 await declarations.write({file:`packages/host/dist/${name}.d.ts`,format:'es'}); await declarations.close();
}
await mkdir('packages/host/dist/docs/schema',{recursive:true});
for (const document of ['host-http.md','collaboration-contract.md','frontend-progress.md','implementation-plan.adoc']) await cp('docs/'+document,'packages/host/dist/docs/'+document);
await writeFile('packages/host/dist/docs/host-http.md',(await readFile('docs/host-http.md','utf8')).replace('../packages/host/README.md','../../README.md'));
for (const schema of ['huddle.feedback.v2.schema.json','huddle.http.v2.openapi.json']) await cp('docs/schema/'+schema,'packages/host/dist/docs/schema/'+schema);
console.log('Built private host storage reference package and integration contracts.');
