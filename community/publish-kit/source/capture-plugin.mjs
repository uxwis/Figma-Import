import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {pluginHost} from '../../tests/plugin-host.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const community = path.resolve(root, '..');
await fs.mkdir(path.join(root, 'assets'), {recursive:true});
const [html, main] = await Promise.all(['ui.html', 'code.js'].map(p => fs.readFile(path.join(community,p),'utf8')));
const browser = await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:true});
try {
  const page = await browser.newPage({viewport:{width:440,height:520},deviceScaleFactor:2});
  await page.route(/^https?:\/\//, route => route.abort());
  await page.setContent('<style>body{margin:0}</style>');
  await page.addScriptTag({content:'window.__host=('+pluginHost.toString()+')();window.figma=window.__host.figma;'});
  await page.addScriptTag({content:'const __html__='+JSON.stringify(html)+';'+main});
  const frame = page.frameLocator('iframe');
  await frame.locator('#pick:enabled').waitFor();
  await page.locator('iframe').screenshot({path:path.join(root,'assets/plugin-home.png')});
  await frame.locator('summary').click();
  await page.locator('iframe').screenshot({path:path.join(root,'assets/plugin-instructions.png')});
  console.log('Captured current shipped plugin UI at 2x. Browser host; not a Figma canvas rendering.');
} finally { await browser.close(); }
