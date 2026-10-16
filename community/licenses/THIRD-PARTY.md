# 社区版第三方组件

| 组件 | 固定版本 | 许可 |
|---|---|---|
| PDF.js | 6.3.289 | Apache-2.0 |
| ag-psd | 31.0.2 | MIT |
| fflate | 0.8.2 | MIT |
| svgpath | 2.6.0 | MIT；https://github.com/fontello/svgpath |
| @okathira/ghostpdl-wasm | 1.1.0 | AGPL-3.0-or-later |
| 内置 Ghostscript | 10.06.0 | AGPL；商业授权由 Artifex 提供 |

本目录保留已有许可正文。Ghostscript 的 npm 包、引擎二进制及源码提交校验值记录在 GHOSTSCRIPT-WASM.json。原始 gs.js 和 gs.wasm 未修改；加载适配器、内嵌压缩、后台任务和取消逻辑属于本项目新增代码。vendor/ghostscript/compile.sh 是固定提交的原始构建脚本，未执行。

## 对应源码与发布

- WASM 包源码：<https://github.com/okathira-dev/ghostpdl-wasm/tree/a62b7d686b21cf88f6425b3e989d1062b9af4256>
- GhostPDL 子模块源码：<https://github.com/ArtifexSoftware/ghostpdl/tree/2d6e764c1f4a73520ed6de6dd3fa78ad30cd6a63>
- 上游构建环境：Emscripten 4.0.13；具体参数见原始 compile.sh 和上游发布工作流。
- 官方许可说明：<https://ghostscript.com/licensing/>、<https://artifex.com/licensing/>

当前产物供本地验证，未替项目所有者作开源授权决定，也未发布到社区。公开分发前，需落实适用的 AGPL 开源授权、通知和完整对应源码交付，或适用商业授权。仅附带此说明、上游 URL 或构建脚本不能替代完整对应源码。源码测试包包含本项目源码、供应商二进制和来源资料，不包含 GhostPDL 全部源码树。

社区版不使用或分发原本机程序的 PyMuPDF、Python 运行时、psd-tools、系统字体或 Ghostscript 原生可执行文件。开发测试使用的 @napi-rs/canvas 不进入插件构建。
