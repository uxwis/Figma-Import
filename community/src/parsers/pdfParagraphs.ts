import type {Matrix,ParsedNode,ParsedText,ParsedTextStyleRun} from '../types';
import {identity,inverse,multiply} from '../scene';
import {point} from '../affine';

const close=(a:number,b:number,tolerance=.001)=>Math.abs(a-b)<=tolerance;
function normalized(n:ParsedText):ParsedText{
 const m=n.transform||[1,0,0,1,n.x,n.y] as Matrix,scale=Math.hypot(m[2],m[3]);
 if(!scale||close(scale,1,1e-9))return n;
 return{...n,fontSize:(n.fontSize||12)*scale,leading:n.leading===undefined?undefined:n.leading*scale,
  transform:[m[0]/scale,m[1]/scale,m[2]/scale,m[3]/scale,m[4],m[5]],
  pdfLayout:n.pdfLayout?{...n.pdfLayout,advance:n.pdfLayout.advance*scale}:undefined,
  styleRuns:n.styleRuns?.map(r=>({...r,fontSize:r.fontSize===undefined?undefined:r.fontSize*scale,leading:r.leading===undefined?undefined:r.leading*scale,paragraphIndent:r.paragraphIndent===undefined?undefined:r.paragraphIndent*scale}))};
}
function runsFor(n:ParsedText):ParsedTextStyleRun[]{
 const base={font:n.font,fontSize:n.fontSize,color:n.color,tracking:n.tracking,leading:n.leading,
  pdfFills:n.pdfTextPaints?.fills,pdfReference:n.pdfTextPaints?.reference};
 return n.styleRuns?.length?n.styleRuns.map(r=>({...base,...r})):[{...base,length:n.characters.length}];
}
function compatible(a:ParsedText,b:ParsedText):boolean{
 if(!a.pdfLayout||!b.pdfLayout||a.visible!==b.visible||a.blendMode!==b.blendMode||(a.opacity??1)!==(b.opacity??1))return false;
 if(a.pdfLayout.tag!==b.pdfLayout.tag)return false;
 if(!!a.pdfLayout.vertical!==!!b.pdfLayout.vertical)return false;
 const x=a.transform||identity(),y=b.transform||identity();
 if(x.slice(0,4).some((v,i)=>!close(v,y[i],.0001)))return false;
 // Figma exposes range fills but stroke paints are shared by the TextNode.
 const stroke=(n:ParsedText)=>JSON.stringify([n.pdfTextPaints?.strokes,n.pdfTextPaints?.strokes.length?n.pdfTextPaints.strokeWidth:0]);
 return stroke(a)===stroke(b)&&!a.textOverlay&&!b.textOverlay;
}
type Line={x:number;y:number;right:number;start:number;end:number;size:number};
function aligned(a:Line,b:Line):boolean{
 const tolerance=Math.max(1,Math.min(a.size,b.size)*.4);
 return close(a.x,b.x,tolerance)||close(a.right,b.right,tolerance)||close((a.x+a.right)/2,(b.x+b.right)/2,tolerance);
}
const isCjk=(c:string)=>/[\u2e80-\u9fff\uf900-\ufaff]/.test(c);
function needsSpace(left:string,right:string,gap:number,size:number):boolean{
 return gap>size*.18&&!/\s$/.test(left)&&!/^\s|^[,.;:!?，。；：！？）】]/.test(right)&&!isCjk(left.slice(-1))&&!isCjk(right[0]||'');
}
function addTracking(runs:ParsedTextStyleRun[],delta:number):void{
 if(Math.abs(delta)<.001||!runs.length)return;
 const last=runs.pop()!;
 if(last.length>1)runs.push({...last,length:last.length-1});
 runs.push({...last,length:1,tracking:(last.tracking||0)+delta/(last.fontSize||12)*1000});
}
function combine(parts:ParsedText[]):ParsedText{
 if(parts.length===1)return parts[0];
 const first=parts[0],m=first.transform||identity(),inv=inverse(m),runs:ParsedTextStyleRun[]=[],lines:Line[]=[];
 let characters='',last=first;
 const sourceIds:string[]=[];
 for(const n of parts){
  const at=point(inv,(n.transform||identity())[4],(n.transform||identity())[5]),size=n.fontSize||12;
  let line:Line|undefined=lines[lines.length-1];
  if(line&&Math.abs(at[1]-line.y)>Math.min(line.size,size)*.18){
   if(!characters.endsWith('\n')){const previous=runs[runs.length-1];runs.push({...previous,length:1,tracking:0});characters+='\n';}line=undefined;
  }else if(line){
   const gap=at[0]-line.right;
   if(needsSpace(characters,n.characters,gap,size)){
    runs.push({...runs[runs.length-1],length:1,tracking:0});characters+=' ';
   }else addTracking(runs,gap);
  }
  if(!line){line={x:at[0],y:at[1],right:at[0],start:characters.length,end:characters.length,size};lines.push(line);}
  characters+=n.characters;runs.push(...runsFor(n));line.end=characters.length;line.right=Math.max(line.right,at[0]+(n.pdfLayout?.advance||0));line.size=Math.max(line.size,size);
  sourceIds.push(...(n.pdfLayout?.sourceIds||(n.sourceId?[n.sourceId]:[])));last=n;
 }
 const left=Math.min(...lines.map(l=>l.x)),right=Math.max(...lines.map(l=>l.right)),width=Math.max(.01,right-left);
 const tolerance=Math.max(1,(first.fontSize||12)*.4),center=(lines[0].x+lines[0].right)/2;
 const align=lines.length>1&&lines.every(l=>close((l.x+l.right)/2,center,tolerance))?'center':lines.length>1&&lines.every(l=>close(l.right,lines[0].right,tolerance))?'right':'left';
 const distances=lines.slice(1).map((line,i)=>line.y-lines[i].y),leading=distances.length?distances.reduce((a,b)=>a+b,0)/distances.length:first.leading;
 let offset=0;
 for(const run of runs){const line=lines.find(l=>offset>=l.start&&offset<=l.end)||lines[lines.length-1];const index=lines.indexOf(line);if(lines.length>1){run.leading=distances[index]||leading;if(align==='left')run.paragraphIndent=line.x-left;}offset+=run.length;}
 const bounds=parts.map(p=>p.pdfLayout?.bounds),complete=bounds.every(Boolean);
 const box=complete?{x:Math.min(...bounds.map(b=>b!.x)),y:Math.min(...bounds.map(b=>b!.y)),width:0,height:0}:undefined;
 if(box){box.width=Math.max(...bounds.map(b=>b!.x+b!.width))-box.x;box.height=Math.max(...bounds.map(b=>b!.y+b!.height))-box.y;}
 const semantic=parts.map(p=>p.sourceData?.pdfSemanticText as {restored:boolean;glyphs:number;outlineIds:string[]}|undefined);
 return{...first,characters,name:characters.split('\n')[0].slice(0,80),transform:multiply(m,[1,0,0,1,left,0]),fontSize:first.fontSize,inkBounds:first.inkBounds&&box?box:first.inkBounds,
  width,box:lines.length>1,align,leading,styleRuns:runs,
  pdfLayout:{...first.pdfLayout!,advance:lines.length===1?right-left:last.pdfLayout!.advance,bounds:box,paragraph:true,lineCount:lines.length,sourceIds},
  sourceData:{...first.sourceData,pdfParagraph:{lineCount:lines.length,sourceIds},...(semantic.every(Boolean)?{pdfSemanticText:{restored:true,glyphs:semantic.reduce((sum,s)=>sum+s!.glyphs,0),outlineIds:[...new Set(semantic.flatMap(s=>s!.outlineIds))]}}:{})}};
}
/** Keep TJ adjustments inside a text span. Rejoin adjacent spans into their
 * text object/paragraph, respecting columns, large gaps, orientation and tags. */
export function mergePdfParagraphs(nodes:ParsedNode[]):ParsedNode[]{
 const out:ParsedNode[]=[];
 for(let i=0;i<nodes.length;){
  const n=nodes[i];if('children'in n)n.children=mergePdfParagraphs(n.children);
  if(n.kind==='mask'&&'children'in n.mask)n.mask.children=mergePdfParagraphs(n.mask.children);
  if(n.kind!=='text'||n.sourceType!=='pdf-text'||!n.pdfLayout){out.push(n);i++;continue;}
  const first=normalized(n),parts=[first],base=first.transform||identity();let inv:Matrix;
  try{inv=inverse(base);}catch{out.push(n);i++;continue;}
  let line:Line={x:0,y:0,right:first.pdfLayout!.advance,start:0,end:first.characters.length,size:first.fontSize||12};
  let last=first,step=0;
  for(let j=i+1;j<nodes.length;j++){
   const raw=nodes[j];if(raw.kind!=='text'||raw.sourceType!=='pdf-text'||!raw.pdfLayout)break;
   const next=normalized(raw);if(!compatible(first,next))break;
   const p=point(inv,(next.transform||identity())[4],(next.transform||identity())[5]),size=next.fontSize||12,minSize=Math.min(line.size,size),dy=p[1]-line.y;
   const sameLine=Math.abs(dy)<=minSize*.18;
   const sameObject=last.pdfLayout!.object===next.pdfLayout!.object,sameTag=!!first.pdfLayout?.tag&&first.pdfLayout.tag===next.pdfLayout?.tag;
   if(sameLine){
    const gap=p[0]-line.right;
    if(gap<-.2*minSize||gap>minSize*(sameObject||sameTag?2:1))break;
    line.right=Math.max(line.right,p[0]+next.pdfLayout!.advance);line.size=Math.max(line.size,size);
   }else{
    const candidate:Line={x:p[0],y:p[1],right:p[0]+next.pdfLayout!.advance,start:0,end:next.characters.length,size};
    const indented=sameObject&&Math.abs(line.x-candidate.x)<=minSize*2.1;
    if(dy<minSize*.7||dy>Math.max(line.size,size)*2.2||!aligned(line,candidate)&&!indented)break;
    if(step&&Math.abs(dy-step)>Math.max(1,step*.2))break;
    if(!sameObject&&!sameTag&&(last.characters.trim().length<20||next.characters.trim().length<20))break;
    if(!sameObject&&!sameTag&&Math.abs(size-line.size)>minSize*.1)break;
    step=dy;line=candidate;
   }
   parts.push(next);last=next;
  }
  out.push(combine(parts));i+=parts.length;
 }
 return out;
}
