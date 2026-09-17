# 第三方许可与分发材料

本项目准备源码可审阅的预览分发；实际社区发布及含引擎的安装包尚未执行。

| 组件 | 当前固定版本 | 许可证 / 源码 |
|---|---|---|
| PDF.js | 6.3.289 | Apache-2.0；https://github.com/mozilla/pdf.js |
| ag-psd | 31.0.2 | MIT；https://github.com/Agamnentzar/ag-psd |
| fflate | 0.8.2 | MIT；https://github.com/101arrowz/fflate |
| @napi-rs/canvas | 见 package-lock.json | MIT；https://github.com/Brooooooklyn/canvas |
| PyMuPDF / MuPDF | 1.28.2 | AGPL-3.0 / Artifex 商业许可；https://github.com/pymupdf/PyMuPDF |
| Ghostscript | 系统检测；本机测试 9.55.0 | AGPL-3.0 / Artifex 商业许可；https://github.com/ArtifexSoftware/ghostpdl-downloads |
| psd-tools | 1.19.0 | MIT；https://github.com/psd-tools/psd-tools |
| fontTools | 4.65.0 | MIT；https://github.com/fonttools/fonttools |
| uharfbuzz | 0.56.1 | MIT；https://github.com/harfbuzz/uharfbuzz |

其余 Python 与 Node 依赖的精确版本分别记录在 helper/requirements-lock.txt 与 package-lock.json。

此目录保留相关许可文本。当前预览包不包含 Ghostscript、MuPDF 动态库、Python/Node 运行时、site-packages、字体和用户文件，只分发项目源代码、插件构建物和安装说明。

后续若分发附带 AGPL 引擎的安装包，需要按实际版本准备对应源码、构建/修改说明和许可材料，或取得相应商业授权；仅链接上游主页不能替代适用的对应源码交付义务。源代码收费与引擎许可是两个事项，收费设计后续实施。当前不对既有业务代码另行作公开授权或发布。

