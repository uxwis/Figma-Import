import type {ParsedNode,ParsedText,ParsedVector} from '../types';
import {mapPath,nodeMatrix} from '../affine';
import {identity,inverse,multiply} from '../scene';

type Box={minX:number;minY:number;maxX:number;maxY:number};
export type SemanticGlyph={start:number;end:number;box:Box;repairedAscent?:boolean};
type Text={node:ParsedText;glyphs:SemanticGlyph[]};
type Contour={data:string;box:Box;controls:Box;vector:ParsedVector;list:ParsedNode[];owner?:Glyph};
type Glyph=SemanticGlyph&{text:Text;parts:Contour[]};
const union=(boxes:Box[]):Box=>({minX:Math.min(...boxes.map(b=>b.minX)),minY:Math.min(...boxes.map(b=>b.minY)),maxX:Math.max(...boxes.map(b=>b.maxX)),maxY:Math.max(...boxes.map(b=>b.maxY))});
// Three-decimal Type3 advances can accumulate a small horizontal drift over a
// long line; the declared ink widths and baseline must still match.
const EPS=.15;
const contains=(a:Box,b:Box)=>a.minX<=b.minX+EPS&&a.minY<=b.minY+EPS&&a.maxX>=b.maxX-EPS&&a.maxY>=b.maxY-EPS;
const equal=(a:Box,b:Box)=>Object.keys(a).every(k=>Math.abs(a[k as keyof Box]-b[k as keyof Box])<=EPS);
function glyphBox(a:Box,b:Box,repairedAscent=false):boolean{
 if(equal(a,b))return true;
 // Some Figma Type3 d1 boxes include extra ascender room. Require the exact
 // advance-axis edges and baseline edge, with a bounded empty ascender margin.
 return Math.abs(a.minX-b.minX)<=EPS&&Math.abs(a.maxX-b.maxX)<=EPS&&Math.abs(a.maxY-b.maxY)<=EPS&&b.minY>=a.minY-EPS&&b.minY-a.minY<=(a.maxY-a.minY)*(repairedAscent ? .8 : .5);
}

/** Tagged exports may paint outlines in /Artifact and carry selectable text in
 * empty Type3 d1 glyphs. The declared per-glyph ink boxes link the two layers.
 * Replace only complete matched glyphs, keeping unrelated artwork and stacking. */
export class PdfSemanticText{
 private artifact=new WeakSet<ParsedNode>();
 private texts:Text[]=[];
 mark(n:ParsedNode){this.artifact.add(n);}
 text(node:ParsedText,glyphs:SemanticGlyph[]){if(node.visible!==false)this.texts.push({node,glyphs});}
 restore(nodes:ParsedNode[]):ParsedNode[]{
  if(!this.texts.length)return nodes;
  const glyphs:Glyph[]=this.texts.flatMap(text=>text.glyphs.map(g=>({...g,text,parts:[]})));
  const byText=new Map<Text,Glyph[]>(),grid=new Map<string,Glyph[]>(),large:Glyph[]=[];
  for(const g of glyphs){const list=byText.get(g.text)||[];list.push(g);byText.set(g.text,list);
   const x0=Math.floor((g.box.minX-EPS)/32),x1=Math.floor((g.box.maxX+EPS)/32),y0=Math.floor((g.box.minY-EPS)/32),y1=Math.floor((g.box.maxY+EPS)/32);
   if((x1-x0+1)*(y1-y0+1)>256){large.push(g);continue;}
   for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){
    const key=x+','+y,cell=grid.get(key)||[];cell.push(g);grid.set(key,cell);}}
  const contours:Contour[]=[];
  const visit=(list:ParsedNode[])=>{for(const n of list){
   if(n.visible===false)continue;
   if(n.kind==='vector'&&this.artifact.has(n)&&n.paths?.length===1&&!n.paths.some(p=>p.operation)&&n.fills?.length&&!n.strokes?.length){
    for(const p of n.paths){const world=mapPath(p.data,nodeMatrix(n)).data;
     for(const data of world.match(/M[^M]+/g)||[]){if(!/[LC]/.test(data))continue;
      const box=mapPath(data,identity()).box,values=(data.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi)||[]).map(Number);
      const xs=values.filter((_,i)=>i%2===0),ys=values.filter((_,i)=>i%2===1);
      const controls={minX:Math.min(...xs),minY:Math.min(...ys),maxX:Math.max(...xs),maxY:Math.max(...ys)};
      contours.push({data,box,controls,vector:n,list});}}
   }
   if('children'in n&&!n.transform)visit(n.children);
  }};visit(nodes);
  for(const c of contours){
   const candidates=[...(grid.get(Math.floor((c.box.minX+c.box.maxX)/64)+','+Math.floor((c.box.minY+c.box.maxY)/64))||[]),...large].filter(g=>contains(g.box,c.box));
   // Do not guess between overlapping glyphs from independent text layers.
   if(candidates.length===1){c.owner=candidates[0];c.owner.parts.push(c);}
  }
  for(const g of glyphs){
   const groups=new Map<ParsedVector,Contour[]>();for(const c of g.parts){const parts=groups.get(c.vector)||[];parts.push(c);groups.set(c.vector,parts);}
   const fits=[...groups.values()].filter(parts=>glyphBox(g.box,union(parts.map(p=>p.box)),g.repairedAscent)||glyphBox(g.box,union(parts.map(p=>p.controls)),g.repairedAscent));
   if(fits.length===1){const selected=new Set(fits[0]);for(const c of g.parts)if(!selected.has(c))c.owner=undefined;g.parts=fits[0];}
  }
  const ready=new Set<ParsedText>();
  for(const t of this.texts){
   const gs=byText.get(t)||[],parts=gs.flatMap(g=>g.parts),first=parts[0];
   const complete=!!gs.length&&gs.every(g=>g.parts.length&&(glyphBox(g.box,union(g.parts.map(p=>p.box)),g.repairedAscent)||glyphBox(g.box,union(g.parts.map(p=>p.controls)),g.repairedAscent)));
   // A native paragraph cannot span different clipping/compositing containers.
   const sameContainer=first&&parts.every(p=>p.list===first.list);
   const paint=first&&JSON.stringify([first.vector.fills,first.vector.blendMode,first.vector.opacity]);
   const samePaint=first&&parts.every(p=>JSON.stringify([p.vector.fills,p.vector.blendMode,p.vector.opacity])===paint);
   if(complete&&sameContainer&&samePaint){
    const n=t.node,v=first.vector,b=union(parts.map(p=>p.box));ready.add(n);
    n.pdfTextPaints={fills:v.fills!,strokes:[],strokeWidth:0,reference:nodeMatrix(v)};
    n.opacity=v.opacity;n.blendMode=v.blendMode;
    n.inkBounds={x:b.minX,y:b.minY,width:b.maxX-b.minX,height:b.maxY-b.minY};
    n.pdfLayout!.bounds={...n.inkBounds};
    n.issues=n.issues?.filter(i=>i.code!=='text-layout-approximation');
    n.sourceData={...n.sourceData,pdfSemanticText:{restored:true,glyphs:gs.length,outlineIds:[...new Set(parts.map(p=>p.vector.sourceId))]}};
   }else{
    // Empty Type3 glyphs paint no ink in the PDF. Exposing their Unicode as a
    // visible fallback would create a second copy over existing artwork.
    t.node.visible=false;
    (t.node.issues??=[]).push({code:'pdf-text-semantic-unmatched',message:'PDF 的部分语义文字未能与可见轮廓完整对应；已保留原外观和隐藏的可编辑文字，请核对。'});
   }
  }
  const remove=new Set<ParsedText>(this.texts.map(t=>t.node)),inserted=new Set<ParsedText>();
  const byVector=new Map<ParsedVector,Contour[]>();for(const c of contours){const list=byVector.get(c.vector)||[];list.push(c);byVector.set(c.vector,list);}
  const replace=(list:ParsedNode[]):ParsedNode[]=>list.flatMap(n=>{
   if(n.kind==='text'&&remove.has(n))return ready.has(n)||!n.characters.trim()?[]:[n];
   if('children'in n)n.children=replace(n.children);
   if(n.kind!=='vector'||!byVector.has(n))return[n];
   const parts=byVector.get(n)!,matched=parts.filter(c=>c.owner&&ready.has(c.owner.text.node));if(!matched.length)return[n];
   const text=[...new Set(matched.map(c=>c.owner!.text.node))].filter(t=>!inserted.has(t));text.forEach(t=>inserted.add(t));
   const remaining=parts.filter(c=>!matched.includes(c));
   if(remaining.length){const m=inverse(nodeMatrix(n));n.fills=n.fills?.map(p=>({...p,transform:p.transform?multiply(p.transform,m):undefined}));n.paths=[{data:remaining.map(c=>c.data).join(' '),windingRule:n.paths![0].windingRule}];n.transform=identity();n.x=n.y=0;return[n,...text];}
   return text;
  });
  return replace(nodes);
 }
}
