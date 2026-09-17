// Runs private PSDs through the actual community bundles and a strict node harness.
// This is not a Figma renderer; source files stay in the local browser.
import {chromium} from 'playwright';
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {pluginHost} from './plugin-host.mjs';
const sampleDir=process.env.SAMPLE_DIR;if(!sampleDir)throw new Error('Set SAMPLE_DIR to the private sample directory.');
const [main,html]=await Promise.all(['code.js','ui.html'].map(file=>fs.readFile(file,'utf8')));
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':undefined),headless:true});
const report={scope:'Local browser + shipped bundles + strict node harness; not a Figma renderer',cases:[]};
try{
 const cases=[['dribbble-1.psd',1,0],['社区需求.psd',10,36],['红包转赠(18.3.21).psd',16,undefined]].filter(([name])=>!process.env.SAMPLE_FILE||name===process.env.SAMPLE_FILE);
 assert.ok(cases.length,'Unknown SAMPLE_FILE');
 for(const [name,boards,adapted] of cases){
  const sample=path.join(sampleDir,name),input=await fs.readFile(sample);
  const page=await browser.newPage({viewport:{width:440,height:720}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https?:\/\//,route=>route.abort('blockedbyclient'));
  await page.setContent('<style>body{margin:0}</style>');
  await page.addScriptTag({content:'window.__host=('+pluginHost.toString()+')();window.figma=window.__host.figma;'});
  await page.addScriptTag({content:'const __html__='+JSON.stringify(html)+';'+main});
  const frame=page.frameLocator('iframe');await frame.locator('#pick:enabled').waitFor();
  const start=Date.now();await frame.locator('#file').setInputFiles(sample);
  await page.waitForFunction(()=>window.__host.messages.some(m=>m.type==='done'),{},{timeout:120000});
  const state=await page.evaluate(()=>({done:window.__host.messages.filter(m=>m.type==='done').at(-1),writes:window.__host.writes,unhandled:window.__host.unhandled,remainingRoots:window.__host.figma.currentPage.children.length,invalidPaths:window.__host.figma.currentPage.findAll(n=>n.type==='VECTOR'&&n.vectorPaths.some(p=>!/^\s*M/.test(p.data))).map(n=>n.name)}));
  assert.deepEqual(errors,[]);assert.deepEqual(state.unhandled,[]);assert.equal(state.done.error,undefined);
  assert.deepEqual(state.invalidPaths,[]);
  assert.equal(state.done.stats.artboards,boards);assert.ok(state.writes.every(v=>Number.isFinite(v)&&v>=1&&v<=16));
  if(adapted!==undefined){
   assert.equal(state.done.diagnostics.filter(d=>d.code==='stroke-miter-limit').length,adapted);
   assert.equal(state.done.diagnostics.filter(d=>d.code==='stroke-miter-limit'&&d.status==='unsupported').length,0);
  }
  await frame.locator('#again').waitFor();
  assert.equal(await frame.locator('#report,#render,#build-info').count(),0);
  assert.ok(await frame.locator('.warnings li').count()<=3);
  const notices=await frame.locator('.warnings li').allTextContents();
  await page.screenshot({path:'.test-output/'+name+'-compiled.png'});
  await page.evaluate(async()=>window.__host.figma.ui.onmessage({type:'import',buildId:'old-build',requestId:'mismatch',result:{version:2,nodes:[]}}));
  const blocked=await page.evaluate(()=>({message:window.__host.messages.at(-1),roots:window.__host.figma.currentPage.children.length}));
  assert.equal(blocked.message.error,'插件加载异常，请关闭后重新打开。');assert.equal(blocked.roots,state.remainingRoots);
  const diagnosticCounts={};for(const d of state.done.diagnostics)diagnosticCounts[d.code]=(diagnosticCounts[d.code]||0)+1;
  const summary={name,bytes:input.length,sourceSha256:crypto.createHash('sha256').update(input).digest('hex'),elapsedMs:Date.now()-start,buildId:state.done.buildId,stats:state.done.stats,nativeStats:state.done.nativeStats,diagnosticCounts,notices,adapted};
  report.cases.push(summary);console.log(JSON.stringify(summary));await page.close();
 }
 await fs.writeFile('.test-output/compiled-community-report.json',JSON.stringify(report,null,2));
}finally{await browser.close();}
