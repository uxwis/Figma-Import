// Private sample regression: never copied to source or sent to a service.
import './setup.mjs';import {build} from 'esbuild';import fs from 'node:fs/promises';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {createCanvas,Path2D} from '@napi-rs/canvas';import {pluginHost} from './plugin-host.mjs';
const sample=process.env.PDF_SEMANTIC_SAMPLE;if(!sample)throw new Error('Set PDF_SEMANTIC_SAMPLE');
const input=await fs.readFile(sample),hash=crypto.createHash('sha256').update(input).digest('hex');
await build({entryPoints:['src/parsers/aiEps.ts','src/builder.ts'],outdir:'.test-output/pdf-semantic-sample',bundle:true,format:'esm',outExtension:{'.js':'.mjs'},platform:'node',packages:'external',logLevel:'silent'});
await build({entryPoints:['src/parsers/aiEps.ts'],outfile:'.test-output/pdf-semantic-baseline.mjs',bundle:true,format:'esm',platform:'node',packages:'external',logLevel:'silent',plugins:[{name:'baseline',setup(b){b.onLoad({filter:/aiEps\.ts$/},async args=>({contents:(await fs.readFile(args.path,'utf8')).replace('semantic.restore(nodes)','nodes'),loader:'ts'}));}}]});
const {parseAIorEPS}=await import('../.test-output/pdf-semantic-sample/parsers/aiEps.mjs'),baseline=await import('../.test-output/pdf-semantic-baseline.mjs'),{buildScene}=await import('../.test-output/pdf-semantic-sample/builder.mjs');
const before=await baseline.parseAIorEPS(Uint8Array.from(input).buffer),after=await parseAIorEPS(Uint8Array.from(input).buffer);
const walk=ns=>ns.flatMap(n=>[n,...walk(n.children||[])]),old=walk(before.nodes),nodes=walk(after.nodes),texts=nodes.filter(n=>n.kind==='text');
assert.equal(texts.length,44);assert.ok(texts.every(t=>t.visible!==false&&t.sourceData.pdfSemanticText?.restored));
assert.equal(new Set(texts.map(t=>t.pdfLayout.tag)).size,44);assert.ok(texts.every(t=>!t.characters.includes('\n\n')));
const removedIds=new Set(texts.flatMap(t=>t.sourceData.pdfSemanticText.outlineIds));
assert.equal(removedIds.size,44);assert.ok(nodes.filter(n=>n.kind==='vector').every(n=>!removedIds.has(n.sourceId)),'Original text outlines must be absent');
assert.equal(after.stats.images,before.stats.images);assert.equal(after.stats.vectors,before.stats.vectors-44);
const expected=new Map(),{getDocument,OPS}=await import('pdfjs-dist/legacy/build/pdf.mjs'),task=getDocument({data:Uint8Array.from(input),disableFontFace:true,fontExtraProperties:true,useSystemFonts:false,verbosity:0});
try{const doc=await task.promise,page=await doc.getPage(1),ops=await page.getOperatorList();const stack=[];for(let i=0;i<ops.fnArray.length;i++){
 const op=ops.fnArray[i],a=ops.argsArray[i];if(op===OPS.beginMarkedContent)stack.push(undefined);else if(op===OPS.beginMarkedContentProps)stack.push(typeof a[1]==='number'?a[1]:undefined);else if(op===OPS.endMarkedContent)stack.pop();
 else if(op===OPS.showText){const id=stack.filter(x=>x!==undefined).at(-1);if(id!==undefined)expected.set('semantic-'+id,(expected.get('semantic-'+id)||'')+a[0].filter(g=>typeof g!=='number').map(g=>g.unicode).join(''));}
 }
 const normalize=s=>s.replace(/\s+/g,' ').replace(/-\s+/g,'-').trim();for(const t of texts)assert.equal(normalize(t.characters),normalize(expected.get(t.pdfLayout.tag)),t.pdfLayout.tag);
}finally{await task.destroy();}
function renderVectors(scene){
 const canvas=createCanvas(scene.width*2,scene.height*2),ctx=canvas.getContext('2d');ctx.scale(2,2);ctx.fillStyle='white';ctx.fillRect(0,0,scene.width,scene.height);
 const visit=ns=>{for(const n of ns){if(n.visible===false)continue;ctx.save();ctx.transform(...(n.transform||[1,0,0,1,n.x||0,n.y||0]));ctx.globalAlpha*=n.opacity??1;
  if(n.kind==='frame'&&n.clip){ctx.beginPath();ctx.rect(0,0,n.width,n.height);ctx.clip();}
  if(n.kind==='vector')for(const p of n.paths||[]){const path=new Path2D(p.data);for(const paint of n.fills||[]){if(paint.type!=='SOLID')continue;const c=paint.color;ctx.fillStyle='rgba('+[c.r*255,c.g*255,c.b*255,(c.a??1)*(paint.opacity??1)].join(',')+')';ctx.fill(path,p.windingRule==='EVENODD'?'evenodd':'nonzero');}
   for(const paint of n.strokes||[]){if(paint.type!=='SOLID')continue;const c=paint.color;ctx.strokeStyle='rgb('+[c.r*255,c.g*255,c.b*255].join(',')+')';ctx.lineWidth=n.strokeWidth||1;ctx.stroke(path);}}
  if(n.children)visit(n.children);ctx.restore();}};visit(scene.nodes);return canvas;
}
const oldCanvas=renderVectors(before),newCanvas=renderVectors(after);
function dark(canvas){const d=canvas.getContext('2d').getImageData(30*2,25*2,470*2,45*2).data;let count=0;for(let i=0;i<d.length;i+=4)if(d[i]<80&&d[i+1]<80&&d[i+2]<80)count++;return count;}
assert.ok(dark(oldCanvas)>5000);assert.equal(dark(newCanvas),0,'No residual title outlines may remain behind native text');
await fs.writeFile('.test-output/industry-vectors-before.png',oldCanvas.toBuffer('image/png'));await fs.writeFile('.test-output/industry-vectors-after.png',newCanvas.toBuffer('image/png'));
globalThis.window={addEventListener(){}};const host=pluginHost({fonts:[{family:'Inter',style:'Regular'}]});globalThis.figma=host.figma;const result=await buildScene(after,'semantic-sample.pdf');
assert.equal(result.nativeStats.texts,44);assert.equal(result.stats.outlinedTexts,0);assert.equal(host.figma.currentPage.findAll(n=>n.type==='TEXT'&&n.visible!==false).length,44);
assert.equal(crypto.createHash('sha256').update(await fs.readFile(sample)).digest('hex'),hash);
const report={scope:'Local source parser and strict node host, vector-only images omit native text/images/complex effects; not the Figma renderer',sha256:hash,before:before.stats,after:after.stats,removedTextOutlineLayers:removedIds.size,restoredGlyphs:texts.reduce((sum,t)=>sum+t.sourceData.pdfSemanticText.glyphs,0),nativeStats:result.nativeStats,titleDarkPixelsBefore:dark(oldCanvas),titleDarkPixelsAfter:dark(newCanvas)};
await fs.writeFile('.test-output/pdf-semantic-sample-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
