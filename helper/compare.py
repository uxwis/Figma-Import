"""Compare a saved source composite with a Figma export at original dimensions."""
import argparse, json, io, zipfile
from pathlib import Path
import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity
def compare(reference, actual, output, geometry=None):
    a=np.asarray(Image.open(reference).convert("RGBA"),dtype=np.float64)/255
    b=np.asarray(Image.open(actual).convert("RGBA"),dtype=np.float64)/255
    if a.shape!=b.shape:raise ValueError(f"尺寸不一致：{a.shape} != {b.shape}；禁止缩放后冒充原尺寸验收")
    # Both backgrounds matter: transparent white and opaque white look identical
    # on white alone, but are not equivalent imported appearances.
    aa=a[:,:,:3]*a[:,:,3:4]+1-a[:,:,3:4];bb=b[:,:,:3]*b[:,:,3:4]+1-b[:,:,3:4]
    score=float(structural_similarity(aa,bb,channel_axis=2,data_range=1))
    dark_a=a[:,:,:3]*a[:,:,3:4];dark_b=b[:,:,:3]*b[:,:,3:4]
    dark_score=float(structural_similarity(dark_a,dark_b,channel_axis=2,data_range=1))
    alpha=float(np.max(np.abs(a[:,:,3]-b[:,:,3])))
    diff=np.maximum(np.max(np.abs(aa-bb),axis=2),np.max(np.abs(dark_a-dark_b),axis=2))
    heat=np.zeros(a.shape[:2]+(3,),dtype=np.uint8);heat[:,:,0]=np.minimum(255,diff*1020).astype(np.uint8)
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    Image.fromarray(heat).save(output.with_suffix(".heatmap.png"))
    displacement=None
    if geometry:
        points=json.loads(Path(geometry).read_text("utf-8"))
        if not points:raise ValueError("几何对应点为空，不能当作几何验收通过")
        if any(len(p["expected"])!=len(p["actual"]) or not p["expected"] for p in points):raise ValueError("几何坐标数量不匹配")
        if not all(np.isfinite(x) for p in points for k in ("expected","actual") for x in p[k]):raise ValueError("无效几何坐标")
        displacement=max(abs(x-y) for p in points for x,y in zip(p["expected"],p["actual"]))
    report={"ssim":min(score,dark_score),"ssimWhite":score,"ssimBlack":dark_score,"maxAlphaDifference":alpha,"meanAbsoluteError":float(np.mean(diff)),
            "fractionOver1of255":float(np.mean(diff>1/255)),"geometryMaxOffsetPx":displacement,
            "visualPass":min(score,dark_score)>=.99,"geometryPass":displacement is not None and displacement<=.5,
            "requiresHumanReview":True}
    output.write_text(json.dumps(report,indent=2),encoding="utf-8");return report

def compare_packages(reference,actual,output):
    """Join a local conversion package and Figma export by sourceId, never order."""
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    results=[]
    with zipfile.ZipFile(reference) as source,zipfile.ZipFile(actual) as exported:
        sm=json.loads(source.read("manifest.json"));fm=json.loads(exported.read("manifest.json"))
        if sm.get("schema")!="figma-import-package" or fm.get("schema")!="figma-export-package":raise ValueError("不是匹配的转换包和 Figma 验收包")
        boards=fm.get("boards",[]);refs=sm.get("references",[])
        if not refs:raise ValueError("转换包没有原始参考图")
        for i,ref in enumerate(refs):
            matches=[b for b in boards if b.get("sourceId")==ref.get("sourceId")]
            if not ref.get("sourceId") and len(refs)==len(boards)==1:matches=boards
            label=ref.get("name",ref["path"])
            if len(matches)!=1:results.append({"name":label,"error":"找不到唯一对应的 Figma 画板","visualPass":False});continue
            try:
                report=compare(io.BytesIO(source.read(ref["path"])),io.BytesIO(exported.read(matches[0]["path"])),output.parent/f"artboard-{i+1}.json")
                results.append({"name":label,"sourceId":ref.get("sourceId"),"referenceOrigin":ref.get("origin"),**report})
            except (ValueError,KeyError) as exc:results.append({"name":label,"error":str(exc),"visualPass":False})
    result={"boards":results,"visualPass":bool(results) and all(b["visualPass"] for b in results),"fidelityValidated":False,"requiresHumanReview":True}
    output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8");return result
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("reference");p.add_argument("actual");p.add_argument("--output",default=".test-output/comparison.json");p.add_argument("--geometry")
    a=p.parse_args();r=compare_packages(a.reference,a.actual,a.output) if zipfile.is_zipfile(a.reference) and zipfile.is_zipfile(a.actual) else compare(a.reference,a.actual,a.output,a.geometry);print(json.dumps(r,indent=2))
    raise SystemExit(0 if r["visualPass"] else 1)

