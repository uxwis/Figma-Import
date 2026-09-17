import { buildScene } from './builder';
import {importError,LOAD_ERROR} from './import-errors';
import type { ParseResult } from './types';
import { BUILD_ID, PLUGIN_VERSION } from './version';
figma.showUI(__html__,{width:440,height:520,themeColors:true,title:'PDF/AI/EPS/PSD 导入器 · 社区版 '+PLUGIN_VERSION});
let busy=false,cancelled=false;
figma.ui.onmessage=async(msg:{type:string;result?:ParseResult;fileName?:string;requestId?:string;buildId?:string})=>{
  if(msg.type==='get-build'){figma.ui.postMessage({type:'build-info',version:PLUGIN_VERSION,buildId:BUILD_ID});return;}
  if(msg.type==='cancel-import'){cancelled=true;return;}
  if(msg.type==='close'){if(busy)cancelled=true;else figma.closePlugin();return;}
  if(msg.type==='fonts'){figma.ui.postMessage({type:'fonts',fonts:(await figma.listAvailableFontsAsync()).map(f=>f.fontName)});return;}
  if(msg.type!=='import'||!msg.result)return;
  if(msg.buildId!==BUILD_ID){figma.ui.postMessage({type:'done',error:LOAD_ERROR,buildId:BUILD_ID,requestId:msg.requestId});return;}
  if(busy){figma.ui.postMessage({type:'done',error:'已有导入任务运行中',requestId:msg.requestId});return;}
  busy=true;cancelled=false;
  try{const result=await buildScene(msg.result,msg.fileName||'导入结果',(percent,message)=>figma.ui.postMessage({type:'progress',percent,msg:message,requestId:msg.requestId}),()=>cancelled);
    figma.ui.postMessage({type:'done',...result,buildId:BUILD_ID,requestId:msg.requestId});
  }catch(error){figma.ui.postMessage({type:'done',error:importError(error),count:0,buildId:BUILD_ID,requestId:msg.requestId});}
  finally{busy=false;}
};

