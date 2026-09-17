import {parseCommunityFile} from './community-parser';
import {preflightFile} from './file-preflight';
import {validateScene} from './package';
import {summarizeImport} from './import-summary';
import {importError,LOAD_ERROR} from './import-errors';
import {BUILD_ID} from './version';
const app=document.getElementById('app')!;
let mainBuildReady=false,active=false,controller:AbortController|undefined,requestId='';
const escape=(s:string)=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const send=(message:object)=>parent.postMessage({pluginMessage:{...message,requestId,buildId:BUILD_ID}},'*');
function idle(){
 active=false;controller=undefined;
 app.innerHTML='<div class="container"><div class="header"><h1>导入 PDF / AI / EPS / PSD</h1><p class="sub">导入设计文件，保留可解析的图层与内容。</p></div>'+
 '<div class="dropzone" id="drop"><div class="drop-text">拖入文件，开始导入</div><p class="sub">PDF · AI · EPS · PS · PSD · PSB</p><button class="btn-primary" id="pick"'+(mainBuildReady?'':' disabled')+'>选择文件</button><input id="file" type="file" accept=".pdf,.ai,.eps,.ps,.psd,.psb,.figimport" hidden></div>'+
 '<section class="format-help"><details><summary>导入说明</summary><ul><li>按文件内容导入画板、图层、路径和图片，部分文字与复杂效果可能存在差异。已有的 .figimport 转换包也可直接导入。</li><li>所有转换均在插件内完成，不上传转换服务器。</li><li>缺少原字体时可能使用文字外观或替代字体，导入后请核对。</li><li>EPS / PS 及 PostScript 格式 AI 单文件上限 64 MB，其他格式上限 256 MB；AI 需包含可读取的 PDF 或 PostScript 内容。</li></ul></details></section></div>';
 const file=document.getElementById('file') as HTMLInputElement,drop=document.getElementById('drop')!;
 document.getElementById('pick')!.onclick=e=>{e.stopPropagation();if(mainBuildReady)file.click();};
 drop.onclick=()=>{if(mainBuildReady)file.click();};
 drop.ondragover=e=>{e.preventDefault();drop.classList.add('drag-over');};drop.ondragleave=()=>drop.classList.remove('drag-over');
 drop.ondrop=e=>{e.preventDefault();drop.classList.remove('drag-over');if(e.dataTransfer?.files[0])void handle(e.dataTransfer.files[0]);};
 file.onchange=()=>{if(file.files?.[0])void handle(file.files[0]);};
}
function progress(percent:number,message:string){
 app.innerHTML='<div class="container"><h1>正在导入</h1><p id="msg"></p><div class="progress-bar"><div class="progress-fill" style="width:'+Math.max(0,Math.min(100,percent))+'%"></div></div><button class="btn-secondary" id="cancel">取消本次导入</button></div>';
 document.getElementById('msg')!.textContent=message;
 document.getElementById('cancel')!.onclick=()=>{controller?.abort();send({type:'cancel-import'});document.getElementById('msg')!.textContent='正在取消并清理本次节点…';};
}
function error(message:string){
 active=false;controller=undefined;
 app.innerHTML='<div class="container"><h1>导入未完成</h1><p class="sub error">'+escape(importError(message))+'</p><button class="btn-primary" id="back">返回</button></div>';
 document.getElementById('back')!.onclick=idle;
}
async function handle(file:File){
 if(active)return;
 if(!mainBuildReady){error(LOAD_ERROR);return;}
 active=true;controller=new AbortController();
 const signal=controller.signal;
 requestId=Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16)).join('-');
 progress(0,'正在检查文件…');
 try{
  await preflightFile(file,signal);
  const bytes=await file.arrayBuffer();
  if(signal.aborted)throw new Error('导入已取消');
  const result=validateScene(await parseCommunityFile(file.name,bytes,signal,progress));
  if(signal.aborted)throw new Error('导入已取消');
  progress(0,'解析完成，开始创建 Figma 图层');send({type:'import',fileName:file.name,result});
 }catch(e){error(importError(e));}
}
window.onmessage=event=>{
 const msg=event.data?.pluginMessage;if(!msg||msg.requestId&&msg.requestId!==requestId)return;
 if(msg.type==='build-info'){
  mainBuildReady=msg.buildId===BUILD_ID;
  if(!mainBuildReady){controller?.abort();if(active)send({type:'cancel-import'});error(LOAD_ERROR);}
  const pick=document.getElementById('pick') as HTMLButtonElement|null;if(pick)pick.disabled=!mainBuildReady;
  return;
 }
 if(msg.type==='progress'&&active){progress(msg.percent,msg.msg);return;}
 if(msg.type!=='done')return;if(msg.error){error(msg.error);return;}
 active=false;controller=undefined;
 const notices=summarizeImport(msg.diagnostics||[]),s=msg.stats,native=msg.nativeStats||s;
 app.innerHTML='<div class="container"><h1>导入完成</h1>'+
 '<p class="result-stats">'+s.artboards+' 画板 · '+native.vectors+' 矢量路径 · '+native.texts+' 可编辑文字 · '+native.images+' 图片</p>'+
 (notices.length?'<section class="warnings"><h2>需要注意</h2><ul>'+notices.map(n=>'<li>'+escape(n.message)+'</li>').join('')+'</ul></section>':'')+
 '<button class="btn-primary" id="again">继续导入</button></div>';
 document.getElementById('again')!.onclick=idle;
};
idle();send({type:'get-build'});
setTimeout(()=>{if(!mainBuildReady)error(LOAD_ERROR);},5000);
