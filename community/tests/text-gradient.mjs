import './setup.mjs';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {writePsd} from 'ag-psd';
import {JSDOM} from 'jsdom';
import {pluginHost} from './plugin-host.mjs';
await build({entryPoints:['src/builder.ts','src/parsers/index.ts','src/scene.ts'],outdir:'.test-output/text-gradient',bundle:true,format:'esm',outExtension:{'.js':'.mjs'},platform:'node',packages:'external',logLevel:'silent'});
const {buildScene}=await import('../.test-output/text-gradient/builder.mjs');
const {parseFile}=await import('../.test-output/text-gradient/parsers/index.mjs');
const {multiply,inverse,translateNodes}=await import('../.test-output/text-gradient/scene.mjs');
globalThis.window={addEventListener(){}};globalThis.DOMParser=new JSDOM('').window.DOMParser;
const fonts=[{family:'Noto Sans SC',style:'Medium'},{family:'Noto Sans SC',style:'Bold'},{family:'Inter',style:'Regular'}];
const rgba={width:40,height:12,data:new Uint8ClampedArray(40*12*4).fill(255)};
const effect={enabled:true,blendMode:'normal',opacity:1,align:true,type:'linear',angle:90,scale:1,offset:{x:0,y:0},gradient:{type:'solid',name:'gradient',smoothness:1,colorStops:[{location:0,midpoint:.5,color:{r:255,g:0,b:0}},{location:1,midpoint:.5,color:{r:0,g:0,b:255}}],opacityStops:[{location:0,midpoint:.5,opacity:1},{location:1,midpoint:.5,opacity:1}]}};
async function fixture(fx=effect,text={},layer={}){
 const bytes=writePsd({width:300,height:200,children:[{name:'渐变标题',left:90,top:70,imageData:rgba,fillOpacity:.4,opacity:.8,
  text:{text:'渐变标题',transform:[1,0,0,1,90,80],style:{font:{name:'NotoSansHans-Medium'},fontSize:24,fillColor:{r:0,g:255,b:0}},...text},effects:{gradientOverlay:[fx]},...layer}]});
 return parseFile('gradient.psd',bytes);
}
function walk(ns,out=[]){for(const n of ns){out.push(n);if(n.children)walk(n.children,out);if(n.kind==='mask')walk([n.mask],out);}return out;}
async function run(scene,options={}){const host=pluginHost({fonts,...options});globalThis.figma=host.figma;const result=await buildScene(scene,'gradient');return{host,result,texts:host.figma.currentPage.findAll(n=>n.type==='TEXT')};}
const m=t=>[t[0][0],t[1][0],t[0][1],t[1][1],t[0][2],t[1][2]];
const pt=(m,p)=>[m[0]*p[0]+m[2]*p[1]+m[4],m[1]*p[0]+m[3]*p[1]+m[5]];
let checks=0;async function test(name,fn){await fn();checks++;console.log('PASS',name);}
await test('真实 PSD 渐变文字保持 TEXT 和原生填充，无缓存蒙版/叠加矩形',async()=>{
 const scene=await fixture(),node=scene.nodes[0];assert.equal(node.kind,'text');assert.ok(node.textOverlay);
 assert.equal(scene.stats.masks,0);assert.equal(scene.stats.images,0);assert.equal(scene.stats.vectors,0);
 const {result,texts,host}=await run(scene);assert.equal(result.nativeStats.texts,1);assert.equal(result.nativeStats.images,0);assert.equal(result.nativeStats.masks,0);assert.equal(result.nativeStats.vectors,0);
 assert.equal(texts[0].characters,'渐变标题');assert.equal(texts[0].fontSize,24);assert.equal(texts[0].fills.length,1);assert.equal(texts[0].fills[0].type,'GRADIENT_LINEAR');assert.equal(texts[0].fills[0].opacity,1,'Layer fill opacity must not dim an opaque layer effect');
 assert.ok(Math.abs(texts[0].opacity-.8)<.01);assert.equal(texts[0].metadata['import:text-overlay'],'native-text-fills');
 texts[0].characters='编辑后的标题';assert.equal(texts[0].fills[0].type,'GRADIENT_LINEAR');assert.equal(host.figma.currentPage.findAll(n=>n.type==='TEXT').length,1);
});
await test('混合字体和字号保留，渐变覆盖原区间颜色并统一作用于整段文字',async()=>{
 const scene=await fixture(effect,{text:'A中',styleRuns:[{length:1,style:{font:{name:'Inter-Regular'},fontSize:12,fillColor:{r:255,g:0,b:0}}},{length:1,style:{font:{name:'NotoSansHans-Bold'},fontSize:30,fillColor:{r:0,g:255,b:0},tracking:100,autoLeading:false,leading:40}}]});
 const {texts}=await run(scene),t=texts[0];assert.ok(t.ranges.some(r=>r.property==='fontName'&&r.value.family==='Inter'));assert.ok(t.ranges.some(r=>r.property==='fontSize'&&r.value===30));
 const last=t.ranges.filter(r=>r.property==='fills').at(-1);assert.equal(last.start,0);assert.equal(last.end,2);assert.deepEqual(last.value,t.fills);assert.equal(last.value[0].type,'GRADIENT_LINEAR');
});
await test('透明渐变和效果透明度保留，底层不同区间颜色继续可见',async()=>{
 const fx={...effect,opacity:.5,gradient:{...effect.gradient,opacityStops:[{location:0,midpoint:.5,opacity:0},{location:1,midpoint:.5,opacity:1}]}};
 const scene=await fixture(fx,{text:'AB',styleRuns:[{length:1,style:{fillColor:{r:255,g:0,b:0}}},{length:1,style:{fillColor:{r:0,g:0,b:255}}}]});
 const {result,texts}=await run(scene),t=texts[0];assert.equal(result.nativeStats.images,0);assert.equal(t.fills.length,2);assert.equal(t.fills[0].opacity,.5);assert.equal(t.fills[0].gradientStops[0].color.a,0);
 const ranges=t.ranges.filter(r=>r.property==='fills'&&r.end-r.start===1).slice(-2);assert.equal(ranges.length,2);assert.ok(ranges.every(r=>r.value[0].type==='GRADIENT_LINEAR'));assert.equal(ranges[0].value[1].color.r,1);assert.equal(ranges[1].value[1].color.b,1);
});
await test('画板移动、父组缩放/旋转和原生文字位置保持同一渐变坐标',async()=>{
 const scene=await fixture({...effect,angle:112,offset:{x:.1,y:-.15}}),node=scene.nodes[0];translateNodes([node],-50,-30);assert.deepEqual(node.textOverlay.reference,[1,0,0,1,40,40]);
 const sourcePoint=[10,4],expected=pt(node.textOverlay.paints[0].transform,sourcePoint),parentMatrix=[0,2,-2,0,180,10];
 scene.nodes=[{kind:'group',name:'旋转缩放组',transform:parentMatrix,children:[node]}];const {texts,host}=await run(scene),t=texts[0],root=host.figma.currentPage.children[0];
 const reference=multiply(m(root.absoluteTransform),multiply(parentMatrix,node.textOverlay.reference)),absolute=pt(reference,sourcePoint),local=pt(inverse(m(t.absoluteTransform)),absolute),actual=pt(m(t.fills[0].gradientTransform),[local[0]/t.width,local[1]/t.height]);
 actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-8));
});
await test('多行和文本框仍为单一可编辑渐变 TEXT',async()=>{
 const scene=await fixture({...effect,align:false},{text:'第一行\r第二行',shapeType:'box',boxBounds:[0,-20,120,60]});const {texts,result}=await run(scene);
 assert.equal(result.nativeStats.texts,1);assert.equal(result.nativeStats.images,0);assert.equal(texts[0].characters,'第一行\n第二行');assert.equal(texts[0].textAutoResize,'HEIGHT');assert.equal(texts[0].width,120);assert.equal(texts[0].fills[0].type,'GRADIENT_LINEAR');
});
await test('文字填充为零时，仍测量字形墨迹定位并保留可见渐变效果',async()=>{
 const scene=await fixture(effect,{}, {fillOpacity:0}),host=pluginHost({fonts});globalThis.figma=host.figma;
 const create=host.figma.createText;let measurements=0;
 host.figma.createText=()=>{const t=create();Object.defineProperty(t,'absoluteRenderBounds',{get(){if(!(this.fills||[]).some(p=>(p.opacity??1)>0))return null;measurements++;const a=this.absoluteTransform;return{x:a[0][2]+2,y:a[1][2]-4,width:this.width,height:this.height};}});return t;};
 const result=await buildScene(scene,'zero fill'),t=host.figma.currentPage.findAll(n=>n.type==='TEXT')[0];
 assert.ok(measurements>0);assert.equal(t.x,88);assert.equal(t.y,74);assert.equal(t.fills[0].type,'GRADIENT_LINEAR');assert.equal(t.fills[0].opacity,1);assert.equal(result.nativeStats.images,0);
});
await test('无任何可加载字体或非等比变换时明确回退并保留渐变外观',async()=>{
 for(const [scene,options] of [[await fixture(),{fonts:[]}],[await fixture(effect,{transform:[2,0,0,1,90,80]}),{}]]){
  const {result,host}=await run(scene,options);assert.equal(result.nativeStats.texts,0);assert.ok(result.nativeStats.images>0);assert.ok(result.diagnostics.some(d=>d.status==='rasterized'));
  assert.ok(host.figma.currentPage.findAll(n=>(n.fills||[]).some(p=>p.type==='GRADIENT_LINEAR')).length>0);
 }
});
if(process.env.PSD_TEXT_SAMPLE){
 const input=await fs.readFile(process.env.PSD_TEXT_SAMPLE),scene=await parseFile(path.basename(process.env.PSD_TEXT_SAMPLE),input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength)),source=walk(scene.nodes).filter(n=>n.kind==='text'&&n.textOverlay);
 const {result,texts}=await run(scene,{fonts:[...fonts,{family:'Noto Sans SC',style:'Regular'},{family:'DINPro-Medium',style:'Regular'},{family:'DINPro-Regular',style:'Regular'}]});
 const gradients=texts.filter(t=>t.metadata['import:text-overlay']);assert.equal(source.length,6);assert.equal(gradients.length,6);
 assert.ok(gradients.every(t=>t.fills[0].type==='GRADIENT_LINEAR'&&!t.children.length&&!t.isMask));assert.equal(result.nativeStats.texts,148);assert.equal(result.nativeStats.images,20);assert.equal(result.nativeStats.masks,10);
 const report={scope:'Local PSD + strict native node harness; not Figma visual validation',editableGradientTexts:gradients.length,gradientTextImageFills:0,stats:result.stats,nativeStats:result.nativeStats};await fs.writeFile('.test-output/text-gradient-sample-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
console.log(checks+' gradient text checks passed');
