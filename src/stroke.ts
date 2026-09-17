import type { ParsedVector } from './types';

type Point=[number,number];
type Segment={out:Point;into:Point};
export const figmaMiterLimit=(value:unknown):number=>typeof value==='number'&&Number.isFinite(value)?Math.max(1,Math.min(16,value)):4;
const delta=(a:Point,b:Point):Point=>[a[0]-b[0],a[1]-b[1]];
const nonzero=(...vectors:Point[]):Point=>vectors.find(v=>v[0]!==0||v[1]!==0)||[0,0];

/** Check joins in the canonical M/L/C/Z paths produced by bakeVector.
 * Tangents point away from their shared vertex. A miter's length/half-width
 * ratio is 1/sin(theta/2). If both limits choose the same join, the current
 * outline is unchanged. Boolean results may introduce new joins: stay unknown. */
function equivalentJoins(n:ParsedVector,source:number,target:number):boolean {
 if(!n.paths||n.paths.length!==1)return false;
 const tokens=n.paths[0].data.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi)||[];
 let index=0,position:Point=[0,0],start:Point=[0,0],segments:Segment[]=[],started=false;
 const join=(a:Segment,b:Segment)=>{
  const lengthA=Math.hypot(...a.into),lengthB=Math.hypot(...b.out);
  if(!lengthA||!lengthB)return false;
  const cosine=Math.max(-1,Math.min(1,(a.into[0]/lengthA)*(b.out[0]/lengthB)+(a.into[1]/lengthA)*(b.out[1]/lengthB)));
  const ratio=1/Math.sqrt((1-cosine)/2);
  // Treat values very close to either transition conservatively.
  const low=Math.min(source,target),high=Math.max(source,target);
  return ratio<low-1e-7||ratio>high+1e-7;
 };
 const finish=(closed:boolean)=>{
  for(let i=1;i<segments.length;i++)if(!join(segments[i-1],segments[i]))return false;
  return !closed||!segments.length||join(segments[segments.length-1],segments[0]);
 };
 const read=():Point=>[Number(tokens[index++]),Number(tokens[index++])];
 const line=(end:Point)=>{const out=delta(end,position);if(out[0]||out[1])segments.push({out,into:delta(position,end)});position=end;};
 while(index<tokens.length){
  const command=tokens[index++];
  if(command==='M'){
   if(!finish(false))return false;
   position=read();start=position;segments=[];started=true;
  }else if(command==='L'&&started)line(read());
  else if(command==='C'&&started){
   const a=read(),b=read(),end=read();
   const out=nonzero(delta(a,position),delta(b,position),delta(end,position));
   const into=nonzero(delta(b,end),delta(a,end),delta(position,end));
   if(out[0]||out[1]||into[0]||into[1])segments.push({out,into});position=end;
  }else if(command==='Z'&&started){
   line(start);if(!finish(true))return false;segments=[];started=false;
  }else return false;
  if(!position.every(Number.isFinite))return false;
 }
 return finish(false);
}

/** PSD commonly stores 100; Figma's setter accepts only finite values 1..16.
 * Keep source data and report any possible appearance change, never rasterize. */
export function nativeStroke(n:ParsedVector):ParsedVector {
 const original=n.miterLimit;
 if(original===undefined||Number.isFinite(original)&&original>=1&&original<=16)return n;
 const applied=figmaMiterLimit(original);
 const active=(n.strokes?.some(p=>(p.opacity??1)>0&&(p.type!=='SOLID'||(p.color?.a??1)>0))??false)&&
  (n.strokeWidth??1)>0&&(n.strokeJoin??'MITER')==='MITER';
 const unchanged=!active||Number.isFinite(original)&&original>=1&&equivalentJoins(n,original,applied);
 const note=unchanged?'当前轮廓的描边接合不受影响；路径和描边保持可编辑。':'尖角或布尔轮廓的外观可能有差异，需核对；路径和描边保持可编辑。';
 return {...n,miterLimit:applied,fidelity:unchanged?n.fidelity:'unsupported',
  sourceData:{...n.sourceData,strokeMiterLimit:{original:Number.isFinite(original)?original:String(original),applied,appearance:unchanged?'unchanged':'needs-review'}},
  issues:[...(n.issues||[]),{code:'stroke-miter-limit',message:'源描边斜接上限 '+original+' 超出 Figma 范围，已适配为 '+applied+'。'+note}]};
}
