import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {pluginHost} from './plugin-host.mjs';

const [html,main]=await Promise.all(['ui.html','code.js'].map(p=>fs.readFile(p,'utf8')));
const manifest=JSON.parse(await fs.readFile('manifest.json','utf8'));
assert.deepEqual(manifest.networkAccess.allowedDomains,['none']);
assert.equal(manifest.documentAccess,'dynamic-page');
for(const text of ['启动本机转换.cmd','localhost:47823','复制连接码'])assert.ok(!html.includes(text),text);
const eps='%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 240 160\n1 0 0 setrgbcolor 10 10 moveto 150 10 lineto 150 110 lineto closepath fill\n0 0 1 setrgbcolor 180 80 25 0 360 arc fill\nshowpage\n%%EOF\n';
const ps='%!PS-Adobe-3.0\n<< /PageSize [200 100] >> setpagedevice\n0 1 0 setrgbcolor 10 10 60 30 rectfill showpage\n/Helvetica findfont 18 scalefont setfont 10 50 moveto (Vector text) show showpage\n';
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({viewport:{width:440,height:680}}),requests=[],errors=[];
await context.route(/^https?:\/\//,route=>{requests.push(route.request().url());return route.abort('blockedbyclient');});
const report=[];
async function open({shortTimeout=false}={}){
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<style>body{margin:0}</style>');
  await page.addScriptTag({content:'window.__host=('+pluginHost.toString().replace('allow-scripts allow-same-origin allow-downloads','allow-scripts allow-downloads')+')();window.figma=window.__host.figma;'});
  await page.addScriptTag({content:'window.addEventListener("message",event=>{if(event.data?.pluginMessage?.type==="import")window.__scene=event.data.pluginMessage.result;});'});
  const csp='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'wasm-unsafe-eval\' blob:; worker-src blob:; connect-src \'none\'; img-src data: blob:; style-src \'unsafe-inline\';">';
  const time=shortTimeout?'<script>const originalTimeout=window.setTimeout.bind(window);window.setTimeout=(f,t,...a)=>originalTimeout(f,t===180000?100:t,...a);</script>':'';
  const content=html.replace('<head>','<head>'+csp+time);
  await page.addScriptTag({content:'const __html__='+JSON.stringify(content)+';'+main});
  const frame=page.frameLocator('iframe');await frame.locator('#pick:enabled').waitFor({timeout:30000});
  return {page,frame};
}
async function successful(name,buffer,boards=1){
  const {page,frame}=await open();
  console.log('CHECK',name);
  await frame.locator('#file').setInputFiles({name,mimeType:'application/octet-stream',buffer});
  await Promise.race([
    page.waitForFunction(()=>window.__host.messages.some(m=>m.type==='done'),{},{timeout:90000}),
    frame.locator('#back').waitFor({timeout:90000}).then(async()=>{throw new Error(name+': '+await frame.locator('.sub.error').innerText());})
  ]);
  const result=await page.evaluate(()=>window.__host.messages.filter(m=>m.type==='done').at(-1));
  assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.stats.artboards,boards);
  if(name==='shapes.eps'||name==='binary.eps')assert.deepEqual(await page.evaluate(()=>({width:window.__scene.width,height:window.__scene.height})),{width:240,height:160});
  if(name.endsWith('.eps')||name.endsWith('.ps')||name==='legacy.ai'){
    assert.ok(result.nativeStats.vectors>0);assert.equal(result.nativeStats.images,0,'PostScript vectors must not become a page bitmap');
  }
  report.push({name,stats:result.stats,nativeStats:result.nativeStats});await page.close();return result;
}
try{
  const initial=await open();assert.equal(await initial.frame.locator('#local,#token,#connect').count(),0);
  await initial.page.screenshot({path:'.test-output/community-start.png'});await initial.page.close();
  await successful('shapes.eps',Buffer.from(eps));
  await successful('pages.ps',Buffer.from(ps),2);
  await successful('legacy.ai',Buffer.from(eps));
  const header=Buffer.alloc(30);header.writeUInt32LE(0xc6d3d0c5,0);header.writeUInt32LE(30,4);header.writeUInt32LE(Buffer.byteLength(eps),8);
  await successful('binary.eps',Buffer.concat([header,Buffer.from(eps),Buffer.from('unused preview')]));
  await successful('compatible.ai',await fs.readFile('.test-output/operator-fixture.pdf'));
  await successful('document.pdf',await fs.readFile('.test-output/operator-fixture.pdf'));
  const packaged={version:2,width:10,height:10,nodes:[{kind:'frame',name:'board',x:0,y:0,width:10,height:10,artboard:true,clip:true,children:[]}],resources:{},diagnostics:[],warnings:[]};
  await successful('saved.figimport',Buffer.from(zipSync({'manifest.json':strToU8(JSON.stringify({schema:'figma-import-package',version:2,scene:'scene.json'})),'scene.json':strToU8(JSON.stringify(packaged))})));
  const failure=await open();
  for(const [name,buffer,expected] of [
    ['broken.eps',Buffer.from('%!PS-Adobe-3.0\nnotAnOperator'),'转换未完成'],
    ['private.ai',Buffer.from('private Illustrator content'),'不含可读取的 PDF 或 PostScript'],
    ['invalid.eps',Buffer.from([0xc5,0xd0,0xd3,0xc6]),'文件头不完整'],
  ]){
    await failure.frame.locator('#file').setInputFiles({name,mimeType:'application/octet-stream',buffer});
    await failure.frame.locator('.error').filter({hasText:expected}).waitFor({timeout:30000});
    assert.equal(await failure.page.evaluate(()=>window.__host.figma.currentPage.children.length),0);
    await failure.frame.locator('#back').click();
  }
  await failure.frame.locator('#file').setInputFiles({name:'cancel.ps',mimeType:'application/postscript',buffer:Buffer.from('%!PS-Adobe-3.0\n{} loop')});
  await failure.frame.locator('#msg').filter({hasText:'正在转换 EPS / PS'}).waitFor({timeout:30000});
  await failure.frame.locator('#cancel').click();await failure.frame.locator('.error').filter({hasText:'导入已取消'}).waitFor();
  await failure.frame.locator('#back').click();
  await failure.frame.locator('#file').setInputFiles({name:'after-cancel.eps',mimeType:'application/postscript',buffer:Buffer.from(eps)});
  await failure.page.waitForFunction(()=>window.__host.messages.some(m=>m.type==='done'),{},{timeout:30000});
  assert.equal(await failure.page.evaluate(()=>window.__host.messages.filter(m=>m.type==='done').at(-1).error),undefined);
  await failure.page.close();
  const timeout=await open({shortTimeout:true});
  await timeout.frame.locator('#file').setInputFiles({name:'timeout.ps',mimeType:'application/postscript',buffer:Buffer.from('%!PS-Adobe-3.0\n{} loop')});
  await timeout.frame.locator('.error').filter({hasText:'转换超过 3 分钟'}).waitFor({timeout:30000});await timeout.page.close();
  const fonts=await successful('missing-font.ps',Buffer.from('%!PS-Adobe-3.0\n/AFontThatDoesNotExist123 findfont 18 scalefont setfont 10 50 moveto (Test) show showpage\n'));
  assert.ok(fonts.diagnostics.some(d=>d.code==='postscript-font'),'Font substitution must be reported');
  assert.deepEqual(requests,[],'No HTTP requests, even for engine initialization');assert.deepEqual(errors,[]);
  await fs.writeFile('.test-output/browser-report.json',JSON.stringify({scope:'Opaque-origin iframe + restrictive CSP + real WASM + node harness; not a Figma renderer',requests,errors,cases:report,failuresAndCancellation:true},null,2));
  console.log('PASS EPS, PS pages + text, legacy AI, binary EPS, PDF/AI, offline package, invalid inputs, cancel/retry, timeout, font warning; 0 network requests');
}finally{await browser.close();}
