import { childrenOf, countStats, type Matrix, type ParsedNode, type ParseResult } from './types';
export const identity = (): Matrix => [1, 0, 0, 1, 0, 0];
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}
export function inverse(a: Matrix): Matrix {
  const d=a[0]*a[3]-a[1]*a[2];
  if (!Number.isFinite(d) || Math.abs(d)<1e-12) throw new Error('不可逆变换矩阵');
  return [a[3]/d,-a[1]/d,-a[2]/d,a[0]/d,(a[2]*a[5]-a[3]*a[4])/d,(a[1]*a[4]-a[0]*a[5])/d];
}
export function translateNodes(nodes: ParsedNode[], x: number, y: number): void {
  for (const n of nodes) {
    if (n.transform) n.transform=multiply([1,0,0,1,x,y],n.transform);
    else if ('x' in n) { n.x+=x; n.y+=y; }
    else translateNodes(childrenOf(n), x, y);
    if(n.kind==='text'){
      if(n.inkBounds){n.inkBounds.x+=x;n.inkBounds.y+=y;}
      if(n.fallback)translateNodes([n.fallback],x,y);
    }
  }
}
export function finishScene(width: number, height: number, nodes: ParsedNode[], warnings: string[] = []): ParseResult {
  const result: ParseResult={version:2,width,height,nodes,warnings,diagnostics:[],resources:{},stats:countStats(nodes)};
  let resource=0;
  function walk(list: ParsedNode[], prefix: string) {
    list.forEach((n,i)=>{
      n.sourceId ??= prefix+'/'+i;
      n.fidelity ??= n.kind==='image'?'original-image':'editable';
      if(n.kind==='image' && n.bytes) {n.resourceId='image-'+resource++;result.resources[n.resourceId]=n.bytes;delete n.bytes;}
      if(n.kind==='text' && n.fallback?.kind==='image' && n.fallback.bytes) {
        n.fallback.resourceId='image-'+resource++;result.resources[n.fallback.resourceId]=n.fallback.bytes;delete n.fallback.bytes;
      }
      result.diagnostics.push({sourceId:n.sourceId,name:n.name,status:n.fidelity,code:n.issues?.[0]?.code||n.fidelity,message:n.issues?.map(x=>x.message).join('；')||''});
      walk(childrenOf(n),n.sourceId);
    });
  }
  walk(nodes,'source');return result;
}
export function materializeResources(result: ParseResult): ParsedNode[] {
  function walk(ns: ParsedNode[]) {for(const n of ns){if(n.kind==='image'&&n.resourceId)n.bytes=result.resources[n.resourceId];if(n.kind==='text'&&n.fallback?.kind==='image'&&n.fallback.resourceId)n.fallback.bytes=result.resources[n.fallback.resourceId];walk(childrenOf(n));}}
  walk(result.nodes);return result.nodes;
}
export function issue(n: ParsedNode, code: string, message: string, unsupported=true): void {
  (n.issues ??=[]).push({code,message});if(unsupported)n.fidelity='unsupported';
}
export function checkCancelled(signal?: { readonly aborted: boolean }): void {if(signal?.aborted)throw new Error('导入已取消');}

