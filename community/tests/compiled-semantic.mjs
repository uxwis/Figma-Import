import {chromium} from 'playwright';import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {pluginHost} from './plugin-host.mjs';
const sample=process.env.PDF_SEMANTIC_SAMPLE;if(!sample)throw new Error('Set PDF_SEMANTIC_SAMPLE');
const [input,main,html]=await Promise.all([fs.readFile(sample),fs.readFile('code.js','utf8'),fs.readFile('ui.html','utf8')]);
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}),requests=[],errors=[];
try{const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));await page.route(/^https?:\/\//,route=>{requests.push(route.request().url());return route.abort('blockedbyclient');});
 await page.setContent('<style>body{margin:0}</style>');await page.addScriptTag({content:'window.__host=('+pluginHost.toString()+')({fonts:[{family:"Inter",style:"Regular"}]});window.figma=window.__host.figma;'});
 await page.addScriptTag({content:'const __html__='+JSON.stringify(html)+';'+main});const frame=page.frameLocator('iframe');await frame.locator('#pick:enabled').waitFor({timeout:30000});
 await frame.locator('#file').setInputFiles({name:'semantic-sample.pdf',mimeType:'application/pdf',buffer:input});await page.waitForFunction(()=>window.__host.messages.some(m=>m.type==='done'),{},{timeout:90000});
 const result=await page.evaluate(()=>{const texts=figma.currentPage.findAll(n=>n.type==='TEXT'),vectors=figma.currentPage.findAll(n=>n.type==='VECTOR');return{done:window.__host.messages.find(m=>m.type==='done'),unhandled:window.__host.unhandled,texts:texts.map(n=>({characters:n.characters,visible:n.visible,data:JSON.parse(n.metadata['import:source-data'])})),vectorIds:vectors.map(n=>JSON.parse(n.metadata['import:source']).id)};});
 assert.equal(result.done.error,undefined);assert.deepEqual(result.unhandled,[]);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);assert.equal(result.texts.length,44);assert.ok(result.texts.every(t=>t.visible&&t.data.pdfSemanticText?.restored));
 const removedIds=new Set(result.texts.flatMap(t=>t.data.pdfSemanticText.outlineIds));assert.equal(removedIds.size,44);assert.ok(result.vectorIds.every(id=>!removedIds.has(id)));
 assert.equal(result.done.nativeStats.vectors,42);assert.equal(result.done.nativeStats.images,6);assert.equal(result.done.stats.outlinedTexts,0);assert.match(await frame.locator('.warnings').innerText(),/默认字体替代并保留可编辑文字/);
 const report={scope:'Local browser, actual bundle and strict node host; not the Figma renderer',buildId:result.done.buildId,nativeStats:result.done.nativeStats,visibleTexts:result.texts.length,removedOutlineLayers:removedIds.size,restoredGlyphs:result.texts.reduce((sum,t)=>sum+t.data.pdfSemanticText.glyphs,0),requests};
 await fs.writeFile('.test-output/compiled-semantic-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
