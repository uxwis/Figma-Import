import type { VectorContent, Layer, LayerEffectsInfo, Psd } from 'ag-psd';
import type { Paint, ParsedNode, ParsedVector, RGB } from '../types';
import { inverse, issue } from '../scene';
import { colorToRgb } from './psdSvg';
import { clamp01 } from '../util';
import type { Box } from '../svg';

export function blendName(value?: string): string | undefined {
  const n=(value||'normal').trim().toLowerCase().replace(/[-_]/g,' ');
  const modes: Record<string,string>={normal:'NORMAL',multiply:'MULTIPLY',darken:'DARKEN','color burn':'COLOR_BURN','linear burn':'LINEAR_BURN',
    screen:'SCREEN',lighten:'LIGHTEN','color dodge':'COLOR_DODGE','linear dodge':'LINEAR_DODGE',overlay:'OVERLAY','soft light':'SOFT_LIGHT',
    'hard light':'HARD_LIGHT',difference:'DIFFERENCE',exclusion:'EXCLUSION',hue:'HUE',saturation:'SATURATION',color:'COLOR',luminosity:'LUMINOSITY','pass through':'PASS_THROUGH'};
  return modes[n];
}
export function solid(color: RGB, opacity=1): Paint {return {type:'SOLID',color,opacity};}
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
function midpoint(t:number,m=0.5):number {
  m=Math.max(0.001,Math.min(0.999,m));
  return Math.pow(clamp01(t),Math.log(0.5)/Math.log(m));
}
export function gradientPaint(content: VectorContent, box: Box): Paint | null {
  if(content.type==='color') {const c=colorToRgb(content.color);return c?solid(c):null;}
  if(content.type!=='solid') return null;
  const colors=content.colorStops.slice().sort((a,b)=>a.location-b.location);
  const alpha=content.opacityStops.slice().sort((a,b)=>a.location-b.location);
  if(!colors.length)return null;
  function at<T extends {location:number;midpoint:number}>(stops:T[],t:number): [T,T,number] {
    if(t<=stops[0].location)return[stops[0],stops[0],0];
    for(let i=1;i<stops.length;i++)if(t<=stops[i].location){
      const a=stops[i-1],b=stops[i];return[a,b,midpoint((t-a.location)/Math.max(1e-9,b.location-a.location),a.midpoint)];
    }const last=stops[stops.length-1];return[last,last,0];
  }
  const positions=new Set([0,1]);
  // Preserve independent opacity stops and approximate non-linear midpoint curves.
  for(const stops of [colors,alpha])for(let i=0;i<stops.length;i++){
    positions.add(clamp01(stops[i].location));
    if(i+1<stops.length && Math.abs((stops[i].midpoint??0.5)-0.5)>1e-5)
      for(let j=1;j<32;j++)positions.add(mix(stops[i].location,stops[i+1].location,j/32));
  }
  let stops=[...positions].sort((a,b)=>a-b).map(t=>{
    const [a,b,k]=at(colors,t),ca=colorToRgb(a.color)!,cb=colorToRgb(b.color)!;
    let opacity=1;if(alpha.length){const [aa,ab,ak]=at(alpha,t);opacity=mix(aa.opacity,ab.opacity,ak);}
    return {position:content.reverse?1-t:t,color:{r:mix(ca.r,cb.r,k),g:mix(ca.g,cb.g,k),b:mix(ca.b,cb.b,k),a:clamp01(opacity)}};
  }).sort((a,b)=>a.position-b.position);
  const w=Math.max(0.001,box.maxX-box.minX),h=Math.max(0.001,box.maxY-box.minY);
  const scale=Math.max(0.0001,content.scale??1),rad=(content.angle??0)*Math.PI/180;
  const ux=Math.cos(rad),uy=-Math.sin(rad),len=(Math.abs(w*ux)+Math.abs(h*uy))*scale;
  const cx=box.minX+w*(0.5+(content.offset?.x??0)),cy=box.minY+h*(0.5+(content.offset?.y??0));
  const style=content.style||'linear';
  let type: Paint['type']='GRADIENT_LINEAR';
  if(style==='reflected') stops=[...stops.map(s=>({...s,position:0.5-s.position/2})).reverse(),...stops.slice(1).map(s=>({...s,position:0.5+s.position/2}))];
  if(style==='radial')type='GRADIENT_RADIAL';
  if(style==='angle')type='GRADIENT_ANGULAR';
  if(style==='diamond')type='GRADIENT_DIAMOND';
  const matrix: [number,number,number,number,number,number]=style==='linear'||style==='reflected'
    ?[ux*len,uy*len,-uy*len,ux*len,cx-ux*len/2+uy*len/2,cy-uy*len/2-ux*len/2]
    :[w*scale,0,0,h*scale,cx-w*scale/2,cy-h*scale/2];
  return {type,stops,transform:inverse(matrix),opacity:1};
}
export function activeEffects(fx?: LayerEffectsInfo): {key:string;value:Record<string,unknown>}[] {
  if(!fx||fx.disabled)return [];
  const out:{key:string;value:Record<string,unknown>}[]=[];
  for(const [key,value]of Object.entries(fx)) for(const v of Array.isArray(value)?value:[value])
    if(v&&typeof v==='object'&&v.enabled===true)out.push({key,value:v});
  return out;
}
const unit=(v:unknown)=> typeof v==='number'?v: Number((v as {value?:number})?.value??0);
export function applyPsdEffects(n:ParsedNode,l:Layer,p:Psd,box:Box):void {
  if(l.effects)n.sourceData={...n.sourceData,psdEffects:l.effects,globalAngle:p.imageResources?.globalAngle};
  const scale=l.effects?.scale??1;
  for(const {key,value:fx} of activeEffects(l.effects)){
    const opacity=typeof fx.opacity==='number'?fx.opacity:1;
    const blend=blendName(fx.blendMode as string);
    if(!blend){issue(n,'effect-blend','效果混合模式 '+fx.blendMode+' 需要局部合成');continue;}
    if(key==='dropShadow'||key==='innerShadow'){
      const angle=(fx.useGlobalLight ? p.imageResources?.globalAngle??120 : Number(fx.angle??120))*Math.PI/180;
      const distance=unit(fx.distance)*scale;
      (n.effects??=[]).push({type:key==='dropShadow'?'DROP_SHADOW':'INNER_SHADOW',
        color:{...(colorToRgb(fx.color)||{r:0,g:0,b:0}),a:opacity},
        offset:{x:-Math.cos(angle)*distance,y:Math.sin(angle)*distance},
        radius:unit(fx.size)*scale,spread:unit(fx.choke)*scale,blendMode:blend});
      const contour=fx.contour as {curve?:{x:number;y:number}[]}|undefined;
      if(contour?.curve?.some(pt=>Math.abs(pt.x-pt.y)>0.01)) issue(n,'shadow-contour','自定投影等高线尚未通过保真验证');
    } else if(key==='solidFill'||key==='gradientOverlay'){
      let paint:Paint|null=null;
      if(key==='solidFill'){const c=colorToRgb(fx.color);if(c)paint=solid(c,opacity);}
      else {
        const g=fx.gradient as VectorContent|undefined;
        if(g){const x='x'in n?n.x:l.left??0,y='y'in n?n.y:l.top??0;const targetBox=fx.align===false?{minX:-x,minY:-y,maxX:p.width-x,maxY:p.height-y}:box;
          paint=gradientPaint({...g,style:fx.type,angle:fx.angle,scale:fx.scale,offset:fx.offset,reverse:fx.reverse} as VectorContent,targetBox);}
      }
      if(paint){paint.opacity=opacity;paint.blendMode=blend;if(n.kind==='vector')n.fills=[paint,...n.fills||[]];else(n.overlays??=[]).unshift(paint);}
      else issue(n,'effect-paint','该叠加填充不能表示为原生渐变');
    } else if(key==='stroke'&&n.kind==='vector'){
      const color=colorToRgb(fx.color);
      let paint=fx.fillType==='gradient'&&fx.gradient?gradientPaint(fx.gradient as VectorContent,box):color?solid(color,opacity):null;
      if(paint){paint.opacity=opacity;paint.blendMode=blend;n.strokes=[paint];n.strokeWidth=unit(fx.size)*scale;n.strokeAlign=String(fx.position||'inside').toUpperCase() as ParsedVector['strokeAlign'];}
      else issue(n,'effect-stroke','图案描边需要局部合成');
    } else issue(n,'effect-'+key,'效果 '+key+' 尚未支持，已记录外观差异');
  }
}

