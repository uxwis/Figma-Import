import {chromium}from'playwright';
import fs from'node:fs/promises';import assert from'node:assert/strict';
import {zipSync,strToU8}from'fflate';
const buildInfo=JSON.parse(await fs.readFile('build-info.json','utf8'));
async function connectMain(page){await page.evaluate(info=>window.addEventListener('message',event=>{if(event.data?.pluginMessage?.type==='get-build')event.source.postMessage({pluginMessage:{type:'build-info',...info}},'*');}),buildInfo);}
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':undefined),headless:true});
try{
 const page=await browser.newPage({viewport:{width:440,height:680}});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('BROWSER',e.message);});
 let localRequests=0;page.on('request',r=>{if(r.url().startsWith('http://localhost:47823'))localRequests++;});
 await page.setContent('<iframe id="plugin" sandbox="allow-scripts allow-downloads allow-same-origin"></iframe>');
 await connectMain(page);
 const html=await fs.readFile('ui.html','utf8');await page.locator('iframe').evaluate((el,src)=>el.srcdoc=src,html);
 const frame=page.frameLocator('iframe');await frame.locator('#file').waitFor({state:'attached'});
 assert.equal(await frame.locator('#token').isVisible(),false);
 await page.evaluate(()=>{window.imports=[];window.addEventListener('message',e=>{if(e.data?.pluginMessage?.type==='import')window.imports.push(e.data.pluginMessage);});});
 await frame.locator('#file').setInputFiles('.test-output/operator-fixture.pdf');
 await page.waitForFunction(()=>window.imports.length===1,{},{timeout:20000});
 const result=await page.evaluate(()=>({stats:window.imports[0].result.stats,version:window.imports[0].result.version}));
 assert.equal(result.version,2);assert.equal(result.stats.images,1);assert.equal(result.stats.unsupported,0);assert.deepEqual(errors,[]);
 assert.equal(localRequests,0,'Direct import must not contact the companion');
 console.log('PASS browser iframe PDF.js worker, canvas image, gradients',result.stats);
 await page.screenshot({path:'.test-output/iframe-smoke.png'});

 // Exercise the actual shipped UI with HTTP responses at the companion boundary.
 const connectPage=await browser.newPage({viewport:{width:440,height:820}});
 connectPage.on('pageerror',e=>errors.push(e.message));
 await connectPage.setContent('<style>body{margin:0}iframe{width:100vw;height:100vh;border:0}</style><iframe sandbox="allow-scripts allow-downloads allow-same-origin"></iframe>');
 await connectMain(connectPage);
 await connectPage.locator('iframe').evaluate((el,src)=>el.srcdoc=src,html);
 await connectPage.evaluate(()=>{window.imports=[];window.addEventListener('message',e=>{if(e.data?.pluginMessage?.type==='import')window.imports.push(e.data.pluginMessage);});});
 const localFrame=connectPage.frameLocator('iframe');await localFrame.locator('#file').waitFor({state:'attached'});
 await connectPage.screenshot({path:'.test-output/onboarding-direct.png'});
 let mode='offline';const requests=[];
 const scene={version:2,width:10,height:10,nodes:[],resources:{},diagnostics:[],warnings:[]};
 const bytes=Buffer.from(zipSync({'manifest.json':strToU8(JSON.stringify({schema:'figma-import-package',version:2,scene:'scene.json'})),'scene.json':strToU8(JSON.stringify(scene))}));
 await connectPage.route('http://localhost:47823/**',async route=>{
  const request=route.request(),url=new URL(request.url());requests.push({method:request.method(),path:url.pathname});
  if(mode==='offline')return route.abort('connectionrefused');
  if(request.headers().authorization!=='Bearer valid-code')return route.fulfill({status:401,json:{error:'Pairing token required'}});
  if(url.pathname==='/capabilities')return route.fulfill({json:{version:2,node:mode!=='missing-node',ghostscript:true,formats:['eps','pdf']}});
  if(request.method()==='DELETE')return route.fulfill({json:{cancelled:true}});
  if(request.method()==='POST')return route.fulfill({json:{id:'new-user-import'}});
  if(url.pathname.endsWith('/result'))return route.fulfill({contentType:'application/octet-stream',body:bytes});
  return route.fulfill({json:{state:'done',progress:100,message:'完成'}});
 });
 await localFrame.locator('#file').setInputFiles({name:'new-user.EPS',mimeType:'application/postscript',buffer:Buffer.from('%!PS\nshowpage')});
 assert.equal(await localFrame.locator('#token').isVisible(),true);assert.equal(requests.length,0);
 assert.match(await localFrame.locator('.pending-file').innerText(),/new-user.EPS/);
 await localFrame.locator('#connect').click();await localFrame.locator('#connection-status').filter({hasText:'请先在本机程序中'}).waitFor();assert.equal(requests.length,0);
 await localFrame.locator('#token').fill('bad-code');mode='online';await localFrame.locator('#connect').click();
 await localFrame.locator('#connection-status').filter({hasText:'连接码不正确或已失效'}).waitFor();
 mode='offline';await localFrame.locator('#connect').click();await localFrame.locator('#connection-status').filter({hasText:'未连接到本机程序'}).waitFor();
 mode='missing-node';await localFrame.locator('#token').fill('valid-code');await localFrame.locator('#connect').click();await localFrame.locator('#connection-status').filter({hasText:'缺少 Node.js'}).waitFor();
 assert.equal(requests.filter(r=>r.method==='POST').length,0,'No file is submitted before successful connection');
 await connectPage.screenshot({path:'.test-output/onboarding-connection.png'});
 mode='online';await localFrame.locator('#connect').click();await connectPage.waitForFunction(()=>window.imports.length===1);
 assert.equal(requests.filter(r=>r.method==='POST').length,1);assert.equal(requests.filter(r=>r.method==='DELETE').length,1);
 assert.equal(await connectPage.evaluate(()=>window.imports[0].fileName),'new-user.EPS');
 // An offline package bypasses pairing even when enhanced mode is selected.
 await connectPage.locator('iframe').evaluate((el,src)=>el.srcdoc=src,html);
 await localFrame.locator('#local').check();const before=requests.length;
 await localFrame.locator('#file').setInputFiles({name:'offline.FIGIMPORT',mimeType:'application/zip',buffer:bytes});
 await connectPage.waitForFunction(()=>window.imports.length===2);assert.equal(requests.length,before);assert.deepEqual(errors,[]);
 console.log('PASS onboarding: direct/offline import without pairing, EPS guidance, missing/invalid/offline connection, resume + cleanup');
 await localFrame.locator('#build-info').filter({hasText:'主程序已核对'}).waitFor();
 await connectPage.locator('iframe').evaluate(el=>el.contentWindow.postMessage({pluginMessage:{type:'build-info',buildId:'old-code',version:'old'}},'*'));
 await localFrame.locator('#build-info').filter({hasText:'版本不一致'}).waitFor();
 await connectPage.locator('iframe').evaluate((el,src)=>el.srcdoc=src,html);
}finally{await browser.close();}





