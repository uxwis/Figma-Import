// Local execution harness for shipped code.js + ui.html. This is NOT a Figma
// renderer. Geometry is approximate; the miter setter uses Figma's real bounds.
export function pluginHost(){
 let sequence=0,imageSequence=0;const writes=[],messages=[];
 const matrix=(a,b)=>[[a[0][0]*b[0][0]+a[0][1]*b[1][0],a[0][0]*b[0][1]+a[0][1]*b[1][1],a[0][0]*b[0][2]+a[0][1]*b[1][2]+a[0][2]],
 [a[1][0]*b[0][0]+a[1][1]*b[1][0],a[1][0]*b[0][1]+a[1][1]*b[1][1],a[1][0]*b[0][2]+a[1][1]*b[1][2]+a[1][2]]];
 const nodes=new Map();
 class Node{
  constructor(type){this.id=String(++sequence);this.type=type;this.name=type;this.x=0;this.y=0;this.width=1;this.height=1;this.children=[];this.fills=[];this.strokes=[];this.opacity=1;this.visible=true;this.metadata={};this.axes=[[1,0],[0,1]];nodes.set(this.id,this);}
  get relativeTransform(){return[[...this.axes[0],this.x],[...this.axes[1],this.y]];}
  set relativeTransform(m){this.axes=m.map(row=>row.slice(0,2));this.x=m[0][2];this.y=m[1][2];}
  get absoluteTransform(){return this.parent?matrix(this.parent.absoluteTransform,this.relativeTransform):this.relativeTransform;}
  resize(w,h){if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0)throw new Error('Invalid resize');this.width=w;this.height=h;}
  appendChild(child){if(child.parent)child.parent.children=child.parent.children.filter(n=>n!==child);child.parent=this;this.children.push(child);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);for(const child of [...this.children])child.remove();this.removed=true;nodes.delete(this.id);}
  setPluginData(key,value){this.metadata[key]=value;}
  getPluginData(key){return this.metadata[key]||'';}
  findAll(test=()=>true){const result=[];for(const child of this.children){if(test(child))result.push(child);result.push(...child.findAll(test));}return result;}
  set strokeMiterLimit(value){writes.push(value);if(!Number.isFinite(value)||value<1||value>16)throw new Error('in set_strokeMiterLimit: Property "strokeMiterLimit" failed validation: Number must be '+(value>16?'less than or equal to 16':'greater than or equal to 1'));this.miter=value;}
  get strokeMiterLimit(){return this.miter??16;}
  set vectorPaths(paths){this.paths=paths;const nums=paths.flatMap(p=>(p.data.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi)||[]).map(Number)),xs=nums.filter((_,i)=>i%2===0),ys=nums.filter((_,i)=>i%2===1);if(xs.length&&ys.length){this.width=Math.max(.001,Math.max(...xs)-Math.min(...xs));this.height=Math.max(.001,Math.max(...ys)-Math.min(...ys));}}
  get vectorPaths(){return this.paths||[];}
 }
 const page=new Node('PAGE');page.selection=[];
 const create=type=>{const node=new Node(type);page.appendChild(node);return node;};
 const group=(children,parent,type='GROUP')=>{
  const node=new Node(type),x=Math.min(...children.map(n=>n.x)),y=Math.min(...children.map(n=>n.y));
  node.x=x;node.y=y;node.width=Math.max(.001,...children.map(n=>n.x+n.width-x));node.height=Math.max(.001,...children.map(n=>n.y+n.height-y));parent.appendChild(node);
  for(const child of children){node.appendChild(child);child.x-=x;child.y-=y;}return node;
 };
 const figma={currentPage:page,viewport:{scrollAndZoomIntoView(){}},ui:{onmessage:null,postMessage(msg){messages.push(msg);document.querySelector('iframe')?.contentWindow.postMessage({pluginMessage:msg},'*');}},
  showUI(html,options){document.title=options.title||'Plugin test';const iframe=document.createElement('iframe');iframe.setAttribute('sandbox','allow-scripts allow-same-origin allow-downloads');iframe.style.cssText='width:100vw;height:100vh;border:0';document.body.replaceChildren(iframe);iframe.srcdoc=html;},
  listAvailableFontsAsync:async()=>[],loadFontAsync:async()=>{},createFrame:()=>create('FRAME'),createVector:()=>create('VECTOR'),
  createImage(bytes){if(!ArrayBuffer.isView(bytes)||!bytes.byteLength)throw new Error('Missing image bytes');return{hash:'image-'+(++imageSequence)};},
  getNodeByIdAsync:async id=>nodes.get(id)||null,group,
  union:(children,parent)=>group(children,parent,'BOOLEAN_OPERATION'),subtract:(children,parent)=>group(children,parent,'BOOLEAN_OPERATION'),intersect:(children,parent)=>group(children,parent,'BOOLEAN_OPERATION'),exclude:(children,parent)=>group(children,parent,'BOOLEAN_OPERATION'),
  createNodeFromSvg(svg){const frame=create('FRAME'),doc=new DOMParser().parseFromString(svg,'image/svg+xml');for(const element of doc.querySelectorAll('path,rect,circle,ellipse,line,polygon,polyline')){
   const node=new Node('VECTOR');node.fills=[{type:'SOLID',color:{r:0,g:0,b:0}}];if(element.tagName==='path')node.vectorPaths=[{data:element.getAttribute('d')||'',windingRule:'NONZERO'}];frame.appendChild(node);
  }return frame;}
 };
 const state={figma,writes,messages,imports:[],unhandled:[]};
 window.addEventListener('message',event=>{const msg=event.data?.pluginMessage;if(msg){if(msg.type==='import')state.imports.push({fileName:msg.fileName,stats:msg.result.stats});Promise.resolve(figma.ui.onmessage?.(msg)).catch(error=>state.unhandled.push(String(error)));}});
 return state;
}
