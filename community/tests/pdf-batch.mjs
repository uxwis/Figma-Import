import './setup.mjs';
import {build} from 'esbuild';import assert from 'node:assert/strict';
import {createCanvas,Path2D} from '@napi-rs/canvas';
await build({entryPoints:['src/parsers/pdfBatch.ts'],outfile:'.test-output/pdf-batch.mjs',bundle:true,format:'esm',platform:'node',logLevel:'silent'});
const {batchPdfPaths,translateCanonicalPath}=await import('../.test-output/pdf-batch.mjs');
const fill={type:'SOLID',color:{r:.2,g:.4,b:.7}};
const vector=(index,extra={})=>({kind:'vector',sourceType:'pdf-path',sourceId:'path-'+index,name:'path',x:0,y:0,width:4,height:4,transform:[1,0,0,1,index*6,3],paths:[{data:'M0 0L4 0L4 4L0 4Z',windingRule:'NONZERO'}],fills:[fill],strokes:[],...extra});
const series=()=>Array.from({length:16},(_,i)=>vector(i));
let checks=0;function test(name,fn){fn();checks++;console.log('PASS',name);}
test('相邻同色、不重叠纹样合为一个原生路径，保留全部源 ID',()=>{
 const result=batchPdfPaths(series());assert.equal(result.length,1);assert.equal(result[0].paths.length,1);
 assert.equal(result[0].paths[0].data.match(/M/g).length,16);assert.equal(result[0].width,94);assert.equal(result[0].sourceData.pdfBatch.count,16);
 assert.deepEqual(result[0].sourceData.pdfBatch.sourceIds,series().map(n=>n.sourceId));
});
test('重叠、透明度、混合、描边、颜色、填充规则、文字和裁剪边界均不跨越合并',()=>{
 for(const change of [{transform:[1,0,0,1,0,3]},{opacity:.5},{blendMode:'MULTIPLY'},{strokes:[fill]},
  {fills:[{...fill,opacity:.5}]},{fills:[{...fill,blendMode:'MULTIPLY'}]},{fills:[{type:'SOLID',color:{r:1,g:0,b:0}}]},
  {paths:[{data:'M0 0L4 0L4 4Z',windingRule:'EVENODD'}]},{kind:'text',characters:'keep editable'},
  {kind:'group',children:[]},{kind:'mask',mask:vector(0),children:[]}]){
   const original=series();original[4]={...original[4],...change};const result=batchPdfPaths(original);
   if(!change.transform)assert.ok(result.some(n=>n.sourceId==='path-4'),'Must retain boundary node '+JSON.stringify(change));
   else assert.ok(result.every(n=>!n.sourceData?.pdfBatch?.sourceIds.includes('path-0')||!n.sourceData?.pdfBatch?.sourceIds.includes('path-4')));
   for(const n of result){const ids=n.sourceData?.pdfBatch?.sourceIds||[];assert.ok(!(ids.includes('path-0')&&ids.includes('path-15')));}
 }
});
test('批量大小和数据长度有界；少量独立对象保持节点身份',()=>{
 assert.equal(batchPdfPaths(series().slice(0,7)).length,7);
 const many=batchPdfPaths(Array.from({length:400},(_,i)=>vector(i)));assert.ok(many.every(n=>(n.sourceData?.pdfBatch?.count||1)<=128));
 assert.equal(many.reduce((sum,n)=>sum+(n.sourceData?.pdfBatch?.count||1),0),400);
 const detailed=Array.from({length:20},(_,i)=>vector(i,{paths:[{data:'M0 0'+('C0.123456789012345 1.123456789012345 2.123456789012345 3.123456789012345 4 4').repeat(80)+'Z',windingRule:'NONZERO'}]}));
 assert.ok(batchPdfPaths(detailed).every(n=>n.paths[0].data.length<=65536));
});
test('规范路径平移保留曲线、负数和科学计数，避免二次解析曲线包围盒',()=>{
 assert.equal(translateCanonicalPath('M1e-3 -2C0 1 2 3 4 5Z',2,-3),'M2.001 -5C2 -2 4 0 6 2Z');
});
function render(nodes){
 const canvas=createCanvas(200,80),ctx=canvas.getContext('2d');
 ctx.fillStyle='white';ctx.fillRect(0,0,200,80);
 for(const n of nodes){ctx.save();ctx.transform(...(n.transform||[1,0,0,1,n.x,n.y]));
 for(const path of n.paths||[]){ctx.fillStyle='rgb(51,102,179)';ctx.fill(new Path2D(path.data),path.windingRule==='EVENODD'?'evenodd':'nonzero');}ctx.restore();}
 return ctx.getImageData(0,0,200,80).data;
}
test('反向子路径、孔洞、曲线和仿射变换的几何一致，仅允许抗锯齿舍入',()=>{
 for(const matrix of [[1,0,0,1,10,10],[.9,.1,-.1,1.4,20,5]]){
  const original=series().map((n,i)=>({...n,transform:[matrix[0],matrix[1],matrix[2],matrix[3],matrix[4]+matrix[0]*i*6,matrix[5]+matrix[1]*i*6],paths:[{data:'M0 0C0 0 4 0 4 0L4 4L0 4Z M1 1L1 3L3 3L3 1Z',windingRule:'NONZERO'}]}));
  const batched=batchPdfPaths(structuredClone(original)),before=render(original),after=render(batched);
  const coordinates=nodes=>nodes.flatMap(n=>n.paths.flatMap(p=>{
    const values=p.data.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi).map(Number),m=n.transform;
    return values.map((v,i)=>i%2?m[1]*values[i-1]+m[3]*v+m[5]:m[0]*v+m[2]*values[i+1]+m[4]);
  }));
  const a=coordinates(original),b=coordinates(batched);assert.equal(a.length,b.length);assert.ok(a.every((v,i)=>Math.abs(v-b[i])<1e-9));
  let difference=0,max=0;for(let i=0;i<before.length;i++){const d=Math.abs(before[i]-after[i]);difference+=d;max=Math.max(max,d);}
  assert.ok(difference/before.length<.02&&max<=8,'Raster rounding differs: '+difference+' max '+max);
 }
});
console.log(checks+' PDF batching checks passed');
