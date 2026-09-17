import './setup.mjs';import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {build} from 'esbuild';
await build({entryPoints:['src/parsers/index.ts'],outfile:'.test-output/parser.mjs',bundle:true,format:'esm',platform:'node',packages:'external',logLevel:'silent'});
const {parseFile}=await import('../.test-output/parser.mjs');
await build({entryPoints:['src/stroke.ts','src/affine.ts'],outdir:'.test-output/stroke',bundle:true,format:'esm',outExtension:{'.js':'.mjs'},platform:'node',packages:'external',logLevel:'silent'});
const {nativeStroke}=await import('../.test-output/stroke/stroke.mjs');
const {bakeVector,nodeMatrix}=await import('../.test-output/stroke/affine.mjs');
const dir=process.env.SAMPLE_DIR;if(!dir)throw new Error('Set SAMPLE_DIR to your private test folder.');
const output=[];
function walk(ns,out=[]){for(const n of ns){out.push(n);if(n.kind==='mask')walk([n.mask],out);if(n.children)walk(n.children,out);}return out;}
for(const [name,count,smart,boards]of [['dribbble-1.psd',5,5,1],['社区需求.psd',214,12,10]]){
 if(!fs.existsSync(path.join(dir,name))){console.log('SKIP private sample',name);continue;}
 const input=fs.readFileSync(path.join(dir,name));const start=Date.now();
 const scene=await parseFile(name,input.buffer.slice(input.byteOffset,input.byteOffset+input.length));
 const flat=walk(scene.nodes),shapes=flat.filter(n=>n.sourceType==='psd-shape'&&!n.sourceId?.includes('clip-mask')&&!n.sourceId?.includes('/asset/'));
 const ids=new Set(shapes.map(n=>n.sourceId));assert.equal(ids.size,count,name+' unique native shapes');
 assert.equal(flat.filter(n=>n.sourceType==='vector-smart-object'&&!n.sourceId?.includes('/asset/')).length,smart,name+' smart vectors');
 assert.equal(scene.stats.artboards,boards,name+' artboards');
 const issues=scene.diagnostics.filter(d=>d.status==='unsupported'||d.status==='rasterized');
 const strokeLimits=[];
 function verifyStrokes(nodes,parent=[1,0,0,1,0,0]){for(const n of nodes){
  if(n.kind==='vector'&&n.paths?.length){const converted=nativeStroke(bakeVector(n,parent));if(converted.miterLimit!==undefined)assert.ok(Number.isFinite(converted.miterLimit)&&converted.miterLimit>=1&&converted.miterLimit<=16);
   if(converted.sourceData?.strokeMiterLimit)strokeLimits.push({sourceId:n.sourceId,...converted.sourceData.strokeMiterLimit});}
  if(n.children){let matrix=nodeMatrix(n,parent);if(n.kind==='frame')matrix=[Math.hypot(matrix[0],matrix[1]),0,0,Math.hypot(matrix[2],matrix[3]),0,0];
   if(n.mask)verifyStrokes([n.mask],matrix);verifyStrokes(n.children,matrix);}
 }}
 verifyStrokes(scene.nodes);
 const report={name,elapsedMs:Date.now()-start,shapeCount:ids.size,stats:scene.stats,strokeLimits:{adapted:strokeLimits.length,unchanged:strokeLimits.filter(s=>s.appearance==='unchanged').length,needsReview:strokeLimits.filter(s=>s.appearance==='needs-review').length},issues:issues.reduce((a,d)=>(a[d.code]=(a[d.code]||0)+1,a),{})};
 output.push(report);console.log(JSON.stringify(report,null,2));
 fs.writeFileSync('.test-output/'+name+'.scene.json',JSON.stringify(scene,(k,v)=>v instanceof Uint8Array?{base64:Buffer.from(v).toString('base64')}:v));
}
fs.writeFileSync('.test-output/sample-report.json',JSON.stringify(output,null,2));



