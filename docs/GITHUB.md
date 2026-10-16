# 社区版构建与发布

项目仓库根目录为 D:/WB/导入figma插件，只维护 community/。从根目录执行：

```powershell
npm --prefix community ci
npm test
npm run build
npm run test:bundle
npm run test:browser
npm run test:ui
npm run package
```

打包输出：

- community/dist/figma-import-community-2.1.0-preview.13-plugin.zip：Figma 开发插件测试包。
- community/dist/figma-import-community-2.1.0-preview.13-source.zip：项目源码与内嵌引擎。

在 Figma 桌面端通过 community/manifest.json 测试，确认后使用既有插件 ID 更新社区条目。发布所需清单、code.js、ui.html 均在 community/；构建和打包会检查合计体积小于 15,000,000 字节。发布素材位于 community/publish-kit/。

Git 提交前检查 git status --short 和 git diff --stat。源码、锁文件、测试、许可、素材及固定引擎进入仓库；依赖、真实样本、测试输出、生成的入口文件和 ZIP 均被忽略。GitHub Release 可使用 community-v2.1.0-preview.13 标签并附加两个 ZIP。GitHub 上传与 Figma 社区发布需要分别操作。

项目许可状态及引擎对应源码交付事项见 [第三方组件说明](../community/licenses/THIRD-PARTY.md)。源码 ZIP 的范围以该说明为准。
