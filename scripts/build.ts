import {build} from 'esbuild';
import {build as viteBuild} from 'vite';
import {cp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {rollup} from 'rollup';
import {dts} from 'rollup-plugin-dts';
import {resolve} from 'node:path';
await mkdir('dist/public',{recursive: true}); await mkdir('packages/browser/dist',{recursive: true});
await build({entryPoints: ['packages/browser/src/embed.ts'],bundle: true,format: 'iife',globalName: 'Huddle',minify: true,target: 'es2022',outfile: 'dist/public/embed.js'});
await build({entryPoints: ['packages/browser/src/index.ts'],bundle: true,format: 'esm',minify: true,target: 'es2022',outfile: 'packages/browser/dist/huddle.js'});
await cp('packages/browser/dist/huddle.js','dist/public/huddle.js');
await cp('NOTICE','packages/browser/NOTICE');
const declarations = await rollup({input: 'packages/browser/src/index.ts',plugins: [dts({compilerOptions: {paths: {'@huddle/shared': ['./packages/shared/src/index.ts']}}})]});
await declarations.write({file: 'packages/browser/dist/index.d.ts',format: 'es'}); await declarations.close();
await build({entryPoints: ['apps/server/src/main.ts'],bundle: true,platform: 'node',target: 'node24',format: 'esm',packages: 'external',outfile: 'dist/server.js'});
await build({entryPoints: ['scripts/cli.ts'],bundle: true,platform: 'node',target: 'node24',format: 'esm',packages: 'external',outfile: 'dist/cli.js'});
await viteBuild({root: 'apps/manage',build: {outDir: resolve('dist/public'),emptyOutDir: false},logLevel: 'warn'});
await mkdir('dist/examples/html',{recursive: true}); await cp('examples/html/index.html','dist/examples/html/index.html'); await cp('examples/style.css','dist/examples/style.css'); await cp('dist/public/huddle.js','dist/examples/huddle.js');
for (const example of ['react','angular']) {
 await viteBuild({root: `examples/${example}`,base: `/${example}/`,resolve: {alias: {'@huddle/browser': resolve('packages/browser/src/index.ts')}},build: {outDir: resolve(`dist/examples/${example}`),emptyOutDir: true},logLevel: 'warn'});
}
// The HTML example uses the same built browser module served by the example host.
const meta = JSON.parse(await readFile('package.json','utf8'));
await writeFile('dist/build.json',JSON.stringify({version: meta.version,node: process.version}) + '\n');
console.log('Built service, management UI, widget, declarations and all three examples.');
