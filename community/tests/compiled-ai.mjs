import {chromium} from 'playwright';import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {pluginHost} from './plugin-host.mjs';
const sample=process.env.AI_PERF_SAMPLE;if(!sample)throw new Error('Set AI_PERF_SAMPLE to a private AI/PDF sample.');
const input=await fs.readFile(sample),report={scope:'Local browser + actual bundles + approximate node host; not a Figma renderer; no network upload',cases:[]};
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const requests=[];
try{
 const editions=[...(process.env.AI_BASELINE_DIR?[{name:'archived-community',dir:process.env.AI_BASELINE_DIR}]:[]),{name:'current-ai',dir:'.'},{name:'current-pdf',dir:'.'}];
 for(const edition of editions){
  const [main,html]=await Promise.all(['code.js','ui.html'].map(file=>fs.readFile(path.join(edition.dir,file),'utf8')));
  const page=await browser.newPage({viewport:{width:440,height:520}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https?:\/\//,route=>{requests.push(route.request().url());return route.abort('blockedbyclient');});
  await page.setContent('<style>body{margin:0}</style>');
  await page.addScriptTag({content:'window.__host=('+pluginHost.toString()+')({fonts:[{family:"Inter",style:"Regular"}]});window.figma=window.__host.figma;window.addEventListener("message",e=>{if(e.data?.pluginMessage?.type==="import")window.__parsedAt=performance.now();});'});
  await page.addScriptTag({content:'const __html__='+JSON.stringify(html)+';'+main});
  const frame=page.frameLocator('iframe');await frame.locator('#pick:enabled').waitFor({timeout:30000});
  const name=path.basename(sample).replace(/\.[^.]+$/,edition.name==='current-pdf'?'.pdf':'.ai');
  await page.evaluate(()=>{window.__startedAt=performance.now();});
  await frame.locator('#file').setInputFiles({name,mimeType:'application/octet-stream',buffer:input});
  await page.waitForFunction(()=>window.__host.messages.some(m=>m.type==='done'),{},{timeout:90000});
  const result=await page.evaluate(()=>({done:window.__host.messages.find(m=>m.type==='done'),parseMs:Math.round(window.__parsedAt-window.__startedAt),buildMs:Math.round(performance.now()-window.__parsedAt),texts:figma.currentPage.findAll(n=>n.type==='TEXT').map(n=>n.characters),fontLoads:window.__host.fontLoads,unhandled:window.__host.unhandled}));
  assert.equal(result.done.error,undefined);assert.deepEqual(errors,[]);assert.deepEqual(result.unhandled,[]);
  if(edition.name!=='archived-community'){
   assert.ok(result.done.nativeStats.texts>0);assert.equal(result.done.stats.outlinedTexts,0);assert.equal(result.done.nativeStats.images,0);
   assert.match(await frame.locator('.warnings').innerText(),/默认字体替代并保留可编辑文字/);
  }
  const summary={edition:edition.name,buildId:result.done.buildId,parseMs:result.parseMs,buildMs:result.buildMs,nativeStats:result.done.nativeStats,texts:result.texts,outlined:result.done.stats.outlinedTexts};
  report.cases.push(summary);console.log(JSON.stringify(summary));await page.close();
 }
 assert.deepEqual(requests,[]);assert.deepEqual(report.cases.at(-1).texts,report.cases.at(-2).texts);
 report.requests=requests;await fs.writeFile('.test-output/compiled-ai-report.json',JSON.stringify(report,null,2));
}finally{await browser.close();}
