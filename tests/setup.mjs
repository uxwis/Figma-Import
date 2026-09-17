import {createCanvas,ImageData,DOMMatrix,Path2D} from '@napi-rs/canvas';
Object.assign(globalThis,{ImageData,DOMMatrix,Path2D});
globalThis.document={createElement(tag){if(tag!=='canvas')throw new Error('Unexpected DOM '+tag);const c=createCanvas(1,1);
 c.toBlob=cb=>cb(new Blob([c.toBuffer('image/png')],{type:'image/png'}));return c;}};

