import { readPsd, initializeCanvas, type Layer, type Psd, type PixelData, type BezierPath, type TextStyle } from 'ag-psd';
import { childrenOf } from '../types';
import { sceneBounds } from '../bounds';
import type { Common, Matrix, ParseOptions, ParsedNode, ParsedImage, ParsedVector, ParsedText, ParsedMask, ParseResult } from '../types';
import { finishScene, translateNodes, materializeResources, issue, checkCancelled } from '../scene';
import { buildShapePath, colorToRgb } from './psdSvg';
import { blendName, gradientPaint, solid, applyPsdEffects } from './psdPaint';
import { resolveShapeBlend, resolveWhiteBackdrop } from './psdBlend';
import { createCanvas, downscaleToLimit, toPng, MAX_IMAGE_DIM } from '../canvas';
import { parseFontName, applyFaux } from '../font';
import { createWarns, clamp01 } from '../util';
import { type Box, boxWidth, boxHeight } from '../svg';
import {checkPsdDimensions,preflightPsd} from '../psd-preflight';
import {PSD_DECODE_LIMIT} from '../conversion-limits';
import {importError,MEMORY_ERROR} from '../import-errors';

type Context = { psd: Psd; options: ParseOptions; progress?: (p:number,m:string)=>void; done:number; total:number;
  warns: ReturnType<typeof createWarns>; assets: Map<string,Promise<ParseResult>> };
let initialized=false;
function init() {if(!initialized){initializeCanvas((w,h)=>createCanvas(w,h));initialized=true;}}
export function pixelsCanvas(pd:PixelData):HTMLCanvasElement {
  const rgba=new Uint8ClampedArray(pd.width*pd.height*4), channels=pd.data.length/(pd.width*pd.height);
  const read=(i:number)=>pd.data instanceof Uint16Array ? pd.data[i]/257 : pd.data instanceof Float32Array ? clamp01(pd.data[i])*255 : pd.data[i];
  for(let i=0;i<pd.width*pd.height;i++){
    const s=i*channels,o=i*4;rgba[o]=read(s);rgba[o+1]=channels>=3?read(s+1):read(s);rgba[o+2]=channels>=3?read(s+2):read(s);rgba[o+3]=channels===4?read(s+3):255;
  }
  const c=createCanvas(pd.width,pd.height);c.getContext('2d')!.putImageData(new ImageData(rgba,pd.width,pd.height),0,0);return c;
}
function bounds(l:Layer):Box {return {minX:l.left??0,minY:l.top??0,maxX:l.right??0,maxY:l.bottom??0};}
function localBox(n:{width:number;height:number}):Box{return{minX:0,minY:0,maxX:n.width,maxY:n.height};}
function common(l:Layer, path:string):Common {
  return {name:l.name||'图层',sourceId:path,opacity:clamp01(l.opacity??1),visible:!l.hidden,blendMode:blendName(l.blendMode),sourceType:'psd-layer',sourceData:{sourceBlendMode:l.blendMode||'normal'}};
}
function clone<T>(value:T):T {return structuredClone(value);}
export async function parsePSD(data:ArrayBuffer,progress?:(p:number,m:string)=>void,options:ParseOptions={}):Promise<ParseResult> {
  init();checkCancelled(options.signal);
  if((options.depth??0)>8)throw new Error('智能对象嵌套超过 8 层');
  if(data.byteLength<26)throw new Error('PSD 文件头不完整');
  const header=new DataView(data),sourceHeight=header.getUint32(14),sourceWidth=header.getUint32(18);
  checkPsdDimensions(sourceWidth,sourceHeight);
  if((options.depth??0)===0){
    progress?.(0,'正在检查文件…');
    await new Promise(resolve=>setTimeout(resolve,0));
    await preflightPsd(data,options);
    checkCancelled(options.signal);
  }
  progress?.(5,'读取 PSD 图层和嵌入对象…');
  const psd=readPsd(data,{useImageData:true,skipCompositeImageData:true,skipThumbnail:true,totalMemoryLimit:PSD_DECODE_LIMIT});
  const count=(ls:Layer[]):number=>ls.reduce((n,l)=>n+1+count(l.children||[]),0);
  const ctx:Context={psd,options,progress,done:0,total:count(psd.children||[]),warns:createWarns(100),assets:new Map()};
  let nodes=await layers(psd.children||[],ctx,'psd');
  if(!psd.children?.length){
    const flat=readPsd(data,{useImageData:true,skipThumbnail:true});
    if(flat.imageData){const bytes=await toPng(downscaleToLimit(pixelsCanvas(flat.imageData),ctx.warns));if(bytes)nodes=[{kind:'image',name:'原始扁平图像',x:0,y:0,width:psd.width,height:psd.height,bytes,sourceType:'flattened-psd'}];}
  }
  if(!nodes.length)throw new Error('文件没有可导入的图层');
  progress?.(100,'PSD 场景解析完成');
  return finishScene(psd.width,psd.height,nodes,ctx.warns.list);
}
async function layers(ls:Layer[],ctx:Context,path:string):Promise<ParsedNode[]> {
  const out:ParsedNode[]=[];let clipped:Layer[]=[];
  // Collect clipping runs from top to bottom; each run is bound to the next base.
  for(let i=ls.length-1;i>=0;i--){
    const l=ls[i];
    if(l.clipping){clipped.push(l);continue;}
    let base=await layer(l,ctx,path+'/'+(l.id??i));
    if(clipped.length){
      if(base){
        const above:ParsedNode[]=[];
        for(let j=clipped.length-1;j>=0;j--){const c=clipped[j];const n=await layer(c,ctx,path+'/'+(c.id??('clip'+i+'-'+j)));if(n)above.push(n);}
        const mask=clone(base);mask.name='剪贴基底蒙版';mask.sourceId=base.sourceId+'/clip-mask';mask.sourceType='clip-mask';mask.effects=[];mask.opacity=1;
        // The base keeps its own pixels and blend. The mask only restricts clipped siblings.
        const maskGroup:ParsedMask={kind:'mask',name:'剪贴内容',sourceId:base.sourceId+'/clip',mask,maskType:'ALPHA',children:above};
        base={kind:'group',name:l.name||'剪贴组',visible:base.visible,children:[base,maskGroup]};
      }else ctx.warns.warn('missing-clip-base','剪贴基底缺失，相关图层未导入');
      clipped=[];
    }
    if(base)out.unshift(base);
  }
  if(clipped.length)ctx.warns.warn('orphan-clip','存在没有基底的剪贴图层，未错误地作为普通图层导入');
  return out;
}
async function layer(l:Layer,ctx:Context,path:string):Promise<ParsedNode|null> {
  checkCancelled(ctx.options.signal);ctx.done++;
  if(ctx.done%12===0){ctx.progress?.(10+Math.round(80*ctx.done/Math.max(1,ctx.total)),'转换图层 '+ctx.done+'/'+ctx.total);await new Promise(r=>setTimeout(r,0));}
  const c=common(l,path);let n:ParsedNode|null=null;
  if(l.children){
    const children=await layers(l.children,ctx,path);
    if(l.artboard){
      const r=l.artboard.rect;translateNodes(children,-r.left,-r.top);
      n={kind:'frame',...c,x:r.left,y:r.top,width:r.right-r.left,height:r.bottom-r.top,children,clip:true,artboard:true,
        fills:l.artboard.backgroundType===3?[]:[solid(colorToRgb(l.artboard.color)||{r:1,g:1,b:1})]};
      resolveWhiteBackdrop(n);
    }else n={kind:'group',...c,children};
    const b=sceneBounds(n);applyPsdEffects(n,l,ctx.psd,{minX:0,minY:0,maxX:boxWidth(b),maxY:boxHeight(b)});
  }else if(l.placedLayer){n=await smart(l,ctx,c);}
  if(!n&&l.text?.text){n=await textLayer(l,ctx,c);}
  if(!n&&l.vectorMask?.paths?.length&&(l.vectorFill||l.vectorStroke)){n=shape(l,ctx,c);}
  if(!n&&(l.imageData||l.canvas)){n=await imageLayer(l,ctx,c);}
  if(!n){n={kind:'group',...c,children:[]};issue(n,'missing-content',l.adjustment?'调整图层尚未支持':'图层没有可读取内容');}
  if(n.overlays?.length){
    const alpha:ParsedNode=await imageLayer({...l,effects:undefined,opacity:1,fillOpacity:1},ctx,{name:'叠加效果透明度蒙版',sourceType:'mask',opacity:1})||clone(n);
    if(alpha){
      const fills=n.overlays;delete n.overlays;delete alpha.overlays;alpha.effects=[];alpha.opacity=1;alpha.blendMode='NORMAL';alpha.sourceType='mask';alpha.sourceId=path+'/overlay-alpha';
      const b=sceneBounds(alpha),w=boxWidth(b),h=boxHeight(b);
      const rect:ParsedVector={kind:'vector',name:'颜色 / 渐变叠加',sourceId:path+'/overlay-paint',sourceType:'effect',x:b.minX,y:b.minY,width:w,height:h,
        paths:[{data:'M0 0H'+w+'V'+h+'H0Z',windingRule:'NONZERO'}],fills};
      const effects=n.effects;delete n.effects;n.opacity=l.fillOpacity??1;
      n={kind:'group',...c,name:n.name,sourceId:path+'/appearance',effects,children:[n,{kind:'mask',name:'叠加效果',mask:alpha,maskType:'ALPHA',children:[rect]}]};
    }else issue(n,'effect-alpha','叠加效果缺少可用的透明度轮廓');
  }
  if(!blendName(l.blendMode)&&!resolveShapeBlend(n,l))issue(n,'unsupported-blend','混合模式 '+l.blendMode+' 需要保留背景依赖的局部合成');
  if(l.placedLayer?.filter?.enabled){
    n.sourceData={...n.sourceData,smartFilters:l.placedLayer.filter};
    if(n.kind==='image'&&n.sourceType==='raster-smart-object')issue(n,'cached-smart-filter','原始位图智能对象使用包含滤镜的保存外观；滤镜参数已保留，尚未转换为可编辑效果',false);
    else issue(n,'smart-filter','智能滤镜需要继续解析；原始参数已保留');
  }
  const feather=l.mask?.vectorMaskFeather??0,density=l.mask?.vectorMaskDensity??1;
  if(n.kind==='vector'&&n.sourceType==='psd-shape'&&(feather>0||density<1)){
    if(density===1&&!n.strokes?.length&&n.fills?.every(p=>p.type==='SOLID')&&!n.effects?.length){
      n.effects=[{type:'LAYER_BLUR',radius:feather*2}];
      n.sourceData={...n.sourceData,vectorMaskFeather:feather};
    }else issue(n,'vector-mask-feather','带渐变/描边/效果或非满密度的矢量蒙版需独立羽化，尚未通过保真验证');
  }
  if(l.vectorMask?.paths?.length&&!l.vectorMask.disable&&n.sourceType!=='psd-shape'){
    const mask=maskVector(l.vectorMask.paths,ctx.psd.width,ctx.psd.height,!!l.vectorMask.invert);
    if(mask)n={kind:'mask',name:n.name,sourceId:path+'/vector-mask',mask,maskType:'VECTOR',children:[n]};
  }
  // fromVectorData is the compatibility raster channel of the SAME vector mask.
  // Applying it again clips away native feather and destroys editable soft edges.
  if(l.mask&&!l.mask.disabled&&l.mask.imageData&&!(l.mask.fromVectorData&&l.vectorMask?.paths.length)){
    const mask=await rasterMask(l,ctx);
    if(mask)n={kind:'mask',name:n.name,sourceId:path+'/pixel-mask',mask,maskType:'ALPHA',children:[n]};
  }
  return n;
}
function shape(l:Layer,ctx:Context,c:Common):ParsedVector {
  const paths=l.vectorMask!.paths,full=buildShapePath(paths.map(p=>({...p,operation:'combine'})));
  if(!full)throw new Error('矢量图层「'+c.name+'」路径无效；禁止退回缓存位图');
  const x=full.box.minX,y=full.box.minY,width=boxWidth(full.box),height=boxHeight(full.box);
  const parts=paths.map(p=>{
    const part=buildShapePath([{...p,operation:'combine'}],-x,-y);
    if(!part)throw new Error('无效子路径');
    return {data:part.d,windingRule:(p.fillRule==='even-odd'?'EVENODD':'NONZERO') as 'EVENODD'|'NONZERO',operation:p.operation};
  });
  const n:ParsedVector={kind:'vector',...c,sourceType:'psd-shape',x,y,width,height,paths:parts,fills:[],strokes:[]};
  const fill=l.vectorFill?gradientPaint(l.vectorFill,localBox(n)):null;
  if(fill){fill.opacity=l.fillOpacity??1;n.fills=[fill];}
  else if(l.vectorFill)issue(n,'unsupported-fill','图案或杂色填充需要局部合成');
  const st=l.vectorStroke;
  if(st&&st.strokeEnabled!==false){
    const paint=st.content?gradientPaint(st.content,localBox(n)):null;
    if(paint){paint.opacity=(paint.opacity??1)*(st.opacity??1);n.strokes=[paint];}
    else issue(n,'unsupported-stroke','无法还原描边填充');
    n.strokeWidth=st.lineWidth?.value??1;n.strokeAlign=(st.lineAlignment||'center').toUpperCase() as ParsedVector['strokeAlign'];
    n.strokeCap=st.lineCapType==='round'?'ROUND':st.lineCapType==='square'?'SQUARE':'NONE';
    n.strokeJoin=(st.lineJoinType||'miter').toUpperCase() as ParsedVector['strokeJoin'];
    n.dashPattern=(st.lineDashSet||[]).map(v=>v.value*(n.strokeWidth||1));n.miterLimit=st.miterLimit;
    if(st.fillEnabled===false)n.fills=[];
  }
  applyPsdEffects(n,l,ctx.psd,localBox(n));return n;
}
function maskVector(paths:BezierPath[],w:number,h:number,invert=false):ParsedVector|null{
  const shape=buildShapePath(paths.map(p=>({...p,operation:'combine'})));if(!shape)return null;
  const parts=paths.map(p=>({data:buildShapePath([{...p,operation:'combine'}])!.d,windingRule:p.fillRule==='even-odd'?'EVENODD' as const:'NONZERO' as const,operation:p.operation}));
  if(invert)parts.push({data:'M0 0H'+w+'V'+h+'H0Z',windingRule:'NONZERO',operation:'exclude'});
  return {kind:'vector',name:'矢量蒙版',sourceType:'mask',x:0,y:0,width:w,height:h,
    paths:parts,fills:[solid({r:1,g:1,b:1})]};
}
async function rasterMask(l:Layer,ctx:Context):Promise<ParsedNode|null>{
  const m=l.mask!,pd=m.imageData!,w=ctx.psd.width,h=ctx.psd.height;
  const density=m.userMaskDensity??1;
  const x=(m.left??0)+(m.positionRelativeToLayer?l.left??0:0),y=(m.top??0)+(m.positionRelativeToLayer?l.top??0:0);
  const c=pixelsCanvas(pd),g=c.getContext('2d')!,pixels=g.getImageData(0,0,c.width,c.height);
  for(let i=0;i<pixels.data.length;i+=4){pixels.data[i+3]=255-(255-pixels.data[i])*density;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=255;}
  g.putImageData(pixels,0,0);
  const children:ParsedNode[]=[],outside=1-(1-(m.defaultColor??0)/255)*density;
  if(outside>0){children.push({kind:'vector',name:'蒙版外部默认值',sourceType:'mask',x:0,y:0,width:w,height:h,
    paths:[{data:'M0 0H'+w+'V'+h+'H0Z',windingRule:'NONZERO'},
      {data:'M'+x+' '+y+'h'+c.width+'v'+c.height+'h'+(-c.width)+'Z',windingRule:'NONZERO',operation:'subtract'}],fills:[solid({r:1,g:1,b:1},outside)]});}
  for(let ty=0;ty<c.height;ty+=MAX_IMAGE_DIM)for(let tx=0;tx<c.width;tx+=MAX_IMAGE_DIM){
    checkCancelled(ctx.options.signal);const tw=Math.min(MAX_IMAGE_DIM,c.width-tx),th=Math.min(MAX_IMAGE_DIM,c.height-ty);
    const tile=createCanvas(tw,th);tile.getContext('2d')!.drawImage(c,tx,ty,tw,th,0,0,tw,th);
    const bytes=await toPng(tile);if(!bytes)throw new Error('无法编码像素蒙版');
    children.push({kind:'image',name:'像素蒙版',sourceType:'mask',x:x+tx,y:y+ty,width:tw,height:th,bytes});
  }
  const n:ParsedNode={kind:'group',name:'像素蒙版',sourceType:'mask',children};
  if(m.userMaskFeather) n.effects=[{type:'LAYER_BLUR',radius:m.userMaskFeather}];
  return n;
}
async function imageLayer(l:Layer,ctx:Context,c:Common):Promise<ParsedImage|null>{
  const b=bounds(l),canvas=l.canvas??(l.imageData?pixelsCanvas(l.imageData):null);
  if(!canvas||boxWidth(b)<=0||boxHeight(b)<=0)return null;
  const bytes=await toPng(downscaleToLimit(canvas,ctx.warns));if(!bytes)throw new Error('无法编码图层 '+c.name);
  const n:ParsedImage={kind:'image',...c,sourceType:l.placedLayer?'raster-smart-object':'raster-layer',bytes,x:b.minX,y:b.minY,width:boxWidth(b),height:boxHeight(b)};
  n.opacity=(c.opacity??1)*(l.fillOpacity??1);
  applyPsdEffects(n,l,ctx.psd,localBox(n));return n;
}
function font(st:TextStyle,base:TextStyle={}){
  const name=st.font?.name??base.font?.name;const r=applyFaux(parseFontName(name),st.fauxBold??base.fauxBold,st.fauxItalic??base.fauxItalic);
  return {candidates:r.candidates,style:r.style,postScriptName:name};
}
async function textLayer(l:Layer,ctx:Context,c:Common):Promise<ParsedText>{
  const t=l.text!,base=t.style||{},m=(t.transform?.length===6?t.transform:[1,0,0,1,l.left??0,l.top??0]) as Matrix;
  const size=base.fontSize??t.styleRuns?.[0]?.style.fontSize??12;
  const b=bounds(l),box=t.shapeType==='box',bb=t.boxBounds;
  const n:ParsedText={kind:'text',...c,sourceType:'psd-text',characters:t.text.replace(/\r/g,'\n'),font:font(base),fontSize:size,
    x:m[4],y:m[5],transform:[...m],color:colorToRgb(base.fillColor),fillOpacity:l.fillOpacity??1,tracking:base.tracking,
    leading:base.autoLeading===false?base.leading:undefined,box,
    align:t.paragraphStyle?.justification?.includes('center')?'center':t.paragraphStyle?.justification?.includes('right')?'right':'left',
    width:box&&bb?bb[2]-bb[0]:undefined,baseline:0};
  if(box&&bb){n.transform![4]+=m[0]*bb[0]+m[2]*bb[1];n.transform![5]+=m[1]*bb[0]+m[3]*bb[1];}
  if(boxWidth(b)>0&&boxHeight(b)>0)n.inkBounds={x:b.minX,y:b.minY,width:boxWidth(b),height:boxHeight(b)};
  n.styleRuns=t.styleRuns?.map(run=>({length:run.length,font:font(run.style,base),fontSize:run.style.fontSize??size,
    color:colorToRgb(run.style.fillColor??base.fillColor),tracking:run.style.tracking??base.tracking,leading:run.style.autoLeading===false?run.style.leading:undefined}));
  // Source cached text is an explicitly labelled fallback, never silently replaced by a system font.
  const fallback=await imageLayer({...l,effects:undefined},ctx,{name:c.name+'（缺字体时的原始外观）'});
  if(fallback)n.fallback={...fallback,fidelity:'rasterized'};
  if(t.orientation==='vertical'||(t.warp?.style&&t.warp.style!=='none'))issue(n,'text-warp','竖排或变形文字使用保存的外观，请核对结果');
  applyPsdEffects(n,l,ctx.psd,{minX:0,minY:0,maxX:boxWidth(b),maxY:boxHeight(b)});return n;
}
async function smart(l:Layer,ctx:Context,c:Common):Promise<ParsedNode|null>{
  const placed=l.placedLayer!,file=ctx.psd.linkedFiles?.find(f=>f.id===placed.id);
  if(!file?.data){const n=await imageLayer(l,ctx,c);if(n)issue(n,'missing-linked-content','智能对象原始内容不在文件内，需补充链接文件');return n;}
  const head=new TextDecoder().decode(file.data.subarray(0,256)).trim();
  const isPdf=head.startsWith('%PDF'),isSvg=head.includes('<svg'),isPsd=head.startsWith('8BPS');
  if(!isPdf&&!isSvg&&!isPsd)return imageLayer(l,ctx,c);
  const a=placed.transform,w=placed.width,h=placed.height;
  if(!w||!h||a.length!==8)return null;
  const affine=Math.abs(a[0]+a[4]-a[2]-a[6])<0.02&&Math.abs(a[1]+a[5]-a[3]-a[7])<0.02;
  const warp=placed.warp;
  const mesh=warp?.customEnvelopeWarp?.meshPoints;
  const customWarped=mesh?.some((point,index)=>{
    const columns=Math.sqrt(mesh.length),row=Math.floor(index/columns),col=index%columns;
    if(!Number.isInteger(columns)||columns<2)return true;
    return Math.abs(point.x-col*w/(columns-1))>0.05||Math.abs(point.y-row*h/(columns-1))>0.05;
  });
  const warped=warp?.style&&warp.style!=='none'&&(warp.style!=='custom'||customWarped);
  const ancestry=ctx.options.ancestry||[];
  if(ancestry.includes(placed.id))throw new Error('智能对象循环引用');
  const opts={...ctx.options,depth:(ctx.options.depth??0)+1,ancestry:[...ancestry,placed.id]};
  try {
    let promise=ctx.assets.get(placed.id);
    if(!promise){promise=(async()=>{
      if(isPsd)return parsePSD(file.data!.slice().buffer as ArrayBuffer,undefined,opts);
      if(isPdf){const {parseAIorEPS}=await import('./aiEps');return parseAIorEPS(file.data!.slice().buffer as ArrayBuffer,undefined,opts);}
      const svg=new TextDecoder().decode(file.data!).replace(/<script\b[\s\S]*?<\/script>/gi,'').replace(/<\?xml[^>]*>/g,'').replace(/<!DOCTYPE[\s\S]*?>/gi,'')
        .replace(/<svg\b([^>]*)>/,(_match,attrs:string)=>'<svg '+attrs.replace(/\b(?:width|height|preserveAspectRatio)\s*=\s*(["']).*?\1/gi,'')+' width="'+w+'" height="'+h+'" preserveAspectRatio="none">');
      return finishScene(w,h,[{kind:'vector',name:file.name||'SVG',x:0,y:0,width:w,height:h,svg}]);
    })();ctx.assets.set(placed.id,promise);}
    const result=clone(await promise),children=materializeResources(result);
    const namespace=(nodes:ParsedNode[])=>{for(const node of nodes){node.sourceId=c.sourceId+'/asset/'+(node.sourceId||node.name);namespace(childrenOf(node));}};namespace(children);
    const sx=w/result.width,sy=h/result.height;
    const n:ParsedNode={kind:'group',...c,sourceType:isPsd?'layered-smart-object':'vector-smart-object',sourceAssetId:placed.id,children,
      transform:[(a[2]-a[0])/w*sx,(a[3]-a[1])/w*sx,(a[6]-a[0])/h*sy,(a[7]-a[1])/h*sy,a[0],a[1]]};
    if(!affine||warped){
      const appearance=await imageLayer(l,ctx,c);
      if(!appearance)throw new Error('变形智能对象没有原始缓存');
      n.recovery=true;n.visible=false;n.name+=' [未变形的源结构]';n.sourceData={placedTransform:placed.transform,warp:placed.warp};
      appearance.fidelity='rasterized';issue(appearance,'smart-warp','透视/曲面变形使用原始缓存；隐藏源结构仍可编辑，但不代表可见结果完全可编辑',false);
      return{kind:'group',name:c.name,sourceId:c.sourceId+'/appearance',children:[n,appearance]};
    }
    applyPsdEffects(n,l,ctx.psd,{minX:0,minY:0,maxX:boxWidth(bounds(l)),maxY:boxHeight(bounds(l))});return n;
  }catch(e){
    checkCancelled(ctx.options.signal);
    if(importError(e)===MEMORY_ERROR)throw new Error(MEMORY_ERROR);
    const n=await imageLayer(l,ctx,c);if(n){n.fidelity='rasterized';issue(n,'smart-conversion','原始智能对象尚未完整解析：'+(e instanceof Error?e.message:String(e)),false);}return n;
  }
}

