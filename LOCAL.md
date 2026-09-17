# AI / EPS / PSD → Figma（本地自用版）

本说明适用于仓库根目录的 `2.0.0-beta.5`。社区版独立位于 `community/`；仓库结构与两版区别见 [项目首页](README.md)。下文的旧版本修复说明是更新记录，并非需要保留的多个安装目录。

本地解析源文件，优先生成可编辑路径、文字、画板和蒙版。EPS/PostScript 可通过可选 Windows 本机程序增强；整个转换过程不依赖 Adobe，也不使用远程转换服务。

**这是待视觉验收的预览版，不能承诺所有文件与 Photoshop / Illustrator 完全一致。** 插件区分原生可编辑、文字转曲、原始图片、局部栅格化和未支持；保存的参考图不会被当作可编辑导入结果。当前测试结论见 [验收记录](docs/VALIDATION.md)。

已用最新版源码在真实 Figma 中完成 `dribbble-1.psd` 整图回归：1920 × 1200 原尺寸 SSIM **0.9989449**，5 个基础形状最大几何偏移 **0.00009 px**；最终 944 个原生矢量路径，0 图片节点。这个结果只适用于已测样本，不等于所有格式和效果已通过。

## 运行插件

需要 Node.js 22.13+（本次使用 Node.js 24）。

```powershell
npm ci
npm run build
```

在 Figma 桌面端通过开发插件菜单导入根目录的 `manifest.json`，运行插件，选择 AI/PDF、PSD/PSB 或离线转换包。纯 EPS/PS 选择“使用本机增强转换”。

`2.0.0-beta.2` 修复了本机地址导致的 `Invalid value for allowedDomains` 启动错误。清单和插件统一使用 Figma 支持的 `http://localhost:47823`。如果此前导入的是旧压缩包中的清单，请解压新包后重新导入其中的 `manifest.json`。

`2.0.0-beta.4` 修复 PSD 的 `strokeMiterLimit` 超限导致整次导入中断。构建器保留原始斜接值，并适配 Figma 的 1–16 范围；可能影响尖角外观时明确报告，路径和描边继续保持可编辑。此修复也适用于先前生成的 `.figimport` 包，无需重新转换。

`2.0.0-beta.5` 增加窗口版本号、主程序与界面的构建标识核对，以及最终属性写入保护。若 Figma 注册了多个同名开发插件，它们可能指向不同解压目录；更新根目录不会自动更新旧目录。请以窗口中的版本号为准，正在运行的旧窗口需要关闭后重新打开。打包时会校验主程序和界面的哈希，避免混装。

构建产物为 `code.js` 和 `ui.html`。主线程只创建 Figma 节点；PDF.js、PSD 解析和像素编码在 iframe 中运行。PDF.js worker 已内联，不从 CDN 下载。画板按源坐标保留。

## Windows 本机程序

**普通文件和 `.figimport` 离线包直接导入，无需连接码。** 选择 EPS / PS 时插件会保留待导入文件并打开连接引导；其他格式可自行开启“本机增强”。

Windows 用户双击解压目录中的 `启动本机转换.cmd`，在本机窗口点“复制连接码”，回到插件粘贴并点连接。首次缺少转换组件时，窗口提供“安装所需组件并启动”，下载组件到当前文件夹。连接码是每次启动更新的临时密码，不需要注册或手动设置。关闭窗口会停止本机服务并清理临时转换文件。

当前预览版仍需先安装 Python 3.12 和 Node.js；EPS 另需 Ghostscript，尚未制作包含全部运行环境的安装器。首次安装和常见问题见 [本机转换使用说明](本机转换使用说明.html)。以下命令仅供开发者手动准备环境。

需要 Python 3.12、Node.js 和 Ghostscript。Ghostscript 使用系统安装，不随项目打包；可用 `FIGMA_IMPORT_GS` 指定 `gswin64c.exe` 的完整路径。

```powershell
py -3.12 -m venv .venv
.venv/Scripts/python.exe -m pip install -r helper/requirements-lock.txt
npm run build
.venv/Scripts/python.exe helper/service.py serve
```

程序仅监听 `127.0.0.1:47823`，插件通过本机别名 `http://localhost:47823` 访问。每次启动生成新的配对令牌，将终端显示的令牌填入插件。令牌不持久保存到插件。按 Ctrl+C 关闭本机服务。

连接被浏览器或 Figma 网络策略阻止时，使用离线包：

```powershell
.venv/Scripts/python.exe helper/service.py convert "C:/你的目录/设计.eps" "C:/你的目录/设计.figimport"
```

再把 `.figimport` 文件拖入插件。包中含场景、图片资源、参考图、源文件哈希和转换器版本；不含原始 PSD/AI、字体文件或配对令牌。

支持能力检测、任务提交、进度、取消、结果与资源读取。HTTP 接口均需要 Bearer 令牌；上传上限 256 MB。任务超过 180 秒终止子进程。协议见 [场景与服务接口](docs/PROTOCOL.md)。

## 当前转换范围

- PSD 路径修复：按入控制点、锚点、出控制点转换；原生布尔路径、渐变、描边、画板、剪贴和像素/矢量蒙版。
- 智能对象：关联嵌入资源，递归恢复 PDF/SVG/PSD/PSB 内容，保留实例来源。真正的 PNG/JPEG 仍作为原始图片。
- 图层效果：常规阴影、颜色/渐变叠加及形状描边。自定义等高线等不兼容效果会报告差异。
- 纯色形状的矢量蒙版羽化保持原生可编辑；不重复应用同一矢量蒙版的兼容位图通道。满足边界条件的 Subtract / Divide 使用反相填充和等价原生混合；已证明的连续白底 Hard Mix 生成白色矢量并记录背景依赖，改变背景后需要重新转换。
- 文字：精确匹配字体及区间样式；修正变换、字号、段落宽度和字形墨迹位置。缺字体时优先使用本机生成的原字体轮廓，否则明确使用缓存外观。复杂段落、竖排、变形与特殊排版尚未全部覆盖。
- PDF/AI：维护版 PDF.js 6.3.289 的绘制指令转换，保留顺序、变换、裁剪、普通透明组、图片、轴向/同心径向渐变和嵌入字体轮廓。
- EPS/PS：Ghostscript 保留矢量地正规化为 PDF，再经过同一转换链路。不会将 EPS 预览图当成源内容。
- 原生 Figma 无法表达的特殊混合、透明蒙版、网格渐变、图案及挖空组等会报告；只有可独立合成的已覆盖局部对象才允许栅格化。不会自动扩大为整页位图。

**隐藏的可编辑源结构不计作可见结果完全可编辑。** 改动隐藏源结构不会自动重生成烘焙外观，需要再次转换。

## 验证

```powershell
npm test
npm run build
npm run test:browser
.venv/Scripts/python.exe tests/helper_test.py
$env:SAMPLE_DIR = "C:/你的私有样本目录"
npm run test:samples
npm run test:compiled
```

浏览器测试默认使用 Windows Edge，可用 `BROWSER_EXECUTABLE` 指定其他 Chromium 可执行文件。真实样本不在仓库；缺少样本必须报告跳过，不能当作真实样本验收通过。

`test:compiled` 使用完整社区 PSD、实际 `code.js` / `ui.html` 和本机节点测试环境，严格检查斜接值与失败清理。可用 `OLD_PLUGIN_DIR` 指定旧安装目录，对比复现超限报错；该测试不模拟 Figma 的真实渲染，不能作为整图视觉验收。

插件完成页可保存诊断和逐画板验收 ZIP（PNG、源对象 ID、实际节点几何）。离线包可直接用 ZIP 工具解压取出参考图；PSD 参考来自文件保存的合成图，PDF 参考来自 MuPDF，二者会明确区分。对照命令：

```powershell
.venv/Scripts/python.exe helper/compare.py reference.png figma.png --output .test-output/comparison.json

# 或按源对象 ID 自动配对两个包中的画板：
.venv/Scripts/python.exe helper/compare.py design.figimport figma-validation.zip --output .test-output/boards/report.json

# 生成只保存在本机的画板参考图与问题清单：
.venv/Scripts/python.exe helper/review.py design.figimport .test-output/review
```

工具会拒绝尺寸不一致的图片，在黑白两种背景分别计算 SSIM，避免透明白与不透明白被误判为相同，并输出差异比例及热图。可另传 `--geometry points.json` 校验对应几何坐标；没有对应点不会把几何验收算作通过。视觉初始门槛 SSIM ≥ 0.99、几何偏移 ≤ 0.5 px；还需检查文字、遮挡、蒙版及实际编辑操作。

## 分发

`npm run package` 生成开发预览包，使用明确文件清单排除用户样本、字体、测试输出、虚拟环境和运行时二进制。尚未发布社区版本，也未实施收费和 Mac 本机程序。

引擎许可证、源码地址和分发要求见 [第三方许可](licenses/THIRD-PARTY.md)。本机使用的 PyMuPDF/MuPDF 与 Ghostscript 采用 AGPL / 商业双重许可；后续发布带引擎安装包时需要相应的源码与许可证材料或商业授权。当前预览包只分发本项目代码及插件构建物。

