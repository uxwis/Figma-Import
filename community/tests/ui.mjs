import './setup.mjs';
import {chromium} from 'playwright';
import {writePsd} from 'ag-psd';
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {pluginHost} from './plugin-host.mjs';
const [html,main]=await Promise.all(['ui.html','code.js'].map(p=>fs.readFile(p,'utf8')));
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const reports=[],errors=[];
const instrumentation=`
window.__fullReads=[];window.__workers=0;window.__pixelAllocations=0;window.__stages=[];window.__holdReads=false;
const size=Object.getOwnPropertyDescriptor(Blob.prototype,'size').get;
Object.defineProperty(File.prototype,'size',{get(){if(this.name.startsWith('over64'))return 64*1024*1024+1;if(this.name.startsWith('over256'))return 256*1024*1024+1;return size.call(this);}});
const read=Blob.prototype.arrayBuffer;
Blob.prototype.arrayBuffer=async function(){if(this instanceof File)window.__fullReads.push(this.name);if(window.__holdReads)await new Promise(r=>window.__releaseRead=r);return read.call(this);};
const OriginalWorker=window.Worker;window.Worker=class extends OriginalWorker{constructor(...args){window.__workers++;super(...args);}};
const OriginalImageData=window.ImageData;window.ImageData=class extends OriginalImageData{constructor(...args){window.__pixelAllocations++;super(...args);}};
new MutationObserver(()=>{const message=document.getElementById('msg')?.textContent;if(message&&window.__stages.at(-1)!==message)window.__stages.push(message);}).observe(document.body,{subtree:true,childList:true,characterData:true});
`;
async function open(mode='normal'){
 const page=await browser.newPage({viewport:{width:440,height:680}});page.on('pageerror',e=>errors.push(e.message));
 await page.route(/^https?:\/\//,route=>route.abort('blockedbyclient'));
 await page.setContent('<style>body{margin:0}</style>');
 await page.addScriptTag({content:'window.__host=('+pluginHost.toString()+')();window.figma=window.__host.figma;'});
 if(mode!=='normal')await page.evaluate(mode=>{
  const post=figma.ui.postMessage;figma.ui.postMessage=msg=>{if(msg.type==='build-info'){if(mode==='timeout')return;msg={...msg,buildId:'wrong-build'};}post(msg);};
 },mode);
 await page.evaluate(()=>{const original=figma.listAvailableFontsAsync;figma.listAvailableFontsAsync=async()=>{if(window.__delayBuild)await new Promise(r=>window.__releaseBuild=r);return original();};});
 const extra=instrumentation+(mode==='timeout'?`const timer=setTimeout;window.setTimeout=(fn,ms,...args)=>timer(fn,ms===5000?50:ms,...args);`:'');
 const content=html.replace('<script>','<script>'+extra);
 await page.addScriptTag({content:'const __html__='+JSON.stringify(content)+';'+main});
 const frame=page.frameLocator('iframe');
 if(mode==='normal')await frame.locator('#pick:enabled').waitFor();else await frame.locator('.error').waitFor();
 return{page,frame,document:page.frames().find(f=>f.parentFrame())};
}
const png=name=>'.test-output/ui-'+name+'.png';
async function capture(test,name){
 await test.document.waitForFunction(()=>innerHeight===520);
 const size=await test.document.evaluate(()=>({width:innerWidth,height:innerHeight,contentHeight:document.getElementById('app').getBoundingClientRect().height,scrollHeight:document.documentElement.scrollHeight,scrollWidth:document.documentElement.scrollWidth}));
 assert.ok(size.scrollHeight<=size.height,name+' vertical overflow');assert.ok(size.scrollWidth<=size.width,name+' horizontal overflow');
 assert.equal(size.height,520,name+' fixed panel height');
 assert.deepEqual(await test.page.evaluate(()=>window.__host.resizes),[],name+' must not resize the panel');
 assert.equal(size.width,440);reports.push({screen:name,...size});
 await test.page.locator('iframe').screenshot({path:png(name)});return size;
}
async function noRemovedUI(frame){
 assert.equal(await frame.locator('#build-info,#report,#render').count(),0);
 const text=await frame.locator('body').innerText();
 for(const old of ['主程序已核对','打开即可导入','格式与导入说明','无需安装额外程序','源文件在当前设备','保存完整诊断','逐画板导出验收包','节点创建成功不代表','局部栅格化'])assert.ok(!text.includes(old),old);
}
try{
 const home=await open();await noRemovedUI(home.frame);
 assert.equal(await home.frame.locator('summary').innerText(),'导入说明');await capture(home,'start');
 await home.frame.locator('summary').click();
 assert.deepEqual(await home.frame.locator('.format-help li').allTextContents(),[
  '按文件内容导入画板、图层、路径和图片，部分文字与复杂效果可能存在差异。已有的 .figimport 转换包也可直接导入。',
  '所有转换均在插件内完成，不上传转换服务器。',
  '缺少原字体时可能使用文字外观或替代字体，导入后请核对。',
  'EPS / PS 及 PostScript 格式 AI 单文件上限 64 MB，其他格式上限 256 MB；AI 需包含可读取的 PDF 或 PostScript 内容。']);
 await capture(home,'instructions');
 await home.frame.locator('summary').click();await capture(home,'start-restored');
 for(const [name,content,limit] of [['over64.EPS','%!PS-Adobe-3.0',64],['over64.AI','%!PS-Adobe-3.0',64],['over256.PSD','8BPS',256],['over256.AI','%PDF-1.7',256]]){
  await home.frame.locator('#file').setInputFiles({name,mimeType:'application/octet-stream',buffer:Buffer.from(content)});
  assert.equal(await home.frame.locator('.error').innerText(),'文件超过 '+limit+' MB，请拆分后再导入。');
  await noRemovedUI(home.frame);await home.frame.locator('#back').click();
 }
 assert.deepEqual(await home.document.evaluate(()=>({reads:__fullReads,workers:__workers})),{reads:[],workers:0});reports.push('oversize blocked before full read / worker');
 // Drag-drop exercises the same file gate.
 await home.document.evaluate(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['8BPS'],'over256.PSB'));document.getElementById('drop').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));});
 await home.frame.locator('.error').filter({hasText:'文件超过 256 MB'}).waitFor();await home.frame.locator('#back').click();
 // Cancellation while checking a header must not continue to full-file reading.
 await home.document.evaluate(()=>{__holdReads=true;});
 await home.frame.locator('#file').setInputFiles({name:'cancel.PSD',mimeType:'application/octet-stream',buffer:Buffer.from('8BPS')});
 await home.frame.locator('#msg').filter({hasText:'正在检查文件…'}).waitFor();await capture(home,'checking');
 await home.frame.locator('#cancel').click();await home.document.evaluate(()=>{__holdReads=false;__releaseRead();});await home.frame.locator('.error').filter({hasText:'导入已取消'}).waitFor();
 assert.deepEqual(await home.document.evaluate(()=>__fullReads),[]);await home.frame.locator('#back').click();
 // Valid PSD import, with a delayed font query to inspect the creation screen.
 const rgba=(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4).fill(255)});
 const tiny=writePsd({width:10,height:10,imageData:rgba(10,10),children:[{name:'pixels',imageData:rgba(2,2)}]});
 await home.page.evaluate(()=>{window.__delayBuild=true;});
 await home.frame.locator('#file').setInputFiles({name:'tiny.PSD',mimeType:'application/octet-stream',buffer:Buffer.from(tiny)});
 await home.frame.locator('#msg').filter({hasText:'正在读取 Figma 字体…'}).waitFor();await capture(home,'progress');
 await home.page.waitForFunction(()=>typeof window.__releaseBuild==='function');await home.page.evaluate(()=>{window.__delayBuild=false;window.__releaseBuild();});
 await home.frame.locator('#again').waitFor();assert.equal(await home.frame.locator('h1').innerText(),'导入完成');
 assert.equal(await home.frame.locator('.warnings').count(),0);await noRemovedUI(home.frame);await capture(home,'done-clean');
 assert.equal(await home.frame.locator('button').count(),1);
 const d=(code,status='unsupported',extra={})=>({sourceId:code,name:'SECRET-LAYER',code,status,message:'Raw technical details',...extra});
 const diagnostics=[...Array(200).fill(d('text-fallback','rasterized')),d('text-default-font','editable'),d('stroke-miter-limit','editable',{strokeAppearance:'unchanged'}),d('shadow-contour','unsupported',{issues:[{code:'shadow-contour',message:'shadow'},{code:'missing-content',message:'missing'}]})];
 await home.document.evaluate(diagnostics=>window.postMessage({pluginMessage:{type:'done',stats:{artboards:16},nativeStats:{vectors:1103,texts:0,images:311},diagnostics}},'*'),diagnostics);
 await home.frame.locator('.warnings li').nth(2).waitFor();assert.equal(await home.frame.locator('.warnings li').count(),3);
 assert.match(await home.frame.locator('.warnings').innerText(),/原字体缺失或无法加载，已使用默认字体替代并保留可编辑文字/);
 assert.ok(!(await home.frame.locator('body').innerText()).includes('SECRET-LAYER'));await capture(home,'done-notices');
 // Runtime memory errors are readable as well, on either side of the bridge.
 await home.document.evaluate(()=>window.postMessage({pluginMessage:{type:'done',error:'Exceeded memory limit'}},'*'));
 await home.frame.locator('.error').filter({hasText:'导入所需内存不足，请拆分文件后重试。'}).waitFor();await capture(home,'memory-error');
 await home.page.close();reports.push('homepage, drop, checking/cancel, progress, completion and memory error');
 for(const mode of ['mismatch','timeout']){
  const test=await open(mode);assert.equal(await test.frame.locator('.error').innerText(),'插件加载异常，请关闭后重新打开。');await noRemovedUI(test.frame);await capture(test,mode);await test.page.close();
 }
 reports.push('hidden handshake mismatch and timeout remain enforced');
 if(process.env.SAMPLE_DIR){
  const large=await open();await large.frame.locator('#file').setInputFiles(path.join(process.env.SAMPLE_DIR,'v1.0.psd'));
  await large.frame.locator('.error').filter({hasText:'该文件图层或图片过大，请在 Photoshop 中按画板拆分后再导入。'}).waitFor({timeout:60000});
  const trace=await large.document.evaluate(()=>({stages:__stages,pixelAllocations:__pixelAllocations,workers:__workers}));
  assert.equal(trace.pixelAllocations,0);assert.equal(trace.workers,0);assert.ok(trace.stages.every(s=>s==='正在检查文件…'));
  assert.equal(await large.page.evaluate(()=>__host.imports.length),0);await capture(large,'large-psd');
  await large.frame.locator('#back').click();await large.frame.locator('#pick:enabled').waitFor();
  reports.push({largePsdRejectedBeforeConversion:trace});await large.page.close();
 }
 assert.deepEqual(errors,[]);await fs.writeFile('.test-output/ui-report.json',JSON.stringify({scope:'Real browser + shipped UI/code + node harness, not a Figma renderer',reports,errors},null,2));
 console.log('PASS',JSON.stringify(reports));
}finally{await browser.close();}
