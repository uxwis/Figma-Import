// Private full-file execution against the shipped UI/main bundles. Strictly
// validates strokeMiterLimit and rollback; does not certify visual fidelity.
import {chromium} from 'playwright';
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {pluginHost} from './plugin-host.mjs';
const sampleDir=process.env.SAMPLE_DIR;if(!sampleDir)throw new Error('Set SAMPLE_DIR to the private sample directory.');
const sample=path.join(sampleDir,'社区需求.psd');const input=await fs.readFile(sample);
const cases=[...(process.env.OLD_PLUGIN_DIR?[{dir:process.env.OLD_PLUGIN_DIR,expected:'miter-error'}]:[]),{dir:'.',expected:'success'}];
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':undefined),headless:true});
const report={sample:path.basename(sample),bytes:input.length,sha256:crypto.createHash('sha256').update(input).digest('hex'),scope:'Local browser + shipped bundles + miter-validating node harness; not a Figma renderer',cases:[]};
try{
 for(const testCase of cases){
  const [main,html]=await Promise.all(['code.js','ui.html'].map(file=>fs.readFile(path.join(testCase.dir,file),'utf8')));
  const page=await browser.newPage({viewport:{width:440,height:720}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  // The real sample never leaves this local browser process.
  await page.route(/^https?:\/\//,route=>route.abort('blockedbyclient'));
  await page.setContent('<style>body{margin:0}</style>');
  await page.addScriptTag({content:'window.__host=('+pluginHost.toString()+')();window.figma=window.__host.figma;'});
  await page.addScriptTag({content:'const __html__='+JSON.stringify(html)+';'+main});
  const frame=page.frameLocator('iframe');await frame.locator('#file').waitFor({state:'attached'});
  if(testCase.expected==='success')await frame.locator('#build-info').filter({hasText:'主程序已核对'}).waitFor();
  const start=Date.now();await frame.locator('#file').setInputFiles(sample);
  await page.waitForFunction(()=>window.__host.messages.some(m=>m.type==='done'),{},{timeout:120000});
  const state=await page.evaluate(()=>({done:window.__host.messages.filter(m=>m.type==='done').at(-1),writes:window.__host.writes,imports:window.__host.imports,unhandled:window.__host.unhandled,remainingRoots:window.__host.figma.currentPage.children.length}));
  assert.deepEqual(errors,[]);assert.deepEqual(state.unhandled,[]);
  if(testCase.expected==='miter-error'){
   assert.match(state.done.error,/strokeMiterLimit.*16/);assert.ok(state.writes.includes(100));assert.equal(state.remainingRoots,0);
  }else{
   assert.equal(state.done.error,undefined);assert.equal(state.done.stats.artboards,10);assert.ok(state.writes.length>0);assert.ok(state.writes.every(v=>Number.isFinite(v)&&v>=1&&v<=16));
   assert.equal(state.done.diagnostics.filter(d=>d.code==='stroke-miter-limit').length,36);
   assert.equal(state.done.diagnostics.filter(d=>d.code==='stroke-miter-limit'&&d.status==='unsupported').length,0);
   await frame.locator('#report').waitFor();
   await page.screenshot({path:'.test-output/community-compiled-import.png'});
   // Exercise the bundled main's version gate: mismatched UI must create nothing.
   await page.evaluate(async()=>window.__host.figma.ui.onmessage({type:'import',buildId:'old-build',requestId:'mismatch',result:{version:2,nodes:[]}}));
   const blocked=await page.evaluate(()=>({message:window.__host.messages.at(-1),roots:window.__host.figma.currentPage.children.length}));
   assert.match(blocked.message.error,/版本不一致/);assert.equal(blocked.roots,state.remainingRoots);
  }
  const summary={directory:testCase.dir,expected:testCase.expected,elapsedMs:Date.now()-start,codeSha256:crypto.createHash('sha256').update(main).digest('hex'),error:state.done.error||null,buildId:state.done.buildId||null,artboards:state.done.stats?.artboards||0,miterWrites:state.writes.length,maxMiter:Math.max(...state.writes),adapted:state.done.diagnostics?.filter(d=>d.code==='stroke-miter-limit').length||0};
  report.cases.push(summary);console.log(JSON.stringify(summary));await page.close();
 }
 await fs.writeFile('.test-output/compiled-community-report.json',JSON.stringify(report,null,2));
}finally{await browser.close();}
