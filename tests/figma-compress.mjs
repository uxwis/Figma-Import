import fs from 'node:fs/promises';import{build}from'esbuild';import{zlibSync}from'fflate';
await build({stdin:{contents:"export {unzlibSync,strFromU8} from 'fflate';",resolveDir:process.cwd(),loader:'js'},bundle:true,format:'iife',globalName:'Compression',minify:true,write:true,outfile:'.test-output/compression.js'});
await import('./figma-harness.mjs');

