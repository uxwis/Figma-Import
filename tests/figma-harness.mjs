import fs from 'node:fs/promises';import {build}from'esbuild';
await build({stdin:{contents:(await fs.readFile('src/builder.ts','utf8')).replace(/(\w+)\.setPluginData\(/g,'__testMetadata($1,').replace(/await new Promise\(r=>setTimeout\(r,0\)\)/g,'void 0'),resolveDir:process.cwd()+'/src',loader:'ts'},bundle:true,format:'iife',globalName:'Importer',minify:true,write:true,outfile:'.test-output/figma-builder.js'});
const code=await fs.readFile('.test-output/figma-builder.js','utf8');
const scene={version:2,width:420,height:260,resources:{},warnings:[],diagnostics:[],stats:{},
nodes:[{kind:'group',name:'缩放与旋转',transform:[1.4,.4,-.3,1.2,40,20],children:[
{kind:'vector',name:'可改色渐变',x:0,y:0,width:100,height:80,paths:[{data:'M0 0H100V80H0Z',windingRule:'NONZERO'}],
 fills:[{type:'GRADIENT_LINEAR',transform:[.01,0,0,.0125,0,0],stops:[{position:0,color:{r:1,g:0,b:0,a:1}},{position:1,color:{r:0,g:0,b:1,a:.5}}]}]},
{kind:'vector',name:'布尔减去',x:130,y:0,width:100,height:80,paths:[{data:'M0 0H100V80H0Z',windingRule:'NONZERO'},{data:'M20 20H80V60H20Z',windingRule:'NONZERO',operation:'subtract'}],fills:[{type:'SOLID',color:{r:0,g:.8,b:.3}}]}]},
{kind:'mask',name:'嵌套裁剪',maskType:'VECTOR',mask:{kind:'vector',name:'裁剪轮廓',x:0,y:150,width:70,height:70,paths:[{data:'M0 0L70 35L0 70Z',windingRule:'NONZERO'}],fills:[{type:'SOLID',color:{r:1,g:1,b:1}}]},children:[
 {kind:'vector',name:'裁剪内内容',x:0,y:150,width:120,height:80,paths:[{data:'M0 0H120V80H0Z',windingRule:'NONZERO'}],fills:[{type:'SOLID',color:{r:1,g:.8,b:0}}]}]}]};
console.log(JSON.stringify({code:'function __testMetadata(){};'+code,scene}));

