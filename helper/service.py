"""Local-only converter. No Adobe, remote APIs, or whole-page raster fallback."""
from __future__ import annotations
import argparse, hashlib, hmac, importlib.metadata, io, json, os, secrets, shutil, subprocess, sys, tempfile, threading, time, uuid, zipfile
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import pymupdf
from psd_tools import PSDImage

ROOT = Path(__file__).resolve().parent.parent
MAX_BYTES = 256 * 1024 * 1024
TIMEOUT = 180
class Cancelled(Exception): pass

def ghostscript():
    env = os.environ.get("FIGMA_IMPORT_GS")
    if env and Path(env).is_file(): return str(Path(env).resolve())
    for name in ("gswin64c", "gswin32c", "gs"):
        if result := shutil.which(name): return result
    folder = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "gs"
    found = list(folder.glob("gs*/bin/gswin64c.exe")) if folder.exists() else []
    return str(sorted(found)[-1]) if found else None

def capabilities():
    return {"version": 2, "formats": ["pdf", "ai", "psd", "psb"] + (["eps", "ps"] if ghostscript() else []),
            "engines": {n: importlib.metadata.version(n) for n in ("PyMuPDF", "psd-tools", "fonttools")},
            "ghostscript": bool(ghostscript()), "node": bool(shutil.which("node")),
            "wholePageRasterFallback": False, "offlinePackages": True}

def process(args, cancel, timeout=TIMEOUT):
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    with tempfile.TemporaryFile() as log:
        proc = subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT, cwd=ROOT, creationflags=flags)
        start = time.monotonic()
        while proc.poll() is None:
            if cancel.wait(.1) or time.monotonic()-start > timeout:
                proc.kill(); proc.wait()
                if cancel.is_set(): raise Cancelled("Conversion cancelled")
                raise TimeoutError("Converter exceeded time limit")
        log.seek(0); output = log.read().decode("utf-8", "replace")
        if proc.returncode: raise RuntimeError(output[-4000:])
        return output

def iter_nodes(nodes):
    for node in nodes:
        yield node
        if node["kind"] == "mask": yield from iter_nodes([node["mask"]])
        yield from iter_nodes(node.get("children", []))

def reference_psd(source, folder, scene):
    psd = PSDImage.open(source)
    preview = psd.topil()  # saved composite; do not call composite() and relabel it as Adobe reference
    refs = []
    if preview is None: return refs
    for i, frame in enumerate(n for n in scene["nodes"] if n.get("artboard")):
        x,y,w,h = (frame[k] for k in ("x","y","width","height"))
        name = f"references/artboard-{i+1}.png"
        preview.crop((round(x),round(y),round(x+w),round(y+h))).save(folder/name)
        refs.append({"path":name,"sourceId":frame["sourceId"],"name":frame["name"],"width":round(w),"height":round(h),"origin":"psd-saved-composite"})
    if not refs:
        name="references/composite.png"; preview.save(folder/name)
        refs.append({"path":name,"origin":"psd-saved-composite","width":preview.width,"height":preview.height})
    return refs

def reference_pdf(source, folder, scene):
    refs=[]
    with pymupdf.open(source) as pdf:
        for i,page in enumerate(pdf):
            name=f"references/page-{i+1}.png"
            page.get_pixmap(matrix=pymupdf.Matrix(1,1),alpha=True).save(folder/name)
            refs.append({"path":name,"sourceId":f"pdf/page-{i+1}","name":f"画板 {i+1}","origin":"mupdf-reference","width":round(page.rect.width),"height":round(page.rect.height)})
    return refs

def convert(source:Path, destination:Path, cancel=None, progress=lambda p,m:None):
    cancel = cancel or threading.Event()
    if source.stat().st_size > MAX_BYTES: raise ValueError("File exceeds 256 MB limit")
    with tempfile.TemporaryDirectory(prefix="figma-import-") as tmp:
        work=Path(tmp); out=work/"result"; out.mkdir(); (out/"references").mkdir()
        original_hash=hashlib.sha256(source.read_bytes()).hexdigest()
        suffix=source.suffix.lower()
        progress(5,"识别源文件")
        normalized=source
        header=source.read_bytes()[:1024]
        if suffix in (".eps",".ps") or (suffix==".ai" and b"%PDF-" not in header):
            gs=ghostscript()
            if not gs: raise ValueError("Ghostscript is required for EPS/PostScript; no preview-image fallback")
            normalized=work/"normalized.pdf"
            process([gs,"-dSAFER","-dBATCH","-dNOPAUSE","-dEPSCrop","-dAutoRotatePages=/None","-sDEVICE=pdfwrite",
                     "-dCompatibilityLevel=1.7","-sOutputFile="+str(normalized),str(source.resolve())],cancel)
            if not normalized.exists(): raise ValueError("No readable PostScript/PDF content; private AI data is unsupported")
        progress(20,"构建有序场景")
        node=shutil.which("node")
        if not node: raise RuntimeError("Node.js runtime not found")
        process([node,str(ROOT/"helper/convert.mjs"),str(normalized.resolve()),str(out)],cancel)
        scene=json.loads((out/"scene.json").read_text("utf-8"))
        if suffix in (".psd",".psb"):
            from composite import supplement
            supplement(scene,source,out,cancel)
        progress(75,"生成独立参考图和字体轮廓")
        refs=reference_psd(source,out,scene) if suffix in (".psd",".psb") else reference_pdf(normalized,out,scene)
        # Explicit supplemental outlines, never a substitute font.
        from fonts import add_font_outlines
        outline_report=add_font_outlines(scene,cancel)
        scene["warnings"] += outline_report
        scene["diagnostics"] += [{"sourceId":"helper","name":"本机补充解析","status":"unsupported","code":"font-outline","message":m} for m in outline_report]
        (out/"scene.json").write_text(json.dumps(scene,ensure_ascii=False),encoding="utf-8")
        manifest={"schema":"figma-import-package","version":2,"scene":"scene.json","source":{"name":source.name,"sha256":original_hash},
                  "references":refs,"engines":capabilities()["engines"],"fidelityValidated":False}
        (out/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False),encoding="utf-8")
        if cancel.is_set(): raise Cancelled()
        destination.parent.mkdir(parents=True,exist_ok=True)
        temporary=destination.with_suffix(destination.suffix+".partial")
        try:
            with zipfile.ZipFile(temporary,"w",zipfile.ZIP_DEFLATED) as z:
                for f in out.rglob("*"):
                    if f.is_file(): z.write(f,f.relative_to(out).as_posix())
            temporary.replace(destination)
        finally: temporary.unlink(missing_ok=True)
        progress(100,"离线转换包已生成")
        return manifest

class Service:
    def __init__(self,token):
        self.token=token;self.jobs={};self.lock=threading.Lock();self.pool=ThreadPoolExecutor(max_workers=1)
        self.storage=tempfile.TemporaryDirectory(prefix="figma-import-service-")
    def start(self,data,name):
        with self.lock:
            if sum(j["state"] in ("queued","running") for j in self.jobs.values())>=2: raise ValueError("转换队列已满")
            jid=uuid.uuid4().hex;folder=Path(self.storage.name)/jid;folder.mkdir()
            suffix=Path(name).suffix.lower()
            if suffix not in (".ai",".pdf",".eps",".ps",".psd",".psb"): raise ValueError("不支持的文件类型")
            source=folder/("source"+suffix);source.write_bytes(data)
            job={"id":jid,"state":"queued","progress":0,"message":"等待转换","cancel":threading.Event(),"folder":folder}
            self.jobs[jid]=job
        def run():
            try:
                job["state"]="running"
                def update(p,m): job.update(progress=p,message=m)
                convert(source,folder/"result.figimport",job["cancel"],update)
                job["state"]="done"
            except Cancelled: job.update(state="cancelled",message="转换已取消")
            except Exception as exc: job.update(state="error",message=str(exc))
            finally: source.unlink(missing_ok=True)
        self.pool.submit(run);return jid
    def public(self,j): return {k:v for k,v in j.items() if k not in ("cancel","folder")}

def serve(port, on_ready=None, stop_event=None):
    token=secrets.token_urlsafe(32);service=Service(token)
    allowed_origins={"null","https://www.figma.com","https://figma.com"}
    class Handler(BaseHTTPRequestHandler):
        server_version="FigmaImport/2"
        def log_message(self,*_): pass
        def cors(self):
            origin=self.headers.get("Origin")
            if origin in allowed_origins:self.send_header("Access-Control-Allow-Origin",origin);self.send_header("Vary","Origin")
        def respond(self,status,value,raw=False):
            body=value if raw else json.dumps(value,ensure_ascii=False).encode("utf-8")
            self.send_response(status);self.cors();self.send_header("Content-Type","application/octet-stream" if raw else "application/json; charset=utf-8")
            self.send_header("Cache-Control","no-store");self.send_header("Content-Length",str(len(body)));self.end_headers();self.wfile.write(body)
        def auth(self):
            if self.headers.get("Host") not in (f"127.0.0.1:{port}",f"localhost:{port}"):self.respond(403,{"error":"Invalid Host"});return False
            if self.headers.get("Origin") not in allowed_origins|{None}:self.respond(403,{"error":"Invalid Origin"});return False
            value=self.headers.get("Authorization","").removeprefix("Bearer ")
            if not hmac.compare_digest(value,service.token):self.respond(401,{"error":"Pairing token required"});return False
            return True
        def do_OPTIONS(self):
            if self.headers.get("Origin") not in allowed_origins:self.respond(403,{});return
            self.send_response(204);self.cors();self.send_header("Access-Control-Allow-Methods","GET,POST,DELETE,OPTIONS")
            self.send_header("Access-Control-Allow-Headers","Authorization,Content-Type")
            self.send_header("Access-Control-Allow-Private-Network","true");self.end_headers()
        def do_GET(self):
            if not self.auth():return
            parts=urlparse(self.path).path.strip("/").split("/")
            if parts==["capabilities"]:self.respond(200,capabilities());return
            job=service.jobs.get(parts[1] if len(parts)>1 else "")
            if not job or parts[0]!="jobs":self.respond(404,{"error":"Not found"});return
            if len(parts)==3 and parts[2]=="result":
                if job["state"]!="done":self.respond(409,{"error":"Result not ready"});return
                self.respond(200,(job["folder"]/"result.figimport").read_bytes(),True)
            elif len(parts)==4 and parts[2]=="resources":
                if job["state"]!="done":self.respond(409,{"error":"Result not ready"});return
                # Resource names are exact members of the generated package, no arbitrary filesystem reads.
                with zipfile.ZipFile(job["folder"]/"result.figimport") as z:
                    name="resources/"+parts[3]
                    if name not in z.namelist():self.respond(404,{});return
                    self.respond(200,z.read(name),True)
            else:self.respond(200,service.public(job))
        def do_POST(self):
            if not self.auth():return
            url=urlparse(self.path)
            if url.path!="/jobs":self.respond(404,{});return
            try:
                size=int(self.headers.get("Content-Length","0"))
                if size<=0 or size>MAX_BYTES:raise ValueError("File size must be 1..256 MB")
                self.connection.settimeout(60);data=self.rfile.read(size)
                if len(data)!=size:raise ValueError("Incomplete upload")
                jid=service.start(data,parse_qs(url.query).get("name",["source.psd"])[0])
                self.respond(202,{"id":jid})
            except Exception as exc:self.respond(400,{"error":str(exc)})
        def do_DELETE(self):
            if not self.auth():return
            jid=urlparse(self.path).path.rsplit("/",1)[-1];job=service.jobs.get(jid)
            if not job:self.respond(404,{});return
            job["cancel"].set()
            if job["state"] in ("done","error","cancelled"):
                folder=job["folder"].resolve();base=Path(service.storage.name).resolve()
                if folder.parent==base and folder.name==jid:shutil.rmtree(folder,ignore_errors=True)
                with service.lock:service.jobs.pop(jid,None)
            self.respond(200,{"id":jid,"cancelled":True})
    server=ThreadingHTTPServer(("127.0.0.1",port),Handler)
    port=server.server_address[1]
    try:
        if sys.stdout:print(f"Local converter: http://localhost:{port}\nPairing token: {token}",flush=True)
        if on_ready:on_ready(token,capabilities())
        if stop_event is None:server.serve_forever()
        else:
            server.timeout=.25
            while not stop_event.is_set():server.handle_request()
    except KeyboardInterrupt:pass
    finally:
        for j in service.jobs.values():j["cancel"].set()
        server.server_close();service.pool.shutdown(wait=True,cancel_futures=True);service.storage.cleanup()

if __name__=="__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser=argparse.ArgumentParser();sub=parser.add_subparsers(dest="command",required=True)
    sub.add_parser("capabilities")
    run=sub.add_parser("serve");run.add_argument("--port",type=int,default=47823)
    conv=sub.add_parser("convert");conv.add_argument("source",type=Path);conv.add_argument("output",type=Path)
    args=parser.parse_args()
    if args.command=="serve":serve(args.port)
    elif args.command=="capabilities":print(json.dumps(capabilities()))
    else:convert(args.source,args.output,progress=lambda p,m:print(f"{p}% {m}",flush=True))

