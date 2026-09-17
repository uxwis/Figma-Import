import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {zipSync,strToU8,unzipSync} from 'fflate';
import assert from 'node:assert/strict';
import {checkPublicationSize} from './publication-size.mjs';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const pkg=JSON.parse(await readFile('package.json','utf8'));
const info=JSON.parse(await readFile('build-info.json','utf8'));
assert.equal(info.version,pkg.version);
for(const [path,hash] of Object.entries(info.files))assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),hash,'Rebuild changed file: '+path);
const publication=checkPublicationSize(Object.fromEntries(await Promise.all(['manifest.json','code.js','ui.html'].map(async path=>[path,await readFile(path)]))));
assert.deepEqual(info.publication,publication,'Publication size does not match the build');
const entries={};
const add=async path=>{entries[path]=new Uint8Array(await readFile(path));};
async function tree(dir){for(const item of await readdir(dir,{withFileTypes:true})){const path=dir+'/'+item.name;if(item.isDirectory())await tree(path);else if(item.isFile())await add(path);}}
for(const path of ['manifest.json','code.js','ui.html','build-info.json','README.md'])await add(path);
await tree('licenses');
const release={edition:'community',version:pkg.version,buildId:info.buildId,preview:true,networkRequired:false,communityPublicationVerified:false,licenseDecisionRequired:true};
entries['RELEASE.json']=strToU8(JSON.stringify(release,null,2));
await mkdir('dist',{recursive:true});
async function pack(suffix){
  const names=Object.keys(entries);assert.ok(names.every(name=>!/(^|\/)(node_modules|\.test-output|helper)(\/|$)|\.(cmd|psd|psb|figimport|eps)$/i.test(name)));
  const bytes=zipSync(entries,{level:6}),file='dist/figma-import-community-'+pkg.version+'-'+suffix+'.zip';
  await writeFile(file,bytes);const check=unzipSync(new Uint8Array(await readFile(file)));assert.equal(Object.keys(check).length,names.length);
  console.log(file+' · '+(bytes.length/1024/1024).toFixed(2)+' MiB');
}
await pack('plugin');
for(const path of ['package.json','package-lock.json','build.mjs','tsconfig.base.json','tsconfig.code.json','tsconfig.ui.json'])await add(path);
for(const dir of ['src','scripts','tests','vendor'])await tree(dir);
await pack('source');
