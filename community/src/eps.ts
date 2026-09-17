import workerSource from 'ghostscript-worker-source';
import {POSTSCRIPT_LIMIT,POSTSCRIPT_TIMEOUT} from './conversion-limits';
import {sizeError} from './import-errors';

export function convertPostScript(input:ArrayBuffer,eps:boolean,signal:AbortSignal,progress:(percent:number,message:string)=>void,
  timeout=POSTSCRIPT_TIMEOUT):Promise<{pdf:ArrayBuffer;warnings:string[]}>{
  if(signal.aborted)return Promise.reject(new Error('导入已取消'));
  if(input.byteLength>POSTSCRIPT_LIMIT)return Promise.reject(new Error(sizeError(64)));
  return new Promise((resolve,reject)=>{
    let worker:Worker|undefined,timer:ReturnType<typeof setTimeout>|undefined,url:string|undefined,finished=false;
    const finish=(error?:Error,result?:{pdf:ArrayBuffer;warnings:string[]})=>{
      if(finished)return;finished=true;if(timer)clearTimeout(timer);signal.removeEventListener('abort',abort);
      worker?.terminate();if(url)URL.revokeObjectURL(url);error?reject(error):resolve(result!);
    };
    const abort=()=>finish(new Error('导入已取消'));
    try{
      url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));worker=new Worker(url);
      worker.onmessage=event=>{
        const data=event.data;
        if(data.type==='progress')progress(data.percent,data.message);
        else if(data.type==='result')finish(undefined,{pdf:data.pdf,warnings:data.warnings||[]});
        else if(data.type==='error')finish(new Error(data.message+(data.details?'\n'+data.details:'')));
      };
      worker.onerror=event=>{event.preventDefault();finish(new Error('EPS / PS 引擎运行失败：'+(event.message||'请检查文件或减少文件大小')));};
      signal.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>finish(new Error('EPS / PS 转换超过 3 分钟，已停止。请拆分或简化文件后重试。')),timeout);
      worker.postMessage({input,eps},[input]);
    }catch(error){finish(new Error('当前环境无法启动 EPS / PS 转换引擎：'+(error instanceof Error?error.message:String(error))));}
  });
}
