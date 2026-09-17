# PDF / AI / EPS / PSD → Figma

将设计文件导入 Figma，保留可解析的图层、路径、文字与画板。仓库维护两种版本，分别独立构建；版本号中的 beta / preview 是迭代编号，不是额外产品。

| 版本 | 目录 / Figma 开发入口 | 当前版本 | 使用方式 |
| --- | --- | --- | --- |
| 本地自用版 | 根目录 / `manifest.json` | `2.0.0-beta.5` | 可选 Windows 本机转换服务，支持离线转换包 |
| Figma 社区版 | `community/` / `community/manifest.json` | `2.1.0-preview.7` | 转换引擎内嵌，无需本机服务 |

本地版沿用根目录，保持已有 Figma 注册路径、启动脚本和 Python 环境有效。两版源码相互独立；修改解析器时需要分别验证，不能直接互相覆盖构建文件。两个清单目前沿用同一个插件 ID，切换时核对清单路径和插件标题。

## 目录

```text
.
├── README.md               仓库总览
├── LOCAL.md                本地版使用、开发与验证说明
├── manifest.json           本地版入口
├── src/                    本地版源码
├── helper/                 Windows 本机转换服务
├── tests/                  本地版回归与 Figma 验收工具
├── scripts/                本地版打包脚本
├── docs/                   协议、验收记录、GitHub 发布说明
├── licenses/               本地版第三方许可
├── community/
│   ├── README.md           社区版使用与构建说明
│   ├── manifest.json       社区版入口
│   ├── src/                社区版源码
│   ├── tests/              社区版测试
│   ├── scripts/            打包与发布体积检查
│   ├── vendor/ghostscript/ 必需的固定版本 WASM 引擎
│   ├── licenses/           社区版许可与引擎来源
│   └── publish-kit/        Figma 社区发布文案、图片及生成源码
└── 启动本机转换.cmd         本地版启动入口
```

`node_modules/`、`.venv/`、`.test-output/`、`dist/` 和构建出的 `code.js`、`ui.html`、`build-info.json` 仅供本机使用，已从 Git 提交中排除。源码模板 `src/ui.html` 和供应商引擎文件仍保留。历史产物归档于 `.cleanup-archive/`，不进入 GitHub 或发布包。

## 构建

开发环境需要 Node.js 22.13+。从仓库根目录执行：

```powershell
# 本地版
npm ci
npm run build
npm test

# 社区版（独立安装依赖）
npm --prefix community ci
npm --prefix community run build
npm --prefix community test
```

构建后在 Figma 中导入对应的 `manifest.json`。从 GitHub 下载源码后须先构建；若曾注册 `dist/` 下的历史副本，请移除旧注册并改用上述固定入口。

## 打包与发布

```powershell
npm run package
npm --prefix community run package
```

本地版包生成到 `dist/`；社区插件包和源码包生成到 `community/dist/`。ZIP 放到 GitHub Releases，源码进入 Git 仓库。社区发布素材在 [community/publish-kit](community/publish-kit/README.md)。

详细操作见 [GitHub 发布指南](docs/GITHUB.md)，整理范围见 [目录整理记录](docs/CLEANUP.md)。

## 功能范围与许可

复杂效果、字体和专有结构仍有兼容限制，详见 [本地版说明](LOCAL.md)、[社区版说明](community/README.md) 和 [历史验收记录](docs/VALIDATION.md)。源码整理与自动化测试不等于完成真实 Figma 的所有文件验收。

项目自身的开源许可尚未确定。第三方许可资料保留在两版的 `licenses/` 内；社区版内置引擎的现有授权及对应源码交付待办见 [社区版第三方组件](community/licenses/THIRD-PARTY.md)。本次整理未替项目所有者添加新的授权声明。
