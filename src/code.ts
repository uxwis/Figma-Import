import { buildScene } from './builder';
import { exportValidation } from './export';
import type { ParseResult } from './types';
import { BUILD_ID, PLUGIN_VERSION } from './version';
figma.showUI(__html__,{width:440,height:680,themeColors:true,title:'AI/EPS/PSD 导入器 · '+PLUGIN_VERSION});
let busy=false,cancelled=false;
figma.ui.onmessage=async(msg:{type:string;result?:ParseResult;fileName?:string;requestId?:string;nodeId?:string;buildId?:string})=>{
  if(msg.type==='get-build'){figma.ui.postMessage({type:'build-info',version:PLUGIN_VERSION,buildId:BUILD_ID});return;}
  if(msg.type==='cancel-import'){cancelled=true;return;}
  if(msg.type==='close'){if(busy)cancelled=true;else figma.closePlugin();return;}
  if(msg.type==='fonts'){figma.ui.postMessage({type:'fonts',fonts:(await figma.listAvailableFontsAsync()).map(f=>f.fontName)});return;}
  if(msg.type==='export-reference'&&msg.nodeId){
    if(busy){figma.ui.postMessage({type:'render-error',error:'请等待当前导入完成'});return;}
    busy=true;
    try{const result=await exportValidation(msg.nodeId,(done,total)=>figma.ui.postMessage({type:'render-progress',done,total,requestId:msg.requestId}));
      figma.ui.postMessage({type:'render-package',...result,requestId:msg.requestId});
    }catch(error){figma.ui.postMessage({type:'render-error',error:error instanceof Error?error.message:String(error),requestId:msg.requestId});}
    finally{busy=false;}
    return;
  }
  if(msg.type!=='import'||!msg.result)return;
  if(msg.buildId!==BUILD_ID){figma.ui.postMessage({type:'done',error:'插件界面与主程序版本不一致。请关闭插件后重新运行。主程序：'+BUILD_ID,buildId:BUILD_ID,requestId:msg.requestId});return;}
  if(busy){figma.ui.postMessage({type:'done',error:'已有导入任务运行中',requestId:msg.requestId});return;}
  busy=true;cancelled=false;
  try{const result=await buildScene(msg.result,msg.fileName||'导入结果',(percent,message)=>figma.ui.postMessage({type:'progress',percent,msg:message,requestId:msg.requestId}),()=>cancelled);
    figma.ui.postMessage({type:'done',...result,buildId:BUILD_ID,requestId:msg.requestId});
  }catch(error){figma.ui.postMessage({type:'done',error:error instanceof Error?error.message:String(error),count:0,buildId:BUILD_ID,requestId:msg.requestId});}
  finally{busy=false;}
};

