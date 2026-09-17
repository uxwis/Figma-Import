/** PDF.js 6 operator adapter. No document-wide SVG and no DOM layout sampling.
 * Private operator payloads are isolated here and pinned by regression fixtures. */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import type { Matrix, Paint, ParsedNode, ParsedVector, ParseOptions, ParseResult, RGB } from '../types';
import { identity, inverse, multiply, finishScene, checkCancelled, issue } from '../scene';
import { createCanvas, toPng } from '../canvas';
import { blendName, solid } from './psdPaint';
(globalThis as typeof globalThis & {pdfjsWorker?:unknown}).pdfjsWorker={WorkerMessageHandler};
const names=new Map<number,string>(Object.entries(pdfjs.OPS).map(([k,v])=>[v,k]));
type ObjStore={get(id:string,callback?:(v:any)=>void):any;has(id:string):boolean};
type Page={view:number[];getViewport(options:{scale:number}):{width:number;height:number;transform:number[]};
  getOperatorList():Promise<{fnArray:number[];argsArray:any[][]}>;objs:ObjStore;commonObjs:ObjStore};
type State={ctm:Matrix;fill:Paint;stroke:Paint;fillAlpha:number;strokeAlpha:number;blend:string;
 width:number;cap:'NONE'|'ROUND'|'SQUARE';join:'MITER'|'ROUND'|'BEVEL';dash:number[];miter:number;
 clips:ParsedVector[];font?:any;fontSize:number;tm:Matrix;tx:number;ty:number;lx:number;ly:number;
 hscale:number;char:number;word:number;leading:number;rise:number;mode:number;visible:boolean;issues:{code:string;message:string}[]};
function cssColor(value:string):RGB {
 if(value==='transparent')return{r:0,g:0,b:0,a:0};
 const h=value.match(/^#([\da-f]{6})$/i);if(h){const v=parseInt(h[1],16);return{r:(v>>16)/255,g:((v>>8)&255)/255,b:(v&255)/255};}
 const rgb=value.match(/[\d.]+/g);if(rgb?.length&&rgb.length>=3)return{r:+rgb[0]/255,g:+rgb[1]/255,b:+rgb[2]/255,a:rgb[3]===undefined?1:+rgb[3]};
 throw new Error('无法解读 PDF 颜色 '+value);
}
const numbers=(v:ArrayLike<number>)=>Array.from(v);
function rect(x:number,y:number,w:number,h:number){return new Float32Array([0,x,y,1,x+w,y,1,x+w,y+h,1,x,y+h,4]);}
export function decodeDrawPath(cmds:ArrayLike<number>,dx=0,dy=0):string {
 let d='',i=0;const arity=[2,2,6,4,0],letters=['M','L','C','Q','Z'];
 while(i<cmds.length){const op=cmds[i++],n=arity[op];if(n===undefined||i+n>cmds.length)throw new Error('无效 PDF DrawOPS 路径');
 d+=letters[op];for(let j=0;j<n;j++)d+=(j?' ':'')+(cmds[i++]+(j%2?dy:dx));d+=' ';}
 return d.trim();
}
function bounds(cmds:ArrayLike<number>):number[]{
 let i=0,minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 while(i<cmds.length){const n=[2,2,6,4,0][cmds[i++]];if(n===undefined)throw new Error('无效路径');
 for(let j=0;j<n;j+=2){const x=cmds[i++],y=cmds[i++];minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}
 return Number.isFinite(minX)?[minX,minY,maxX,maxY]:[0,0,0,0];
}
function geometry(cmds:ArrayLike<number>,matrix:Matrix,bbox?:ArrayLike<number>,even=false):ParsedVector{
 const [x,y,r,b]=bbox?numbers(bbox):bounds(cmds);
 return{kind:'vector',name:'路径',sourceType:'pdf-path',x:0,y:0,width:Math.max(0.001,r-x),height:Math.max(0.001,b-y),
 transform:multiply(matrix,[1,0,0,1,x,y]),paths:[{data:decodeDrawPath(cmds,-x,-y),windingRule:even?'EVENODD':'NONZERO'}],fills:[]};
}
async function object(page:Page,id:string):Promise<any>{
 const store=id.startsWith('g_')?page.commonObjs:page.objs;
 return store.has(id)?store.get(id):new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(new Error('PDF 资源等待超时：'+id)),15000);
 store.get(id,v=>{clearTimeout(timer);resolve(v);});
 });
}
function cloneState(s:State):State{return{...s,ctm:[...s.ctm],tm:[...s.tm],clips:[...s.clips],issues:[...s.issues],dash:[...s.dash]};}
export async function parseAIorEPS(data:ArrayBuffer,progress?:(p:number,m:string)=>void,options:ParseOptions={}):Promise<ParseResult>{
 checkCancelled(options.signal);
 const bytes=new Uint8Array(data),head=new TextDecoder('latin1').decode(bytes.subarray(0,1024)),start=head.indexOf('%PDF-');
 if(start<0)throw new Error(head.includes('%!PS')?'EPS/PostScript 需要通过插件内转换入口导入；不会使用预览位图代替源内容':'该 AI 不含 PDF 兼容内容，请另存为带 PDF 兼容内容的 AI 或 PDF');
 const task=pdfjs.getDocument({data:bytes.slice(start),disableFontFace:true,fontExtraProperties:true,stopAtErrors:true,
 isOffscreenCanvasSupported:false,isImageDecoderSupported:false,useSystemFonts:false,verbosity:0});
 try{
 const doc=await task.promise,nodes:ParsedNode[]=[];let x=0,height=0;const optional=await doc.getOptionalContentConfig();
 for(let p=1;p<=doc.numPages;p++){checkCancelled(options.signal);
 const page=await doc.getPage(p) as unknown as Page,view=page.getViewport({scale:1});
 const children=await parsePage(page,options,ratio=>progress?.(10+80*((p-1+ratio)/doc.numPages),'解析 PDF 第 '+p+' 页'),p,optional);
 nodes.push({kind:'frame',name:'画板 '+p,sourceId:'pdf/page-'+p,x,y:0,width:view.width,height:view.height,children,clip:true,artboard:true,fills:[]});
 height=Math.max(height,view.height);x+=view.width+40;}
 // A top-level PDF keeps its page crop and identity even when it has one page.
 // Embedded one-page smart objects use the placed object's existing container.
 if(nodes.length===1&&(options.depth??0)>0){const n=nodes[0];if(n.kind==='frame')return finishScene(n.width,n.height,n.children);}
 return finishScene(x-40,height,nodes);
 }finally{await task.destroy();}
}
export async function parsePage(page:Page,options:ParseOptions,progress:(p:number)=>void,pageNumber:number,optional:{isVisible(group:any):boolean}):Promise<ParsedNode[]>{
 const ops=await page.getOperatorList(),view=page.getViewport({scale:1}),nodes:ParsedNode[]=[];
 let dest=nodes,serial=0,pendingClip:undefined|boolean;
 let s:State={ctm:view.transform as Matrix,fill:solid({r:0,g:0,b:0}),stroke:solid({r:0,g:0,b:0}),fillAlpha:1,strokeAlpha:1,blend:'NORMAL',
 width:1,cap:'NONE',join:'MITER',dash:[],miter:10,clips:[],fontSize:0,tm:identity(),tx:0,ty:0,lx:0,ly:0,hscale:1,char:0,word:0,leading:0,rise:0,mode:0,visible:true,issues:[]};
 const stack:State[]=[],groups:{dest:ParsedNode[];state:State}[]=[];
 const clipRuns=new WeakMap<ParsedNode[],{clips:ParsedVector[];outer:ParsedNode;inner:ParsedNode[]}>();
 const marked:boolean[]=[];
 const add=(n:ParsedNode)=>{
 n.sourceId='pdf/page-'+pageNumber+'/op-'+serial++;n.blendMode??=s.blend;n.visible??=s.visible;
 if(s.issues.length){n.issues=[...n.issues||[],...s.issues];n.fidelity='unsupported';}
 if(!s.clips.length){dest.push(n);return;}
 const run=clipRuns.get(dest);
 if(run&&dest[dest.length-1]===run.outer&&run.clips.length===s.clips.length&&run.clips.every((c,i)=>c===s.clips[i])){run.inner.push(n);return;}
 const inner:ParsedNode[]=[n];let children=inner,outer:ParsedNode=n;
 for(let i=s.clips.length-1;i>=0;i--){outer={kind:'mask',name:'裁剪',mask:structuredClone(s.clips[i]),maskType:'VECTOR',children};children=[outer];}
 dest.push(outer);clipRuns.set(dest,{clips:[...s.clips],outer,inner});
 };
 const unsupported=(code:string,message:string)=>add({kind:'group',name:message,children:[],fidelity:'unsupported',issues:[{code,message}]});
 const save=()=>stack.push(cloneState(s));
 const restore=()=>{const prev=stack.pop();if(!prev)throw new Error('PDF 图形状态栈不匹配');s=prev;};
 const paintPath=(cmds:ArrayLike<number>,box:ArrayLike<number>|undefined,op:string)=>{
 const even=op.toLowerCase().includes('eo'),v=geometry(cmds,s.ctm,box,even);
 const b=box?numbers(box):bounds(cmds),shift:Matrix=[1,0,0,1,b[0],b[1]];
 const local=(p:Paint,alpha:number):Paint=>({...p,opacity:(p.opacity??1)*alpha,transform:p.transform?multiply(p.transform,shift):undefined});
 if(op!=='endPath'){
 v.fills=op.toLowerCase().includes('fill')?[local(s.fill,s.fillAlpha)]:[];
 v.strokes=op.toLowerCase().includes('stroke')?[local(s.stroke,s.strokeAlpha)]:[];
 v.strokeWidth=s.width;v.strokeCap=s.cap;v.strokeJoin=s.join;v.dashPattern=s.dash;v.miterLimit=s.miter;
 if(op.startsWith('close')&&!v.paths![0].data.endsWith('Z'))v.paths![0].data+=' Z';
 add(v);}
 if(pendingClip!==undefined){const mask=geometry(cmds,s.ctm,box,pendingClip);mask.name='PDF 裁剪路径';mask.fills=[solid({r:1,g:1,b:1})];s.clips.push(mask);pendingClip=undefined;}
 };
 const setFont=async(id:string,size:number)=>{s.font=await object(page,id);s.fontSize=size;};
 async function text(glyphs:any[]){
 if(!s.font){unsupported('pdf-font','缺少 PDF 字体');return;}
 const f=s.font,size=Math.abs(s.fontSize),direction=s.fontSize<0?-1:1,hs=s.hscale*direction;
 if(f.isType3Font||f.vertical){unsupported('pdf-text-layout','Type3 或竖排 PDF 字体尚未支持，请在原软件中转曲后重试');return;}
 let advance=0;
 for(const g of glyphs){if(typeof g==='number'){advance-=g*size/1000;continue;}
 const id=f.loadedName+'_path_'+g.fontChar;
 const glyph=page.commonObjs.has(id)?page.commonObjs.get(id):undefined;
 // PDF.js may append closePath (DrawOPS 4) to a glyph with no contours.
 // It has no geometry, even when isSpace is false; still advance below.
 const emptyOutline=glyph?.path!==undefined&&numbers(glyph.path).every(op=>op===4);
 if(glyph?.path?.length && !emptyOutline && s.mode!==3){
 // PDF.js font paths are already normalized to em units and point upward.
 const tm=multiply(s.ctm,multiply(s.tm,[hs*size,0,0,direction*size,s.tx+hs*advance,s.ty+s.rise]));
 const v=geometry(glyph.path,tm);v.name=g.unicode||'字形';v.sourceType='pdf-glyph';v.fidelity='outlined-text';
 const paint=(p:Paint,alpha:number)=>({...p,opacity:alpha,transform:p.transform?multiply(p.transform,multiply(inverse(s.ctm),v.transform!)):undefined});
 v.fills=(s.mode&3)===1?[]:[paint(s.fill,s.fillAlpha)];v.strokes=(s.mode&3)===0?[]:[paint(s.stroke,s.strokeAlpha)];v.strokeWidth=s.width/Math.max(size,0.001);
 if(g.accent)issue(v,'pdf-glyph-accent','组合字形的独立重音尚未支持，请核对文字外观');
 if(s.mode>=4){s.issues.push({code:'pdf-text-clip',message:'文字裁剪尚未支持'});}add(v);
 }else if(!emptyOutline&&!g.isSpace&&s.mode!==3)unsupported('pdf-missing-outline','无法取得字形轮廓：'+(g.unicode||'?'));
 advance+=g.width*size*(f.fontMatrix?.[0]??0.001)+(s.char+(g.isSpace?s.word:0))*direction;
 }s.tx+=advance*hs;
 }
 async function shading(id:string,matrix?:Matrix):Promise<Paint|null>{
 const ir=await object(page,id);
 if(ir?.[0]!=='RadialAxial'){unsupported('pdf-shading','网格渐变或图案需要局部合成');return null;}
 const [,type,,stops,p0,p1,r0,r1]=ir,dx=p1[0]-p0[0],dy=p1[1]-p0[1];
 let m:Matrix;
 if(type==='axial')m=[dx,dy,-dy,dx,p0[0]+dy/2,p0[1]-dx/2];
 else if(Math.hypot(dx,dy)<0.001 && r0===0)m=[2*r1,0,0,2*r1,p0[0]-r1,p0[1]-r1];
 else {unsupported('pdf-radial-focal','偏心径向渐变需要局部合成');return null;}
 return{type:type==='axial'?'GRADIENT_LINEAR':'GRADIENT_RADIAL',stops:stops.map((v:[number,string])=>({position:v[0],color:cssColor(v[1])})),
 transform:inverse(matrix?multiply(matrix,m):m)};
 }
 async function imageData(raw:any,mask=false){
 const w=raw.width,h=raw.height;if(!(w>0&&h>0))throw new Error('无效 PDF 图片');
 const canvas=createCanvas(w,h),ctx=canvas.getContext('2d')!;
 if(raw.bitmap){ctx.drawImage(raw.bitmap,0,0);}
 else {const rgba=new Uint8ClampedArray(w*h*4),data=raw.data;const col=s.fill.color||{r:0,g:0,b:0};
 for(let i=0;i<w*h;i++){const o=i*4;
 if(mask||raw.kind===1){const b=(data[Math.floor(i/w)*Math.ceil(w/8)+((i%w)>>3)]>>(7-(i%w)%8))&1;
 rgba[o]=mask?col.r*255:b*255;rgba[o+1]=mask?col.g*255:b*255;rgba[o+2]=mask?col.b*255:b*255;rgba[o+3]=mask?(1-b)*255:255;}
 else {const c=raw.kind===2?3:4;rgba[o]=data[i*c];rgba[o+1]=data[i*c+1];rgba[o+2]=data[i*c+2];rgba[o+3]=c===4?data[i*c+3]:255;}}
 ctx.putImageData(new ImageData(rgba,w,h),0,0);}
 const bytes=await toPng(canvas);if(!bytes)throw new Error('PDF 图片编码失败');
 add({kind:'image',name:mask?'图像蒙版':'原始图片',sourceType:mask?'pdf-image-mask':'pdf-image',bytes,x:0,y:0,width:w,height:h,opacity:s.fillAlpha,
 transform:multiply(s.ctm,[1/w,0,0,-1/h,0,1])});
 }
 for(let i=0;i<ops.fnArray.length;i++){
 if(i%100===0){checkCancelled(options.signal);progress(i/Math.max(1,ops.fnArray.length));await new Promise(r=>setTimeout(r,0));}
 const op=names.get(ops.fnArray[i])||'unknown',a=ops.argsArray[i]||[];
 switch(op){
 case'dependency':for(const id of a)await object(page,id);break;
 case'save':save();break;case'restore':restore();break;
 case'transform':s.ctm=multiply(s.ctm,a as Matrix);break;
 case'setLineWidth':s.width=a[0];break;case'setLineCap':s.cap=['NONE','ROUND','SQUARE'][a[0]] as State['cap'];break;
 case'setLineJoin':s.join=['MITER','ROUND','BEVEL'][a[0]] as State['join'];break;
 case'setMiterLimit':s.miter=a[0];break;case'setDash':s.dash=numbers(a[0]);if(a[1])s.issues.push({code:'pdf-dash-phase',message:'非零虚线偏移需要轮廓转换'});break;
 case'setFillRGBColor':s.fill=solid(cssColor(a[0]));break;case'setStrokeRGBColor':s.stroke=solid(cssColor(a[0]));break;
 case'setFillTransparent':s.fill=solid({r:0,g:0,b:0,a:0});break;case'setStrokeTransparent':s.stroke=solid({r:0,g:0,b:0,a:0});break;
 case'clip':pendingClip=false;break;case'eoClip':pendingClip=true;break;
 case'constructPath':paintPath(a[1][0]||[],a[2],names.get(a[0])||'unknown');break;
 case'setGState':for(const [k,v]of a[0]){
 if(k==='ca')s.fillAlpha=v;else if(k==='CA')s.strokeAlpha=v;else if(k==='BM'){s.blend=v==='source-over'?'NORMAL':blendName(v)||'NORMAL';if(v!=='source-over'&&!blendName(v))s.issues.push({code:'pdf-blend',message:'不支持的 PDF 混合 '+v});}
 else if(k==='LW')s.width=v;else if(k==='LC')s.cap=['NONE','ROUND','SQUARE'][v] as State['cap'];else if(k==='LJ')s.join=['MITER','ROUND','BEVEL'][v] as State['join'];
 else if(k==='ML')s.miter=v;else if(k==='D')s.dash=numbers(v[0]);else if(k==='Font')await setFont(v[0],v[1]);
 else if(k==='SMask'&&v)s.issues.push({code:'pdf-soft-mask',message:'PDF 透明蒙版尚未支持'});else if(k==='TR'&&v)s.issues.push({code:'pdf-transfer',message:'PDF 色调映射尚未支持'});}break;
 case'paintFormXObjectBegin':save();if(a[0])s.ctm=multiply(s.ctm,a[0]);if(a[1]){const [x,y,r,b]=a[1];pendingClip=false;paintPath(rect(x,y,r-x,b-y),a[1],'endPath');}break;
 case'paintFormXObjectEnd':restore();break;
 case'beginGroup':{
 groups.push({dest,state:cloneState(s)});const g:ParsedNode={kind:'group',name:'PDF 透明组',children:[],opacity:s.fillAlpha,blendMode:s.blend};add(g);dest=g.children;
 s=cloneState(s);s.clips=[];s.fillAlpha=s.strokeAlpha=1;s.blend='NORMAL';
 if(a[0].matrix)s.ctm=multiply(s.ctm,a[0].matrix);if(a[0].knockout||a[0].smask)issue(g,'pdf-group-composite','挖空组或透明蒙版尚未支持');break;}
 case'endGroup':{const g=groups.pop();if(!g)throw new Error('PDF 透明组不匹配');dest=g.dest;s=g.state;break;}
 case'setFillColorN':case'setStrokeColorN':{
 const ir=a;const paint=ir?.[0]==='Shading'?await shading(ir[1],ir[2]):null;
 if(paint){if(op==='setFillColorN')s.fill=paint;else s.stroke=paint;}else s.issues.push({code:'pdf-pattern',message:'图案填充需要局部合成'});break;}
 case'shadingFill':{const p=await shading(a[0]);if(p){const inv=inverse(s.ctm),pts=[[0,0],[view.width,0],[view.width,view.height],[0,view.height]].map(([x,y])=>[inv[0]*x+inv[2]*y+inv[4],inv[1]*x+inv[3]*y+inv[5]]);
 const x=Math.min(...pts.map(p=>p[0])),y=Math.min(...pts.map(p=>p[1])),r=Math.max(...pts.map(p=>p[0])),b=Math.max(...pts.map(p=>p[1]));
 const old=s.fill;s.fill=p;paintPath(rect(x,y,r-x,b-y),[x,y,r,b],'fill');s.fill=old;}break;}
 case'paintImageXObject':await imageData(await object(page,a[0]));break;case'paintInlineImageXObject':await imageData(a[0]);break;
 case'paintImageMaskXObject':await imageData(a[0],true);break;
 case'beginText':s.tm=identity();s.tx=s.ty=s.lx=s.ly=0;break;case'endText':break;
 case'setFont':await setFont(a[0],a[1]);break;
 case'setTextMatrix':s.tm=(Array.isArray(a[0])||ArrayBuffer.isView(a[0])?numbers(a[0] as ArrayLike<number>):a) as Matrix;s.tx=s.ty=s.lx=s.ly=0;break;
 case'setCharSpacing':s.char=a[0];break;case'setWordSpacing':s.word=a[0];break;case'setHScale':s.hscale=a[0]/100;break;
 case'setLeading':s.leading=-a[0];break;case'setTextRise':s.rise=a[0];break;case'setTextRenderingMode':s.mode=a[0];break;
 case'moveText':s.tx=s.lx+=a[0];s.ty=s.ly+=a[1];break;
 case'setLeadingMoveText':s.leading=a[1];s.tx=s.lx+=a[0];s.ty=s.ly+=a[1];break;
 case'nextLine':s.tx=s.lx;s.ty=s.ly+=s.leading;break;
 case'showText':case'showSpacedText':await text(a[0]);break;
 case'nextLineShowText':s.tx=s.lx;s.ty=s.ly+=s.leading;await text(a[0]);break;
 case'nextLineSetSpacingShowText':s.word=a[0];s.char=a[1];s.tx=s.lx;s.ty=s.ly+=s.leading;await text(a[2]);break;
 case'beginMarkedContent':marked.push(s.visible);break;
 case'beginMarkedContentProps':marked.push(s.visible);if(a[0]==='OC')s.visible=s.visible&&optional.isVisible(a[1]);break;
 case'endMarkedContent':s.visible=marked.pop()??s.visible;break;
 case'markPoint':case'markPointProps':case'setRenderingIntent':case'setFlatness':case'beginCompat':case'endCompat':break;
 default:unsupported('pdf-operator-'+op,'尚未支持 PDF 指令 '+op);
 }
 }
 if(stack.length||groups.length)throw new Error('PDF 状态栈未闭合');
 return nodes;
}

