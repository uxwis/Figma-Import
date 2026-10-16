import svgpath from 'svgpath';
import {mapPath} from '../affine';

/** Illustrator SVGs can store artwork far outside a nominal viewBox. Photoshop
 * places their artwork crop, whose dimensions are saved on the smart object. */
export function normalizeSvgViewport(source:string,width:number,height:number):{svg:string;adjusted:boolean}{
  const unchanged={svg:source,adjusted:false};
  const root=source.match(/<svg\b([^>]*)>/i);if(!root||/\b(?:width|height)\s*=/i.test(root[1]))return unchanged;
  const attrs=(text:string)=>Object.fromEntries([...text.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map(m=>[m[1],m[3]]));
  const viewport=(attrs(root[1]).viewBox||'').trim().split(/[\s,]+/).map(Number);
  if(viewport.length!==4||!viewport.every(Number.isFinite)||viewport[2]<=0||viewport[3]<=0)return unchanged;
  // Leave complex CSS, transformed artwork and definition geometry to the SVG importer.
  if(/\btransform\s*=|<(?:defs|symbol|clipPath|mask|filter|image|text|use)\b/i.test(source))return unchanged;
  const declarations=(text:string)=>Object.fromEntries(text.split(';').map(v=>v.split(':').map(v=>v.trim())).filter(v=>v.length===2));
  const classes=new Map<string,Record<string,string>>();
  for(const block of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))for(const rule of block[1].matchAll(/\.([\w-]+)\s*\{([^}]+)\}/g))classes.set(rule[1],declarations(rule[2]));
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(const shape of source.matchAll(/<(path|rect|circle|ellipse|line|polygon|polyline)\b([^>]*)>/gi)){
    const a=attrs(shape[2]),style:Record<string,string>={...a};
    for(const name of (a.class||'').split(/\s+/))Object.assign(style,classes.get(name));Object.assign(style,declarations(a.style||''));
    if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)continue;
    const fill=style.fill!=='none'&&Number(style['fill-opacity'])!==0;
    const stroke=!!style.stroke&&style.stroke!=='none'&&Number(style['stroke-opacity'])!==0;
    if(!fill&&!stroke)continue;
    const num=(key:string,defaultValue=0)=>a[key]===undefined?defaultValue:Number.parseFloat(a[key]);
    let box:{minX:number;minY:number;maxX:number;maxY:number};
    const kind=shape[1].toLowerCase();
    if(kind==='path'){
      const path=svgpath(a.d||'');if((path as typeof path&{err?:string}).err)return unchanged;
      box=mapPath(path.unshort().unarc().abs().toString(),[1,0,0,1,0,0]).box;
    }else if(kind==='rect')box={minX:num('x'),minY:num('y'),maxX:num('x')+num('width'),maxY:num('y')+num('height')};
    else if(kind==='circle'||kind==='ellipse'){
      const rx=kind==='circle'?num('r'):num('rx'),ry=kind==='circle'?num('r'):num('ry');
      box={minX:num('cx')-rx,minY:num('cy')-ry,maxX:num('cx')+rx,maxY:num('cy')+ry};
    }else if(kind==='line')box={minX:Math.min(num('x1'),num('x2')),minY:Math.min(num('y1'),num('y2')),maxX:Math.max(num('x1'),num('x2')),maxY:Math.max(num('y1'),num('y2'))};
    else{
      const points=(a.points||'').trim().split(/[\s,]+/).map(Number),xs=points.filter((_,i)=>i%2===0),ys=points.filter((_,i)=>i%2===1);
      box={minX:Math.min(...xs),minY:Math.min(...ys),maxX:Math.max(...xs),maxY:Math.max(...ys)};
    }
    // Round joins/caps and the sampled Illustrator stroke contours have this envelope.
    if(stroke&&style['stroke-linejoin']&&!['round','bevel'].includes(style['stroke-linejoin']))return unchanged;
    const radius=stroke?Number.parseFloat(style['stroke-width']||'1')/2:0;
    left=Math.min(left,box.minX-radius);top=Math.min(top,box.minY-radius);right=Math.max(right,box.maxX+radius);bottom=Math.max(bottom,box.maxY+radius);
  }
  if(![left,top,right,bottom].every(Number.isFinite)||right<=left||bottom<=top)return unchanged;
  const [x,y,w,h]=viewport;
  if(left>=x-w*.25&&top>=y-h*.25&&right<=x+w*1.25&&bottom<=y+h*1.25)return unchanged;
  // Use the PSD's saved artwork dimensions only when they corroborate the crop.
  const exact=Math.abs(right-left-width)<.02&&Math.abs(bottom-top-height)<.02;
  const rounded=Math.abs(Math.ceil(right)-Math.floor(left)-width)<.02&&Math.abs(Math.ceil(bottom)-Math.floor(top)-height)<.02;
  if(!exact&&!rounded)return unchanged;
  const crop=[rounded&&!exact?Math.floor(left):left,rounded&&!exact?Math.floor(top):top,width,height];
  const newRoot=root[0].replace(/\bviewBox\s*=\s*(["']).*?\1/i,'viewBox="'+crop.join(' ')+'"');
  return{svg:source.replace(root[0],newRoot),adjusted:true};
}
