"""Conservative local raster fallback. Never expand to a whole artboard.
Only isolated pattern fills currently qualify for this restricted fallback.
Other unsupported effects remain actionable diagnostics."""
import copy
from psd_tools import PSDImage
from psd_tools.constants import BlendMode
def supplement(scene, source, folder, cancel):
    psd=PSDImage.open(source);layers={l.layer_id:l for l in psd.descendants()}
    resolved=set();serial=0
    def visit(nodes):
        nonlocal serial
        for i,n in enumerate(nodes):
            if cancel.is_set():return
            if n["kind"]=="mask":visit([n["mask"]])
            if "children" in n:visit(n["children"])
            problems={x["code"] for x in n.get("issues",[])}
            if not problems or not problems.issubset({"unsupported-fill"}):continue
            if n["kind"]!="vector" or "/asset/" in n.get("sourceId",""):continue
            try: layer=layers[int(n["sourceId"].split("/")[-1])]
            except (ValueError,KeyError):continue
            if layer.clipping or layer.blend_mode!=BlendMode.NORMAL:continue
            if layer.has_effects():continue
            viewport=layer.bbox
            if viewport[2]-viewport[0]>=psd.width or viewport[3]-viewport[1]>=psd.height:continue
            try:
                rendered=layer.composite(viewport=viewport,force=True,color=0,alpha=0,apply_icc=True)
                if rendered is None:continue
                name=f"resources/local-{serial}.png";serial+=1;rendered.save(folder/name)
                original=copy.deepcopy(n);original["name"]+=" [可编辑源结构]";original["recovery"]=True;original["visible"]=False
                original["sourceId"]+="/source"
                image={"kind":"image","name":n["name"]+" [局部合成]","sourceId":n["sourceId"],"sourceType":"local-composite",
                       "fidelity":"rasterized","resourceId":f"local-{serial}","x":n["x"],"y":n["y"],"width":rendered.width,"height":rendered.height,
                       "issues":[{"code":"local-rasterized","message":"图案填充局部合成；原结构另存，外观仍需逐项验收"}]}
                scene["resources"][image["resourceId"]]=name
                nodes[i]={"kind":"group","name":n["name"],"children":[image,original],"sourceId":n["sourceId"]+"/appearance"}
                resolved.add(n["sourceId"])
                scene["diagnostics"].append({"sourceId":image["sourceId"],"name":image["name"],"status":"rasterized",
                                             "code":"local-rasterized","message":image["issues"][0]["message"]})
            except Exception as exc:
                scene["warnings"].append(n["name"]+"：本机局部合成失败："+str(exc))
    visit(scene["nodes"])
    scene["diagnostics"]=[d for d in scene["diagnostics"] if d["sourceId"] not in resolved or d["status"]=="rasterized"]
    return len(resolved)

