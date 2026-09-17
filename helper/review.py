"""Create a local-only reference gallery and issue checklist from a conversion package."""
import argparse, html, json, zipfile
from pathlib import Path

def review(package, output):
    output=Path(output).resolve();output.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(package) as archive:
        manifest=json.loads(archive.read('manifest.json'))
        if manifest.get('schema')!='figma-import-package':raise ValueError('不是转换包')
        scene=json.loads(archive.read(manifest['scene']))
        cards=[];boards=[]
        for i,ref in enumerate(manifest.get('references',[])):
            target=output/f'artboard-{i+1}.png';target.write_bytes(archive.read(ref['path']))
            issues=[d for d in scene.get('diagnostics',[]) if d.get('message') and d.get('sourceId','').startswith(ref.get('sourceId','')+'/')]
            boards.append({**ref,'reference':target.name,'issues':issues})
            rows=''.join('<li><b>'+html.escape(d.get('name',''))+'</b>：'+html.escape(d['message'])+'<small>'+html.escape(d['sourceId'])+'</small></li>' for d in issues)
            cards.append('<article><h2>'+html.escape(ref.get('name',str(i+1)))+'</h2><p>'+str(ref['width'])+' × '+str(ref['height'])+' · '+html.escape(ref.get('origin',''))+'</p><a href="'+target.name+'"><img src="'+target.name+'"></a><ul>'+rows+'</ul></article>')
        warnings=''.join('<li>'+html.escape(w)+'</li>' for w in scene.get('warnings',[]))
        report={'source':manifest['source'],'boards':boards,'warnings':scene.get('warnings',[]),'fidelityValidated':False}
        (output/'review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        page='''<!doctype html><html lang="zh"><meta charset="utf-8"><title>本机画板验收</title>
<style>body{font:15px/1.6 system-ui;margin:32px;background:#f4f5f7;color:#172033}h1{margin:0}header{max-width:1100px;margin:auto auto 24px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px}article{background:white;padding:20px;border-radius:12px}img{max-width:100%;max-height:680px;object-fit:contain;display:block;margin:auto}h2{font-size:19px}p,small{color:#536078}small{display:block;overflow-wrap:anywhere}li{margin:8px 0}code{background:#e9edf2;padding:2px 5px}</style>
<header><h1>本机画板验收</h1><p>下方是转换包的源参考图，尚未与您导入 Figma 后的结果比较。所有内容仅保存在本机。</p>
<ol><li>在开发插件中选择对应的 .figimport 离线转换包。</li><li>保存插件诊断，点击“逐画板导出验收包”，取得 <code>figma-validation.zip</code>。</li><li>按项目 README 的对照命令比较两个包，再检查热图、文字、蒙版和图层编辑。</li></ol><p>原生白底混合依赖背景；文字缺精确字体时会使用标记的轮廓或缓存。未通过的效果仍需修复。</p><ul>'''+warnings+'</ul></header><main>'+''.join(cards)+'</main></html>'
        (output/'index.html').write_text(page,encoding='utf-8')
        return {'artboards':len(boards),'warnings':len(scene.get('warnings',[])),'gallery':str(output/'index.html')}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('package');p.add_argument('output');a=p.parse_args();print(json.dumps(review(a.package,a.output),ensure_ascii=False))
