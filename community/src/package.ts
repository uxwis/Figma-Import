import { unzipSync, strFromU8 } from 'fflate';
import type { ParseResult, ParsedNode, ParseOptions } from './types';
import { childrenOf, countStats } from './types';
import { checkCancelled } from './scene';
import {FILE_LIMIT} from './conversion-limits';
import {sizeError} from './import-errors';
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
 checkCancelled(options.signal);if(data.byteLength>FILE_LIMIT)throw new Error(sizeError(256));
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
