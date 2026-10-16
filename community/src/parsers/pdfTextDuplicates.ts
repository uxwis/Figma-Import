import type {Matrix,Paint,ParsedNode,ParsedText,ParsedVector} from '../types';
import {mapPath,nodeMatrix} from '../affine';

// Compare complete source glyph contours, never just bounding rectangles. A
// decoration, partial hole, different colour or different clip must survive.
function contours(data:string,m?:Matrix):string[]{
 const d=m?mapPath(data,m).data:data,parts=d.match(/M[^M]+/g)||[],result:string[]=[];
 const q=(v:number)=>Math.round(v*100)/100;
 for(const part of parts){
  const tokens=part.match(/[MLCZ]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi)||[];
  let i=0,start:number[]=[],at:number[]=[],segments:number[][]=[];
  while(i<tokens.length){const op=tokens[i++];
   if(op==='M'){start=at=[+tokens[i++],+tokens[i++]];}
   else if(op==='L'){const end=[+tokens[i++],+tokens[i++]];if(Math.hypot(end[0]-at[0],end[1]-at[1])>1e-6)segments.push([...at,...end]);at=end;}
   else if(op==='C'){const rest=tokens.slice(i,i+6).map(Number);i+=6;segments.push([...at,...rest]);at=rest.slice(-2);}
   else if(op==='Z'&&Math.hypot(at[0]-start[0],at[1]-start[1])>1e-6)segments.push([...at,...start]);
  }
  if(segments.length<2)continue;
  if(!part.trim().endsWith('Z')&&Math.hypot(at[0]-start[0],at[1]-start[1])>.0001)return[];
  if(segments.length>512)return[];
  const rotate=(list:number[][])=>list.map((_,i)=>[...list.slice(i),...list.slice(0,i)].map(s=>s.map(q).join(',')).join(';')).sort()[0];
  const reverse=segments.slice().reverse().map(s=>s.length===4?[...s.slice(2),...s.slice(0,2)]:[...s.slice(6),...s.slice(4,6),...s.slice(2,4),...s.slice(0,2)]);
  let area=0;for(const s of segments){let x=s[0],y=s[1];for(let t=1;t<=4;t++){const u=t/4,v=1-u;
   const xx=s.length===4?s[0]+(s[2]-s[0])*u:v*v*v*s[0]+3*v*v*u*s[2]+3*v*u*u*s[4]+u*u*u*s[6];
   const yy=s.length===4?s[1]+(s[3]-s[1])*u:v*v*v*s[1]+3*v*v*u*s[3]+3*v*u*u*s[5]+u*u*u*s[7];area+=x*yy-xx*y;x=xx;y=yy;}}
  // Keep winding orientation: identical boundaries with a filled-in counter
  // are not the same glyph under NONZERO fill.
  result.push((area<0?'-':'+')+[rotate(segments),rotate(reverse)].sort()[0]);
 }
 return result;
}
const opaque=(paints:Paint[])=>paints.every(p=>p.type==='SOLID'&&(!p.blendMode||p.blendMode==='NORMAL')&&(p.opacity??1)===1&&(p.color?.a??1)===1);
function style(fills:Paint[],strokes:Paint[],width:number,m:Matrix):string|undefined{
 if(!fills.length&&!strokes.length||!opaque(fills)||!opaque(strokes))return;
 const colour=(p:Paint)=>[p.color?.r,p.color?.g,p.color?.b].map(v=>Math.round((v||0)*10000));
 return JSON.stringify([fills.map(colour),strokes.map(colour),strokes.length?Math.round(width*Math.hypot(m[0],m[1])*1000):0]);
}
function near(a:string,b:string,tolerance:number):boolean{
 const x=a.slice(1).split(';').map(s=>s.split(',').map(Number)),y=b.slice(1).split(';').map(s=>s.split(',').map(Number));
 if(x.length!==y.length)return false;
 const matches=(list:number[][])=>x.some((_,shift)=>x.every((segment,i)=>segment.length===list[(i+shift)%list.length].length&&segment.every((v,j)=>Math.abs(v-list[(i+shift)%list.length][j])<=tolerance)));
 return matches(y)||matches(y.slice().reverse().map(s=>s.length===4?[...s.slice(2),...s.slice(0,2)]:[...s.slice(6),...s.slice(4,6),...s.slice(2,4),...s.slice(0,2)]));
}
type Glyph={keys:string[];style:string;scope:string;tolerance:number};
export class PdfTextDuplicates{
 private glyphs:Glyph[]=[];
 private scopes=new WeakMap<ParsedNode,string>();
 private regions=new Map<string,{minX:number;minY:number;maxX:number;maxY:number}>();
 scope(n:ParsedNode,key:string){this.scopes.set(n,key);}
 glyph(n:ParsedText,data:string,m:Matrix,scope:string):void{
  if(n.visible===false||n.blendMode&&n.blendMode!=='NORMAL'||n.issues?.length)return;
  const p=n.pdfTextPaints!,key=style(p.fills,p.strokes,p.strokeWidth,p.reference);if(!key)return;
  const mapped=mapPath(data,m),keys=contours(mapped.data);if(!keys.length)return;
  this.glyphs.push({keys,style:key,scope,tolerance:Math.min(.1,Math.max(.015,Math.hypot(m[0],m[1])*.0015))});
  const regionKey=scope+'|'+key,region=this.regions.get(regionKey),b=mapped.box;
  this.regions.set(regionKey,region?{minX:Math.min(region.minX,b.minX),minY:Math.min(region.minY,b.minY),maxX:Math.max(region.maxX,b.maxX),maxY:Math.max(region.maxY,b.maxY)}:b);
 }
 remove(nodes:ParsedNode[]):ParsedNode[]{
  if(!this.glyphs.length)return nodes;
  const lookup=new Map<string,Glyph[]>();
  const byStyle=new Map<string,Glyph[]>();
  for(const g of this.glyphs){const key=g.scope+'|'+g.style,list=byStyle.get(key)||[];list.push(g);byStyle.set(key,list);}
  for(const g of this.glyphs)for(const contour of new Set(g.keys)){const key=g.scope+'|'+g.style+'|'+contour,list=lookup.get(key)||[];list.push(g);lookup.set(key,list);}
  const duplicate=(n:ParsedVector)=>{
   if(n.visible===false||(n.opacity??1)!==1||n.effects?.length||n.issues?.length||n.blendMode&&n.blendMode!=='NORMAL'||!n.paths?.length||n.paths.some(p=>p.operation))return false;
   const key=style(n.fills||[],n.strokes||[],n.strokeWidth||1,nodeMatrix(n));if(!key)return false;
   const prefix=(this.scopes.get(n)||'')+'|'+key,region=this.regions.get(prefix);if(!region)return false;
   // charpath can append an unpainted current-point moveto after the glyphs.
   const mapped=n.paths.map(p=>mapPath((p.data.match(/M[^M]+/g)||[]).filter(part=>/[LCQHV]/.test(part)).join(' '),nodeMatrix(n)));
   if(mapped.some(({box:b})=>b.minX<region.minX-.1||b.minY<region.minY-.1||b.maxX>region.maxX+.1||b.maxY>region.maxY+.1))return false;
   const paths=mapped.map(p=>contours(p.data));if(paths.some(keys=>!keys.length))return false;
   const remaining=paths.flat();
   // Each matched glyph must have all its contours in this vector, including holes.
   while(remaining.length){
    const exact=lookup.get(prefix+'|'+remaining[0])||[];
    const candidates=[...exact,...(byStyle.get(prefix)||[]).filter(g=>!exact.includes(g)&&g.keys.some(k=>near(k,remaining[0],g.tolerance)))];
    let matched=false;
    for(const g of candidates){const rest=[...remaining];let complete=true,reversed:boolean|undefined;for(const k of g.keys){
     const matches=(r:string)=>(reversed===undefined||(r[0]!==k[0])===reversed)&&near(r,k,g.tolerance);
     const i=rest.findIndex(matches);if(i<0){complete=false;break;}reversed??=rest[i][0]!==k[0];rest.splice(i,1);}
     if(complete){remaining.splice(0,remaining.length,...rest);matched=true;break;}}
    if(!matched)return false;
   }
   return true;
  };
  const visit=(list:ParsedNode[]):ParsedNode[]=>list.filter(n=>n.kind!=='vector'||!duplicate(n)).map(n=>{if('children'in n)n.children=visit(n.children);return n;});
  return visit(nodes);
 }
}
