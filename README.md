# FigImport · PDF / AI / EPS / PSD → Figma

本仓库只维护 Figma 社区版，源码、依赖、测试、许可及发布产物统一位于 community/。插件内置转换引擎，无需安装本机转换服务。

唯一 Figma 开发入口：[community/manifest.json](community/manifest.json)。在 Figma 中移除旧的根目录开发插件注册，改为导入此清单。

## 开发与打包

需要 Node.js 22.13+。从仓库根目录执行：

```powershell
npm --prefix community ci
npm test
npm run build
npm run test:browser
npm run package
```

根目录 package.json 仅将命令转发到社区版，没有独立源码、依赖或构建产物。插件包与源码包生成到 community/dist/，社区发布素材位于 community/publish-kit/。

当前修复版本为 2.1.0-preview.15：补上空 Type3 字形携带 Unicode、另用路径显示文字的 PDF 重影处理。完整匹配的源文字轮廓由原生可编辑 TEXT 替换，保留段落及绘制顺序；无法匹配的语义文字隐藏并明确提示。继续保留段落合并、默认字体替代提示、裁剪精简及重复纹样加速。已经转曲且没有有效编码的源路径不能自动还原文字。

详细范围见 [社区版说明](community/README.md)，发布操作见 [发布指南](docs/GITHUB.md)，测试说明见 [验证记录](docs/VALIDATION.md)，清理范围见 [目录整理记录](docs/CLEANUP.md)。本地构建不会自动更新已上线的社区条目。

第三方许可及引擎来源保留在 [community/licenses](community/licenses/THIRD-PARTY.md)。项目自身的开源许可尚未确定，现有授权状态未改变。
