import fs from'node:fs/promises';import{build}from'esbuild';import{createCanvas}from'@napi-rs/canvas';
await build({stdin:{contents:(await fs.readFile('src/builder.ts','utf8')).replace(/(\w+)\.setPluginData\(/g,'__testMetadata($1,').replace(/await new Promise\(r=>setTimeout\(r,0\)\)/g,'void 0'),resolveDir:process.cwd()+'/src',loader:'ts'},bundle:true,format:'iife',globalName:'Importer',minify:true,write:true,outfile:'.test-output/figma-builder.js'});
const old=JSON.parse(await fs.readFile('.test-output/harness-payload.json','utf8'));
const c=createCanvas(8,8),g=c.getContext('2d');
for(const[color,x,y]of[['red',0,0],['lime',4,0],['blue',0,4],['white',4,4]]){g.fillStyle=color;g.fillRect(x,y,4,4);}
old.scene.nodes.push({kind:'image',name:'仿射图片',resourceId:'grid',x:0,y:0,width:8,height:8,transform:[7,1,2,7,110,175]});
old.scene.resources.grid=Array.from(c.toBuffer('image/png'));
old.scene.nodes.push({kind:'text',name:'局部字形样式',characters:'AB',x:200,y:180,fontSize:32,font:{candidates:['Inter'],style:'Regular'},color:{r:1,g:1,b:1},styleRuns:[{length:1,font:{candidates:['Inter'],style:'Bold'}},{length:1,font:{candidates:['Inter'],style:'Regular'}}]});
console.log(JSON.stringify({code:'function __testMetadata(){};'+await fs.readFile('.test-output/figma-builder.js','utf8'),scene:old.scene}));

