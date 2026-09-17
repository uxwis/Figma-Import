import {parseFile} from './parsers/index';
import {readPackage} from './package';
import {convertPostScript} from './eps';
import {inspectInput,checkFileSize} from './file-preflight';
import type {ParseResult} from './types';

export async function parseCommunityFile(name:string,bytes:ArrayBuffer,signal:AbortSignal,progress:(percent:number,message:string)=>void):Promise<ParseResult>{
  if(signal.aborted)throw new Error('导入已取消');
  const extension=name.split('.').pop()?.toLowerCase();
  let data=new Uint8Array(bytes);
  const input=inspectInput(name,data.subarray(0,1024),data.length);
  checkFileSize(data.length,input.kind);
  if(input.kind==='package')return readPackage(bytes,{signal});
  if(input.offset!==undefined){
    bytes=data.slice(input.offset,input.offset+input.length!).buffer;data=new Uint8Array(bytes);
  }
  if(input.kind==='psd')return parseFile('input.psd',bytes,progress,{signal});
  if(input.kind==='pdf')return parseFile('input.pdf',bytes,progress,{signal});
  const header=new TextDecoder('latin1').decode(data.subarray(0,1024));
  const postscript=header.trimStart().startsWith('%!PS');
  if(input.kind==='postscript'){
    if(!postscript)throw new Error('文件中没有有效 PostScript 内容，无法导入 EPS / PS');
    const result=await convertPostScript(bytes,input.eps,signal,progress);
    const scene=await parseFile('converted.pdf',result.pdf,(p,m)=>progress(50+p*.5,m),{signal});
    for(const message of result.warnings){scene.warnings.push(message);scene.diagnostics.push({sourceId:'postscript',name:'EPS / PS 转换',status:'unsupported',code:'postscript-font',message});}
    return scene;
  }
  if(extension==='ai')throw new Error('该 AI 不含可读取的 PDF 或 PostScript 内容。请在原软件中另存为启用“创建 PDF 兼容文件”的 AI，或导出 PDF 后导入。');
  return parseFile(name,bytes,progress,{signal});
}
