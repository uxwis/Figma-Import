import {FILE_LIMIT,POSTSCRIPT_LIMIT} from './conversion-limits';
import {sizeError} from './import-errors';
import {checkCancelled} from './scene';

export type InputKind='pdf'|'postscript'|'psd'|'package'|'unknown';
export function inspectInput(name:string,head:Uint8Array,size:number):{kind:InputKind;eps:boolean;offset?:number;length?:number} {
 const extension=name.split('.').pop()?.toLowerCase();
 if(extension==='figimport')return{kind:'package',eps:false};
 if(head[0]===0xc5&&head[1]===0xd0&&head[2]===0xd3&&head[3]===0xc6){
  if(head.length<30)throw new Error('EPS 二进制文件头不完整');
  const view=new DataView(head.buffer,head.byteOffset,head.byteLength),offset=view.getUint32(4,true),length=view.getUint32(8,true);
  if(offset<30||!length||offset+length>size)throw new Error('EPS 的 PostScript 内容范围无效');
  return{kind:'postscript',eps:true,offset,length};
 }
 const header=new TextDecoder('latin1').decode(head.subarray(0,1024));
 if(header.startsWith('8BPS'))return{kind:'psd',eps:false};
 if(header.includes('%PDF-'))return{kind:'pdf',eps:false};
 if(header.trimStart().startsWith('%!PS')||extension==='eps'||extension==='ps')
  return{kind:'postscript',eps:extension==='eps'||header.includes('EPSF-')};
 return{kind:extension==='psd'||extension==='psb'?'psd':'unknown',eps:false};
}
export function checkFileSize(size:number,kind:InputKind):void {
 const limit=kind==='postscript'?POSTSCRIPT_LIMIT:FILE_LIMIT;
 if(size>limit)throw new Error(sizeError(limit/1024/1024));
}
/** Read at most 1 KiB before the format-specific size gate; never decode here. */
export async function preflightFile(file:Pick<File,'name'|'size'|'slice'>,signal?:AbortSignal):Promise<void> {
 checkCancelled(signal);
 const header=new Uint8Array(await file.slice(0,1024).arrayBuffer());
 checkCancelled(signal);checkFileSize(file.size,inspectInput(file.name,header,file.size).kind);
}
