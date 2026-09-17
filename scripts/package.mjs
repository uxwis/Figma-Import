import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import path from 'node:path';
import {zipSync,strToU8,unzipSync} from 'fflate';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const pkg=JSON.parse(await readFile('package.json','utf8'));
const buildInfo=JSON.parse(await readFile('build-info.json','utf8'));
assert.equal(buildInfo.version,pkg.version,'Run npm run build before packaging');
for(const [file,hash]of Object.entries(buildInfo.files))assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'),hash,'Mixed or stale plugin build: '+file);
const entries={};
const add=async file=>{entries[file.replaceAll('\\','/')]=new Uint8Array(await readFile(file));};
// Allowlisted source and generated plugin files only. Never enumerate the workspace.
for(const file of ['manifest.json','code.js','ui.html','build-info.json','README.md','LOCAL.md','启动本机转换.cmd','本机转换使用说明.html','package.json','package-lock.json','build.mjs','tsconfig.base.json','tsconfig.code.json','tsconfig.ui.json'])await add(file);
for(const dir of ['src','docs','licenses']){
  async function visit(current){for(const item of await readdir(current,{withFileTypes:true})){const file=path.join(current,item.name);if(item.isDirectory())await visit(file);else await add(file);}}
  await visit(dir);
}
for(const file of ['service.py','desktop.py','first-run.html','fonts.py','composite.py','compare.py','review.py','convert.mjs','parser.mjs','requirements-lock.txt'])await add('helper/'+file);
for(const file of ['core.mjs','setup.mjs','samples.mjs','browser.mjs','compiled-import.mjs','plugin-host.mjs','helper_test.py'])await add('tests/'+file);
await add('scripts/package.mjs');
assert.ok(Object.keys(entries).every(n=>!/(?:^|\/)(?:\.test-output|\.venv|node_modules)(?:\/|$)|\.(?:psd|psb|ai|eps|ttf|otf|ttc|figimport)$/i.test(n)));
entries['RELEASE.json']=strToU8(JSON.stringify({name:pkg.name,version:pkg.version,buildId:buildInfo.buildId,preview:true,fidelityValidated:false,files:Object.keys(entries).sort()},null,2));
assert.equal(new Set(Object.keys(entries).map(n=>n.toLowerCase())).size,Object.keys(entries).length,'Package paths must also be unique on Windows');
const output='dist/figma-import-'+pkg.version+'.zip',bytes=zipSync(entries,{level:6});
await mkdir('dist',{recursive:true});await writeFile(output,bytes);
const check=unzipSync(new Uint8Array(await readFile(output)));
assert.equal(Object.keys(check).length,Object.keys(entries).length);
console.log(output+' ('+Object.keys(check).length+' files, '+Math.round(bytes.length/1024)+' KiB)');
