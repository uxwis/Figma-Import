// The helper and iframe use the same scene converter.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, ImageData, DOMMatrix, Path2D } from '@napi-rs/canvas';
Object.assign(globalThis,{ImageData,DOMMatrix,Path2D});
globalThis.document={createElement(tag){if(tag!=='canvas')throw new Error('Unsupported DOM '+tag);
 const c=createCanvas(1,1);c.toBlob=cb=>cb(new Blob([c.toBuffer('image/png')],{type:'image/png'}));return c;}};
const {parseFile}=await import('./parser.mjs');
const [input,output]=process.argv.slice(2);if(!input||!output)throw new Error('Usage: node helper/convert.mjs input output-directory');
const bytes=await fs.readFile(input),result=await parseFile(path.basename(input),bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),
(p,message)=>process.stderr.write(JSON.stringify({progress:p,message})+'\n'));
await fs.mkdir(path.join(output,'resources'),{recursive:true});
const resources={};
for(const [id,data]of Object.entries(result.resources)){resources[id]='resources/'+id+'.png';await fs.writeFile(path.join(output,resources[id]),data);}
await fs.writeFile(path.join(output,'scene.json'),JSON.stringify({...result,resources}));
process.stdout.write(JSON.stringify({version:2,scene:'scene.json',stats:result.stats}));

