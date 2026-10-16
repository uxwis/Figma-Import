/** Bound read/load APIs that may never settle, while still accepting cancellation.
 * Late font completions cannot resume an abandoned import. */
export function waitForHost<T>(work:()=>Promise<T>,cancelled:()=>boolean,timeoutMs:number,message:string):Promise<T>{
  return new Promise((resolve,reject)=>{
    let settled=false,timer:ReturnType<typeof setTimeout>|undefined;
    const deadline=Date.now()+timeoutMs;
    const finish=(error:unknown,value?:T)=>{
      if(settled)return;settled=true;if(timer!==undefined)clearTimeout(timer);
      if(error)reject(error);else resolve(value as T);
    };
    const poll=()=>{
      if(cancelled()){finish(new Error('导入已取消'));return;}
      const remaining=deadline-Date.now();
      if(remaining<=0){finish(new Error(message));return;}
      timer=setTimeout(poll,Math.min(50,remaining));
    };
    poll();if(settled)return;
    Promise.resolve().then(work).then(value=>finish(cancelled()?new Error('导入已取消'):undefined,value),error=>finish(error));
  });
}
