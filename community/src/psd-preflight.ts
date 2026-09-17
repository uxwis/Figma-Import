import {readPsd,type Layer} from 'ag-psd';
import type {ParseOptions} from './types';
import {checkCancelled} from './scene';
import {PSD_MEMORY_ERROR,importError,MEMORY_ERROR} from './import-errors';
import {PSD_DECODE_LIMIT} from './conversion-limits';

export function checkPsdDimensions(width:number,height:number):void {
 if(width>100000||height>100000||width*height>100000000)throw new Error(PSD_MEMORY_ERROR);
}
/** Holds only metadata and views of compressed data. No canvas/pixel decoding. */
export async function preflightPsd(input:ArrayBuffer,options:ParseOptions={}):Promise<{decodedBytes:number;documents:number}> {
 let decodedBytes=0,documents=0;
 const visited=new WeakMap<ArrayBufferLike,Set<string>>();
 const add=(bytes:number)=>{
  decodedBytes+=bytes;
  if(!Number.isSafeInteger(decodedBytes)||decodedBytes>PSD_DECODE_LIMIT)throw new Error(PSD_MEMORY_ERROR);
 };
 const area=(r:{left?:number;top?:number;right?:number;bottom?:number})=>Math.max(0,(r.right??0)-(r.left??0))*Math.max(0,(r.bottom??0)-(r.top??0));
 async function visit(bytes:Uint8Array,depth:number,ancestry:string[]):Promise<void> {
  checkCancelled(options.signal);
  if(depth>8)throw new Error('智能对象嵌套超过 8 层');
  if(bytes.length<26)throw new Error('PSD 文件头不完整');
  const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  checkPsdDimensions(header.getUint32(18),header.getUint32(14));
  const key=bytes.byteOffset+':'+bytes.byteLength,seen=visited.get(bytes.buffer)||new Set<string>();
  if(seen.has(key))return;seen.add(key);visited.set(bytes.buffer,seen);documents++;
  const psd=readPsd(bytes,{useRawData:true,useImageData:true,skipCompositeImageData:true,skipThumbnail:true});
  const usedAssets=new Set<string>();
  function walk(layers:Layer[]):void {
   for(const layer of layers){
    const raw=layer.rawData;
    if(raw){
     const pixelBytes=4*Math.max(1,raw.bitsPerChannel/8);
     // Mirror ag-psd's RGBA allocation, including empty-but-sized layers.
     add(area(layer)*pixelBytes);
     for(const [id,mask] of [[-2,layer.mask],[-3,layer.realMask]] as const)
      if(mask&&raw.channels.some(c=>c.id===id&&c.data?.length))add(area(mask)*pixelBytes);
    }
    if(layer.placedLayer)usedAssets.add(layer.placedLayer.id);
    if(layer.children)walk(layer.children);
   }
  }
  walk(psd.children||[]);
  if(!psd.children?.length)add(psd.width*psd.height*4*Math.max(1,(psd.bitsPerChannel??8)/8));
  await new Promise(resolve=>setTimeout(resolve,0));checkCancelled(options.signal);
  for(const file of psd.linkedFiles||[]){
   if(!usedAssets.delete(file.id)||!file.data||file.data[0]!==56||file.data[1]!==66||file.data[2]!==80||file.data[3]!==83)continue;
   if(ancestry.includes(file.id))throw new Error('智能对象循环引用');
   try{await visit(file.data,depth+1,[...ancestry,file.id]);}
   catch(error){
    checkCancelled(options.signal);
    const message=importError(error);
    if(message===PSD_MEMORY_ERROR||message===MEMORY_ERROR||/智能对象(?:嵌套|循环引用)/.test(message))throw error;
    // Unsupported/corrupt embedded formats already use the parent's saved
    // appearance in smart(). Do not turn that existing fallback into a failure.
   }
  }
 }
 await visit(new Uint8Array(input),options.depth??0,options.ancestry||[]);
 return{decodedBytes,documents};
}
