import sys, os, json, tempfile, subprocess, time, unittest, urllib.request, urllib.error, zipfile, threading, io, contextlib
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"helper"))
import service
from compare import compare
from PIL import Image
class Tests(unittest.TestCase):
 def test_companion_window_and_graceful_shutdown(self):
  import desktop
  root=desktop.tk.Tk();root.withdraw()
  try:
   window=desktop.Companion(root,autostart=False);window.code='test-only-code'
   with patch.object(root,'clipboard_clear') as clear,patch.object(root,'clipboard_append') as append:
    window.copy_code();clear.assert_called_once();append.assert_called_once_with('test-only-code')
   self.assertIn('已复制',window.copy.cget('text'))
   window.close();self.assertTrue(window.stop.is_set())
  finally:root.destroy()
  stop=threading.Event();ready=threading.Event();state={}
  def started(token,cap):state.update(token=token,cap=cap);ready.set()
  # The GUI serves in-process so closing its window can cancel jobs and clean storage.
  with contextlib.redirect_stdout(io.StringIO()):
   thread=threading.Thread(target=service.serve,args=(47828,),kwargs={'on_ready':started,'stop_event':stop})
   thread.start()
   try:
    self.assertTrue(ready.wait(10));self.assertEqual(state['cap']['version'],2)
    request=urllib.request.Request('http://localhost:47828/capabilities',headers={'Authorization':'Bearer '+state['token']})
    with urllib.request.urlopen(request,timeout=5) as response:self.assertEqual(response.status,200)
   finally:stop.set();thread.join(10)
   self.assertFalse(thread.is_alive())
 def test_visual_alpha_and_dimensions(self):
  with tempfile.TemporaryDirectory() as temp:
   folder=Path(temp);a=folder/'a.png';b=folder/'b.png';report=folder/'comparison.json'
   Image.new('RGBA',(16,16),(255,255,255,255)).save(a)
   Image.new('RGBA',(16,16),(255,255,255,0)).save(b)
   self.assertFalse(compare(a,b,report)['visualPass'])
   self.assertTrue(compare(a,a,report)['visualPass'])
   self.assertFalse(compare(a,a,report)['geometryPass'])
   Image.new('RGBA',(8,8)).save(b)
   with self.assertRaises(ValueError):compare(a,b,report)
 def test_timeout_and_cancel(self):
  with self.assertRaises(TimeoutError):service.process([sys.executable,"-c","import time;time.sleep(5)"],threading.Event(),timeout=.2)
  event=threading.Event();event.set()
  with self.assertRaises(service.Cancelled):service.process([sys.executable,"-c","import time;time.sleep(5)"],event)
 def test_eps_vectors(self):
  if not service.ghostscript():self.skipTest("Ghostscript unavailable")
  with tempfile.TemporaryDirectory() as temp:
   src=Path(temp)/"vector.eps";out=Path(temp)/"result.figimport"
   src.write_text("%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 200 200\n1 0 0 setrgbcolor 20 20 moveto 180 20 lineto 180 180 lineto closepath fill\nshowpage\n%%EOF")
   service.convert(src,out)
   with zipfile.ZipFile(out) as z:
    scene=json.loads(z.read("scene.json"));nodes=list(service.iter_nodes(scene["nodes"]))
    self.assertTrue(any(n["kind"]=="vector" for n in nodes));self.assertFalse(any(n["kind"]=="image" for n in nodes))
    self.assertEqual(json.loads(z.read("manifest.json"))["fidelityValidated"],False)
 def test_http(self):
  flags=subprocess.CREATE_NO_WINDOW if os.name=="nt" else 0
  proc=subprocess.Popen([sys.executable,"-u",str(service.ROOT/"helper/service.py"),"serve","--port","47827"],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding="utf-8",creationflags=flags)
  try:
   proc.stdout.readline();token=proc.stdout.readline().strip().split(": ",1)[1]
   def request(path,method="GET",data=None,auth=token,origin="null"):
    return urllib.request.urlopen(urllib.request.Request("http://localhost:47827"+path,data=data,method=method,headers={"Authorization":"Bearer "+auth,"Origin":origin}),timeout=20)
   self.assertEqual(json.load(request("/capabilities"))["version"],2)
   with self.assertRaises(urllib.error.HTTPError) as e:request("/capabilities",auth="bad")
   self.assertEqual(e.exception.code,401)
   with self.assertRaises(urllib.error.HTTPError) as e:request("/capabilities",origin="https://hostile.invalid")
   self.assertEqual(e.exception.code,403)
   jid=json.load(request("/jobs?name=broken.pdf","POST",b"broken PDF"))["id"]
   for _ in range(40):
    state=json.load(request("/jobs/"+jid))
    if state["state"] in ("error","cancelled"):break
    time.sleep(.1)
   self.assertEqual(state["state"],"error");request("/jobs/"+jid,"DELETE")
   with self.assertRaises(urllib.error.HTTPError) as e:request("/jobs/"+jid)
   self.assertEqual(e.exception.code,404)
  finally:
   proc.terminate()
   try:proc.wait(timeout=10)
   except subprocess.TimeoutExpired:proc.kill();proc.wait()
   proc.stdout.close();proc.stderr.close()
if __name__=="__main__":unittest.main()

