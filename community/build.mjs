import {build} from 'esbuild';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {encodeBase85,decodeBase85} from './src/base85.js';
import {checkPublicationSize} from './scripts/publication-size.mjs';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';

process.chdir(fileURLToPath(new URL('.',import.meta.url)));

const version=JSON.parse(await readFile('package.json','utf8')).version;
const hash=createHash('sha256').update(version);
async function hashTree(dir){for(const item of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const file=dir+'/'+item.name;if(item.isDirectory())await hashTree(file);else hash.update(file).update(await readFile(file));}}
await hashTree('src');await hashTree('vendor/ghostscript');hash.update(await readFile('build.mjs'));hash.update(await readFile('scripts/publication-size.mjs'));
const buildId=version+'+'+hash.digest('hex').slice(0,12);
const wasm=await readFile('vendor/ghostscript/gs.wasm');
const wasmGzip=gzipSync(wasm,{level:9}).toString('base64');
const textModule=(name,value)=>({name,setup(b){b.onResolve({filter:new RegExp('^'+name+'$')},()=>({path:name,namespace:name}));b.onLoad({filter:/.*/,namespace:name},()=>({contents:'export default '+JSON.stringify(value),loader:'js'}));}});
const common={absWorkingDir:process.cwd(),bundle:true,minify:true,format:'iife',write:false,logLevel:'warning',define:{__PLUGIN_VERSION__:JSON.stringify(version),__PLUGIN_BUILD_ID__:JSON.stringify(buildId)}};
const worker=await build({...common,entryPoints:['src/eps-worker.ts'],platform:'browser',target:'es2020',external:['module'],define:{...common.define,process:'undefined','import.meta.url':'""'},plugins:[textModule('ghostscript-wasm-data',wasmGzip)]});
const ui=await build({...common,entryPoints:['src/ui.ts'],target:'es2020',plugins:[textModule('ghostscript-worker-source',worker.outputFiles[0].text)]});
const main=await build({...common,entryPoints:['src/code.ts'],target:'es2019'});
const compressed=gzipSync(ui.outputFiles[0].contents,{level:9});
const packed=encodeBase85(compressed);
assert.ok(!packed.includes('<'));
assert.deepEqual(gunzipSync(decodeBase85(packed,compressed.length)),Buffer.from(ui.outputFiles[0].contents),'Embedded bundle must restore byte-for-byte');
const bootstrap=await build({...common,entryPoints:['src/bootstrap.ts'],target:'es2020'});
const html=(await readFile('src/ui.html','utf8')).replace('<script src="ui.js"></script>',()=>
  '<script id="plugin-source" type="application/octet-stream" data-bytes="'+compressed.length+'">'+packed+'</script>\n<script>'+bootstrap.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')+'</script>');
const publication=checkPublicationSize({'manifest.json':await readFile('manifest.json'),'code.js':main.outputFiles[0].contents,'ui.html':html});
await writeFile('code.js',main.outputFiles[0].contents);await writeFile('ui.html',html);
const files={};for(const name of ['code.js','ui.html','manifest.json'])files[name]=createHash('sha256').update(await readFile(name)).digest('hex');
await writeFile('build-info.json',JSON.stringify({version,buildId,edition:'community',engine:'Ghostscript 10.06.0 / @okathira/ghostpdl-wasm 1.1.0',embedding:'gzip-base85',publication,files},null,2));
await mkdir('.test-output',{recursive:true});
console.log('Community '+buildId+' · publishing source '+publication.totalBytes.toLocaleString('en-US')+' / '+publication.limitBytes.toLocaleString('en-US')+' bytes · all engine assets embedded');
