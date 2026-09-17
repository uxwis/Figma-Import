import type {Layer} from 'ag-psd';
import type {ParsedNode,ParsedFrame,Paint,RGB} from '../types';
import {issue} from '../scene';

const invert=(c:RGB):RGB=>({...c,r:1-c.r,g:1-c.g,b:1-c.b});
const complement=(p:Paint):Paint=>({...p,color:p.color?invert(p.color):undefined,stops:p.stops?.map(s=>({...s,color:invert(s.color)}))});
/** Cb/Cs = color-dodge(Cb,1-Cs); max(0,Cb-Cs) = linear-burn(Cb,1-Cs).
 * Restrict to one shape paint, so internal blend/effect composition cannot change. */
export function resolveShapeBlend(n:ParsedNode,l:Layer):boolean{
  if(l.blendMode!=='divide'&&l.blendMode!=='subtract')return false;
  if(n.kind!=='vector'||n.svg||n.effects?.length||n.strokes?.length||n.fills?.length!==1)return false;
  const p=n.fills[0];if(p.blendMode&&p.blendMode!=='NORMAL')return false;
  if((l.fillOpacity??1)!==1)return false;
  // The 0/0 edge case differs between renderers. Keep it explicit instead of guessing.
  if(l.blendMode==='divide'){
    const colors=p.color?[p.color]:p.stops?.map(s=>s.color)||[];
    if(colors.some(c=>c.r===0||c.g===0||c.b===0))return false;
  }
  n.sourceData={...n.sourceData,sourceBlendMode:l.blendMode,sourceFills:n.fills,blendConversion:'complement-source'};
  n.fills=n.fills.map(complement);n.blendMode=l.blendMode==='divide'?'COLOR_DODGE':'LINEAR_BURN';
  issue(n,'native-blend','已转换为反相填充及等价原生混合；原始填充保存在节点数据中',false);
  return true;
}
function canWhiten(n:ParsedNode):boolean{
  if(n.effects?.length||n.overlays?.length)return false;
  if(n.kind==='vector')return !n.svg||!/<(?:image|foreignObject|filter|mask|text)\b/i.test(n.svg);
  if(n.kind==='group')return n.children.length>0&&n.children.every(canWhiten);
  return false;
}
/** Only a contiguous prefix whose backdrop remains the artboard's solid white. */
export function resolveWhiteBackdrop(frame:ParsedFrame):void{
  const p=frame.fills?.[0];
  if(frame.fills?.length!==1||p?.type!=='SOLID'||(p.opacity??1)!==1||p.color?.r!==1||p.color.g!==1||p.color.b!==1||(p.color.a??1)!==1)return;
  for(const node of frame.children){
    if(node.visible===false||node.opacity===0)continue;
    if(node.sourceData?.sourceBlendMode!=='hard mix'||!canWhiten(node))break;
    node.whiteBackdropBlend={sourceMode:'hard mix',artboardId:frame.sourceId||''};node.blendMode='NORMAL';
    node.issues=node.issues?.filter(i=>i.code!=='unsupported-blend');
    if(node.fidelity==='unsupported'&&!node.issues?.length)node.fidelity='editable';
    issue(node,'white-backdrop-blend','Hard Mix 已按当前不透明白色画板背景转换为白色矢量；改变背景或下方内容后需要重新转换',false);
  }
}
