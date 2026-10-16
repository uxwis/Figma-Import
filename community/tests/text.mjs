import './setup.mjs';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {writePsd} from 'ag-psd';
import {pluginHost} from './plugin-host.mjs';
import {JSDOM} from 'jsdom';

await build({entryPoints:['src/builder.ts','src/font.ts','src/parsers/index.ts'],outdir:'.test-output/text',bundle:true,format:'esm',outExtension:{'.js':'.mjs'},platform:'node',packages:'external',logLevel:'silent'});
const {buildScene,resolveFont}=await import('../.test-output/text/builder.mjs');
const {parseFontName}=await import('../.test-output/text/font.mjs');
const {parseFile}=await import('../.test-output/text/parsers/index.mjs');
globalThis.window={addEventListener(){}};
globalThis.DOMParser=new JSDOM('').window.DOMParser;
const face=(family,style='Regular')=>({family,style});
const ref=name=>{const f=parseFontName(name);return{candidates:f.candidates,style:f.style,postScriptName:name};};
const fontList=[face('Noto Sans SC'),face('Noto Sans SC','Medium'),face('Noto Sans SC','Bold'),face('DINPro-Medium'),face('DINPro-Regular'),face('Inter'),face('Inter','Medium')];
const rgba={width:4,height:4,data:new Uint8ClampedArray(64).fill(255)};
const source=writePsd({width:200,height:100,children:[{name:'中文标题',left:20,top:30,imageData:rgba,text:{text:'工业大脑',transform:[1,0,0,1,20,40],style:{font:{name:'NotoSansHans-Medium'},fontSize:20,fillColor:{r:1,g:240,b:227}}}}]});
const scene=await parseFile('text.psd',source);
const base=scene.nodes[0];assert.equal(base.kind,'text');assert.ok(base.fallback);
let checks=0;
async function test(name,fn){await fn();checks++;console.log('PASS',name);}
async function run(nodes,options={}){const host=pluginHost({fonts:fontList,...options});globalThis.figma=host.figma;const result=await buildScene({...scene,nodes},'text');return{host,result,texts:host.figma.currentPage.findAll(n=>n.type==='TEXT')};}
await test('PSD 原字体存在时保持原字体，无替代提示',async()=>{
 const {result,texts}=await run([base],{fonts:[face('Noto Sans Hans','Medium')]});
 assert.equal(result.nativeStats.texts,1);assert.equal(result.nativeStats.images,0);assert.equal(result.status,'created');assert.deepEqual(texts[0].fontName,face('Noto Sans Hans','Medium'));
});
await test('NotoSansHans 缺失时创建可编辑中文并记录实际替代字体',async()=>{
 const {result,texts}=await run([base]);
 assert.equal(result.nativeStats.texts,1);assert.equal(result.nativeStats.images,0);assert.equal(result.stats.rasterized,0);assert.equal(result.status,'needs-review');
 assert.equal(texts[0].characters,'工业大脑');assert.deepEqual(texts[0].fontName,face('Noto Sans SC','Medium'));
 assert.equal(texts[0].fontSize,20);assert.equal(texts[0].x,20);assert.ok(Math.abs(texts[0].fills[0].color.g-240/255)<1e-5);
 const data=JSON.parse(texts[0].metadata['import:source-data']);assert.equal(data.fontSubstitutions[0].source.postScriptName,'NotoSansHans-Medium');
 assert.ok(result.diagnostics.some(d=>d.issues?.some(i=>i.code==='text-font-substitution')&&d.nodeId===texts[0].id));
});
await test('DINPro 字重在 family 内仍为精确字体；候选顺序优先于系统列表顺序',()=>{
 assert.deepEqual(resolveFont(ref('DINPro-Medium'),[face('DINPro-Medium')]),face('DINPro-Medium'));
 assert.deepEqual(resolveFont(ref('DINPro-Regular'),[face('DIN Pro')]),face('DIN Pro'));
 assert.deepEqual(resolveFont(ref('DINPro-Regular'),[face('DINPro-Regular')]),face('DINPro-Regular'));
 assert.deepEqual(resolveFont({candidates:['Preferred','Other'],style:'Regular'},[face('Other'),face('Preferred')]),face('Preferred'));
 assert.equal(resolveFont(ref('DINPro-Bold'),[face('DINPro-Medium')]),undefined);
 assert.equal(resolveFont(ref('Avenir-Regular'),[face('Avenir','Book')]),undefined);
 assert.equal(ref('Alibaba-PuHuiTi-M').style,'Medium');
});
await test('替代字体也支持字体族中的字重，不误用 Regular',async()=>{
 const {texts}=await run([base],{fonts:[face('Noto Sans SC'),face('Noto Sans SC Medium')]});
 assert.deepEqual(texts[0].fontName,face('Noto Sans SC Medium'));
});
await test('同层混合字体仅替代缺失区间，保留颜色、字号、字距、行距',async()=>{
 const runs=[{length:1,font:ref('Inter-Regular'),fontSize:12,color:{r:1,g:0,b:0}},{length:1,font:ref('NotoSansHans-Bold'),fontSize:30,tracking:100,leading:40}];
 const {result,texts}=await run([{...base,characters:'A中',font:ref('Inter-Regular'),styleRuns:runs}]);
 assert.equal(result.nativeStats.texts,1);assert.equal(result.nativeStats.images,0);
 const r=texts[0].ranges;assert.deepEqual(r.filter(r=>r.property==='fontName').map(r=>r.value),[face('Inter'),face('Noto Sans SC','Bold')]);
 assert.ok(r.some(r=>r.start===1&&r.end===2&&r.property==='fontSize'&&r.value===30));
 assert.ok(r.some(r=>r.property==='letterSpacing'&&r.value.value===10));assert.ok(r.some(r=>r.property==='lineHeight'&&r.value.value===40));
 assert.equal(JSON.parse(texts[0].metadata['import:source-data']).fontSubstitutions.length,1);
});
await test('失效字体加载失败时选择可加载字体，失败只尝试一次',async()=>{
 const {host,result}=await run([base,{...base,sourceId:'second'}],{failFonts:['Noto Sans SC/Medium']});
 assert.equal(result.nativeStats.texts,2);assert.equal(result.nativeStats.images,0);
 assert.equal(host.fontLoads.filter(f=>f.family==='Noto Sans SC'&&f.style==='Medium').length,1);
});
await test('精确字体加载失败时保留可编辑文字并记录失败原因，无缓存也能导入',async()=>{
 const {texts,result}=await run([{...base,characters:'ABCD',font:ref('Inter-Regular'),fallback:undefined}],{failFonts:['Inter/Regular']});
 assert.equal(result.nativeStats.texts,1);assert.equal(result.nativeStats.images,0);
 assert.equal(JSON.parse(texts[0].metadata['import:source-data']).fontSubstitutions[0].reason,'font-load-failed');
});
await test('忽略文字末尾以外的样式区间，缺字重时保留可编辑文本',async()=>{
 const {result,texts}=await run([{...base,font:ref('Inter-Medium'),styleRuns:[{length:4,font:ref('Inter-Medium')},{length:1,font:ref('Missing-Regular')}]}],{fonts:[face('Inter')]});
 assert.equal(result.nativeStats.texts,1);assert.deepEqual(texts[0].fontName,face('Inter'));
});
await test('无任何可用字体、竖排、非等比变换仍诚实保留原始外观',async()=>{
 for(const [node,options] of [[base,{fonts:[]}],[{...base,issues:[{code:'text-warp',message:'vertical'}]},{}],[{...base,transform:[2,0,0,1,20,40]},{}]]){
  const {result}=await run([node],options);assert.equal(result.nativeStats.texts,0);assert.equal(result.nativeStats.images,1);assert.equal(result.stats.rasterized,1);
 }
});
await test('PDF 缺字体时使用默认字体保留可编辑文字',async()=>{
 const {result,texts}=await run([{...base,sourceType:'pdf-text',fallback:{kind:'vector',name:'outline',x:0,y:0,width:10,height:10,paths:[{data:'M0 0H10V10Z',windingRule:'NONZERO'}]}}]);
 assert.equal(result.nativeStats.texts,1);assert.equal(result.stats.outlinedTexts,0);assert.equal(result.nativeStats.images,0);assert.deepEqual(texts[0].fontName,face('Inter'));
});
if(process.env.PSD_TEXT_SAMPLE){
 const input=await fs.readFile(process.env.PSD_TEXT_SAMPLE),sample=await parseFile(path.basename(process.env.PSD_TEXT_SAMPLE),input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength));
 const host=pluginHost({fonts:fontList});globalThis.figma=host.figma;const result=await buildScene(sample,'private PSD');
 const texts=host.figma.currentPage.findAll(n=>n.type==='TEXT');
 assert.equal(sample.stats.texts,148);assert.equal(result.nativeStats.texts,148);assert.equal(texts.length,148);
 assert.equal(result.diagnostics.filter(d=>/^text-(fallback|transform)$/.test(d.code)).length,0);
 const substitutions=result.diagnostics.filter(d=>d.issues?.some(i=>i.code==='text-font-substitution')).length;
 const report={scope:'Local PSD parser + strict Plugin API harness; no Figma visual validation',topLevelSourceTexts:145,embeddedSourceTexts:3,parsedTexts:sample.stats.texts,editableTexts:result.nativeStats.texts,textRasterFallbacks:0,substitutions,stats:result.stats,nativeStats:result.nativeStats};
 await fs.writeFile('.test-output/text-sample-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
console.log(checks+' text checks passed');
