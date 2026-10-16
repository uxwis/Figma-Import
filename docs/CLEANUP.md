# 单一社区版维护记录

2026-10-16：仅保留 community/ 作为产品源码与发布入口。

删除旧根目录产品源码、构建脚本、清单、重复许可与测试，删除 Windows 转换启动器、HTML 说明、LOCAL.md、helper/ Python 服务及 .venv/。删除旧根目录构建物、测试输出和归档中确认属于自用版的历史副本、脚本与打包文件。原归档中的小型原始样本保留在忽略提交的 community/test-assets/，社区历史产物保留在 community/.cleanup-archive/，均不作为维护或发布入口。

根目录依赖移入 community/node_modules/，产品依赖与锁文件只维护 community/package.json 和 community/package-lock.json。根目录 npm 脚本仅转发社区版命令。

保留 Git 历史、社区版已有未提交的 PSD 修复、社区发布素材、第三方许可和固定版本 Ghostscript WASM。更新开发、协议和发布文档，移除旧服务接口及双版本维护步骤。

唯一 Figma 开发入口是 community/manifest.json。旧根目录开发插件注册需在 Figma 内移除；当前工作区已没有可运行的旧版入口。
