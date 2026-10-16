import './setup.mjs';import {build} from 'esbuild';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {semanticPdf} from './semantic-fixture.mjs';import {pluginHost} from './plugin-host.mjs';
await build({entryPoints:['src/parsers/aiEps.ts','src/builder.ts','src/import-summary.ts'],outdir:'.test-output/pdf-semantic',bundle:true,format:'esm',outExtension:{'.js':'.mjs'},platform:'node',packages:'external',logLevel:'silent'});
const {parseAIorEPS}=await import('../.test-output/pdf-semantic/parsers/aiEps.mjs');const {buildScene}=await import('../.test-output/pdf-semantic/builder.mjs');const {summarizeImport}=await import('../.test-output/pdf-semantic/import-summary.mjs');
const walk=ns=>ns.flatMap(n=>[n,...walk(n.children||[])]);globalThis.window={addEventListener(){}};let checks=0;
async function test(name,fn){await fn();checks++;console.log('PASS',name);}
await test('空 Type3 语义文字替换 Artifact 中的对应轮廓，原位保留颜色并保护覆盖文字的装饰',async()=>{
 const scene=await parseAIorEPS(semanticPdf()),nodes=walk(scene.nodes),text=nodes.filter(n=>n.kind==='text'),vectors=nodes.filter(n=>n.kind==='vector');
 assert.equal(text.length,1);assert.equal(text[0].characters,'AB');assert.equal(text[0].visible,true);assert.equal(text[0].sourceData.pdfSemanticText.glyphs,2);
 assert.equal(vectors.length,1);assert.equal(vectors[0].fills[0].color.r,1);assert.ok(Math.abs(text[0].pdfTextPaints.fills[0].color.g-.2)<.01);
 const host=pluginHost({fonts:[{family:'Inter',style:'Regular'}]});globalThis.figma=host.figma;const result=await buildScene(scene,'semantic.pdf');
 assert.equal(result.nativeStats.texts,1);assert.equal(result.stats.outlinedTexts,0);assert.equal(host.figma.currentPage.findAll(n=>n.type==='TEXT')[0].fills[0].color.b,text[0].pdfTextPaints.fills[0].color.b);
 assert.match(summarizeImport(result.diagnostics).find(n=>n.category==='text').message,/默认字体替代并保留可编辑文字/);
 await fs.writeFile('.test-output/semantic-fixture.pdf',Buffer.from(semanticPdf()));
});
await test('缺少完整轮廓时不暴露空字形文字造成重影，并明确提示隐藏的可编辑文字',async()=>{
 const scene=await parseAIorEPS(semanticPdf({partial:true,decor:false})),nodes=walk(scene.nodes);assert.equal(nodes.filter(n=>n.kind==='vector').length,1);assert.equal(nodes.find(n=>n.kind==='text').visible,false);
 assert.match(summarizeImport(scene.diagnostics).find(n=>n.category==='text').message,/可编辑文字暂时隐藏/);
});
await test('无 Artifact 标记或非空 Type3 字形均不做语义轮廓替换',async()=>{
 for(const options of [{artifact:false},{tagged:false},{paintingFont:true}]){const scene=await parseAIorEPS(semanticPdf(options));assert.ok(walk(scene.nodes).filter(n=>n.kind==='vector').length>=2);assert.ok(walk(scene.nodes).filter(n=>n.kind==='text').every(n=>!n.sourceData?.pdfSemanticText));}
});
await test('段落自带换行不再额外插入第二个换行',async()=>{
 const fixture=semanticPdf({newlines:true,decor:false});const scene=await parseAIorEPS(fixture),texts=walk(scene.nodes).filter(n=>n.kind==='text');assert.equal(texts.length,1);assert.equal(texts[0].characters,'AB\nAB');assert.equal(texts[0].leading,25);assert.equal(scene.stats.vectors,0);
});
console.log(checks+' semantic PDF checks passed');
