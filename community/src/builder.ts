import type { Common, Diagnostic, Matrix, Paint as ScenePaint, ParsedNode, ParsedVector, ParsedText, ParseResult, ParsedFont, ParseStats } from './types';
import { emptyStats } from './types';
import { multiply, identity, inverse } from './scene';
import { bakeVector, nodeMatrix, point } from './affine';
import { nativeStroke, figmaMiterLimit } from './stroke';
type Built=FrameNode|GroupNode|VectorNode|BooleanOperationNode|RectangleNode|TextNode;
type Parent=FrameNode|GroupNode|PageNode;
type Context={fonts:FontName[];loaded:Set<string>;result:ParseResult;report:(p:number,m:string)=>void;cancelled:()=>boolean;
  stats:ParseStats;done:number;diagnostics:Diagnostic[];imageHashes:Map<string,string>;imageNodes:Set<string>;recoveryRoots:Set<string>};
const key=(s:string)=>s.toLowerCase().replace(/[\s_-]/g,'');
export function resolveFont(font:ParsedFont|undefined,fonts:FontName[]):FontName|undefined {
  if(!font)return undefined;
  return fonts.find(f=>font.candidates.some(c=>key(c)===key(f.family)) && key(f.style)===key(font.style));
}
function transform(m:Matrix):Transform{return[[m[0],m[2],m[4]],[m[1],m[3],m[5]]];}
function fromTransform(t:Transform):Matrix{return[t[0][0],t[1][0],t[0][1],t[1][1],t[0][2],t[1][2]];}
function paint(p:ScenePaint,w:number,h:number,x=0,y=0):Paint{
  const common={opacity:p.opacity??1,blendMode:(p.blendMode||'NORMAL') as BlendMode,visible:true};
  if(p.type==='SOLID'){const c=p.color||{r:0,g:0,b:0};return{type:'SOLID',color:{r:c.r,g:c.g,b:c.b},...common,opacity:(p.opacity??1)*(c.a??1)};}
  return{type:p.type,gradientStops:(p.stops||[]).map(s=>({position:s.position,color:{...s.color,a:s.color.a??1}})),
    gradientTransform:transform(multiply(p.transform||[1,0,0,1,0,0],[Math.max(w,0.001),0,0,Math.max(h,0.001),x,y])),...common};
}
function nativeEffects(effects:Common['effects']):Effect[]{
  return(effects||[]).map<Effect>(e=>{
    if(e.type==='LAYER_BLUR')return{type:'LAYER_BLUR',blurType:'NORMAL',radius:e.radius,visible:true};
    const value={color:{r:e.color?.r??0,g:e.color?.g??0,b:e.color?.b??0,a:e.color?.a??1},offset:e.offset||{x:0,y:0},
      radius:e.radius,spread:e.spread??0,blendMode:(e.blendMode||'NORMAL') as BlendMode,visible:true};
    return e.type==='DROP_SHADOW'?{type:'DROP_SHADOW',...value}:{type:'INNER_SHADOW',...value};
  });
}
function applyCommon(node:Built,n:Common):void{
  node.name=n.name;node.visible=n.visible!==false;
  node.opacity=Math.max(0,Math.min(1,n.opacity??1));
  if(n.blendMode)node.blendMode=n.blendMode as BlendMode;
  node.effects=nativeEffects(n.effects);
  node.setPluginData('import:source',JSON.stringify({id:n.sourceId,type:n.sourceType,asset:n.sourceAssetId}));
  node.setPluginData('import:fidelity',n.fidelity||'editable');
  if(n.issues?.length)node.setPluginData('import:issues',JSON.stringify(n.issues));
  if(n.sourceData)node.setPluginData('import:source-data',JSON.stringify(n.sourceData));
  if(n.whiteBackdropBlend){
    node.setPluginData('import:backdrop',JSON.stringify(n.whiteBackdropBlend));
    const whiten=(target:SceneNode):void=>{
      if('isMask'in target&&target.isMask)return;
      if('fills'in target&&Array.isArray(target.fills)){
        target.setPluginData('import:original-fills',JSON.stringify(target.fills));
        target.fills=(target.fills as Paint[]).map(whitePaint);
      }
      if('strokes'in target){target.setPluginData('import:original-strokes',JSON.stringify(target.strokes));target.strokes=target.strokes.map(whitePaint);}
      if('children'in target)for(const child of target.children)whiten(child);
    };
    whiten(node);
  }
  if(n.recovery){node.visible=false;node.setPluginData('import:recovery','true');}
}
function whitePaint(p:Paint):Paint{
  if(p.type==='SOLID')return{...p,color:{r:1,g:1,b:1}};
  if('gradientStops'in p)return{...p,gradientStops:p.gradientStops.map(s=>({...s,color:{r:1,g:1,b:1,a:s.color.a}}))};
  throw new Error('白底混合转换遇到非矢量填充');
}
function place(node:Built,n:ParsedNode):void{
  if(n.transform)node.relativeTransform=transform(n.transform);
  else if('x'in n){node.x=n.x;node.y=n.y;}
}
function diagnose(ctx:Context,n:ParsedNode,code:string,message:string,status:Diagnostic['status']='unsupported'){
  ctx.diagnostics.push({sourceId:n.sourceId||'',name:n.name,code,message,status});
}
async function loadFont(font:FontName,ctx:Context){const k=font.family+'/'+font.style;if(!ctx.loaded.has(k)){await figma.loadFontAsync(font);ctx.loaded.add(k);}}
async function textFallback(n:ParsedText,parent:Parent,ctx:Context,parentMatrix:Matrix,code:string):Promise<Built>{
  if(!n.fallback)throw new Error('文字「'+n.name+'」缺少精确字体和可用轮廓：'+(n.font?.postScriptName||'未知字体'));
  const outlined=n.fallback.kind==='vector';
  const opacity=(n.opacity??1)*(n.fallback.kind==='image'?n.fallback.opacity??1:1);
  const built=await buildNode({...n.fallback,name:n.name+' [文字外观]',sourceId:n.sourceId,sourceType:'text-fallback',opacity,visible:n.visible,blendMode:n.blendMode},parent,ctx,parentMatrix,n.recovery);
  built.effects=nativeEffects(n.effects);built.setPluginData('import:text',n.characters);
  diagnose(ctx,n,code,outlined?'使用原字体轮廓；原文字内容保存在节点数据中':'精确字体/排版不可用，使用明确标记的缓存外观；原文字内容保存在节点数据中',outlined?'outlined-text':'rasterized');
  return built;
}
export async function buildScene(result:ParseResult,fileName:string,report:(p:number,m:string)=>void=()=>{},cancelled:()=>boolean=()=>false) {
  if(result.version!==2)throw new Error('不支持的场景协议版本');
  const ctx:Context={result,report,cancelled,fonts:(await figma.listAvailableFontsAsync()).map(f=>f.fontName),loaded:new Set(),stats:emptyStats(),done:0,diagnostics:[],imageHashes:new Map(),imageNodes:new Set(),recoveryRoots:new Set()};
  const root=figma.createFrame();
  try{
    root.name=fileName.replace(/\.[^.]+$/,'');root.fills=[];root.clipsContent=false;
    root.resize(Math.max(1,result.width),Math.max(1,result.height));
    const right=figma.currentPage.children.filter(n=>n.id!==root.id).reduce((x,n)=>Math.max(x,n.x+n.width),0);
    root.x=right+80;root.y=0;
    for(const n of result.nodes)await buildNode(n,root,ctx);
    if(cancelled())throw new Error('导入已取消');
    if(!root.children.length)throw new Error('没有成功创建任何图层');
    const diagnostics=[...result.diagnostics.filter(d=>d.sourceId==='helper'||d.sourceId==='postscript'),...ctx.diagnostics];
    root.setPluginData('import:version','2');root.setPluginData('import:summary',JSON.stringify(ctx.stats));
    figma.currentPage.selection=[root];figma.viewport.scrollAndZoomIntoView([root]);
    return{rootId:root.id,count:ctx.done,stats:ctx.stats,nativeStats:actualNodeStats(root,ctx),diagnostics,
      warnings:[...result.warnings,...ctx.diagnostics.map(d=>d.name+'：'+d.message)],
      fidelityValidated:false,status:diagnostics.some(d=>d.status==='unsupported'||d.status==='rasterized')?'needs-review':'created'};
  }catch(error){root.remove();throw error;}
}
async function buildNode(n:ParsedNode,parent:Parent,ctx:Context,parentMatrix:Matrix=identity(),recovery=false):Promise<Built>{
  if(ctx.cancelled())throw new Error('导入已取消');
  if(recovery)n={...n,recovery:true};
  if(n.effects?.length){
    const scale=Math.sqrt(Math.abs(parentMatrix[0]*parentMatrix[3]-parentMatrix[1]*parentMatrix[2]));
    n={...n,effects:n.effects.map(e=>({...e,radius:e.radius*scale,spread:(e.spread??0)*scale,
      offset:e.offset?{x:parentMatrix[0]*e.offset.x+parentMatrix[2]*e.offset.y,y:parentMatrix[1]*e.offset.x+parentMatrix[3]*e.offset.y}:undefined}))};
  }
  let built:Built;
  if(n.kind==='group'||n.kind==='mask'){
    const scratch=figma.createFrame();parent.appendChild(scratch);scratch.x=0;scratch.y=0;scratch.fills=[];scratch.clipsContent=false;
    try{
      if(n.kind==='mask'){
        const mask=await buildNode(n.mask,scratch,ctx,nodeMatrix(n,parentMatrix),n.recovery);mask.isMask=true;mask.maskType=n.maskType;
      }
      for(const child of n.children)await buildNode(child,scratch,ctx,nodeMatrix(n,parentMatrix),n.recovery);
      if(scratch.children.length){
        const group=figma.group([...scratch.children],scratch);
        const pos=fromTransform(group.relativeTransform);
        parent.appendChild(group);group.relativeTransform=transform(pos);
        scratch.remove();built=group;
      }else{built=scratch;built.resize(0.01,0.01);}
    }catch(e){scratch.remove();throw e;}
  }else if(n.kind==='frame'){
    const m=nodeMatrix(n,parentMatrix),sx=Math.hypot(m[0],m[1]),sy=Math.hypot(m[2],m[3]);
    if(Math.abs(m[0]*m[2]+m[1]*m[3])>0.001)throw new Error('倾斜画板必须先转换为裁剪组');
    const f=figma.createFrame();parent.appendChild(f);f.resize(Math.max(0.01,n.width*sx),Math.max(0.01,n.height*sy));
    const frameWidth=n.width,frameHeight=n.height;
    f.fills=(n.fills||[]).map(p=>paint(p,frameWidth,frameHeight));f.clipsContent=n.clip;
    f.relativeTransform=transform([m[0]/sx,m[1]/sx,m[2]/sy,m[3]/sy,m[4],m[5]]);
    for(const child of n.children)await buildNode(child,f,ctx,[sx,0,0,sy,0,0],n.recovery);built=f;
  }else if(n.kind==='vector'){
    if(n.paths?.length){n=nativeStroke(bakeVector(n,parentMatrix));built=buildVector(n,parent);built.x+=n.x;built.y+=n.y;}
    else {
      const m=nodeMatrix(n,parentMatrix),points=[[0,0],[n.width,0],[n.width,n.height],[0,n.height]].map(([x,y])=>point(m,x,y));
      const x=Math.min(...points.map(p=>p[0])),y=Math.min(...points.map(p=>p[1]));
      const w=Math.max(...points.map(p=>p[0]))-x,h=Math.max(...points.map(p=>p[1]))-y;
      const local=multiply([1,0,0,1,-x,-y],m);
      const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'"><g transform="matrix('+local.join(' ')+')">'+n.svg+'</g></svg>';
      built=buildVector({...n,svg},parent);built.x=x;built.y=y;
    }
  }else if(n.kind==='image'){
    const bytes=n.bytes||(n.resourceId?ctx.result.resources[n.resourceId]:undefined);
    if(!bytes)throw new Error('缺少图片资源 '+n.name);
    let hash=n.resourceId?ctx.imageHashes.get(n.resourceId):undefined;
    if(!hash){hash=figma.createImage(bytes).hash;if(n.resourceId)ctx.imageHashes.set(n.resourceId,hash);}
    const m=nodeMatrix(n,parentMatrix),corners=[[0,0],[n.width,0],[n.width,n.height],[0,n.height]].map(([x,y])=>point(m,x,y));
    const x=Math.min(...corners.map(p=>p[0])),y=Math.min(...corners.map(p=>p[1])),w=Math.max(0.01,Math.max(...corners.map(p=>p[0]))-x),h=Math.max(0.01,Math.max(...corners.map(p=>p[1]))-y);
    const r=figma.createVector();parent.appendChild(r);r.vectorPaths=[{data:corners.map((p,i)=>(i?'L':'M')+(p[0]-x)+' '+(p[1]-y)).join(' ')+' Z',windingRule:'NONZERO'}];r.x=x;r.y=y;
    const sourceToTarget=multiply([1/w,0,0,1/h,-x/w,-y/h],multiply(m,[n.width,0,0,n.height,0,0]));
    r.fills=[{type:'IMAGE',imageHash:hash,scaleMode:'CROP',imageTransform:transform(inverse(sourceToTarget))}];r.strokes=[];built=r;
  }else{
    const font=resolveFont(n.font,ctx.fonts);
    const missing=!font||n.styleRuns?.some(r=>r.font&&!resolveFont(r.font,ctx.fonts));
    if(missing||n.issues?.some(i=>i.code==='text-warp')){
      return textFallback(n,parent,ctx,parentMatrix,'text-fallback');
    }
    const m=nodeMatrix(n,parentMatrix),sx=Math.hypot(m[0],m[1]),sy=Math.hypot(m[2],m[3]);
    if(Math.abs(sx-sy)>0.001||Math.abs(m[0]*m[2]+m[1]*m[3])>0.001){
      return textFallback(n,parent,ctx,parentMatrix,'text-transform');
    }
    const ib=n.inkBounds,p=ib?point(parentMatrix,ib.x,ib.y):undefined;
    n={...n,fontSize:(n.fontSize||12)*sy,width:n.width===undefined?undefined:n.width*sx,leading:n.leading===undefined?undefined:n.leading*sy,
      transform:[m[0]/sx,m[1]/sx,m[2]/sy,m[3]/sy,m[4],m[5]],inkBounds:ib&&p?{...ib,x:p[0],y:p[1]}:undefined,
      styleRuns:n.styleRuns?.map(r=>({...r,fontSize:r.fontSize===undefined?undefined:r.fontSize*sy,leading:r.leading===undefined?undefined:r.leading*sy}))};
    built=await buildText(n,font!,parent,ctx);
  }
  applyCommon(built,n);
  if(n.kind==='image')ctx.imageNodes.add(built.id);
  if(n.recovery)ctx.recoveryRoots.add(built.id);
  if(n.kind==='frame'&&n.artboard)built.setPluginData('import:artboard','true');
  ctx.diagnostics.push({sourceId:n.sourceId||'',name:n.name,status:n.fidelity||(n.kind==='image'?'original-image':'editable'),code:n.issues?.[0]?.code||'created',message:n.issues?.map(i=>i.message).join('；')||'',nodeId:built.id,recovery:n.recovery,issues:n.issues,
    strokeAppearance:(n.sourceData?.strokeMiterLimit as {appearance?:'unchanged'|'needs-review'}|undefined)?.appearance});
  if(!n.recovery){
    if(n.kind==='vector')ctx.stats.vectors++;
    if(n.kind==='image')ctx.stats.images++;
    if(n.kind==='text')ctx.stats.texts++;
    if(n.kind==='group'||n.kind==='frame')ctx.stats.groups++;
    if(n.kind==='frame'&&n.artboard)ctx.stats.artboards++;
    if(n.kind==='mask')ctx.stats.masks++;
    if(n.fidelity==='outlined-text')ctx.stats.outlinedTexts++;
    if(n.fidelity==='rasterized')ctx.stats.rasterized++;
    if(n.fidelity==='unsupported')ctx.stats.unsupported++;
    ctx.done++;
  }
  if(ctx.done%20===0){ctx.report(Math.min(95,10+ctx.done/Math.max(1,ctx.result.diagnostics.length)*85),'创建图层 '+ctx.done);await new Promise(r=>setTimeout(r,0));}
  return built;
}
/** Count the actual Figma tree, including vector children produced by local SVG.
 * A vector carrying a bitmap fill is still reported as an image, not editable art. */
function actualNodeStats(root:FrameNode,ctx:Context){
  const stats={vectors:0,images:0,texts:0,groups:0,frames:0,booleans:0,masks:0,total:0};
  function visit(nodes:readonly SceneNode[]){for(const n of nodes){
    if(ctx.recoveryRoots.has(n.id))continue;
    stats.total++;
    if(ctx.imageNodes.has(n.id))stats.images++;
    else if(['VECTOR','RECTANGLE','ELLIPSE','LINE','POLYGON','STAR'].includes(n.type))stats.vectors++;
    else if(n.type==='BOOLEAN_OPERATION')stats.booleans++;
    else if(n.type==='TEXT')stats.texts++;
    else if(n.type==='GROUP')stats.groups++;
    else if(n.type==='FRAME')stats.frames++;
    if('isMask'in n&&n.isMask)stats.masks++;
    if('children'in n)visit(n.children);
  }}
  visit(root.children);return stats;
}
function buildVector(n:ParsedVector,parent:Parent):Built {
  if(!n.paths?.length){if(!n.svg)throw new Error('空矢量 '+n.name);const f=figma.createNodeFromSvg(n.svg);parent.appendChild(f);f.clipsContent=false;return f;}
  const make=(paths:ParsedVector['paths'])=>{const v=figma.createVector();parent.appendChild(v);
    v.vectorPaths=paths!.map(p=>({data:p.data,windingRule:p.windingRule}));v.fills=[{type:'SOLID',color:{r:0,g:0,b:0}}];v.strokes=[];return v;};
  let v:VectorNode|BooleanOperationNode;
  if(n.paths.length===1)v=make(n.paths);
  else{
    let current:VectorNode|BooleanOperationNode=make([n.paths[0]]);
    for(const p of n.paths.slice(1)){const next=make([p]);const op=p.operation||'combine';
      current=op==='subtract'?figma.subtract([current,next],parent):op==='intersect'?figma.intersect([current,next],parent):op==='exclude'?figma.exclude([current,next],parent):figma.union([current,next],parent);
    }v=current;
  }
  // Boolean intersection/subtraction can shrink and offset the geometry bounds.
  // Paint coordinates stay in the original path space, not the result's new box.
  v.fills=(n.fills||[]).map(p=>paint(p,v.width,v.height,v.x,v.y));v.strokes=(n.strokes||[]).map(p=>paint(p,v.width,v.height,v.x,v.y));
  v.strokeWeight=n.strokeWidth??1;v.strokeAlign=n.strokeAlign||'CENTER';
  v.strokeCap=n.strokeCap||'NONE';v.strokeJoin=n.strokeJoin||'MITER';v.dashPattern=n.dashPattern||[];
  // Enforce the API contract at the actual setter as well as in scene adaptation.
  if(n.miterLimit!==undefined)v.strokeMiterLimit=figmaMiterLimit(n.miterLimit);
  return v;
}
async function buildText(n:ParsedText,font:FontName,parent:Parent,ctx:Context):Promise<TextNode>{
  await loadFont(font,ctx);
  for(const r of n.styleRuns||[])if(r.font)await loadFont(resolveFont(r.font,ctx.fonts)!,ctx);
  const t=figma.createText();parent.appendChild(t);t.fontName=font;t.characters=n.characters;t.fontSize=n.fontSize||12;
  t.fills=[paint({type:'SOLID',color:n.color||{r:0,g:0,b:0},opacity:n.fillOpacity??1},1,1)];
  t.textAlignHorizontal=n.align==='center'?'CENTER':n.align==='right'?'RIGHT':'LEFT';
  if(n.tracking!==undefined)t.letterSpacing={unit:'PERCENT',value:n.tracking/10};
  if(n.leading)t.lineHeight={unit:'PIXELS',value:n.leading};
  let offset=0;
  for(const r of n.styleRuns||[]){const end=Math.min(n.characters.length,offset+r.length);if(end<=offset)continue;
    if(r.font)t.setRangeFontName(offset,end,resolveFont(r.font,ctx.fonts)!);
    if(r.fontSize)t.setRangeFontSize(offset,end,r.fontSize);
    if(r.color)t.setRangeFills(offset,end,[paint({type:'SOLID',color:r.color,opacity:n.fillOpacity??1},1,1)]);
    if(r.tracking!==undefined)t.setRangeLetterSpacing(offset,end,{unit:'PERCENT',value:r.tracking/10});
    if(r.leading)t.setRangeLineHeight(offset,end,{unit:'PIXELS',value:r.leading});offset=end;
  }
  t.textAutoResize=n.box?'HEIGHT':'WIDTH_AND_HEIGHT';if(n.box&&n.width)t.resize(n.width,t.height);
  place(t,n);
  // Align actual native glyph ink to source ink, never center a line-height box.
  // Absolute render bounds include glyph ascenders/descenders and the affine transform.
  if(n.inkBounds && t.absoluteRenderBounds){
    const p:Transform='absoluteTransform' in parent?parent.absoluteTransform:[[1,0,0],[0,1,0]],r=t.absoluteRenderBounds;
    const targetX=p[0][0]*n.inkBounds.x+p[0][1]*n.inkBounds.y+p[0][2];
    const targetY=p[1][0]*n.inkBounds.x+p[1][1]*n.inkBounds.y+p[1][2];
    const det=p[0][0]*p[1][1]-p[0][1]*p[1][0],dx=targetX-r.x,dy=targetY-r.y;
    if(Math.abs(det)>1e-9){t.x+=(p[1][1]*dx-p[0][1]*dy)/det;t.y+=(-p[1][0]*dx+p[0][0]*dy)/det;}
  }else if(n.baseline!==undefined)t.y-=(n.fontSize||12)*0.8;
  return t;
}

