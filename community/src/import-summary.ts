import type {Diagnostic} from './types';
export type ImportNotice={category:'content'|'text'|'appearance';message:string};
/** Stable categories, deduplicated by source; no individual layer list in the UI. */
export function summarizeImport(diagnostics:Diagnostic[]):ImportNotice[] {
 const missing=new Set<string>(),outlined=new Set<string>(),textImages=new Set<string>(),substituted=new Set<string>(),appearance=new Set<string>(),images=new Set<string>();
 for(const [index,d] of diagnostics.entries()){
  if(d.recovery)continue;
  const id=d.sourceId||d.nodeId||String(index),issues=d.issues?.length?d.issues:[{code:d.code,message:d.message}];
  const textCode=issues.some(i=>/^(text-|pdf-(font|glyph|missing-outline|text)|postscript-font)/.test(i.code));
  if(d.status==='outlined-text')outlined.add(id);
  if(d.status==='rasterized')(textCode?textImages:images).add(id);
  for(const {code} of issues){
   if(code==='native-blend')continue;
   if(code==='stroke-miter-limit'&&(d.strokeAppearance==='unchanged'||!d.strokeAppearance&&d.status!=='unsupported'))continue;
   if(code==='postscript-font'){substituted.add(id);continue;}
   if(/^(missing-|pdf-(missing-outline|font|text-layout|operator-|pattern|shading|radial-focal))/.test(code)){missing.add(id);continue;}
   if(/^text-/.test(code)){
    if(d.status==='outlined-text')outlined.add(id);else if(d.status==='rasterized')textImages.add(id);else appearance.add(id);
    continue;
   }
   if(!['created','editable','original-image','outlined-text','rasterized'].includes(code)&&d.message)appearance.add(id);
  }
  // Unknown/older scene diagnostics remain visible, without printing raw errors.
  if(d.status==='unsupported'&&!issues.some(i=>/^(missing-|pdf-(missing-outline|font|text-layout|operator-|pattern|shading|radial-focal)|postscript-font)/.test(i.code)))appearance.add(id);
 }
 for(const id of textImages)images.delete(id);
 const notices:ImportNotice[]=[];
 if(missing.size)notices.push({category:'content',message:'部分内容未完整导入，请核对缺失图层或智能对象。'});
 const converted=[outlined.size?'轮廓':'',textImages.size?'图片':''].filter(Boolean);
 if(converted.length||substituted.size){
  const action=[converted.length?'已转为'+converted.join('或'):'',substituted.size?'使用替代字体':''].filter(Boolean).join('或');
  notices.push({category:'text',message:'部分文字'+action+'，请核对字形与排版。'});
 }
 if(appearance.size||images.size)notices.push({category:'appearance',message:[appearance.size?'部分效果、蒙版或描边可能存在差异':'',images.size?'部分内容以图片保留':''].filter(Boolean).join('，')+'，请核对外观。'});
 return notices;
}
