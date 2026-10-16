import './setup.mjs';
import {build}from'esbuild';import assert from'node:assert/strict';import fs from'node:fs';
await build({absWorkingDir:process.cwd(),entryPoints:['src/parsers/index.ts','src/parsers/aiEps.ts','src/parsers/psdSvg.ts','src/parsers/psdPaint.ts','src/parsers/psdBlend.ts','src/affine.ts','src/stroke.ts','src/scene.ts','src/package.ts','src/builder.ts'],
 outdir:'.test-output/core',bundle:true,format:'esm',outExtension:{'.js':'.mjs'},platform:'node',packages:'external',logLevel:'silent'});
const {buildShapePath}=await import('../.test-output/core/parsers/psdSvg.mjs');
const {blendName,gradientPaint,activeEffects}=await import('../.test-output/core/parsers/psdPaint.mjs');
const {bakeVector,mapPath}=await import('../.test-output/core/affine.mjs');
const {nativeStroke}=await import('../.test-output/core/stroke.mjs');
const {translateNodes}=await import('../.test-output/core/scene.mjs');
const {parseFile}=await import('../.test-output/core/parsers/index.mjs');
const {parsePage}=await import('../.test-output/core/parsers/aiEps.mjs');
const {OPS}=await import('pdfjs-dist/legacy/build/pdf.mjs');
const {readPackage}=await import('../.test-output/core/package.mjs');
const {resolveShapeBlend,resolveWhiteBackdrop}=await import('../.test-output/core/parsers/psdBlend.mjs');
function walk(nodes,out=[]){for(const n of nodes){out.push(n);if(n.kind==='mask')walk([n.mask],out);if(n.children)walk(n.children,out);}return out;}
let checks=0;function test(name,fn){fn();checks++;console.log('PASS',name);}
test('PSD 入控制点、锚点、出控制点语义及曲线极值',()=>{
 const p=buildShapePath([{open:true,knots:[{points:[0,0,0,0,20,40]},{points:[40,40,60,0,60,0]}]}]);
 assert.match(p.d,/M0 0C20 40 40 40 60 0/);assert.equal(p.box.maxY,30);
});
test('空格混合模式和逐项启用状态',()=>{
 assert.equal(blendName('pass through'),'PASS_THROUGH');assert.equal(blendName('soft light'),'SOFT_LIGHT');
 assert.equal(activeEffects({dropShadow:[{enabled:false},{enabled:true}],disabled:false}).length,1);
});
test('Subtract / Divide 反相填充与等价原生混合，拒绝 0/0 歧义',()=>{
 for(const mode of ['subtract','divide'])for(const cs of [.1,.25,.7,1]){
  const n={kind:'vector',name:mode,fills:[{type:'SOLID',color:{r:cs,g:cs,b:cs}}]};
  assert.ok(resolveShapeBlend(n,{blendMode:mode}));const inverted=n.fills[0].color.r;
  for(const cb of [0,.2,.75,1]){
   const actual=mode==='subtract'?Math.max(0,cb+inverted-1):Math.min(1,cb/(1-inverted));
   const expected=mode==='subtract'?Math.max(0,cb-cs):Math.min(1,cb/cs);
   assert.ok(Math.abs(actual-expected)<1e-12);
  }
 }
 assert.equal(resolveShapeBlend({kind:'vector',fills:[{type:'SOLID',color:{r:1,g:0,b:0}}]},{blendMode:'divide'}),false);
});
test('Hard Mix 只在可证明的连续白底前缀转换',()=>{
 const ring=()=>({kind:'vector',name:'ring',paths:[],fills:[],sourceData:{sourceBlendMode:'hard mix'},issues:[{code:'unsupported-blend'}],fidelity:'unsupported'});
 const a=ring(),b=ring(),c=ring(),frame={kind:'frame',sourceId:'board',fills:[{type:'SOLID',color:{r:1,g:1,b:1}}],children:[a,b,{kind:'image'},c]};
 resolveWhiteBackdrop(frame);assert.equal(a.whiteBackdropBlend.artboardId,'board');assert.ok(b.whiteBackdropBlend);assert.equal(c.whiteBackdropBlend,undefined);
 const transparent=ring();resolveWhiteBackdrop({...frame,fills:[],children:[transparent]});assert.equal(transparent.whiteBackdropBlend,undefined);
});
test('渐变归一比例、偏移和透明度断点',()=>{
 const p=gradientPaint({type:'solid',style:'linear',scale:1,offset:{x:0,y:0},angle:0,
 colorStops:[{location:0,midpoint:.5,color:{r:0,g:0,b:0}},{location:1,midpoint:.5,color:{r:255,g:255,b:255}}],
 opacityStops:[{location:0,midpoint:.5,opacity:0},{location:.25,midpoint:.5,opacity:.8},{location:1,midpoint:.5,opacity:1}]},{minX:0,minY:0,maxX:100,maxY:50});
 assert.ok(Math.abs(p.transform[0]-.01)<1e-10);assert.equal(p.stops.find(s=>s.position===.25).color.a,.8);
});
test('仿射缩放写入几何，保留局部渐变映射',()=>{
 const n=bakeVector({kind:'vector',name:'test',x:0,y:0,width:10,height:10,paths:[{data:'M0 0H10V10H0Z',windingRule:'NONZERO'}],fills:[]},[2,0,.5,3,12,20]);
 assert.equal(n.width,25);assert.equal(n.height,30);assert.equal(n.x,12);assert.equal(n.y,20);assert.equal(n.transform,undefined);
 assert.ok(mapPath('M0 0C20 40 40 40 60 0',[1,0,0,1,0,0]).box.maxY===30);
});
test('画板重新定位同时移动文字 inkBounds 和缓存',()=>{
 const n={kind:'text',name:'t',x:100,y:100,transform:[1,0,0,1,100,100],characters:'A',inkBounds:{x:101,y:90,width:10,height:10},fallback:{kind:'image',name:'cache',x:101,y:90,width:10,height:10}};
 translateNodes([n],-80,-30);assert.equal(n.transform[4],20);assert.equal(n.inkBounds.x,21);assert.equal(n.fallback.x,21);
});

// PDF.js operator payload regression: an empty embedded glyph can be [4] (Z),
// not an empty array, and can have isSpace=false. No private font is needed.
async function glyphScene(emptyPath){
 const objects=new Map([
 ['g_font',{loadedName:'fixture',fontMatrix:[.001,0,0,.001,0,0]}],
 ['fixture_path_A',{path:new Float32Array([0,0,0,1,.5,0,1,.5,.7,4])}],
 ['fixture_path_blank',{path:new Float32Array(emptyPath)}],
 ]);
 const store={has:id=>objects.has(id),get:id=>objects.get(id)};
 const a={fontChar:'A',unicode:'A',width:500,isSpace:false};
 return parsePage({view:[0,0,100,100],getViewport:()=>({width:100,height:100,transform:[1,0,0,1,0,0]}),objs:store,commonObjs:store,
 getOperatorList:async()=>({fnArray:[OPS.setFont,OPS.setTextRenderingMode,OPS.setCharSpacing,OPS.setWordSpacing,OPS.setHScale,OPS.showText,OPS.showText],
 argsArray:[['g_font',20],[1],[1],[3],[150],[[a,{fontChar:'blank',unicode:' ',width:250,isSpace:true},-100,{fontChar:'blank',unicode:'\u200b',width:100,isSpace:false}]],[[a,{fontChar:'missing',unicode:'?',width:200,isSpace:false}]]]})}, {},()=>{},1,{isVisible:()=>true});
}
for(const path of [[4],[4,4],[]]){
 const nodes=await glyphScene(path),texts=nodes.filter(n=>n.kind==='text');
 test('PDF 空字形 '+JSON.stringify(path)+' 不创建路径，保留宽度、字距、词距、TJ 调整和后续文字位置',()=>{
  assert.deepEqual(texts.map(n=>n.characters),['A \u200bA?']);assert.equal(nodes.filter(n=>n.kind==='vector').length,0);
  assert.equal(texts[0].transform[4],0);assert.equal(texts[0].pdfLayout.advance,41);
  assert.equal(nodes.filter(n=>n.issues?.some(i=>i.code==='pdf-missing-outline')).length,0,'Readable Unicode needs no source glyph outline');
 });
}
const degenerateGlyphs=await glyphScene([0,0,0,1,0,0,4]);
test('文字描边使用原生 TEXT，不依赖空字形或零长度轮廓',()=>assert.equal(degenerateGlyphs.filter(n=>n.kind==='text').length,1));
function pdf(objects){
 let str='%PDF-1.7\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(str));str+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';}
 const start=Buffer.byteLength(str);str+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n';
 for(const o of offsets.slice(1))str+=String(o).padStart(10,'0')+' 00000 n \n';
 str+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF';return Buffer.from(str);
}
function stream(data){return'<< /Length '+Buffer.byteLength(data)+' >>\nstream\n'+data+'\nendstream';}
const content='q 1 0 0 1 10 20 cm 0 0 100 80 re W n 1 0 0 rg 0 0 50 50 re f q 20 0 0 20 30 10 cm /Im0 Do Q 0 0 1 rg 20 20 60 30 re f Q q 0 100 120 50 re W n /Sh0 sh Q q /Pattern cs /P0 scn 130 0 60 60 re f Q';
const bytes=pdf(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /XObject << /Im0 5 0 R >> /Shading << /Sh0 6 0 R >> /Pattern << /P0 7 0 R >> >> /Contents 4 0 R >>',stream(content),
'<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 7 >>\nstream\n00FF00>\nendstream',
'<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 100 120 100] /Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >> /Extend [true true] >>',
'<< /Type /Pattern /PatternType 2 /Shading 6 0 R /Matrix [1 0 0 1 0 0] >>']);
fs.writeFileSync('.test-output/operator-fixture.pdf',bytes);
const result=await parseFile('synthetic.ai',bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length));
test('PDF 按源顺序保留图片和矢量，删除未截掉内容的矩形裁剪',()=>{
 assert.equal(result.nodes[0].kind,'frame');assert.equal(result.nodes[0].clip,true);
 assert.deepEqual(result.nodes[0].children.slice(0,3).map(n=>n.kind),['vector','image','vector']);
 assert.equal(walk(result.nodes).filter(n=>n.kind==='image').length,1);
});
test('PDF shading 和 pattern shading 保持原生渐变',()=>{
 assert.equal(walk(result.nodes).filter(n=>n.fills?.some(p=>p.type==='GRADIENT_LINEAR')).length,2);
 assert.equal(result.diagnostics.filter(d=>d.status==='unsupported').length,0);
});
await assert.rejects(()=>parseFile('x.eps',new TextEncoder().encode('%!PS-Adobe-3.0 EPSF-3.0').buffer),/插件内转换入口/);checks++;
await assert.rejects(()=>parseFile('x.pdf',bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),undefined,{signal:{aborted:true}}),/取消/);checks++;
const {writePsd}=await import('ag-psd');const {loadImage,createCanvas}=await import('@napi-rs/canvas');
const rgba=(w,h,value=255)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4).fill(value)});
const rasterPsd=writePsd({width:6000,height:20,children:[{name:'relative mask',left:10,top:3,imageData:rgba(4,4),mask:{left:2,top:1,positionRelativeToLayer:true,defaultColor:255,userMaskDensity:.5,imageData:rgba(5000,4,0)}}]});
const rasterScene=await parseFile('mask.psd',rasterPsd),maskParts=rasterScene.nodes[0].mask.children;
const maskTiles=maskParts.filter(n=>n.kind==='image');
const decoded=await loadImage(Buffer.from(rasterScene.resources[maskTiles[0].resourceId]));const canvas=createCanvas(decoded.width,decoded.height);canvas.getContext('2d').drawImage(decoded,0,0);
test('像素蒙版保持原尺寸分块、相对坐标、外部默认值和密度',()=>{
 assert.deepEqual(maskTiles.map(n=>n.width),[4096,904]);assert.equal(maskTiles[0].x,12);assert.equal(maskTiles[0].y,4);
 assert.equal(maskParts[0].paths[1].operation,'subtract');assert.equal(canvas.getContext('2d').getImageData(0,0,1,1).data[3],127);
});
const knots=[[2,2],[12,2],[12,12],[2,12]].map(([x,y])=>({points:[x,y,x,y,x,y]}));
const featherPsd=writePsd({width:30,height:30,children:[{name:'feathered shape',vectorFill:{type:'color',color:{r:255,g:0,b:0}},vectorMask:{paths:[{knots,open:false,operation:'combine'}]},mask:{fromVectorData:true,vectorMaskFeather:6,left:2,top:2,imageData:rgba(10,10)}}]});
const featherScene=await parseFile('feather.psd',featherPsd);
test('矢量羽化不重复应用兼容位图蒙版',()=>{
 assert.equal(featherScene.nodes[0].kind,'vector');assert.equal(featherScene.nodes[0].effects[0].radius,12);assert.equal(featherScene.stats.images,0);
});
await assert.rejects(()=>parseFile('broken.psd',new Uint8Array(4).buffer),/文件头/);checks++;
if(fs.existsSync('.test-output/dribbble.figimport')){
 const bundle=fs.readFileSync('.test-output/dribbble.figimport'),scene=readPackage(bundle.buffer.slice(bundle.byteOffset,bundle.byteOffset+bundle.length));
 test('本机包的资源表与场景协议互通',()=>{assert.equal(scene.version,2);assert.ok(Object.values(scene.resources).every(x=>x instanceof Uint8Array));});
}
const {buildScene}=await import('../.test-output/core/builder.mjs');
const strokeCase=(data,props={})=>({kind:'vector',name:'描边斜接',sourceId:'stroke-case',fidelity:'editable',x:0,y:0,width:100,height:100,paths:[{data,windingRule:'NONZERO'}],fills:[],strokes:[{type:'SOLID',color:{r:1,g:0,b:0}}],strokeWidth:2,miterLimit:100,...props});
test('描边上限适配保留原值，检查圆滑、闭合与尖角接合',()=>{
 const rectangle=nativeStroke(bakeVector(strokeCase('M0 0H100V100H0Z'),[1,0,0,1,0,0]));
 assert.equal(rectangle.miterLimit,16);assert.equal(rectangle.fidelity,'editable');assert.equal(rectangle.sourceData.strokeMiterLimit.original,100);
 const sharp=strokeCase('M0 2L100 0L0 -2');assert.equal(nativeStroke(sharp).fidelity,'unsupported');assert.equal(sharp.miterLimit,100);
 assert.equal(nativeStroke(strokeCase('M0 0L100 2L100 -2Z')).fidelity,'unsupported','Closing join must be checked');
 assert.equal(nativeStroke(strokeCase('M0 1L100 0L0 -1')).fidelity,'editable','Both limits bevel a corner whose ratio exceeds 100');
 assert.equal(nativeStroke(strokeCase('M0 0C0 0 10 0 20 0C20 0 30 0 40 0')).fidelity,'editable','Degenerate handles still have a tangent');
 assert.equal(nativeStroke(strokeCase('M0 1L100 0L0 -1',{strokeJoin:'ROUND'})).fidelity,'editable');
 assert.equal(nativeStroke(strokeCase('M0 1L100 0L0 -1',{strokes:[]})).fidelity,'editable');
 for(const limit of [0,-10,Infinity,NaN]){const value=nativeStroke(strokeCase('M0 0L10 10',{miterLimit:limit}));assert.ok(Number.isFinite(value.miterLimit)&&value.miterLimit>=1&&value.miterLimit<=16);}
 for(const limit of [1,4,10,16]){const value=strokeCase('M0 0L10 10',{miterLimit:limit});assert.equal(nativeStroke(value),value);}
});
const roots=[];let seq=0;
function fake(type){let miter=16;const n={type,id:String(++seq),x:0,y:0,width:0,height:0,children:[],metadata:{},setPluginData(key,value){this.metadata[key]=value;},get strokeMiterLimit(){return miter;},set strokeMiterLimit(value){assert.ok(Number.isFinite(value)&&value>=1&&value<=16,'Figma strokeMiterLimit must be 1..16');miter=value;},resize(w,h){this.width=w;this.height=h;},appendChild(c){if(c.parent)c.parent.children=c.parent.children.filter(x=>x!==c);this.children.push(c);c.parent=this;},remove(){this.removed=true;if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);for(const c of [...this.children])c.remove();}};return n;}
const page=fake('PAGE');globalThis.figma={currentPage:page,listAvailableFontsAsync:async()=>[],createFrame(){const n=fake('FRAME');roots.push(n);page.appendChild(n);return n;},createVector(){const n=fake('VECTOR');page.appendChild(n);return n;},createImage(){throw new Error('broken image');}};
const node={kind:'image',name:'损坏图像',bytes:new Uint8Array([1,2,3]),x:0,y:0,width:10,height:10};
await assert.rejects(()=>buildScene({version:2,width:20,height:20,nodes:[node],resources:{},warnings:[],diagnostics:[],stats:{}},'failure'),/broken image/);
test('创建中失败清理本次根节点',()=>assert.equal(page.children.length,0));
await assert.rejects(()=>buildScene({version:2,width:20,height:20,nodes:[node],resources:{},warnings:[],diagnostics:[],stats:{}},'cancel',()=>{},()=>true),/取消/);
test('取消导入清理本次根节点',()=>assert.equal(page.children.length,0));
globalThis.figma.viewport={scrollAndZoomIntoView(){}};
globalThis.figma.createNodeFromSvg=()=>{const f=fake('FRAME');for(let i=0;i<2;i++)f.appendChild(fake('VECTOR'));return f;};
const nativeCount=await buildScene({version:2,width:20,height:20,nodes:[{kind:'vector',name:'local SVG',x:0,y:0,width:10,height:10,svg:'<svg/>'}],resources:{},warnings:[],diagnostics:[],stats:{}},'count');
test('实际节点统计包含局部 SVG 展开的矢量',()=>{assert.equal(nativeCount.stats.vectors,1);assert.equal(nativeCount.nativeStats.vectors,2);});
page.children[0].remove();
const psdStroke=writePsd({width:120,height:120,children:[{name:'PSD miter 100',vectorMask:{paths:[{knots,open:false,operation:'combine'}]},vectorStroke:{strokeEnabled:true,lineWidth:{units:'Pixels',value:2},miterLimit:100,lineJoinType:'miter',content:{type:'color',color:{r:255,g:0,b:0}}}}]});
const psdStrokeScene=await parseFile('miter-100.psd',psdStroke);
const strokeResult=await buildScene(psdStrokeScene,'PSD stroke');
test('真实 PSD 编解码到严格 Figma 属性构建，不因 miter 100 中断',()=>{
 assert.equal(strokeResult.nativeStats.vectors,1);assert.equal(strokeResult.nativeStats.images,0);assert.equal(strokeResult.stats.unsupported,0);
 const shape=page.children[0].children[0];assert.equal(shape.strokeMiterLimit,16);
 assert.equal(JSON.parse(shape.metadata['import:source-data']).strokeMiterLimit.original,100);
});
page.children[0].remove();
const sharpResult=await buildScene({version:2,width:100,height:100,nodes:[strokeCase('M0 2L100 0L0 -2')],resources:{},warnings:[],diagnostics:[],stats:{}},'Sharp stroke');
test('可能改变尖角外观时创建可编辑矢量并如实计入待核对',()=>{assert.equal(sharpResult.status,'needs-review');assert.equal(sharpResult.stats.unsupported,1);assert.equal(sharpResult.nativeStats.vectors,1);assert.ok(sharpResult.diagnostics.some(d=>d.code==='stroke-miter-limit'&&d.nodeId));});
page.children[0].remove();
console.log(checks+' checks passed');

