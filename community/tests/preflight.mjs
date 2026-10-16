import './setup.mjs';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {writePsd,initializeCanvas} from 'ag-psd';
await build({absWorkingDir:process.cwd(),entryPoints:['src/file-preflight.ts','src/psd-preflight.ts','src/import-summary.ts','src/import-errors.ts'],outdir:'.test-output/preflight',bundle:true,format:'esm',outExtension:{'.js':'.mjs'},platform:'node',packages:'external',logLevel:'silent'});
const {preflightFile,inspectInput,checkFileSize}=await import('../.test-output/preflight/file-preflight.mjs');
const {preflightPsd}=await import('../.test-output/preflight/psd-preflight.mjs');
const {summarizeImport}=await import('../.test-output/preflight/import-summary.mjs');
const {importError,MEMORY_ERROR,PSD_MEMORY_ERROR}=await import('../.test-output/preflight/import-errors.mjs');
const MiB=1024*1024,encode=s=>new TextEncoder().encode(s);
let checks=0;async function test(name,fn){await fn();checks++;console.log('PASS',name);}
await test('256/64 MB exact boundaries and content detection',async()=>{
 for(const [name,head,kind,limit] of [['x.PSD',encode('8BPS'),'psd',256],['x.PSB',encode('8BPS'),'psd',256],['x.AI',encode('%PDF-1.7'),'pdf',256],['x.AI',encode('%!PS-Adobe-3.0'),'postscript',64],['x.EPS',encode('%!PS-Adobe-3.0'),'postscript',64],['x.PS',encode('%!PS-Adobe-3.0'),'postscript',64],['x.FIGIMPORT',encode('PK'),'package',256]]){
  assert.equal(inspectInput(name,head,100).kind,kind);
  for(const size of [limit*MiB-1,limit*MiB,limit*MiB+1]){
   let reads=0;const file={name,size,slice(start,end){reads++;assert.equal(start,0);assert.equal(end,1024);return new Blob([head]);},arrayBuffer(){throw new Error('Full file must not be read by the size gate');}};
   if(size>limit*MiB)await assert.rejects(()=>preflightFile(file),new RegExp('文件超过 '+limit+' MB'));
   else await preflightFile(file);
   assert.equal(reads,1);
  }
 }
 assert.equal(inspectInput('wrong.PSD',encode('%PDF-1.7'),100).kind,'pdf');
 const head=new Uint8Array(30),view=new DataView(head.buffer);view.setUint32(0,0xc6d3d0c5,true);view.setUint32(4,30,true);view.setUint32(8,20,true);
 assert.equal(inspectInput('binary.ai',head,50).kind,'postscript');assert.throws(()=>inspectInput('bad.eps',head,49),/范围无效/);
 assert.throws(()=>checkFileSize(64*MiB+1,'postscript'),/64 MB/);
 await assert.rejects(()=>preflightFile({name:'x',size:0,slice(){throw new Error('Should not read');}},AbortSignal.abort()),/取消/);
});
const rgba=(w=1,h=1)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4).fill(255)});
const tiny=psb=>writePsd({width:2,height:2,imageData:rgba(2,2),children:[{name:'pixel',imageData:rgba()}]},{psb});
function resizedLayer(bytes,w,h){
 const data=bytes.slice(0),v=new DataView(data);let p=26;
 p+=4+v.getUint32(p);p+=4+v.getUint32(p);const large=v.getUint16(4)===2;p+=large?8:4;p+=large?8:4;p+=2;
 v.setInt32(p+8,h);v.setInt32(p+12,w);return data;
}
const psd=tiny(false),psb=tiny(true),over=resizedLayer(psd,30000,18000),at=resizedLayer(psb,32768,16384);
const masked=writePsd({width:2,height:3,imageData:rgba(2,3),children:[{name:'masked',imageData:rgba(),mask:{left:0,top:0,imageData:rgba(2,3)}}]});
const flat=new ArrayBuffer(52);new Uint8Array(flat).set(new Uint8Array(psd,0,26));new DataView(flat).setUint16(12,3);new Uint8Array(flat,40).fill(255);
const id='11111111-1111-1111-1111-111111111111';
function embedded(data,count=2,assetId=id){return writePsd({width:2,height:2,imageData:rgba(2,2),linkedFiles:[{id:assetId,name:'embedded.psd',data:new Uint8Array(data)}],children:Array.from({length:count},()=>({name:'placed',imageData:rgba(),placedLayer:{id:assetId,type:'raster',width:2,height:2,transform:[0,0,2,0,2,2,0,2]}}))});}
const shared=embedded(psd),embeddedLarge=embedded(over);
const cmyk=psd.slice(0);new DataView(cmyk).setUint16(24,4);const unsupportedEmbedded=embedded(cmyk,1);
let deep=psd;for(let i=0;i<9;i++)deep=embedded(deep,1,'00000000-0000-0000-0000-'+String(i).padStart(12,'0'));
// Any attempt to allocate a canvas/ImageData during preflight fails this suite.
let allocations=0;initializeCanvas(()=>{allocations++;throw new Error('Unexpected pixel decode');},undefined,()=>{allocations++;throw new Error('Unexpected pixel decode');});
await test('PSD/PSB metadata-only estimates, masks, flat documents and bit depth',async()=>{
 assert.equal((await preflightPsd(psd)).decodedBytes,4);assert.equal((await preflightPsd(psb)).decodedBytes,4);
 assert.equal((await preflightPsd(masked)).decodedBytes,28);assert.equal((await preflightPsd(flat)).decodedBytes,16);
 for(const depth of [16,32]){const data=psd.slice(0);new DataView(data).setUint16(22,depth);assert.equal((await preflightPsd(data)).decodedBytes,4*depth/8);}
 assert.equal((await preflightPsd(at)).decodedBytes,2*1024*MiB);
 await assert.rejects(()=>preflightPsd(over),{message:PSD_MEMORY_ERROR});
 const huge=psd.slice(0);new DataView(huge).setUint32(18,100001);await assert.rejects(()=>preflightPsd(huge),{message:PSD_MEMORY_ERROR});
 await assert.rejects(()=>preflightPsd(new ArrayBuffer(4)),/文件头不完整/);
});
await test('Embedded PSD budget, shared asset deduplication, depth and cancellation',async()=>{
 assert.deepEqual(await preflightPsd(shared),{decodedBytes:12,documents:2});
 assert.equal((await preflightPsd(unsupportedEmbedded)).decodedBytes,4,'Unsupported embedded PSD keeps existing saved-appearance fallback');
 await assert.rejects(()=>preflightPsd(embeddedLarge),{message:PSD_MEMORY_ERROR});
 await assert.rejects(()=>preflightPsd(deep),/嵌套超过 8 层/);
 const abort=new AbortController();setTimeout(()=>abort.abort(),0);await assert.rejects(()=>preflightPsd(shared,{signal:abort.signal}),/取消/);
 assert.equal(allocations,0);
});
const diagnostic=(code,status='unsupported',extra={})=>({sourceId:'layer',name:'private layer',code,status,message:'raw details',...extra});
await test('At most three notices; missing content cannot be buried; all node issues included',()=>{
 const d=diagnostic('stroke-miter-limit','unsupported',{strokeAppearance:'unchanged',issues:[{code:'stroke-miter-limit',message:'unchanged'},{code:'missing-content',message:'missing'},{code:'shadow-contour',message:'shadow'}]});
 const notices=summarizeImport([...Array(1000).fill(d),diagnostic('text-fallback','rasterized',{sourceId:'text'}),diagnostic('postscript-font')]);
 assert.deepEqual(notices.map(n=>n.category),['content','text','appearance']);assert.ok(notices.every(n=>!n.message.includes('private layer')));
 assert.match(notices[1].message,/已转为图片/);assert.match(notices[1].message,/原字体缺失，已使用默认字体替代/);
});
await test('No warnings for equivalent strokes; no image/outline/font clause unless applicable',()=>{
 assert.deepEqual(summarizeImport([diagnostic('stroke-miter-limit','editable',{strokeAppearance:'unchanged'})]),[]);
 assert.deepEqual(summarizeImport([diagnostic('created','editable',{message:''})]),[]);
 assert.deepEqual(summarizeImport([diagnostic('native-blend','editable')]),[]);
 assert.deepEqual(summarizeImport([diagnostic('missing-content','unsupported',{recovery:true})]),[]);
 assert.equal(summarizeImport([diagnostic('text-fallback','rasterized')])[0].message,'部分文字已转为图片，请核对字形与排版。');
 assert.equal(summarizeImport([diagnostic('created','outlined-text')])[0].message,'部分文字已转为轮廓，请核对字形与排版。');
 assert.equal(summarizeImport([diagnostic('text-font-substitution','editable')])[0].message,'部分文字使用替代字体，请核对字形与排版。');
 assert.equal(summarizeImport([diagnostic('postscript-font')])[0].message,'EPS/PS 转换时原字体缺失，已使用默认字体替代，请核对字形与排版。');
 assert.deepEqual(summarizeImport([diagnostic('pdf-text-encoding')]),[{category:'text',message:'部分文字编码无法读取，已用替代字符保留可编辑位置，请核对字形与排版。'}]);
 assert.equal(summarizeImport([diagnostic('text-default-font','editable')])[0].message,'部分文字的原字体缺失或无法加载，已使用默认字体替代并保留可编辑文字，请核对字形与排版。');
 assert.equal(summarizeImport([diagnostic('smart-warp','rasterized')]).length,1);
 assert.deepEqual(summarizeImport([diagnostic('missing-linked-content')]).map(n=>n.category),['content']);
 assert.equal(importError(new Error('Exceeded memory limit')),MEMORY_ERROR);assert.equal(importError('导入已取消'),'导入已取消');
});
if(process.env.SAMPLE_DIR){
 const report=[];
 for(const name of ['红包转赠(18.3.21).psd','社区需求.psd','邀新人专享.psd','v1.0.psd']){
  const bytes=await fs.readFile(path.join(process.env.SAMPLE_DIR,name)),data=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),start=Date.now();
  if(name==='v1.0.psd'){await assert.rejects(()=>preflightPsd(data),{message:PSD_MEMORY_ERROR});report.push({name,rejectedBeforeDecode:true,elapsedMs:Date.now()-start});}
  else report.push({name,...await preflightPsd(data),elapsedMs:Date.now()-start});
 }
 assert.equal(allocations,0);await fs.writeFile('.test-output/preflight-samples.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
console.log(checks+' preflight/summary checks passed; '+allocations+' pixel allocations');
