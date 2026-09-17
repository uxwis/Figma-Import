import * as esbuild from 'esbuild';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { watch as watchFiles } from 'node:fs';
import { spawn } from 'node:child_process';

const watch = process.argv.includes('--watch');
const version=JSON.parse(await readFile('package.json','utf8')).version;
const sourceHash=createHash('sha256').update(version);
async function hashSources(dir){for(const item of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const file=dir+'/'+item.name;if(item.isDirectory())await hashSources(file);else sourceHash.update(file).update(await readFile(file));}}
await hashSources('src');
const buildId=version+'+'+sourceHash.digest('hex').slice(0,12);

const common = {
  bundle: true,
  // 输出 ui.html 直接作为插件 UI 文件，体积敏感，需要压缩
  minify: true,
  logLevel: 'info',
  define:{__PLUGIN_VERSION__:JSON.stringify(version),__PLUGIN_BUILD_ID__:JSON.stringify(buildId)},
  banner:{js:'/* Figma importer build: '+buildId+' */'},
};

// 构建 code.js（主线程）。
// 说明：解析全部在 ui.html（iframe）里完成，code.js 只负责接收 ParseResult
// 创建 Figma 节点，不含任何 PDF.js / 浏览器全局依赖，因此无需 polyfill banner。
async function buildCode() {
  await esbuild.build({
    ...common,
    entryPoints: ['src/code.ts'],
    outfile: 'code.js',
    format: 'iife',
    write: true,
    target: ['es2019'],
  });
}

// 构建 ui.js，并内联进 ui.html
async function buildUI() {
  // 1. 打包 ui.js（含所有依赖）
  await esbuild.build({
    ...common,
    entryPoints: ['src/ui.ts'],
    outfile: 'ui.js',
    format: 'iife',
    write: true,
    target: ['es2020'],
    loader: {
      '.wasm': 'binary',
    },
  });

  // 2. 读取 ui.html 模板和 ui.js，合并为最终 ui.html
  const [html, js] = await Promise.all([
    readFile('src/ui.html', 'utf8'),
    readFile('ui.js', 'utf8'),
  ]);

  // 用函数形式做 replacement，避免 js 内容里的 $& / $1 / $$ 等特殊模式
  // 被错误展开为整个匹配（曾经导致 PDF.js 源码里 "$&" 变成 "<script src="ui.js"></script>"）
  const finalHtml = html.replace(
    '<script src="ui.js"></script>',
    () => `<script>${js}</script>`,
  );

  await writeFile('ui.html', finalHtml);

  // 3. 清理临时 ui.js
  try {
    const { unlink } = await import('node:fs/promises');
    await unlink('ui.js');
  } catch {}
}

async function buildAll() {
  try {
    await buildCode();
    await buildUI();
    await esbuild.build({bundle:true,entryPoints:['src/parsers/index.ts'],outfile:'helper/parser.mjs',format:'esm',platform:'node',packages:'external',target:'node22'});
    const files={};for(const name of ['code.js','ui.html'])files[name]=createHash('sha256').update(await readFile(name)).digest('hex');
    await writeFile('build-info.json',JSON.stringify({version,buildId,files},null,2));
    console.log('✅ 构建完成：code.js + ui.html（已内联依赖）');
  } catch (err) {
    console.error('❌ 构建失败：', err);
    process.exit(1);
  }
}

if (watch) {
  // Rebuild both runtimes together so the UI/main handshake never mixes builds.
  await buildAll();
  let timer,running=false,again=false;
  const rebuild=()=>{
    if(running){again=true;return;}running=true;
    const child=spawn(process.execPath,['build.mjs'],{stdio:'inherit',windowsHide:true});
    child.once('exit',()=>{running=false;if(again){again=false;rebuild();}});
  };
  const changed=()=>{clearTimeout(timer);timer=setTimeout(rebuild,150);};
  watchFiles('src',{recursive:true},changed);watchFiles('package.json',changed);
  console.log('👀 监听中：主程序、界面及版本标识将同步构建。');
} else {
  await buildAll();
}
