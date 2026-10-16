import type {ParsedNode,ParsedVector,Matrix} from '../types';
import {inverse,multiply} from '../scene';

/** All coordinates in canonical M/L/C/Q/Z paths occur in x,y pairs. */
export function translateCanonicalPath(data:string,x:number,y:number):string{
  if(!x&&!y)return data;
  let index=0;
  return data.replace(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi,value=>String(Number(value)+(index++%2?y:x)));
}
type Box={x:number;y:number;right:number;bottom:number};
const overlaps=(a:Box,b:Box)=>a.x<b.right&&b.x<a.right&&a.y<b.bottom&&b.y<a.bottom;
function eligible(n:ParsedNode):n is ParsedVector{
  return n.kind==='vector'&&n.sourceType==='pdf-path'&&n.paths?.length===1&&
    /^[MLCQZ\d\s.,+eE-]+$/.test(n.paths[0].data)&&!n.paths[0].operation&&
    n.fills?.length===1&&n.fills[0].type==='SOLID'&&(n.fills[0].opacity??1)===1&&(n.fills[0].color?.a??1)===1&&
    (n.fills[0].blendMode??'NORMAL')==='NORMAL'&&
    !(n.strokes?.length||n.effects?.length||n.overlays?.length||n.issues?.length||n.sourceData||n.vectorOverlay||n.recovery)&&
    (n.opacity??1)===1&&(n.blendMode??'NORMAL')==='NORMAL'&&n.visible!==false;
}
/** Batch only adjacent, identically painted, disjoint PDF ornaments. Never cross
 * masks, groups, text or images. Bound both path count and setter payload size. */
export function batchPdfPaths(nodes:ParsedNode[]):ParsedNode[]{
  const out:ParsedNode[]=[];
  for(let index=0;index<nodes.length;){
    const first=nodes[index];
    if('children'in first)first.children=batchPdfPaths(first.children);
    if(first.kind==='mask'&&'children'in first.mask)first.mask.children=batchPdfPaths(first.mask.children);
    if(!eligible(first)){out.push(first);index++;continue;}
    const reference=first.transform||[1,0,0,1,first.x,first.y] as Matrix,det=reference[0]*reference[3]-reference[1]*reference[2];
    if(Math.abs(det)<1e-9){out.push(first);index++;continue;}
    const inverseReference=inverse(reference),style=JSON.stringify(first.fills),rule=first.paths![0].windingRule;
    const parts:{node:ParsedVector;x:number;y:number}[]=[],boxes:Box[]=[];let bytes=0;
    for(let j=index;j<nodes.length&&parts.length<128;j++){
      const n=nodes[j];if(!eligible(n)||JSON.stringify(n.fills)!==style||n.paths![0].windingRule!==rule)break;
      const m=n.transform||[1,0,0,1,n.x,n.y] as Matrix;if(m.slice(0,4).some((v,i)=>Math.abs(v-reference[i])>1e-9))break;
      const local=multiply(inverseReference,m),box={x:local[4],y:local[5],right:local[4]+n.width,bottom:local[5]+n.height};
      if(boxes.some(b=>overlaps(b,box))||bytes+n.paths![0].data.length>65536)break;
      parts.push({node:n,x:box.x,y:box.y});boxes.push(box);bytes+=n.paths![0].data.length;
    }
    if(parts.length<8){out.push(first);index++;continue;}
    let x=0,y=0,data='';
    while(parts.length>=8){
      x=Math.min(...boxes.map(b=>b.x));y=Math.min(...boxes.map(b=>b.y));
      data=parts.map(p=>translateCanonicalPath(p.node.paths![0].data,p.x-x,p.y-y)).join(' ');
      if(data.length<=65536)break;
      parts.pop();boxes.pop();
    }
    if(parts.length<8){out.push(first);index++;continue;}
    out.push({...first,name:'重复纹样 · '+parts.length,sourceType:'pdf-path-batch',x:0,y:0,
      width:Math.max(...boxes.map(b=>b.right))-x,height:Math.max(...boxes.map(b=>b.bottom))-y,
      transform:multiply(reference,[1,0,0,1,x,y] as Matrix),paths:[{data,windingRule:rule}],
      sourceData:{pdfBatch:{count:parts.length,sourceIds:parts.map(p=>p.node.sourceId)}}});
    index+=parts.length;
  }
  return out;
}
