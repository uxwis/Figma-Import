import loadGhostscript from '../vendor/ghostscript/gs.js';
import compressedWasm from 'ghostscript-wasm-data';
import {gunzipSync} from 'fflate';
import {CONVERTED_PDF_LIMIT,POSTSCRIPT_LIMIT} from './conversion-limits';
import {sizeError} from './import-errors';

const worker=self as unknown as {
  onmessage:((event:MessageEvent<{input:ArrayBuffer;eps:boolean}>)=>void)|null;
  postMessage(message:unknown,transfer?:Transferable[]):void;
};
worker.onmessage=async event=>{
  const logs:string[]=[];
  const log=(line:string)=>{logs.push(String(line).slice(0,1200));if(logs.length>100)logs.shift();};
  try{
    const {input,eps}=event.data;
    if(!(input instanceof ArrayBuffer)||input.byteLength>POSTSCRIPT_LIMIT)throw new Error(sizeError(64));
    worker.postMessage({type:'progress',percent:5,message:'正在准备 EPS / PS 转换引擎'});
    const binary=atob(compressedWasm),compressed=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)compressed[i]=binary.charCodeAt(i);
    const module=await loadGhostscript({wasmBinary:gunzipSync(compressed),locateFile:()=>'embedded.wasm',print:log,printErr:log});
    module.FS.writeFile('/input.ps',new Uint8Array(input));
    worker.postMessage({type:'progress',percent:20,message:'正在转换 EPS / PS，保留路径与文字内容'});
    const code=module.callMain(['-dSAFER','-dBATCH','-dNOPAUSE',...(eps?['-dEPSCrop']:[]),'-dAutoRotatePages=/None','-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.7','-dEmbedAllFonts=true','-dSubsetFonts=true','-sOutputFile=/result.pdf',
      '-c','<</NeverEmbed []>> setdistillerparams','-f','/input.ps']);
    if(code!==0)throw new Error('PostScript 转换失败（'+code+'）');
    const pdf=module.FS.readFile('/result.pdf',{encoding:'binary'});
    if(pdf.length>CONVERTED_PDF_LIMIT)throw new Error('转换结果超过 128 MB，请拆分文件后重试');
    if(new TextDecoder().decode(pdf.subarray(0,5))!=='%PDF-')throw new Error('文件没有生成有效 PDF 内容');
    const warnings=logs.filter(line=>/substitut|can.?t find|cannot find|not found|invalidfont|undefinedresource/i.test(line));
    const output=pdf.slice().buffer as ArrayBuffer;
    worker.postMessage({type:'result',pdf:output,warnings},[output]);
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    worker.postMessage({type:'error',message:'EPS / PS 转换未完成：'+message,details:logs.slice(-12).join('\n')});
  }
};
