# 发布到 GitHub

## 1. 建立项目自己的仓库

本次检查发现，项目目录内原本没有 `.git`，Git 向上找到的是 `D:/` 仓库。必须先在本项目目录初始化，不能直接在上级仓库执行 `git add .`。

在 PowerShell 中执行：

```powershell
Set-Location -LiteralPath 'D:\WB\导入figma插件'
git init -b main
git rev-parse --show-toplevel
```

最后一行必须显示本项目目录 `D:/WB/导入figma插件`。如果仍显示 `D:/`，先停止提交并检查初始化是否成功。

## 2. 在 GitHub 新建空仓库

登录 GitHub，选择 **New repository**，例如命名为 `figma-design-importer`。不要勾选生成 README、`.gitignore` 或 License，项目已有前两者。

当前项目还没有确定自身开源许可证，社区版的现有许可文档也记录了引擎对应源码交付待办。可先创建 Private 仓库存档；公开发布前处理 [现有许可待办](../community/licenses/THIRD-PARTY.md)。这次整理没有改变授权状态。

## 3. 检查并提交源码

```powershell
git add .
git status --short
git diff --cached --stat
```

应看到两版源码、锁文件、测试、说明、许可、社区素材与 `community/vendor/ghostscript/` 引擎。依赖目录、Python 虚拟环境、历史归档、ZIP、测试输出及生成的插件入口文件均应被忽略。

确认清单后提交并关联仓库。将下面地址中的用户名和仓库名替换为实际值：

```powershell
git commit -m "Organize local and community editions"
git remote add origin https://github.com/YOUR_NAME/figma-design-importer.git
git remote -v
git push -u origin main
```

如 Git 提示缺少作者信息，可先在当前仓库执行 `git config user.name "你的名字"` 和 `git config user.email "你的 GitHub 提交邮箱"`，再重新提交。首次推送按 Git 凭据管理器提示登录 GitHub。

以上初始化、创建空仓库和推送流程依据 [GitHub 官方指南](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)。本次整理没有代你创建仓库或推送。

## 4. 发布可下载版本

在根目录执行：

```powershell
npm run package
npm --prefix community run package
```

| 用途 | 文件 |
| --- | --- |
| 本地自用版 | `dist/figma-import-2.0.0-beta.5.zip` |
| 社区版开发插件包 | `community/dist/figma-import-community-2.1.0-preview.7-plugin.zip` |
| 社区版项目源码与引擎包 | `community/dist/figma-import-community-2.1.0-preview.7-source.zip` |

在 GitHub 仓库的 Releases 中分别建立 `local-v2.0.0-beta.5` 和 `community-v2.1.0-preview.7` 标签对应的发布条目，附上对应 ZIP 与版本说明。当前版本仍为预览版，可标记为 Pre-release。ZIP 不提交到源码目录；Git 历史和 Releases 承担版本保存用途。

社区源码 ZIP 的内容范围见该版许可说明，它不是完整 GhostPDL 上游源码交付包。

GitHub 上传不会自动发布到 Figma 社区。Figma 发布继续使用 `community/manifest.json` 及同目录构建物，文案和图片位于 `community/publish-kit/`。

## 日后更新

修改对应版本源码 → 运行该版测试 → 构建及打包 → Git 提交与推送 → 按需新增 Release。两版共享的修复需要分别同步和验证，不再复制整套历史源码目录。
