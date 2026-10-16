# GitHub 操作入口

本仓库只维护社区版。构建、测试、打包及发布步骤统一见 [社区版构建与发布](GITHUB.md)。

在项目根目录检查并提交当前变更：

```powershell
git rev-parse --show-toplevel
git status --short
git diff --stat
git add .
git diff --cached --stat
git commit -m "Preserve editable AI/EPS text and maintain community edition only"
git push
```

执行前核对仓库根目录与待提交文件清单。Git 历史保留；依赖、样本、生成文件和 ZIP 不提交。此文档中的命令仅供手动执行，本次修复没有自动提交或推送。
