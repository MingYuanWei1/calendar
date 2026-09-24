import {build} from 'esbuild';
import {cp,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {builtinModules} from 'node:module';
await rm('dist/pages',{recursive:true,force:true});
await mkdir('dist/pages/vendor',{recursive:true});
await cp('public','dist/pages',{recursive:true});
for(const [source,target] of [
  ['@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff','exam-font-regular.woff'],
  ['@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-700-normal.woff','exam-font-bold.woff'],
  ['html2canvas/dist/html2canvas.min.js','html2canvas.js'],['jspdf/dist/jspdf.umd.min.js','jspdf.js'],
  ['pdfjs-dist/build','pdfjs/build'],['pdfjs-dist/cmaps','pdfjs/cmaps'],['pdfjs-dist/standard_fonts','pdfjs/standard_fonts'],['pdfjs-dist/wasm','pdfjs/wasm']
])await cp('node_modules/'+source,'dist/pages/vendor/'+target,{recursive:true});
await build({entryPoints:['cloudflare/pages.mjs'],outfile:'dist/pages/_worker.js',bundle:true,format:'esm',platform:'browser',target:'es2022'});
await writeFile('dist/pages/_routes.json',JSON.stringify({version:1,include:['/*'],exclude:[]}));
await writeFile('dist/pages/_headers',`/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'\n`);
await build({entryPoints:['cloudflare/worker.mjs'],outfile:'dist/backend/worker.mjs',bundle:true,format:'esm',platform:'node',target:'es2022',minify:true,
  external:['cloudflare:*','node:*','@aws-sdk/client-s3',...builtinModules],
  alias:{pdfkit:resolve('node_modules/pdfkit/js/pdfkit.standalone.js'),exceljs:'exceljs/dist/exceljs.min.js'},
  banner:{js:"import {createRequire as __createRequire} from 'node:module'; const require=__createRequire('/bundle/worker.mjs');"},
  plugins:[{name:'cloudflare-fonts',setup(b){b.onResolve({filter:/\/font-data\.mjs$/},()=>({path:resolve('cloudflare/fonts.mjs')}));}}]
});
console.log('Built Pages assets and Cloudflare backend.');
