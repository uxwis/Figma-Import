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
 const cases=[['dribbble-1.psd',1,0],['社区需求.psd',10,36],['红包转赠(18.3.21).psd',16,undefined],['森篮.psd',5,undefined,148]].filter(([name])=>process.env.SAMPLE_FILE?name===process.env.SAMPLE_FILE:name!=='森篮.psd');
 assert.ok(cases.length,'Unknown SAMPLE_FILE');
 for(const [name,boards,adapted,texts] of cases){
  const sample=path.join(sampleDir,name),input=await fs.readFile(sample);
  const page=await browser.newPage({viewport:{width:440,height:720}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https?:\/\//,route=>route.abort('blockedbyclient'));
  await page.setContent('<style>body{margin:0}</style>');
  const fonts=texts?[{family:'Noto Sans SC',style:'Regular'},{family:'Noto Sans SC',style:'Medium'},{family:'Noto Sans SC',style:'Bold'},{family:'DINPro-Medium',style:'Regular'},{family:'DINPro-Regular',style:'Regular'},{family:'Inter',style:'Regular'}]:[];
  await page.addScriptTag({content:'window.__host=('+pluginHost.toString()+')('+JSON.stringify({fonts})+');window.figma=window.__host.figma;'});
  await page.addScriptTag({content:'const __html__='+JSON.stringify(html)+';'+main});
  const frame=page.frameLocator('iframe');await frame.locator('#pick:enabled').waitFor();
  const start=Date.now();await frame.locator('#file').setInputFiles(sample);
  await page.waitForFunction(()=>window.__host.messages.some(m=>m.type==='done'),{},{timeout:120000});
  const state=await page.evaluate(()=>{
   const objects=window.__host.figma.currentPage.findAll(n=>JSON.parse(n.metadata['import:source']||'{}').type==='vector-smart-object');
   const vectorSmartObjects=objects.map(n=>{const subtree=[n,...n.findAll()];return{nativeOverlay:!!n.metadata['import:vector-overlay'],paths:subtree.filter(n=>n.type==='VECTOR'&&n.vectorPaths.length).length,images:subtree.filter(n=>(n.fills||[]).some(p=>p.type==='IMAGE')||(n.strokes||[]).some(p=>p.type==='IMAGE')).length,masks:subtree.filter(n=>n.isMask).length};});
   const gradientTexts=window.__host.figma.currentPage.findAll(n=>n.metadata['import:text-overlay']).map(n=>({type:n.type,characters:n.characters,paints:n.fills.map(p=>p.type),children:n.children.length,isMask:!!n.isMask}));
   return{done:window.__host.messages.filter(m=>m.type==='done').at(-1),writes:window.__host.writes,unhandled:window.__host.unhandled,remainingRoots:window.__host.figma.currentPage.children.length,vectorSmartObjects,gradientTexts,invalidPaths:window.__host.figma.currentPage.findAll(n=>n.type==='VECTOR'&&n.vectorPaths.some(p=>!/^\s*M/.test(p.data))).map(n=>n.name)};
  });
  assert.deepEqual(errors,[]);assert.deepEqual(state.unhandled,[]);assert.equal(state.done.error,undefined);
  assert.deepEqual(state.invalidPaths,[]);
  assert.equal(state.done.stats.artboards,boards);assert.ok(state.writes.every(v=>Number.isFinite(v)&&v>=1&&v<=16));
  if(texts!==undefined){
   assert.equal(state.done.nativeStats.texts,texts);
   assert.equal(state.done.diagnostics.filter(d=>/^text-(fallback|transform)$/.test(d.code)).length,0);
   assert.ok(state.done.diagnostics.some(d=>d.issues?.some(i=>i.code==='text-font-substitution')));
   assert.equal(state.vectorSmartObjects.length,75);assert.equal(state.vectorSmartObjects.filter(n=>n.nativeOverlay).length,69);
   assert.ok(state.vectorSmartObjects.every(n=>n.paths>0&&n.images===0&&n.masks===0));assert.equal(state.done.nativeStats.images,20);
   assert.equal(state.gradientTexts.length,6);assert.ok(state.gradientTexts.every(n=>n.type==='TEXT'&&n.paints.includes('GRADIENT_LINEAR')&&!n.paints.includes('IMAGE')&&n.children===0&&!n.isMask));
  }
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
  const summary={name,bytes:input.length,sourceSha256:crypto.createHash('sha256').update(input).digest('hex'),elapsedMs:Date.now()-start,buildId:state.done.buildId,stats:state.done.stats,nativeStats:state.done.nativeStats,vectorSmartObjects:state.vectorSmartObjects.length,nativeVectorOverlays:state.vectorSmartObjects.filter(n=>n.nativeOverlay).length,imagesInsideVectorSmartObjects:state.vectorSmartObjects.reduce((s,n)=>s+n.images,0),editableGradientTexts:state.gradientTexts.length,diagnosticCounts,notices,adapted};
  report.cases.push(summary);console.log(JSON.stringify(summary));await page.close();
 }
 await fs.writeFile('.test-output/compiled-community-report.json',JSON.stringify(report,null,2));
}finally{await browser.close();}
