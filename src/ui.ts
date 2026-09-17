import { parseFile } from './parsers/index';
import { readPackage, localConvert, validateScene, checkLocalConnection, type LocalCapabilities } from './package';
import type { ParseResult } from './types';
import { zipSync,strToU8 } from 'fflate';
import { BUILD_ID, PLUGIN_VERSION } from './version';
const app=document.getElementById('app')!;
const buildInfo=document.getElementById('build-info')!;
let mainBuildReady=false;
buildInfo.textContent='v'+PLUGIN_VERSION+' · 正在确认主程序版本';
let active=false,controller:AbortController|undefined,requestId='',token='',useLocal=false,lastResult:ParseResult|undefined;
let localCapabilities:LocalCapabilities|undefined,pendingFile:File|undefined,connectionCheck:AbortController|undefined;
const escape=(s:string)=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const send=(message:object)=>parent.postMessage({pluginMessage:{...message,requestId,buildId:BUILD_ID}},'*');
function download(bytes:Uint8Array,name:string,type='application/octet-stream'){
 const url=URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function idle(){
 connectionCheck?.abort();
 active=false;controller=undefined;
 app.innerHTML='<div class="container"><div class="header"><h1>导入 AI / EPS / PSD</h1><p class="sub">保留图层、路径与文字，逐项报告外观差异</p></div>'+
 '<div class="dropzone" id="drop"><div class="drop-text">拖入文件，开始导入</div><p class="sub">PSD / AI / PDF / .figimport 可直接选择</p><button class="btn-primary" id="pick">选择文件</button><input id="file" type="file" accept=".ai,.pdf,.eps,.ps,.psd,.psb,.figimport" hidden></div>'+
 '<section class="local-card"><label class="local-toggle"><input type="checkbox" id="local"> 本机增强 <span class="optional">可选</span></label><p class="sub">EPS / PS 需要本机程序；其他格式可按需开启。</p>'+
 '<div id="local-setup"'+(useLocal?'':' hidden')+'><ol class="setup-steps"><li>在解压后的插件文件夹中，双击 <strong>启动本机转换.cmd</strong>。</li><li>在打开的窗口中点击 <strong>复制连接码</strong>，保持窗口打开。</li><li>粘贴到下方，点击连接。连接成功后再导入文件。</li></ol>'+
 '<label class="input-label" for="token">连接码</label><input id="token" type="password" placeholder="粘贴本机程序中复制的连接码" autocomplete="off" spellcheck="false">'+
 '<p class="sub">这是本次连接的临时密码，无需注册。重启本机程序后需重新复制。</p>'+
 (pendingFile?'<p class="pending-file">待导入：'+escape(pendingFile.name)+' <button id="clear-pending" class="text-button">取消选择</button></p>':'')+
 '<button id="connect" class="btn-secondary">'+(pendingFile?'连接并继续导入':'连接本机程序')+'</button><p id="connection-status" class="connection-status" role="status" aria-live="polite">'+(localCapabilities?'已连接本机程序':'尚未连接')+'</p>'+
 '<details class="setup-help"><summary>首次使用 / 找不到启动文件？</summary><p>请先将新版插件 ZIP 完整解压，再打开其中的启动文件。首次使用会检查所需组件；按窗口提示准备即可。</p><p>当前 Windows 预览版需要 Python 3.12 和 Node.js；EPS 还需要 Ghostscript。完整步骤见安装包内“本机转换使用说明.html”。Mac 暂不支持本机程序。</p><p>插件无法替你启动电脑上的程序。如果已有 .figimport 离线包，直接选择文件即可，无需连接。</p></details></div></section>'+
 '<p class="privacy-note">文件在本机解析；导入后会进入当前 Figma 文件。</p></div>';
 const file=document.getElementById('file') as HTMLInputElement,drop=document.getElementById('drop')!;
 const local=document.getElementById('local') as HTMLInputElement,t=document.getElementById('token') as HTMLInputElement;
 local.checked=useLocal;t.value=token;
 local.onchange=()=>{useLocal=local.checked;if(!useLocal)pendingFile=undefined;idle();};
 t.oninput=()=>{connectionCheck?.abort();token=t.value.trim();localCapabilities=undefined;document.getElementById('connection-status')!.textContent='连接码已更新，请重新连接';(document.getElementById('connect') as HTMLButtonElement).disabled=false;};
 document.getElementById('clear-pending')?.addEventListener('click',()=>{pendingFile=undefined;idle();});
 document.getElementById('connect')!.onclick=()=>void connectLocal();
 document.getElementById('pick')!.onclick=e=>{e.stopPropagation();file.click();};drop.onclick=()=>file.click();
 drop.ondragover=e=>{e.preventDefault();drop.classList.add('drag-over');};drop.ondragleave=()=>drop.classList.remove('drag-over');
 drop.ondrop=e=>{e.preventDefault();if(e.dataTransfer?.files[0])void handle(e.dataTransfer.files[0]);};
 file.onchange=()=>{if(file.files?.[0])void handle(file.files[0]);};
}
async function connectLocal(){
 connectionCheck?.abort();const checking=new AbortController();connectionCheck=checking;
 const button=document.getElementById('connect') as HTMLButtonElement,status=document.getElementById('connection-status')!;
 button.disabled=true;status.className='connection-status';status.textContent='正在连接本机程序…';
 try{
  const cap=await checkLocalConnection(token,checking.signal);if(checking.signal.aborted||!status.isConnected)return;
  localCapabilities=cap;status.className='connection-status connected';
  status.textContent=cap.ghostscript?'连接成功，可以导入 EPS / PS 等文件':'连接成功。EPS / PS 尚需安装 Ghostscript，其他支持格式可用。';
  if(pendingFile){const file=pendingFile;pendingFile=undefined;await handle(file);}
 }catch(e){if(!checking.signal.aborted&&status.isConnected){localCapabilities=undefined;status.className='connection-status error';status.textContent=e instanceof Error?e.message:String(e);}}
 finally{if(button.isConnected&&!checking.signal.aborted)button.disabled=false;}
}
function progress(percent:number,message:string){
 app.innerHTML='<div class="container"><h1>正在导入</h1><p id="msg"></p><div class="progress-bar"><div class="progress-fill" style="width:'+Math.max(0,Math.min(100,percent))+'%"></div></div><button class="btn-secondary" id="cancel">取消本次导入</button></div>';
 document.getElementById('msg')!.textContent=message;
 document.getElementById('cancel')!.onclick=()=>{controller?.abort();send({type:'cancel-import'});document.getElementById('msg')!.textContent='正在取消并清理本次节点…';};
}
function error(message:string){
 active=false;app.innerHTML='<div class="container"><h1>导入未完成</h1><p class="sub error">'+escape(message)+'</p><button class="btn-primary" id="back">返回</button></div>';
 document.getElementById('back')!.onclick=idle;
}
async function handle(file:File){
 if(!mainBuildReady){error('主程序版本尚未确认或与界面不一致。请关闭插件后重新运行，核对窗口底部显示的版本。');return;}
 const extension=file.name.split('.').pop()?.toLowerCase(),offline=extension==='figimport';
 if(!active&&!offline){
  if(extension==='eps'||extension==='ps')useLocal=true;
  if(useLocal&&!localCapabilities){pendingFile=file;idle();document.getElementById('local-setup')!.scrollIntoView({block:'nearest'});return;}
 }
 if(active)return;active=true;controller=new AbortController();requestId=Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16)).join('-');
 progress(0,'读取 '+file.name);
 try{
 if(file.size>256*1024*1024)throw new Error('当前单文件上限为 256 MB');
 const data=offline?readPackage(await file.arrayBuffer(),{signal:controller.signal}):
 useLocal?await localConvert(file,token,controller.signal,progress):await parseFile(file.name,await file.arrayBuffer(),progress,{signal:controller.signal});
 if(controller.signal.aborted)throw new Error('导入已取消');
 lastResult=validateScene(data);progress(0,'解析完成，开始创建 Figma 图层');send({type:'import',fileName:file.name,result:lastResult});
 }catch(e){if(useLocal&&!offline){localCapabilities=undefined;pendingFile=file;}error(e instanceof Error?e.message:String(e));}
}
window.onmessage=event=>{
 const msg=event.data?.pluginMessage;if(!msg||msg.requestId&&msg.requestId!==requestId)return;
 if(msg.type==='build-info'){
  mainBuildReady=msg.buildId===BUILD_ID;
  buildInfo.textContent=mainBuildReady?'v'+PLUGIN_VERSION+' · '+BUILD_ID.split('+').pop()+' · 主程序已核对':'版本不一致 · 界面 '+BUILD_ID+' / 主程序 '+msg.buildId;
  buildInfo.classList.toggle('error',!mainBuildReady);return;
 }
 if(msg.type==='progress')progress(msg.percent,msg.msg);
 if(msg.type.startsWith('render-')){
   const button=document.getElementById('render') as HTMLButtonElement|null;
   if(msg.type==='render-progress'&&button)button.textContent='正在导出画板 '+msg.done+'/'+msg.total;
   if(msg.type==='render-error'&&button){button.disabled=false;button.textContent='导出失败：'+msg.error;}
   if(msg.type==='render-package'){
     const files:Record<string,Uint8Array>={};
     const boards=msg.rendered.map((r:{bytes:Uint8Array;path:string})=>{const {bytes,...metadata}=r;files[r.path]=bytes;return metadata;});
     files['manifest.json']=strToU8(JSON.stringify({schema:'figma-export-package',version:2,fidelityValidated:false,boards},null,2));
     files['geometry.json']=strToU8(JSON.stringify(msg.geometry,null,2));
     download(zipSync(files,{level:0}),'figma-validation.zip','application/zip');
     if(button){button.disabled=false;button.textContent='逐画板导出验收包';}
   }
   return;
 }
 if(msg.type!=='done')return;if(msg.error){error(msg.error);return;}
 active=false;
 const notes=(msg.diagnostics||[]).filter((d:{message:string})=>d.message);
 const problems=notes.filter((d:{status:string})=>['unsupported','rasterized'].includes(d.status));
 const s=msg.stats,native=msg.nativeStats||s;
 app.innerHTML='<div class="container"><h1>'+((problems.length||msg.status==='needs-review')?'导入完成，需核对差异':'节点已创建，待视觉验收')+'</h1>'+
 '<p>'+native.vectors+' 矢量路径 · '+native.texts+' 文字 · '+native.images+' 图片 · '+s.artboards+' 画板</p><p class="sub">转曲 '+s.outlinedTexts+' · 局部栅格化 '+s.rasterized+' · 未支持 '+s.unsupported+'</p>'+
 '<p class="sub">节点创建成功不代表已通过视觉一致性验收。</p><div class="warnings"><ul>'+notes.slice(0,60).map((d:{name:string;message:string})=>'<li>'+escape(d.name)+'：'+escape(d.message)+'</li>').join('')+'</ul></div>'+
 '<button class="btn-primary" id="again">继续导入</button><button class="btn-secondary" id="report">保存完整诊断</button><button class="btn-secondary" id="render">逐画板导出验收包</button></div>';
 document.getElementById('again')!.onclick=idle;
 document.getElementById('report')!.onclick=()=>download(new TextEncoder().encode(JSON.stringify({...msg,sourceDiagnostics:lastResult?.diagnostics},null,2)),'import-report.json','application/json');
 document.getElementById('render')!.onclick=()=>{const b=document.getElementById('render') as HTMLButtonElement;b.disabled=true;b.textContent='正在准备原尺寸导出…';send({type:'export-reference',nodeId:msg.rootId});};
};
idle();
send({type:'get-build'});
setTimeout(()=>{if(!mainBuildReady)buildInfo.textContent='v'+PLUGIN_VERSION+' · 主程序未匹配，请关闭后重新运行';},5000);

