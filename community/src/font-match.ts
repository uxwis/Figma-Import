import type {ParsedFont} from './types';
type AvailableFont={family:string;style:string};

const key=(s:string)=>s.toLowerCase().replace(/[\s_-]/g,'');
function styleKey(s:string):string {
  const k=key(s);
  return /^(regular|normal|roman)$/.test(k)?'regular':k.replace('demibold','semibold').replace('oblique','italic');
}

/** Match an actual face, including legacy family names with the weight embedded. */
export function resolveFont(font:ParsedFont|undefined,fonts:AvailableFont[]):AvailableFont|undefined {
  if(!font)return undefined;
  for(const candidate of font.candidates){
    const match=fonts.find(f=>key(candidate)===key(f.family)&&styleKey(f.style)===styleKey(font.style));
    if(match)return match;
  }
  for(const candidate of font.candidates){
    const match=fonts.find(f=>styleKey(f.style)==='regular'&&key(f.family)===key(candidate)+styleKey(font.style));
    if(match)return match;
  }
  return undefined;
}

const weights:Record<string,number>={thin:100,extralight:200,light:300,regular:400,medium:500,semibold:600,bold:700,extrabold:800,black:900,heavy:900};
function distance(a:string,b:string):number {
  const x=styleKey(a),y=styleKey(b),italic=/italic/.test(x)!==/italic/.test(y);
  return (italic?1000:0)+Math.abs((weights[x.replace('italic','')]??400)-(weights[y.replace('italic','')]??400));
}

/** Substitutions are deliberately separate from exact matches so they are reported. */
export function substituteFonts(font:ParsedFont|undefined,characters:string,fonts:AvailableFont[]):AvailableFont[] {
  const out:AvailableFont[]=[],style=font?.style||'Regular';
  const add=(family:string)=>{
    const effective=(f:AvailableFont):string|undefined=>{
      if(key(f.family)===key(family))return f.style;
      if(styleKey(f.style)==='regular'&&key(f.family).startsWith(key(family))){
        const suffix=styleKey(key(f.family).slice(key(family).length));
        if(weights[suffix.replace('italic','')])return suffix;
      }
      return undefined;
    };
    const faces=fonts.filter(f=>effective(f)!==undefined).sort((a,b)=>distance(effective(a)!,style)-distance(effective(b)!,style)||a.family.localeCompare(b.family)||a.style.localeCompare(b.style));
    for(const face of faces)if(!out.some(f=>f.family===face.family&&f.style===face.style))out.push(face);
  };
  // Prefer an available weight of the original family before changing the typeface.
  for(const family of font?.candidates||[])add(family);
  const source=key(font?.postScriptName||font?.candidates[0]||'');
  if(/^notosans(hans|sc|cjksc)/.test(source))for(const family of ['Noto Sans SC','Noto Sans CJK SC'])add(family);
  if(/^dinpro/.test(source))for(const family of ['DIN Pro','DINPro'])add(family);
  const cjk=/[\u2e80-\u9fff\uf900-\ufaff]/.test(characters);
  const families=cjk?['Noto Sans SC','Noto Sans CJK SC','Microsoft YaHei','PingFang SC','Source Han Sans SC','Source Han Sans CN','SimHei']:['Inter','Arial','Roboto','Noto Sans'];
  for(const family of families)add(family);
  return out;
}

/** PDF/AI/EPS use the default face when the original font cannot be loaded. */
export function defaultFonts(fonts:AvailableFont[]):AvailableFont[] {
  const preferred=['Inter','Arial','Roboto','Noto Sans'];
  const first=new Map<string,AvailableFont[]>(),regular:AvailableFont[]=[],other:AvailableFont[]=[],seen=new Set<string>();
  for(const font of fonts){
    const id=JSON.stringify([font.family,font.style]);if(seen.has(id))continue;seen.add(id);
    if(styleKey(font.style)==='regular'){
      if(preferred.includes(font.family)){const faces=first.get(font.family)||[];faces.push(font);first.set(font.family,faces);}
      else regular.push(font);
    }else other.push(font);
  }
  return [...preferred.flatMap(family=>first.get(family)||[]),...regular,...other];
}
