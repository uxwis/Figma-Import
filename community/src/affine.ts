import type {Matrix,ParsedVector,Paint} from './types';
import {identity,inverse,multiply,issue} from './scene';
import {emptyBox,extendBox,extendBoxCubic,boxWidth,boxHeight,type Box} from './svg';
import {translateCanonicalPath} from './parsers/pdfBatch';
export const point=(m:Matrix,x:number,y:number):[number,number]=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
/** Our native paths contain absolute M/L/H/V/C/Q/Z only. SVG asset paths stay inside SVG. */
export function mapPath(data:string,m:Matrix):{data:string;box:Box}{
 const tokens=data.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi)||[];
 let i=0,cmd='',x=0,y=0,sx=0,sy=0,d='';const box=emptyBox();
 const number=()=>{const value=Number(tokens[i++]);if(!Number.isFinite(value))throw new Error('无效矢量坐标');return value;};
 while(i<tokens.length){
 if(/^[a-zA-Z]$/.test(tokens[i]))cmd=tokens[i++];
 const relative=cmd===cmd.toLowerCase(),op=cmd.toUpperCase();
 const xy=():[number,number]=>{const xx=number(),yy=number();return[xx+(relative?x:0),yy+(relative?y:0)];};
 const start=point(m,x,y);
 if(op==='Z'){d+=' Z';x=sx;y=sy;cmd='';continue;}
 if(op==='C'||op==='Q'){
 const a=xy(),b=xy(),end=op==='C'?xy():b,aa=point(m,...a),bb=op==='C'?point(m,...b):undefined,ee=point(m,...end);
 const c1: [number,number]=op==='Q'?[start[0]+(aa[0]-start[0])*2/3,start[1]+(aa[1]-start[1])*2/3]:aa;
 const c2: [number,number]=op==='Q'?[ee[0]+(aa[0]-ee[0])*2/3,ee[1]+(aa[1]-ee[1])*2/3]:bb!;
 d+=' C'+[...c1,...c2,...ee].join(' ');extendBoxCubic(box,...start,...c1,...c2,...ee);[x,y]=end;
 }else if(op==='M'||op==='L'||op==='H'||op==='V'){
 if(op==='H')x=number()+(relative?x:0);else if(op==='V')y=number()+(relative?y:0);else [x,y]=xy();
 const p=point(m,x,y);extendBox(box,...p);d+=' '+(op==='M'?'M':'L')+p.join(' ');
 if(op==='M'){sx=x;sy=y;cmd=relative?'l':'L';}
 }else throw new Error('不支持的原生路径命令 '+cmd);
 }
 return{data:d.trim(),box};
}
export function nodeMatrix(n:{transform?:Matrix;x?:number;y?:number},parent=identity()):Matrix{
 return multiply(parent,n.transform||[1,0,0,1,n.x||0,n.y||0]);
}
export function bakeVector(n:ParsedVector,parent:Matrix):ParsedVector{
 const m=nodeMatrix(n,parent),out={...n,transform:undefined},paths=n.paths!.map(p=>({...p,...mapPath(p.data,m)})),box=emptyBox();
 for(const p of paths){extendBox(box,p.box.minX,p.box.minY);extendBox(box,p.box.maxX,p.box.maxY);}
 out.x=box.minX;out.y=box.minY;out.width=boxWidth(box);out.height=boxHeight(box);
 out.paths=paths.map(p=>({...p,data:translateCanonicalPath(p.data,-out.x,-out.y)}));
 const local=multiply([1,0,0,1,-out.x,-out.y],m);
 const paint=(p:Paint):Paint=>({...p,transform:p.transform?multiply(p.transform,inverse(local)):undefined});
 out.fills=n.fills?.map(paint);out.strokes=n.strokes?.map(paint);
 const sx=Math.hypot(m[0],m[1]),sy=Math.hypot(m[2],m[3]);
 out.strokeWidth=(n.strokeWidth??1)*sx;out.dashPattern=n.dashPattern?.map(v=>v*sx);
 if(n.strokes?.length&&(Math.abs(sx-sy)>0.001||Math.abs(m[0]*m[2]+m[1]*m[3])>0.001))
 issue(out,'affine-stroke','非均匀缩放描边需要轮廓转换');
 return out;
}

