"""Windows companion window. Pairing stays manual; no unauthenticated token endpoint."""
from __future__ import annotations
import importlib.metadata, os, queue, shutil, subprocess, sys, threading, time, webbrowser
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
FLAGS=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0
GUIDE=ROOT/'本机转换使用说明.html'
try:
    import tkinter as tk
    from tkinter import ttk
except ImportError:
    if __name__=='__main__':webbrowser.open(GUIDE.as_uri());sys.exit(1)
    raise

def node_runtime():
    node=shutil.which('node')
    if not node:return None
    try:
        version=subprocess.run([node,'-p','process.versions.node'],capture_output=True,text=True,timeout=10,creationflags=FLAGS).stdout.strip()
        return node if tuple(map(int,version.split('.')[:2])) >= (22,13) else None
    except (OSError,ValueError,subprocess.TimeoutExpired):return None

def missing_components():
    missing=[]
    if sys.version_info[:2] != (3,12):missing.append('Python 3.12')
    node=node_runtime()
    if not node:missing.append('Node.js 22.13 或更新版本（建议 24）')
    for line in (ROOT/'helper/requirements-lock.txt').read_text('utf-8').splitlines():
        name,version=line.split('==')
        try:installed=importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:installed=None
        if installed!=version:
            missing.append('Python 转换组件');break
    if node:
        try:
            probe=subprocess.run([node,'--input-type=module','-e',"await import('@napi-rs/canvas'); await import('./helper/parser.mjs');"],cwd=ROOT,capture_output=True,timeout=20,creationflags=FLAGS)
            if probe.returncode:missing.append('文件解析组件')
        except (OSError,subprocess.TimeoutExpired):missing.append('文件解析组件')
    return missing

def setup_commands():
    """Only install into this extracted package. Never modify system Python."""
    node=node_runtime()
    if not node:raise RuntimeError('请先按使用说明安装 Node.js，然后重新打开本窗口。')
    if sys.version_info[:2] != (3,12):raise RuntimeError('请先按使用说明安装 Python 3.12。')
    npm=Path(node).parent/'node_modules/npm/bin/npm-cli.js'
    if not npm.is_file():raise RuntimeError('未找到 npm，请重新安装包含 npm 的 Node.js。')
    python=ROOT/'.venv/Scripts/python.exe'
    commands=[]
    if not python.exists():commands.append(([sys.executable,'-m','venv',str(ROOT/'.venv')],'创建独立运行环境'))
    commands += [([str(python),'-m','pip','install','-r',str(ROOT/'helper/requirements-lock.txt')],'下载并安装转换组件'),
                 ([node,str(npm),'ci','--ignore-scripts','--no-audit','--no-fund'],'下载并安装文件解析组件')]
    return commands

class Companion:
    def __init__(self, root, *, autostart=True):
        self.root=root;self.events=queue.Queue();self.stop=threading.Event();self.worker=None;self.closing=False;self.code=''
        root.title('Figma 导入 · 本机转换');root.geometry('590x470');root.minsize(550,450)
        root.option_add('*Font',('Microsoft YaHei UI',10))
        panel=ttk.Frame(root,padding=24);panel.pack(fill='both',expand=True)
        ttk.Label(panel,text='连接 Figma 插件',font=('Microsoft YaHei UI',16,'bold')).pack(anchor='w')
        ttk.Label(panel,text='此窗口运行时，插件才能使用本机增强转换。',wraplength=510).pack(anchor='w',pady=(8,18))
        self.status=tk.StringVar(value='正在检查运行环境…')
        ttk.Label(panel,textvariable=self.status,wraplength=510).pack(anchor='w',pady=(0,14))
        self.value=tk.StringVar()
        self.entry=ttk.Entry(panel,textvariable=self.value,state='readonly');self.entry.pack(fill='x')
        self.copy=ttk.Button(panel,text='复制连接码',command=self.copy_code,state='disabled');self.copy.pack(anchor='w',pady=(10,14))
        ttk.Label(panel,text='复制后回到 Figma → 开启“本机增强” → 粘贴连接码 → 点击连接。\n这是临时密码，无需注册；关闭并重开本程序后连接码会更新。',wraplength=510).pack(anchor='w')
        self.prepare=ttk.Button(panel,text='安装所需组件并启动',command=self.install)
        self.hint=tk.StringVar(value='文件只在本机转换。导入结果会进入当前 Figma 文件。')
        ttk.Label(panel,textvariable=self.hint,wraplength=510).pack(anchor='w',pady=16)
        bottom=ttk.Frame(panel);bottom.pack(side='bottom',fill='x')
        ttk.Button(bottom,text='查看使用说明',command=lambda:webbrowser.open(GUIDE.as_uri())).pack(side='left')
        ttk.Button(bottom,text='关闭本机程序',command=self.close).pack(side='right')
        root.protocol('WM_DELETE_WINDOW',self.close)
        root.after(100,self.poll)
        if autostart:self.run(self.check_and_start)

    def run(self,work):
        if self.worker and self.worker.is_alive():return
        def wrapped():
            try:work()
            except Exception as exc:
                detail='已有本机程序使用此端口，请回到原窗口复制连接码；或关闭原窗口后重试。' if isinstance(exc,OSError) and exc.errno in (48,98,10048) else str(exc)
                self.events.put(('error',detail))
        self.worker=threading.Thread(target=wrapped,daemon=False);self.worker.start()

    def check_and_start(self):
        missing=missing_components()
        if self.stop.is_set():return
        if missing:self.events.put(('missing','、'.join(missing)));return
        from service import serve
        serve(47823,on_ready=lambda token,cap:self.events.put(('ready',(token,cap))),stop_event=self.stop)

    def copy_code(self):
        if not self.code:return
        self.root.clipboard_clear();self.root.clipboard_append(self.code)
        self.copy.configure(text='已复制，回到 Figma 粘贴')

    def install(self):
        if self.worker and self.worker.is_alive():return
        self.prepare.configure(state='disabled');self.status.set('正在准备…首次运行需要下载组件，请稍候。')
        def setup():
            for args,label in setup_commands():
                if self.stop.is_set():return
                self.events.put(('status',label+'…'))
                # Logs are local, do not include source files or pairing codes.
                with (ROOT/'helper-setup.log').open('ab') as log:
                    proc=subprocess.Popen(args,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,creationflags=FLAGS)
                    started=time.monotonic()
                    while proc.poll() is None:
                        if self.stop.wait(.2) or time.monotonic()-started>1200:
                            proc.kill();proc.wait()
                            if self.stop.is_set():return
                            raise RuntimeError('组件下载超时。请检查网络后重试，详情见 helper-setup.log。')
                    if proc.returncode:raise RuntimeError('组件安装未完成。请检查网络后重试，详情见插件文件夹中的 helper-setup.log。')
            if not self.stop.is_set():self.events.put(('restart',None))
        self.run(setup)

    def poll(self):
        while not self.events.empty():
            kind,data=self.events.get()
            if self.closing:continue
            if kind=='ready':
                self.code,cap=data;self.value.set(self.code);self.copy.configure(state='normal');self.prepare.pack_forget()
                self.status.set('已启动，可以连接。支持 EPS / PS / AI / PDF / PSD。' if cap['ghostscript'] else '已启动，可以连接。EPS / PS 还需安装 Ghostscript，见使用说明。')
            elif kind=='missing':
                self.status.set('首次使用，尚需准备：'+data)
                self.hint.set('先安装 Python 3.12 和 Node.js（见使用说明）。点击下方按钮会从 PyPI / npm 下载组件到此插件文件夹，不上传设计文件。')
                self.prepare.pack(anchor='w',pady=10);self.prepare.configure(state='normal')
            elif kind=='error':
                self.status.set('未能启动：'+data);self.prepare.configure(state='normal')
            elif kind=='status':self.status.set(data)
            elif kind=='restart':
                subprocess.Popen([str(ROOT/'.venv/Scripts/pythonw.exe'),str(ROOT/'helper/desktop.py')],cwd=ROOT,creationflags=FLAGS)
                self.close();return
        if self.closing and (not self.worker or not self.worker.is_alive()):self.root.destroy();return
        self.root.after(100,self.poll)

    def close(self):
        self.closing=True;self.stop.set();self.copy.configure(state='disabled');self.prepare.configure(state='disabled')
        self.status.set('正在停止转换并清理临时文件…')

if __name__=='__main__':
    try:root=tk.Tk()
    except tk.TclError as exc:
        (ROOT/'helper-start.log').write_text(str(exc),encoding='utf-8')
        webbrowser.open(GUIDE.as_uri());sys.exit(1)
    Companion(root);root.mainloop()
