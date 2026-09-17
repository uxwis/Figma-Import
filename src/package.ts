import { unzipSync, strFromU8 } from 'fflate';
import type { ParseResult, ParsedNode, ParseOptions } from './types';
import { childrenOf, countStats } from './types';
import { checkCancelled } from './scene';
const LIMIT=256*1024*1024;
export function validateScene(scene:ParseResult):ParseResult{
 if(scene?.version!==2||!Number.isFinite(scene.width)||!Number.isFinite(scene.height)||scene.width<=0||scene.height<=0||scene.width>100000||scene.height>100000||!Array.isArray(scene.nodes))throw new Error('无效的场景文件');
 let count=0;
 function walk(nodes:ParsedNode[],depth:number){if(depth>48)throw new Error('场景层级过深');
 for(const n of nodes){if(++count>50000)throw new Error('场景对象数量超出限制');
 if(!['vector','text','image','frame','group','mask'].includes(n.kind))throw new Error('未知场景节点');
 if(n.transform&&(n.transform.length!==6||!n.transform.every(Number.isFinite)))throw new Error('无效对象变换');
 if('width'in n && n.width!==undefined && (!Number.isFinite(n.width)||n.width<0))throw new Error('无效对象尺寸');
 if(n.kind==='image'&&!n.bytes&&(!n.resourceId||!scene.resources[n.resourceId]))throw new Error('缺少图片资源 '+n.name);
 walk(childrenOf(n),depth+1);}}
 walk(scene.nodes,0);scene.stats=countStats(scene.nodes);return scene;
}
export function readPackage(data:ArrayBuffer,options:ParseOptions={}):ParseResult{
 checkCancelled(options.signal);if(data.byteLength>LIMIT)throw new Error('转换包超过 256 MB');
 let total=0,count=0;
 const files=unzipSync(new Uint8Array(data),{filter:entry=>{
 total+=entry.originalSize;if(++count>10000||total>512*1024*1024)throw new Error('转换包解压体积超出限制');
 if(entry.name.includes('..')||entry.name.startsWith('/')||entry.name.includes('\\'))throw new Error('转换包包含非法路径');
 return true;}});
 const read=(path:string)=>{if(!Object.prototype.hasOwnProperty.call(files,path))throw new Error('转换包缺少 '+path);return files[path];};
 const manifest=JSON.parse(strFromU8(read('manifest.json')));
 if(manifest.schema!=='figma-import-package'||manifest.version!==2)throw new Error('不支持的转换包版本');
 const raw=JSON.parse(strFromU8(read(manifest.scene))),resources:Record<string,Uint8Array>={};
 for(const [id,path]of Object.entries(raw.resources||{})){if(typeof path!=='string')throw new Error('无效资源索引');resources[id]=read(path);}
 checkCancelled(options.signal);
 return validateScene({...raw,resources,diagnostics:raw.diagnostics||[],warnings:raw.warnings||[]});
}
const LOCAL_URL='http://localhost:47823';
export interface LocalCapabilities {version:2;formats:string[];node:boolean;ghostscript:boolean;}
async function localRequest(path:string,token:string,signal:AbortSignal,init:RequestInit={},timeout=30000):Promise<Response>{
 let response:Response;
 try{response=await fetch(LOCAL_URL+path,{...init,headers:{...init.headers,Authorization:'Bearer '+token},signal:AbortSignal.any([signal,AbortSignal.timeout(timeout)])});}
 catch(e){checkCancelled(signal);throw new Error(e instanceof Error&&e.name==='TimeoutError'?'本机程序响应超时。请检查程序窗口，再重新连接。':'未连接到本机程序。请先双击“启动本机转换.cmd”，保持窗口打开后重试；若浏览器阻止连接，可使用离线转换包。');}
 if(response.status===401)throw new Error('连接码不正确或已失效。请在本机程序中重新“复制连接码”，再粘贴到这里。');
 if(response.status===403)throw new Error('本机程序拒绝了这次连接。请从 Figma 插件连接，或改用离线转换包。');
 if(!response.ok){const detail=await response.json().catch(()=>({}));throw new Error(detail.error||'本机服务请求失败，请检查程序窗口后重试。');}
 return response;
}
export async function checkLocalConnection(token:string,signal:AbortSignal):Promise<LocalCapabilities>{
 if(!token.trim())throw new Error('请先在本机程序中点击“复制连接码”，再粘贴到输入框。');
 const cap=await(await localRequest('/capabilities',token.trim(),signal,{},5000)).json();
 if(cap.version!==2||!Array.isArray(cap.formats))throw new Error('本机程序版本不匹配。请使用同一安装包中的“启动本机转换.cmd”。');
 if(!cap.node)throw new Error('本机程序缺少 Node.js。请按程序窗口中的提示完成准备后重新连接。');
 return cap;
}
export async function localConvert(file:File,token:string,signal:AbortSignal,progress:(p:number,m:string)=>void):Promise<ParseResult>{
 const request=(path:string,init:RequestInit={})=>localRequest(path,token,signal,init);
 const cap=await checkLocalConnection(token,signal),format=file.name.split('.').pop()?.toLowerCase();
 if(!format||!cap.formats.includes(format))throw new Error('本机程序暂不支持此格式。EPS / PS 需要先安装 Ghostscript，再重新连接。');
 let job:string|undefined;const start=Date.now();
 try{
 job=(await(await request('/jobs?name='+encodeURIComponent(file.name),{method:'POST',body:file})).json()).id;
 while(true){checkCancelled(signal);if(Date.now()-start>240000)throw new Error('本机转换超时');
 const state=await(await request('/jobs/'+job)).json();progress(state.progress,state.message);
 if(state.state==='done')return readPackage(await(await request('/jobs/'+job+'/result')).arrayBuffer(),{signal});
 if(state.state==='error'||state.state==='cancelled')throw new Error(state.message);
 await new Promise(r=>setTimeout(r,500));}
 }finally{if(job)try{await fetch(LOCAL_URL+'/jobs/'+job,{method:'DELETE',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});}catch{}}
}

