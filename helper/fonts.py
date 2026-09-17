"""Exact-font outline backup for horizontal, single-line PSD text.
Complex paragraphs retain a diagnostic and their source cached appearance."""
import io, math, os, re
from pathlib import Path
from fontTools.ttLib import TTFont, TTCollection
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
import uharfbuzz as hb

_INDEX=None
def font_key(name):return re.sub(r"[\s_-]", "", name).casefold()
def font_index():
    global _INDEX
    if _INDEX is not None:return _INDEX
    result={}
    roots=[Path(os.environ.get("WINDIR","C:/Windows"))/"Fonts",Path(os.environ.get("LOCALAPPDATA",""))/"Microsoft/Windows/Fonts"]
    for root in roots:
        if not root.exists():continue
        try: files=list(root.iterdir())
        except PermissionError: continue
        for file in files:
            if file.suffix.lower() not in (".ttf",".otf",".ttc",".otc"):continue
            try:
                collection=TTCollection(str(file),lazy=True) if file.suffix.lower() in (".ttc",".otc") else None
                fonts=collection.fonts if collection else [TTFont(str(file),lazy=True)]
                for index,font in enumerate(fonts):
                    regular=any(r.nameID==2 and r.toUnicode().casefold() in ("regular","normal","常规") for r in font["name"].names)
                    for record in font["name"].names:
                        if record.nameID==6:
                            result.setdefault(font_key(record.toUnicode()),(file,index))
                            if regular:result.setdefault(font_key(record.toUnicode()+"-Regular"),(file,index))
                for font in fonts:font.close()
            except Exception:continue
    _INDEX=result;return result

def outline(node,index):
    name=node.get("font",{}).get("postScriptName")
    if not name or font_key(name) not in index:return None
    text=node["characters"]
    if "\n" in text or node.get("box") or node.get("issues"):return None
    runs=node.get("styleRuns") or []
    if any(r.get("font",{}).get("postScriptName",name)!=name or abs(r.get("fontSize",node.get("fontSize",12))-node.get("fontSize",12))>.001 for r in runs):return None
    color=node.get("color") or (runs[0].get("color") if runs else None) or {"r":0,"g":0,"b":0}
    for run in runs:
        run_color=run.get("color") or color
        if any(abs(run_color.get(c,1)-color.get(c,1))>1e-6 for c in ("r","g","b","a")):return None
        if abs(run.get("tracking",node.get("tracking",0))-node.get("tracking",0))>1e-6:return None
    file,face_index=index[font_key(name)]
    tt=TTFont(str(file),fontNumber=face_index)
    glyphs=tt.getGlyphSet();order=tt.getGlyphOrder();upem=tt["head"].unitsPerEm
    face=hb.Face(file.read_bytes(),face_index);font=hb.Font(face);font.scale=(upem,upem);hb.ot_font_set_funcs(font)
    buf=hb.Buffer();buf.add_str(text);buf.guess_segment_properties();hb.shape(font,buf)
    scale=node.get("fontSize",12)/upem;tracking=node.get("tracking",0)/1000*node.get("fontSize",12)
    m=node.get("transform",[1,0,0,1,node["x"],node["y"]]);pen=SVGPathPen(glyphs);bounds=BoundsPen(glyphs);x=y=0
    for info,pos in zip(buf.glyph_infos,buf.glyph_positions):
        if info.codepoint==0:tt.close();return None
        ox=(x+pos.x_offset)*scale;oy=-(y+pos.y_offset)*scale
        transform=(m[0]*scale,m[1]*scale,-m[2]*scale,-m[3]*scale,m[0]*ox+m[2]*oy,m[1]*ox+m[3]*oy)
        glyphs[order[info.codepoint]].draw(TransformPen(pen,transform));glyphs[order[info.codepoint]].draw(TransformPen(bounds,transform))
        x+=pos.x_advance+tracking/scale;y+=pos.y_advance
    tt.close()
    if not bounds.bounds:return None
    left,top,right,bottom=bounds.bounds;w,h=right-left,bottom-top;ink=node.get("inkBounds")
    if not ink:return None
    rgb="rgb("+",".join(str(round(color[c]*255)) for c in "rgb")+")"
    opacity=node.get("fillOpacity",1)*color.get("a",1)
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><path transform="translate({-left} {-top})" fill="{rgb}" fill-opacity="{opacity}" d="{pen.getCommands()}"/></svg>'
    return {"kind":"vector","name":node["name"]+" [原字体轮廓]","sourceType":"font-outline","fidelity":"outlined-text",
            "x":ink["x"],"y":ink["y"],"width":w,"height":h,"svg":svg}

def add_font_outlines(scene,cancel):
    from service import iter_nodes
    index=font_index();missing=set()
    for n in iter_nodes(scene["nodes"]):
        if cancel.is_set():break
        if n["kind"]!="text":continue
        try:
            vector=outline(n,index)
            if vector:n["fallback"]=vector
            elif font_key(n.get("font",{}).get("postScriptName","unknown")) not in index:missing.add(n.get("font",{}).get("postScriptName","unknown"))
        except Exception:continue
    return ["未找到原字体，保留文字缓存并报告："+font for font in sorted(missing)]

