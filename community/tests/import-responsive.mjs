import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {pluginHost} from './plugin-host.mjs';
await build({entryPoints:['src/builder.ts','src/font-match.ts'],outdir:'.test-output/import-responsive',bundle:true,format:'esm',outExtension:{'.js':'.mjs'},platform:'node',packages:'external',logLevel:'silent'});
const {buildScene}=await import('../.test-output/import-responsive/builder.mjs');
const {defaultFonts}=await import('../.test-output/import-responsive/font-match.mjs');
globalThis.window={addEventListener(){}};
const face=(family,style='Regular')=>({family,style});
const text=(id=0)=>({kind:'text',name:'AI text',sourceId:'text-'+id,sourceType:'pdf-text',characters:'Editable AI',x:10,y:20,fontSize:20,font:{candidates:['Missing'],style:'Regular',postScriptName:'Missing-Regular'}});
const scene=nodes=>({version:2,width:300,height:200,nodes,resources:{},warnings:[],diagnostics:[]});
const timing={fontListMs:100,fontLoadMs:25,fontSelectionMs:200,yieldMs:5};
function host(options={}){const h=pluginHost({fonts:[face('Inter')],...options});globalThis.figma=h.figma;return h;}
let checks=0;async function test(name,fn){await fn();checks++;console.log('PASS',name);}
await test('默认字体线性去重，保持优先级与完整候选集合',()=>{
 let reads=0;
 const fonts=Array.from({length:2000},(_,i)=>({get family(){reads++;return 'Font '+i;},style:i%2?'Bold':'Regular'}));
 const inter=face('Inter'),arial=face('Arial');
 const result=defaultFonts([...fonts,arial,inter,inter]);
 assert.deepEqual(result.slice(0,2),[inter,arial]);assert.equal(result.length,2002);assert.ok(reads<20000,'Quadratic default-font scan: '+reads);
});
await test('8000 个字体、200 段 AI 文字只计算一次默认列表并复用字体选择',async()=>{
 let reads=0;
 const fonts=Array.from({length:8000},(_,i)=>({get family(){reads++;return 'Font '+i;},style:i%2?'Bold':'Regular'}));fonts.push(face('Inter'));
 const h=host({fonts}),start=performance.now();const result=await buildScene(scene(Array.from({length:200},(_,i)=>text(i))),'many-fonts');
 assert.equal(result.nativeStats.texts,200);assert.equal(h.fontLoads.length,1);assert.ok(reads<300000,'Repeated font-list traversal: '+reads);
 console.log(JSON.stringify({fontFaces:fonts.length,textSegments:200,fontLoads:h.fontLoads.length,fontFamilyReads:reads,totalBuildMs:Math.round(performance.now()-start)}));
});
await test('原字体已加载时不读取默认字体候选',async()=>{
 const h=host();const nodes=Array.from({length:40},(_,i)=>({...text(i),font:{candidates:['Inter'],style:'Regular'}}));
 const {nativeStats}=await buildScene(scene(nodes),'exact');assert.equal(nativeStats.texts,40);assert.equal(h.fontLoads.length,1);
});
await test('读取字体永不返回时仍可取消，迟到结果不会创建节点',async()=>{
 const h=host();let finish,cancelled=false;h.figma.listAvailableFontsAsync=()=>new Promise(resolve=>{finish=resolve;});
 setTimeout(()=>{cancelled=true;},10);
 await assert.rejects(()=>buildScene(scene([text()]),'cancel-list',()=>{},()=>cancelled,timing),/导入已取消/);
 assert.equal(h.figma.currentPage.children.length,0);finish([{fontName:face('Inter')}]);await new Promise(r=>setTimeout(r,0));assert.equal(h.figma.currentPage.children.length,0);
});
await test('字体列表超时给出可读错误，不无限等待',async()=>{
 const h=host();h.figma.listAvailableFontsAsync=()=>new Promise(()=>{});
 await assert.rejects(()=>buildScene(scene([text()]),'list-timeout',()=>{},()=>false,{...timing,fontListMs:20}),/读取 Figma 字体超时/);
 assert.equal(h.figma.currentPage.children.length,0);
});
await test('原字体加载永不返回时超时后继续默认字体，保持可编辑文字',async()=>{
 const h=host({fonts:[face('Missing'),face('Inter')]}),load=h.figma.loadFontAsync;
 h.figma.loadFontAsync=font=>font.family==='Missing'?new Promise(()=>{}):load(font);
 const result=await buildScene(scene([text()]),'font-timeout',()=>{},()=>false,timing);
 assert.equal(result.nativeStats.texts,1);const t=h.figma.currentPage.findAll(n=>n.type==='TEXT')[0];assert.deepEqual(t.fontName,face('Inter'));
 assert.ok(result.diagnostics.some(d=>d.issues?.some(i=>i.code==='text-default-font')));
});
await test('加载字体时取消能清理本次节点，迟到的字体不会恢复导入',async()=>{
 const h=host();let cancel=false,finish;
 h.figma.loadFontAsync=()=>{setTimeout(()=>{cancel=true;},5);return new Promise(resolve=>{finish=resolve;});};
 await assert.rejects(()=>buildScene(scene([text()]),'cancel-load',()=>{},()=>cancel,{...timing,fontLoadMs:100}),/导入已取消/);
 assert.equal(h.figma.currentPage.children.length,0);finish();await new Promise(r=>setTimeout(r,0));assert.equal(h.figma.currentPage.children.length,0);
});
await test('所有字体挂起时受总等待预算约束，随后仍能重新导入',async()=>{
 const h=host({fonts:[face('Inter'),face('Arial'),face('Roboto')]}),load=h.figma.loadFontAsync;h.figma.loadFontAsync=()=>new Promise(()=>{});
 await assert.rejects(()=>buildScene(scene([text()]),'all-stalled',()=>{},()=>false,{...timing,fontSelectionMs:40}),/没有可加载的字体/);
 assert.equal(h.figma.currentPage.children.length,0);h.figma.loadFontAsync=load;
 const result=await buildScene(scene([text()]),'retry',()=>{},()=>false,timing);assert.equal(result.nativeStats.texts,1);
});
await test('创建节点阶段会让出事件循环，取消无需等满 20 个节点',async()=>{
 const h=host();let cancel=false,attempts=0;const create=h.figma.createText;
 h.figma.createText=()=>{attempts++;if(attempts===1)setTimeout(()=>{cancel=true;},0);return create();};
 await assert.rejects(()=>buildScene(scene(Array.from({length:100},(_,i)=>text(i))),'cancel-build',()=>{},()=>cancel,{...timing,yieldMs:0}),/导入已取消/);
 assert.equal(attempts,1);assert.equal(h.figma.currentPage.children.length,0);
});
console.log(checks+' import responsiveness checks passed');
