import './setup.mjs';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {pluginHost} from './plugin-host.mjs';
await build({entryPoints:['src/parsers/aiEps.ts','src/builder.ts','src/import-summary.ts'],outdir:'.test-output/pdf-text',bundle:true,format:'esm',outExtension:{'.js':'.mjs'},platform:'node',packages:'external',logLevel:'silent'});
const {parseAIorEPS,parsePage}=await import('../.test-output/pdf-text/parsers/aiEps.mjs');
const {buildScene}=await import('../.test-output/pdf-text/builder.mjs');
const {summarizeImport}=await import('../.test-output/pdf-text/import-summary.mjs');
const {OPS}=await import('pdfjs-dist/legacy/build/pdf.mjs');
globalThis.window={addEventListener(){}};
const face=(family,style='Regular')=>({family,style});
const walk=nodes=>nodes.flatMap(n=>[n,...walk(n.children||[]),...n.mask?walk([n.mask]):[]]);
function pdf(content,font='Helvetica'){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
 '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
 '<< /Length '+Buffer.byteLength(content)+' >>\nstream\n'+content+'\nendstream','<< /Type /Font /Subtype /Type1 /BaseFont /'+font+' >>'];
 let data='%PDF-1.7\n',offsets=[0];
 objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(data));data+=(i+1)+' 0 obj\n'+object+'\nendobj\n';});
 const start=Buffer.byteLength(data);data+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('');
 data+='trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF';
 return Uint8Array.from(Buffer.from(data)).buffer;
}
async function run(scene,options={}){
 const host=pluginHost({fonts:[face('Inter')],...options});globalThis.figma=host.figma;
 const result=await buildScene(scene,'AI text');return{host,result,texts:host.figma.currentPage.findAll(n=>n.type==='TEXT')};
}
let checks=0;async function test(name,fn){await fn();checks++;console.log('PASS',name);}
const scene=await parseAIorEPS(pdf('BT /F1 20 Tf 1 0 0 1 30 120 Tm 0.2 0.4 0.6 rg (Hello AI) Tj ET'));
await test('真实 PDF 兼容 AI 的整段文字为 TEXT，保留内容、字号、颜色与起点',async()=>{
 const native=walk(scene.nodes).filter(n=>n.kind==='text');assert.equal(native.length,1);assert.equal(native[0].characters,'Hello AI');
 assert.equal(scene.stats.outlinedTexts,0);assert.equal(native[0].font.postScriptName,'Helvetica');
 const {result,texts}=await run(scene,{fonts:[face('Helvetica'),face('Inter')]});
 assert.equal(result.nativeStats.texts,1);assert.equal(result.nativeStats.vectors,0);assert.equal(result.status,'created');
 assert.equal(texts[0].characters,'Hello AI');assert.equal(texts[0].fontSize,20);assert.equal(texts[0].x,30);assert.equal(texts[0].y,64);
 assert.ok(Math.abs(texts[0].fills[0].color.g-0.4)<0.01);assert.deepEqual(summarizeImport(result.diagnostics),[]);
});
await test('AI 缺字体使用 Inter Regular，完成页明确提示缺失和编辑能力',async()=>{
 const {result,texts}=await run(scene);assert.deepEqual(texts[0].fontName,face('Inter'));assert.equal(result.stats.outlinedTexts,0);
 assert.equal(result.status,'needs-review');const notice=summarizeImport(result.diagnostics).find(n=>n.category==='text');
 assert.match(notice.message,/原字体缺失或无法加载/);assert.match(notice.message,/默认字体替代并保留可编辑文字/);
 const data=JSON.parse(texts[0].metadata['import:source-data']);assert.equal(data.fontSubstitutions[0].source.postScriptName,'Helvetica');
 assert.deepEqual(data.fontSubstitutions[0].replacement,face('Inter'));
});
await test('原字体加载失败后使用默认字体；默认字体加载失败后继续尝试',async()=>{
 const {result,texts}=await run(scene,{fonts:[face('Helvetica'),face('Inter'),face('Arial')],failFonts:['Helvetica/Regular','Inter/Regular']});
 assert.equal(result.nativeStats.texts,1);assert.deepEqual(texts[0].fontName,face('Arial'));
 assert.equal(JSON.parse(texts[0].metadata['import:source-data']).fontSubstitutions[0].reason,'font-load-failed');
});
await test('TJ 字距、词距、多行、文字上移和不可见文字不破坏后续定位',async()=>{
 const value=await parseAIorEPS(pdf('BT /F1 20 Tf 1 0 0 1 30 120 Tm 1 Tc 3 Tw 2 Ts [(A ) -100 (BC)] TJ 24 TL T* (Next) Tj 3 Tr (Hidden) Tj ET'));
 const texts=walk(value.nodes).filter(n=>n.kind==='text');assert.deepEqual(texts.map(n=>n.characters),['A BC\nNext','Hidden']);assert.equal(texts[1].visible,false);
 assert.equal(texts[0].transform[4],30);assert.equal(texts[0].transform[5],78);assert.equal(texts[0].leading,24);
 assert.ok(texts[0].styleRuns.some(r=>r.tracking===300),'Space includes word spacing and TJ displacement');
 const built=await run(value);assert.equal(built.result.nativeStats.texts,2);assert.equal(built.texts[0].letterSpacing.value,5);
});
async function mock({mode=0,font={},glyphs,extra=[],after=[],resources=[]}={}){
 const objects=new Map([['g_font',{name:'ABCDEF+Missing-Bold',loadedName:'fixture',fontMatrix:[.001,0,0,.001,0,0],...font}],...resources]);
 const store={has:id=>objects.has(id),get:id=>objects.get(id)};
 const content=glyphs||[{fontChar:'A',unicode:'中',width:1000},{fontChar:'B',unicode:'😀',width:1000},{fontChar:'C',unicode:'fi',width:500}];
 const operations=[['setFont',['g_font',20]],['setTextRenderingMode',[mode]],...extra,['showText',[content]],...after];
 const nodes=await parsePage({getViewport:()=>({width:300,height:200,transform:[1,0,0,-1,0,200]}),objs:store,commonObjs:store,
 getOperatorList:async()=>({fnArray:operations.map(([name])=>OPS[name]),argsArray:operations.map(([,args])=>args)})},{},()=>{},1,{isVisible:()=>true});
 return{...scene,nodes,diagnostics:[]};
}
await test('中文、代理对与连字保留完整 Unicode；缺少轮廓不阻止默认字体导入',async()=>{
 const {result,texts}=await run(await mock());assert.equal(texts[0].characters,'中😀fi');assert.equal(result.nativeStats.texts,1);assert.equal(result.nativeStats.vectors,0);
});
await test('旋转、文字缩放和上移仍为可编辑文字；基线按旋转方向偏移',async()=>{
 const value=await mock({extra:[['setTextMatrix',[0,1,-1,0,50,60]],['setTextRise',[3]]]});
 const {texts}=await run(value);assert.equal(texts[0].x,31);assert.equal(texts[0].y,140);assert.equal(texts[0].axes[0][1],1);
});
await test('水平缩放保留可编辑内容，并明确提示排版差异',async()=>{
 const {result,texts}=await run(await mock({extra:[['setHScale',[150]]]}),{fonts:[face('Missing','Bold')]});assert.equal(texts.length,1);assert.equal(result.status,'needs-review');
 assert.ok(result.diagnostics.some(d=>d.issues?.some(i=>i.code==='text-transform-approximation')));
});
await test('编码缺失时明确标记替代字符，仍保持 TEXT，不生成字形矢量',async()=>{
 const {result,texts}=await run(await mock({glyphs:[{fontChar:'A',unicode:'',width:500}]}));assert.equal(result.nativeStats.texts,1);assert.equal(result.nativeStats.vectors,0);
 assert.equal(texts[0].characters,'\uFFFD');assert.ok(result.diagnostics.some(d=>d.code==='pdf-text-encoding'));
});
await test('PDF 描边和填充描边文字均为 TEXT，并保留原生描边颜色与宽度',async()=>{
 for(const mode of [1,2]){
   const source=await parseAIorEPS(pdf('BT /F1 20 Tf '+mode+' Tr 1.5 w 0 1 0 RG 1 0 0 rg 1 0 0 1 30 120 Tm (Stroke PDF) Tj ET'));
   const {result,texts}=await run(source);assert.equal(result.nativeStats.texts,1);assert.equal(result.nativeStats.vectors,0);assert.equal(result.stats.outlinedTexts,0);
   assert.equal(texts[0].characters,'Stroke PDF');assert.equal(texts[0].strokes[0].color.g,1);assert.equal(texts[0].strokeWeight,1.5);
   assert.equal(texts[0].fills.length,mode===1?0:1);
 }
});
await test('PDF 渐变文字使用 TEXT 原生渐变填充，不创建轮廓或图片',async()=>{
 const value=await mock({extra:[['setFillColorN',['Shading','g_gradient',null]]],resources:[['g_gradient',['RadialAxial','axial',null,[[0,'#ff0000'],[1,'#0000ff']],[0,0],[100,0]]]]});
 const {result,texts}=await run(value);assert.equal(result.nativeStats.vectors,0);assert.equal(result.nativeStats.images,0);
 assert.equal(texts[0].fills[0].type,'GRADIENT_LINEAR');assert.equal(texts[0].fills[0].gradientStops[0].color.r,1);
 assert.ok(texts[0].fills[0].gradientTransform.flat().every(Number.isFinite));
});
await test('PDF 文字裁剪使用可编辑 TEXT 蒙版，后续图形保留裁剪',async()=>{
 const value=await parseAIorEPS(pdf('q BT /F1 20 Tf 7 Tr 1 0 0 1 30 120 Tm (Clip PDF) Tj ET 1 0 0 rg 0 0 300 200 re f Q'));
 const {result,texts,host}=await run(value);assert.equal(result.nativeStats.texts,1);assert.equal(result.stats.outlinedTexts,0);assert.equal(texts[0].characters,'Clip PDF');
 assert.equal(result.nativeStats.masks,1);assert.ok(host.figma.currentPage.findAll(n=>n.isMask).every(n=>n.maskType==='ALPHA'));
});
await test('PDF 竖排和 Type3 的有效编码保留可编辑文字，并明确提示排版差异',async()=>{
 for(const font of [{vertical:true,defaultVMetrics:[-1000,500,880]},{isType3Font:true}]){
   const {result,texts}=await run(await mock({font}));assert.equal(texts.map(n=>n.characters).join('').replaceAll('\n',''),'中😀fi');assert.equal(result.nativeStats.vectors,0);
   assert.ok(result.diagnostics.some(d=>d.issues?.some(i=>i.code==='text-layout-approximation')));
 }
});
await test('PDF 没有任何可加载字体时明确失败，不自动矢量化文字',async()=>{
 const value=await mock(),host=pluginHost({fonts:[]});globalThis.figma=host.figma;
 await assert.rejects(()=>buildScene(value,'no fonts'),/没有可加载的字体/);assert.equal(host.figma.currentPage.children.length,0);
});
await test('同一文本对象的连续三行组成一个段落，保留行距和完整可编辑字符',async()=>{
 const source=await parseAIorEPS(pdf('BT /F1 12 Tf 1 0 0 1 20 160 Tm 16 TL (First paragraph line.) Tj T* (Second paragraph line.) Tj T* (Last paragraph line.) Tj ET'));
 const native=walk(source.nodes).filter(n=>n.kind==='text');assert.equal(native.length,1);assert.equal(native[0].characters,'First paragraph line.\nSecond paragraph line.\nLast paragraph line.');
 assert.equal(native[0].leading,16);assert.equal(native[0].pdfLayout.lineCount,3);
 const {texts}=await run(source);assert.equal(texts.length,1);assert.equal(texts[0].textAutoResize,'HEIGHT');assert.equal(texts[0].characters,native[0].characters);
});
await test('同段不同字号和颜色继续保留范围样式，不被全局填充覆盖',async()=>{
 const source=await parseAIorEPS(pdf('BT /F1 12 Tf 1 0 0 1 20 160 Tm 1 0 0 rg (Red) Tj /F1 14 Tf 0 0 1 rg (Blue) Tj ET'));
 const native=walk(source.nodes).filter(n=>n.kind==='text');assert.equal(native.length,1);assert.equal(native[0].characters,'RedBlue');
 const {texts}=await run(source);assert.ok(texts[0].ranges.some(r=>r.property==='fontSize'&&r.start===3&&r.value===14));
 assert.ok(texts[0].ranges.some(r=>r.property==='fills'&&r.start===3&&r.value[0].color.b===1));
});
await test('段落首行缩进保留为范围段落缩进，不拆成独立文本层',async()=>{
 const source=await parseAIorEPS(pdf('BT /F1 12 Tf 1 0 0 1 44 160 Tm (Indented first line.) Tj -24 -16 Td (Following line of the paragraph.) Tj ET'));
 const native=walk(source.nodes).filter(n=>n.kind==='text');assert.equal(native.length,1);assert.equal(native[0].align,'left');assert.equal(native[0].transform[4],20);
 const {texts}=await run(source);assert.ok(texts[0].ranges.some(r=>r.property==='paragraphIndent'&&r.start===0&&r.value===24));
 assert.ok(texts[0].ranges.some(r=>r.property==='paragraphIndent'&&r.start>0&&r.value===0));
});
await test('同页独立文本块、多栏、大段间距和不同段落标签不互相合并',async()=>{
 for(const content of [
  'BT /F1 12 Tf 1 0 0 1 20 160 Tm (Left label) Tj 1 0 0 1 180 160 Tm (Right label) Tj ET',
  'BT /F1 12 Tf 1 0 0 1 20 160 Tm (First) Tj ET BT /F1 12 Tf 1 0 0 1 20 144 Tm (Second) Tj ET',
  'BT /F1 12 Tf 1 0 0 1 20 160 Tm (First paragraph long enough.) Tj 0 -60 Td (Second paragraph long enough.) Tj ET',
  '/P BMC BT /F1 12 Tf 1 0 0 1 20 160 Tm (First paragraph long enough.) Tj ET EMC /P BMC BT /F1 12 Tf 1 0 0 1 20 144 Tm (Second paragraph long enough.) Tj ET EMC'
 ]){const source=await parseAIorEPS(pdf(content));assert.equal(walk(source.nodes).filter(n=>n.kind==='text').length,2,content);}
});
await test('PDF 反复整页裁剪不包围文字，实际矩形裁切改用透明 Frame',async()=>{
 const clean=await parseAIorEPS(pdf('q 0 0 300 200 re W n q 0 0 300 200 re W n BT /F1 12 Tf 20 160 Td (Editable paragraph) Tj ET Q Q'));
 assert.equal(walk(clean.nodes).filter(n=>n.kind==='mask').length,0);assert.equal(clean.nodes[0].children[0].kind,'text');
 const cut=await parseAIorEPS(pdf('q 20 30 40 50 re W n 1 0 0 rg 0 0 100 100 re f Q'));
 const frame=cut.nodes[0].children[0];assert.equal(frame.kind,'frame');assert.equal(frame.clip,true);assert.equal(frame.width,40);assert.equal(frame.height,50);assert.deepEqual(frame.fills,[]);
 assert.equal(frame.children[0].transform[4],-20);assert.equal(frame.children[0].transform[5],80);
});
await test('非矩形裁剪保留，避免把曲线裁剪错误替换为矩形',async()=>{
 const source=await parseAIorEPS(pdf('q 0 0 m 100 0 l 50 100 l h W n 1 0 0 rg 0 0 100 100 re f Q'));
 assert.equal(walk(source.nodes).filter(n=>n.kind==='mask').length,1);
});
const glyphPath=new Float32Array([0,0,0,1,.5,0,1,.5,.7,1,0,.7,4]);
const rect=(x=0,y=0,w=10,h=14)=>new Float32Array([0,x,y,1,x+w,y,1,x+w,y+h,1,x,y+h,4]);
const outline=(path=rect())=>['constructPath',[OPS.fill,[path],null]];
const duplicateOptions={glyphs:[{fontChar:'A',unicode:'A',width:500}],resources:[['fixture_path_A',{path:glyphPath}]]};
await test('只移除与源字形几何、位置和颜色一致的重复矢量，保留可编辑 TEXT',async()=>{
 const source=await mock({...duplicateOptions,after:[outline()]});assert.equal(walk(source.nodes).filter(n=>n.kind==='vector').length,0);
 const {texts,result}=await run(source);assert.equal(texts.length,1);assert.equal(texts[0].characters,'A');assert.equal(result.stats.outlinedTexts,0);
});
await test('保留相邻装饰路径、不同颜色或透明度的矢量，不按文字包围盒删除',async()=>{
 for(const after of [[outline(rect(1))],[['setFillRGBColor',['#ff0000']],outline()],[['setGState',[[['ca',.5]]]],outline()],[outline(rect(0,0,10,13))]]){
  const source=await mock({...duplicateOptions,after});assert.equal(walk(source.nodes).filter(n=>n.kind==='vector').length,1);
 }
});
await test('裁剪范围不同的字形轮廓不被错误去重',async()=>{
 const source=await mock({...duplicateOptions,after:[['clip',[]],['constructPath',[OPS.endPath,[rect(0,0,5,14)],null]],outline()]});
 assert.equal(walk(source.nodes).filter(n=>n.kind==='vector').length,1);assert.equal(source.nodes.filter(n=>n.kind==='text').length,1);
});
await test('完整孔洞一起匹配才删除轮廓，单独外轮廓和真实装饰保留',async()=>{
 const hole=[0,.1,.1,1,.1,.6,1,.4,.6,1,.4,.1,4],withHole=new Float32Array([...glyphPath,...hole]);
 const resources=[['fixture_path_A',{path:withHole}]];
 const partial=await mock({...duplicateOptions,resources,after:[outline()]});assert.equal(walk(partial.nodes).filter(n=>n.kind==='vector').length,1);
 const complete=new Float32Array([...rect(),0,2,2,1,2,12,1,8,12,1,8,2,4]);
 const source=await mock({...duplicateOptions,resources,after:[outline(complete)]});assert.equal(walk(source.nodes).filter(n=>n.kind==='vector').length,0);
 const filledHole=new Float32Array([...rect(),0,2,2,1,8,2,1,8,12,1,2,12,4]);
 const differentFill=await mock({...duplicateOptions,resources,after:[outline(filledHole)]});assert.equal(walk(differentFill.nodes).filter(n=>n.kind==='vector').length,1,'Different NONZERO winding fills the hole and must survive');
});
console.log(checks+' AI/PDF editable text checks passed');
