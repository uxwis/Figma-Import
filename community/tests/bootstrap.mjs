import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pluginHost} from './plugin-host.mjs';

const [html,main]=await Promise.all(['ui.html','code.js'].map(file=>fs.readFile(file,'utf8')));
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const requests=[],errors=[];
try {
  for (const mode of ['missing','corrupt']) {
    const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.route(/^https?:\/\//,route=>{requests.push(route.request().url());return route.abort();});
    await page.setContent('<body></body>');
    await page.addScriptTag({content:'window.__host=('+pluginHost.toString().replace('allow-scripts allow-same-origin allow-downloads','allow-scripts allow-downloads')+')();window.figma=window.__host.figma;'});
    const csp='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'wasm-unsafe-eval\' blob:; worker-src blob:; connect-src \'none\'; style-src \'unsafe-inline\';">';
    let content=html.replace('<head>','<head>'+csp);
    content=mode==='missing'?content.replace(/<script id="plugin-source"[^>]*>[^<]*<\/script>/,''):content.replace(/data-bytes="\d+"/,'data-bytes="0"');
    await page.addScriptTag({content:'const __html__='+JSON.stringify(content)+';'+main});
    assert.equal(await page.frameLocator('iframe').locator('.error').innerText(),'插件加载异常，请关闭后重新打开。');
    assert.equal(await page.frameLocator('iframe').locator('#pick').count(),0);
    await page.close();
  }
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  console.log('PASS missing/corrupt embedded source shows a readable load error under restrictive CSP, with no network requests');
} finally { await browser.close(); }
