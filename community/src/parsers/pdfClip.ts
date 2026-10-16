import type {Matrix,ParsedNode} from '../types';
import {mapPath,nodeMatrix,point} from '../affine';
import {identity,translateNodes} from '../scene';
export type PdfBox={x:number;y:number;right:number;bottom:number};
const EPS=.01;
export const containsBox=(a:PdfBox,b:PdfBox)=>a.x<=b.x+EPS&&a.y<=b.y+EPS&&a.right>=b.right-EPS&&a.bottom>=b.bottom-EPS;
export const intersectBox=(a:PdfBox,b:PdfBox):PdfBox=>({x:Math.max(a.x,b.x),y:Math.max(a.y,b.y),right:Math.min(a.right,b.right),bottom:Math.min(a.bottom,b.bottom)});
function union(boxes:PdfBox[]):PdfBox|undefined{return boxes.length?{x:Math.min(...boxes.map(b=>b.x)),y:Math.min(...boxes.map(b=>b.y)),right:Math.max(...boxes.map(b=>b.right)),bottom:Math.max(...boxes.map(b=>b.bottom))}:undefined;}
function transformBox(b:PdfBox,m:Matrix):PdfBox{
 const points=[[b.x,b.y],[b.right,b.y],[b.right,b.bottom],[b.x,b.bottom]].map(([x,y])=>point(m,x,y));
 return{x:Math.min(...points.map(p=>p[0])),y:Math.min(...points.map(p=>p[1])),right:Math.max(...points.map(p=>p[0])),bottom:Math.max(...points.map(p=>p[1]))};
}
/** Prove a single, closed, axis-aligned rectangle; bounds alone cannot prove a clip. */
export function rectangleClip(n:ParsedNode,parent=identity()):PdfBox|undefined{
 if(n.kind!=='vector'||n.paths?.length!==1||n.paths[0].operation)return;
 const data=mapPath(n.paths[0].data,nodeMatrix(n,parent)).data;
 if(/[CQ]/.test(data)||!data.endsWith('Z'))return;
 const tokens=data.match(/[MLZ]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi)||[];
 const points:[number,number][]=[];let index=0;
 while(index<tokens.length){const op=tokens[index++];if(op==='Z')break;if(op!=='M'&&op!=='L'||op==='M'&&points.length)return;points.push([+tokens[index++],+tokens[index++]]);}
 if(points.length===5&&Math.hypot(points[0][0]-points[4][0],points[0][1]-points[4][1])<EPS)points.pop();
 if(points.length!==4)return;
 const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),box={x:Math.min(...xs),y:Math.min(...ys),right:Math.max(...xs),bottom:Math.max(...ys)};
 if(box.right-box.x<EPS||box.bottom-box.y<EPS)return;
 const corners=new Set<string>();
 for(let i=0;i<4;i++){
  const p=points[i],q=points[(i+1)%4];
  if(Math.abs(p[0]-q[0])>EPS&&Math.abs(p[1]-q[1])>EPS)return;
  const x=Math.abs(p[0]-box.x)<EPS?0:Math.abs(p[0]-box.right)<EPS?1:-1;
  const y=Math.abs(p[1]-box.y)<EPS?0:Math.abs(p[1]-box.bottom)<EPS?1:-1;
  if(x<0||y<0)return;corners.add(x+','+y);
 }
 return corners.size===4?box:undefined;
}
export function paintedBounds(n:ParsedNode,parent=identity()):PdfBox|undefined{
 if(n.visible===false)return{x:0,y:0,right:0,bottom:0};
 if(n.effects?.length||n.overlays?.length)return;
 const m=nodeMatrix(n,parent);
 if(n.kind==='vector'){
  if(!n.paths?.length)return;
  const boxes=n.paths.map(p=>mapPath(p.data,m).box);if(boxes.some(b=>!Number.isFinite(b.minX)))return;
  const box=union(boxes.map(b=>({x:b.minX,y:b.minY,right:b.maxX,bottom:b.maxY})));if(!box)return;
  const padding=n.strokes?.length?(n.strokeWidth??1)*Math.max(Math.hypot(m[0],m[1]),Math.hypot(m[2],m[3]))*(n.strokeJoin==='MITER'?(n.miterLimit??10):1):0;
  return{x:box.x-padding,y:box.y-padding,right:box.right+padding,bottom:box.bottom+padding};
 }
 if(n.kind==='image')return transformBox({x:0,y:0,right:n.width,bottom:n.height},m);
 if(n.kind==='text'){
  // Source glyph ink is a stronger proof than font-size/advance guesses.
  const b=n.pdfLayout?.bounds;if(!b)return;
  const p=n.pdfTextPaints,padding=p?.strokes.length?p.strokeWidth*Math.max(Math.hypot(p.reference[0],p.reference[1]),Math.hypot(p.reference[2],p.reference[3]))*10:0;
  return transformBox({x:b.x-padding,y:b.y-padding,right:b.x+b.width+padding,bottom:b.y+b.height+padding},parent);
 }
 const boxes=n.children.filter(c=>c.visible!==false).map(c=>paintedBounds(c,m));
 if(boxes.some(b=>!b))return;
 const box=union(boxes as PdfBox[]);if(!box)return{x:0,y:0,right:0,bottom:0};
 if(n.kind==='frame'&&n.clip)return intersectBox(box,transformBox({x:0,y:0,right:n.width,bottom:n.height},m));
 if(n.kind==='mask'){const clip=rectangleClip(n.mask,m);if(clip)return intersectBox(box,clip);}
 return box;
}
function neutral(n:ParsedNode):boolean{return(n.opacity??1)===1&&(!n.blendMode||n.blendMode==='NORMAL'||n.blendMode==='PASS_THROUGH')&&!n.effects?.length&&!n.overlays?.length&&!n.issues?.length&&!n.transform&&!n.recovery;}
function neutralChildren(nodes:ParsedNode[]):boolean{return nodes.every(n=>(!n.blendMode||n.blendMode==='NORMAL'||n.blendMode==='PASS_THROUGH')&&(!('children'in n)||neutralChildren(n.children)));}
/** Strip redundant intersections. Real rectangular cuts become transparent
 * Frames; only non-rectangular/alpha masks remain mask groups. */
export function simplifyPdfClips(nodes:ParsedNode[],page?:PdfBox):ParsedNode[]{
 function list(input:ParsedNode[],inherited?:PdfBox,ancestors=new Set<string>()):ParsedNode[]{
  const out:ParsedNode[]=[];
  for(const n of input){
   if(n.kind==='mask'&&neutral(n)){
    const rect=n.maskType==='VECTOR'?rectangleClip(n.mask):undefined;
    const signature=n.maskType==='VECTOR'&&n.mask.kind==='vector'?JSON.stringify([n.mask.paths,n.mask.transform]):'';
    if(signature&&ancestors.has(signature)||rect&&inherited&&containsBox(rect,inherited)){
     out.push(...list(n.children,inherited,ancestors));continue;
    }
    const next=new Set(ancestors);if(signature)next.add(signature);
    const effective=rect&&inherited?intersectBox(rect,inherited):rect;
    n.children=list(n.children,effective||inherited,next);
    const children=n.children.filter(c=>c.visible!==false),boxes=rect?children.map(c=>paintedBounds(c)):[];
    if(rect&&boxes.length&&boxes.every(b=>b&&containsBox(rect,b))){out.push(...n.children);continue;}
    if(rect&&effective&&effective.right>effective.x&&effective.bottom>effective.y){
     const children=n.children;translateNodes(children,-effective.x,-effective.y);
     const frame:ParsedNode={kind:'frame',name:'裁切内容',sourceType:'pdf-clip-frame',sourceId:n.sourceId,x:effective.x,y:effective.y,
      width:effective.right-effective.x,height:effective.bottom-effective.y,children,clip:true,fills:[],sourceData:{pdfClip:true}};
     const previous=out[out.length-1];
     if(previous?.kind==='frame'&&previous.sourceType==='pdf-clip-frame'&&previous.x===frame.x&&previous.y===frame.y&&previous.width===frame.width&&previous.height===frame.height)previous.children.push(...children);
     else out.push(frame);
     continue;
    }
    out.push(n);continue;
   }
   if('children'in n)n.children=list(n.children,n.kind==='frame'||n.transform?undefined:inherited,n.transform?new Set():ancestors);
   // Pure grouping around normal paints contributes no clipping or compositing.
   if(n.kind==='group'&&n.sourceType!=='pdf-text-clip'&&neutral(n)&&neutralChildren(n.children))out.push(...n.children);
   else out.push(n);
  }
  return out;
 }
 return list(nodes,page);
}
