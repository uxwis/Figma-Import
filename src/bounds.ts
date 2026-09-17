import { childrenOf, type ParsedNode, type Matrix } from './types';
import { identity, multiply } from './scene';
import { point, nodeMatrix } from './affine';
import { emptyBox, extendBox, type Box } from './svg';
export function sceneBounds(n:ParsedNode,parent:Matrix=identity()):Box{
 const box=emptyBox();
 if(n.kind==='text'&&n.inkBounds){const r=n.inkBounds;for(const p of [[r.x,r.y],[r.x+r.width,r.y],[r.x+r.width,r.y+r.height],[r.x,r.y+r.height]])extendBox(box,...point(parent,p[0],p[1]));return box;}
 if('children'in n && n.kind!=='frame'){
 const m=multiply(parent,n.transform||identity());
 for(const child of childrenOf(n)){const b=sceneBounds(child,m);if(Number.isFinite(b.minX)){extendBox(box,b.minX,b.minY);extendBox(box,b.maxX,b.maxY);}}return box;
 }
 if('width'in n&&n.width!==undefined&&n.height!==undefined){const m=nodeMatrix(n,parent);
 for(const p of [[0,0],[n.width,0],[n.width,n.height],[0,n.height]])extendBox(box,...point(m,p[0],p[1]));}
 return box;
}

