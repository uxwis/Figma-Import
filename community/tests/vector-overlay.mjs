import './setup.mjs';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {JSDOM} from 'jsdom';
import {writePsd} from 'ag-psd';
import {pluginHost} from './plugin-host.mjs';

await build({entryPoints:['src/builder.ts','src/parsers/index.ts','src/parsers/svgViewport.ts','src/scene.ts'],outdir:'.test-output/vector-overlay',bundle:true,format:'esm',outExtension:{'.js':'.mjs'},platform:'node',packages:'external',logLevel:'silent'});
const {buildScene,applyVectorOverlay}=await import('../.test-output/vector-overlay/builder.mjs');
const {parseFile}=await import('../.test-output/vector-overlay/parsers/index.mjs');
const {multiply,inverse,translateNodes}=await import('../.test-output/vector-overlay/scene.mjs');
const {normalizeSvgViewport}=await import('../.test-output/vector-overlay/parsers/svgViewport.mjs');
globalThis.window={addEventListener(){}};globalThis.DOMParser=new JSDOM('').window.DOMParser;
const matrix=t=>[t[0][0],t[1][0],t[0][1],t[1][1],t[0][2],t[1][2]];
const pt=(m,p)=>[m[0]*p[0]+m[2]*p[1]+m[4],m[1]*p[0]+m[3]*p[1]+m[5]];
const near=(a,b)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-8,`${v} != ${b[i]}`));
const id='11111111-1111-1111-1111-111111111111';
const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path fill="#000" fill-rule="evenodd" d="M0 0H40V40H0Z M10 10V30H30V10Z"/><path fill="#fff" d="M2 2H8V8H2Z"/></svg>';
const rgba={width:4,height:4,data:new Uint8ClampedArray(64).fill(255)};
const pure={solidFill:[{enabled:true,blendMode:'normal',opacity:1,color:{r:255,g:0,b:0}}]};
const gradient={gradientOverlay:[{enabled:true,blendMode:'normal',opacity:1,align:true,type:'linear',angle:112,scale:1,offset:{x:.1,y:-.2},gradient:{type:'solid',name:'test',smoothness:1,colorStops:[{location:0,midpoint:.5,color:{r:255,g:0,b:0}},{location:1,midpoint:.5,color:{r:0,g:0,b:255}}],opacityStops:[{location:0,midpoint:.5,opacity:1},{location:1,midpoint:.5,opacity:1}]}}]};
async function fixture(effects,content=svg){const data=writePsd({width:200,height:160,linkedFiles:[{id,name:'icon.svg',type:'SVG',data:new TextEncoder().encode(content)}],children:[{name:'icon',left:100,top:60,imageData:rgba,effects,placedLayer:{id,type:'vector',width:40,height:40,transform:[100,60,140,60,140,100,100,100]}}]});return parseFile('icon.psd',data);}
function walk(ns,out=[]){for(const n of ns){out.push(n);if(n.children)walk(n.children,out);if(n.kind==='mask')walk([n.mask],out);}return out;}
let checks=0;async function test(name,fn){await fn();checks++;console.log('PASS',name);}
await test('真实 PSD 编解码：纯色和渐变直接附于原始 SVG，无缓存资源和蒙版',async()=>{
 for(const effects of [pure,gradient]){
  const scene=await fixture(effects),smart=scene.nodes[0];
  assert.equal(smart.sourceType,'vector-smart-object');assert.ok(smart.vectorOverlay);assert.ok(smart.children[0].svg.includes('M10 10V30H30V10Z'));
  assert.equal(scene.stats.images,0);assert.equal(scene.stats.masks,0);assert.deepEqual(Object.keys(scene.resources),[]);
  const host=pluginHost();globalThis.figma=host.figma;host.figma.createImage=()=>{throw new Error('Vector import must not create an image');};
  const result=await buildScene(scene,'icon'),leaves=host.figma.currentPage.findAll(n=>n.type==='VECTOR');
  assert.equal(result.nativeStats.images,0);assert.equal(result.nativeStats.masks,0);assert.equal(leaves.length,2);
  assert.ok(leaves.every(n=>n.vectorPaths.length>0&&n.fills[0].type===(effects===pure?'SOLID':'GRADIENT_LINEAR')));
 }
});
await test('不同子路径、旋转/缩放/倾斜和画板偏移保持同一全局渐变',()=>{
 const host=pluginHost();globalThis.figma=host.figma;const parent=host.figma.createFrame();parent.x=250;parent.y=70;
 const root=host.figma.createFrame();parent.appendChild(root);root.relativeTransform=[[1,0,3],[0,1,4]];
 const shapes=[];for(const [w,h,t] of [[30,20,[[2,.2,5],[.1,.9,10]]],[15,24,[[.9,0,75],[0,1.1,8]]]]){
  const n=host.figma.createVector();root.appendChild(n);n.resize(w,h);n.relativeTransform=t;n.fills=[{type:'SOLID',color:{r:0,g:0,b:0},opacity:1}];shapes.push(n);
 }
 const parentMatrix=[.8,.3,.15,1.2,24,30],reference=[1,0,0,1,100,60],g=[.02,.003,-.006,.03,.2,-.1];
 applyVectorOverlay(root,{reference,paints:[{type:'GRADIENT_LINEAR',transform:g,stops:[{position:0,color:{r:1,g:0,b:0,a:1}},{position:1,color:{r:0,g:0,b:1,a:1}}]}]},parent,parentMatrix);
 const absoluteReference=multiply(matrix(parent.absoluteTransform),multiply(parentMatrix,reference));
 for(const p of [[10,15],[30,5]]){
  const absolute=pt(absoluteReference,p),expected=pt(g,p);
  for(const shape of shapes){const local=pt(inverse(matrix(shape.absoluteTransform)),absolute);near(pt(matrix(shape.fills[0].gradientTransform),[local[0]/shape.width,local[1]/shape.height]),expected);}
 }
});
await test('填充和描边保留透明度、空心轮廓及几何，不生成遮罩矩形',()=>{
 const host=pluginHost(),root=host.figma.createFrame(),shape=host.figma.createVector();root.appendChild(shape);
 shape.vectorPaths=[{data:'M0 0H20V20H0Z M5 5V15H15V5Z',windingRule:'EVENODD'}];
 shape.fills=[];shape.strokes=[{type:'SOLID',color:{r:0,g:0,b:0},opacity:.25}];shape.strokeWeight=3;shape.opacity=.6;
 const geometry=JSON.stringify({paths:shape.vectorPaths,transform:shape.relativeTransform,width:shape.width,height:shape.height});
 applyVectorOverlay(root,{reference:[1,0,0,1,0,0],paints:[{type:'SOLID',color:{r:0,g:1,b:0},opacity:1}]},host.figma.currentPage,[1,0,0,1,0,0]);
 assert.deepEqual(shape.fills,[]);assert.equal(shape.strokes[0].opacity,.25);assert.equal(shape.strokes[0].color.g,1);assert.equal(shape.strokeWeight,3);assert.equal(shape.opacity,.6);
 assert.equal(JSON.stringify({paths:shape.vectorPaths,transform:shape.relativeTransform,width:shape.width,height:shape.height}),geometry);assert.equal(root.children.length,1);
});
await test('画板平移同步效果参考坐标，保留叠加填充自身参数',()=>{
 const n={kind:'group',name:'smart',transform:[2,0,0,2,100,60],children:[],vectorOverlay:{reference:[1,0,0,1,100,60],paints:[{type:'GRADIENT_LINEAR',transform:[.1,0,0,.1,0,0]}]}};
 translateNodes([n],-80,-30);assert.deepEqual(n.vectorOverlay.reference,[1,0,0,1,20,30]);assert.deepEqual(n.vectorOverlay.paints[0].transform,[.1,0,0,.1,0,0]);
});
await test('图形在 viewBox 外时按 PSD 佐证的绘图区恢复，保留描边和曲线',()=>{
 const shape='<svg viewBox="0 0 24 24"><style>.line{fill:none;stroke:black;stroke-width:2;stroke-linejoin:round}</style><path class="line" d="M40 0H50V20H40Z"/></svg>';
 const normalized=normalizeSvgViewport(shape,12,22);assert.ok(normalized.adjusted);assert.match(normalized.svg,/viewBox="39 -1 12 22"/);assert.ok(normalized.svg.includes('M40 0H50V20H40Z'));
 const decimal='<svg viewBox="0 0 24 24"><rect x="38.9" y="0.9" width="24" height="24"/></svg>';
 assert.match(normalizeSvgViewport(decimal,25,25).svg,/viewBox="38 0 25 25"/);
 assert.equal(normalizeSvgViewport(shape,90,90).adjusted,false,'Do not guess a crop when saved dimensions disagree');
 assert.equal(normalizeSvgViewport(svg,40,40).svg,svg,'Preserve existing canvas margins for valid SVG');
 assert.equal(normalizeSvgViewport(shape.replace('<svg ','<svg width="24" height="24" '),12,22).adjusted,false);
});
await test('统计检查真实 IMAGE 填充，SVG 中的图片不计为可编辑矢量',async()=>{
 const host=pluginHost();globalThis.figma=host.figma;
 host.figma.createNodeFromSvg=()=>{const frame=host.figma.createFrame(),leaf=host.figma.createVector();frame.appendChild(leaf);leaf.fills=[{type:'IMAGE',imageHash:'embedded',scaleMode:'FILL'}];return frame;};
 const result=await buildScene({version:2,width:100,height:100,nodes:[{kind:'vector',name:'image in SVG',x:0,y:0,width:10,height:10,svg:'<svg/>'}],resources:{},warnings:[],diagnostics:[],stats:{}},'image in SVG');
 assert.equal(result.nativeStats.images,1);assert.equal(result.nativeStats.vectors,0);
});
await test('半透明、非正常混合和内嵌图像不冒充纯矢量，保留明确回退',async()=>{
 for(const effects of [{solidFill:[{...pure.solidFill[0],opacity:.5}]},{solidFill:[{...pure.solidFill[0],blendMode:'multiply'}]}]){
  const scene=await fixture(effects);assert.equal(walk(scene.nodes).filter(n=>n.vectorOverlay).length,0);
  assert.ok(scene.diagnostics.some(d=>d.code==='vector-overlay-fallback'&&d.status==='rasterized'));
 }
 const scene=await fixture(pure,svg.replace('</svg>','<image href="data:image/png;base64,AAA=" width="1" height="1"/></svg>'));
 assert.equal(walk(scene.nodes).filter(n=>n.vectorOverlay).length,0);
});
if(process.env.PSD_VECTOR_SAMPLE){
 const input=await fs.readFile(process.env.PSD_VECTOR_SAMPLE),scene=await parseFile(path.basename(process.env.PSD_VECTOR_SAMPLE),input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength));
 const smart=walk(scene.nodes).filter(n=>n.sourceType==='vector-smart-object');assert.equal(smart.length,75);assert.equal(smart.filter(n=>n.vectorOverlay).length,69);
 assert.equal(walk(scene.nodes).filter(n=>n.sourceData?.svgArtworkViewportAdjusted).length,3);
 assert.ok(smart.every(n=>walk([n]).every(n=>n.kind!=='image'&&n.kind!=='mask')));
 const fonts=[{family:'Noto Sans SC',style:'Regular'},{family:'Noto Sans SC',style:'Medium'},{family:'Noto Sans SC',style:'Bold'},{family:'DINPro-Medium',style:'Regular'},{family:'DINPro-Regular',style:'Regular'},{family:'Inter',style:'Regular'}];
 const host=pluginHost({fonts});globalThis.figma=host.figma;const result=await buildScene(scene,'private PSD');
 const imported=host.figma.currentPage.findAll(n=>JSON.parse(n.metadata['import:source']||'{}').type==='vector-smart-object');
 assert.equal(imported.length,75);assert.equal(imported.filter(n=>n.metadata['import:vector-overlay']).length,69);
 for(const n of imported){const subtree=[n,...n.findAll()];assert.ok(subtree.some(n=>n.type==='VECTOR'&&n.vectorPaths.length));assert.ok(subtree.every(n=>!n.isMask&&!(n.fills||[]).some(p=>p.type==='IMAGE')));}
 assert.equal(result.nativeStats.images,20);assert.equal(result.nativeStats.texts,148);
 const report={scope:'Local PSD + strict native node harness; not Figma visual validation',vectorSmartObjects:imported.length,directVectorOverlays:69,rasterImagesInsideVectorSmartObjects:0,stats:result.stats,nativeStats:result.nativeStats};
 await fs.writeFile('.test-output/vector-overlay-sample-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
console.log(checks+' vector overlay checks passed');
