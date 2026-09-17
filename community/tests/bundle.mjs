import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {encodeBase85,decodeBase85} from '../src/base85.js';
import {checkPublicationSize,PUBLICATION_LIMIT} from '../scripts/publication-size.mjs';

// Cover padding, every byte, full 32-bit values, and HTML parser delimiters.
for (const bytes of [Buffer.alloc(0),Buffer.alloc(4),Buffer.alloc(4,255),Buffer.from(Array.from({length:256},(_,i)=>i)),
  Buffer.from('</script><!--<script>中文\\"\'&'),...[1,2,3,5,7,65537].map(n=>randomBytes(n))]) {
  const text=encodeBase85(bytes);
  assert.ok(!text.includes('<'));
  assert.deepEqual(Buffer.from(decodeBase85(text,bytes.length)),bytes);
}
assert.equal(encodeBase85(Buffer.alloc(4)),'00000');
assert.equal(encodeBase85(Buffer.alloc(4,255)),'|NsC0');
for (const [text,size] of [['0',1],['00000',-1],['00000',1.5],['0000<',4],['0000中',4],['~~~~~',4]])
  assert.throws(()=>decodeBase85(text,size));

// Use actual uncompressed publication files, not the ZIP size. Guard both an
// oversized individual file and multiple files exceeding the combined limit.
assert.equal(checkPublicationSize({code:Buffer.alloc(PUBLICATION_LIMIT-1)}).remainingBytes,1);
assert.throws(()=>checkPublicationSize({code:Buffer.alloc(PUBLICATION_LIMIT)}),/发布代码/);
assert.throws(()=>checkPublicationSize({main:Buffer.alloc(1_000_000),ui:Buffer.alloc(14_000_000)}),/发布代码/);
const files=Object.fromEntries(await Promise.all(['manifest.json','code.js','ui.html'].map(async name=>[name,await fs.readFile(name)])));
const info=JSON.parse(await fs.readFile('build-info.json','utf8'));
assert.deepEqual(checkPublicationSize(files),info.publication);
for (const [name,hash] of Object.entries(info.files))
  assert.equal(createHash('sha256').update(files[name]).digest('hex'),hash);
const html=files['ui.html'].toString();
const payload=html.match(/<script id="plugin-source" type="application\/octet-stream" data-bytes="(\d+)">([^<]*)<\/script>/);
assert.ok(payload,'Embedded payload must be safe HTML raw text');
const restored=gunzipSync(decodeBase85(payload[2],Number(payload[1]))).toString('utf8');
// The complete original engine stays embedded, including its fonts/resources.
const wasm=await fs.readFile('vendor/ghostscript/gs.wasm');
assert.ok(restored.includes(gzipSync(wasm,{level:9}).toString('base64')));
assert.equal(JSON.parse(files['manifest.json']).networkAccess.allowedDomains[0],'none');
await fs.writeFile('.test-output/bundle-report.json',JSON.stringify({version:info.version,publication:info.publication,
  decodedSourceBytes:Buffer.byteLength(restored),wasmBytes:wasm.length,wasmUnchanged:true,codecAndLimitChecks:true},null,2));
console.log('PASS lossless embedded bundle, unchanged full engine, safe payload, byte limits, build hashes: '+info.publication.totalBytes+' bytes');
