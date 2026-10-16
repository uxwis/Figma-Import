// Private inputs stay outside source/package files. No Figma or network upload.
import './setup.mjs';import {build} from 'esbuild';import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {performance} from 'node:perf_hooks';
import {createCanvas,Path2D} from '@napi-rs/canvas';import {pluginHost} from './plugin-host.mjs';
const sample=process.env.AI_PERF_SAMPLE;if(!sample){console.log('SKIP AI_PERF_SAMPLE private sample');process.exit(0);}
await build({entryPoints:['src/parsers/aiEps.ts','src/builder.ts'],outdir:'.test-output/ai-performance',bundle:true,format:'esm',outExtension:{'.js':'.mjs'},platform:'node',packages:'external',logLevel:'silent'});
const {parseAIorEPS}=await import('../.test-output/ai-performance/parsers/aiEps.mjs');const {buildScene}=await import('../.test-output/ai-performance/builder.mjs');
globalThis.window={addEventListener(){}};const input=await fs.readFile(sample),face={family:'Inter',style:'Regular'};
const walk=nodes=>nodes.flatMap(n=>[n,...walk(n.children||[]),...n.mask?walk([n.mask]):[]]);
function render(scene){
 const canvas=createCanvas(scene.width,scene.height),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
 const matrix=n=>n.transform||[1,0,0,1,n.x||0,n.y||0];
 const inverse=m=>{const d=m[0]*m[3]-m[1]*m[2];return[m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d];};
 function paint(p){
  if(p.type==='SOLID'){const c=p.color||{r:0,g:0,b:0};return 'rgba('+[c.r*255,c.g*255,c.b*255,c.a??1].join(',')+')';}
  ctx.save();ctx.transform(...inverse(p.transform||[1,0,0,1,0,0]));
  const gradient=p.type==='GRADIENT_RADIAL'?ctx.createRadialGradient(.5,.5,0,.5,.5,.5):ctx.createLinearGradient(0,.5,1,.5);
  for(const stop of p.stops||[])gradient.addColorStop(stop.position,paint({type:'SOLID',color:stop.color}));ctx.restore();return gradient;
 }
 function visit(nodes){for(const n of nodes){if(n.visible===false)continue;ctx.save();ctx.globalAlpha*=n.opacity??1;
  if(n.kind==='mask'){
   const m=matrix(n.mask);ctx.transform(...m);for(const p of n.mask.paths||[])ctx.clip(new Path2D(p.data),p.windingRule==='EVENODD'?'evenodd':'nonzero');ctx.transform(...inverse(m));visit(n.children);
  }else{ctx.transform(...matrix(n));
   if(n.kind==='frame'&&n.clip){ctx.beginPath();ctx.rect(0,0,n.width,n.height);ctx.clip();}
   if(n.kind==='vector')for(const part of n.paths||[]){const shape=new Path2D(part.data);
    for(const p of n.fills||[]){ctx.save();ctx.globalAlpha*=p.opacity??1;ctx.fillStyle=paint(p);ctx.fill(shape,part.windingRule==='EVENODD'?'evenodd':'nonzero');ctx.restore();}
    for(const p of n.strokes||[]){ctx.save();ctx.globalAlpha*=p.opacity??1;ctx.strokeStyle=paint(p);ctx.lineWidth=n.strokeWidth??1;ctx.lineJoin=(n.strokeJoin||'MITER').toLowerCase();ctx.miterLimit=n.miterLimit??10;ctx.setLineDash(n.dashPattern||[]);ctx.stroke(shape);ctx.restore();}
   }
   if(n.children)visit(n.children);
  }ctx.restore();}}
 visit(scene.nodes);return{canvas,pixels:ctx.getImageData(0,0,canvas.width,canvas.height).data};
}
const report={scope:'Local parser + approximate Plugin API host; vector pixel comparison omits text; not a Figma renderer',name:path.basename(sample),bytes:input.length,cases:[]};
const scenes=[];
for(const batchPaths of [false,true]){
 const start=performance.now(),scene=await parseAIorEPS(Uint8Array.from(input).buffer,undefined,{batchPaths}),parsed=performance.now();
 const host=pluginHost({fonts:[face]});globalThis.figma=host.figma;const result=await buildScene(scene,path.basename(sample));
 report.cases.push({batched:batchPaths,parseMs:Math.round(parsed-start),buildMs:Math.round(performance.now()-parsed),sceneBytes:JSON.stringify(scene).length,stats:result.nativeStats,outlined:result.stats.outlinedTexts,
  texts:host.figma.currentPage.findAll(n=>n.type==='TEXT').map(n=>n.characters),batchSourceCount:walk(scene.nodes).reduce((sum,n)=>sum+(n.sourceData?.pdfBatch?.count||0),0)});scenes.push(scene);
}
const [before,after]=report.cases;assert.deepEqual(after.texts,before.texts);assert.equal(after.stats.masks,before.stats.masks);assert.equal(after.outlined,0);assert.ok(after.stats.vectors<before.stats.vectors);
const reference=render(scenes[0]),optimized=render(scenes[1]);let sum=0,max=0,changed=0;
for(let i=0;i<reference.pixels.length;i++){const delta=Math.abs(reference.pixels[i]-optimized.pixels[i]);sum+=delta;max=Math.max(max,delta);if(delta)changed++;}
report.vectorPixels={meanAbsoluteDifference:sum/reference.pixels.length,maxDifference:max,changedChannels:changed};
assert.ok(report.vectorPixels.meanAbsoluteDifference<.02&&max<=8,'Vector rendering differs: '+JSON.stringify(report.vectorPixels));
await fs.writeFile('.test-output/ai-vectors-reference.png',reference.canvas.toBuffer('image/png'));await fs.writeFile('.test-output/ai-vectors-optimized.png',optimized.canvas.toBuffer('image/png'));
await fs.writeFile('.test-output/ai-performance-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
