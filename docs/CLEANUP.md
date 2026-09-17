# 目录整理记录

整理日期：2026-09-17。

## 保留的两套版本

- 根目录：本地自用版 `2.0.0-beta.5`，保留 Windows 本机服务与现有运行环境。
- `community/`：Figma 社区版 `2.1.0-preview.7`，保留内嵌引擎、独立测试与社区发布素材。
- 未修改解析器及 Figma 节点构建逻辑，也未合并两版源码。依赖、锁文件、第三方许可及供应商引擎均保留。

## 移出日常开发目录的内容

- 根目录 `dist/` 下 beta.1–beta.5 的历史包与解压副本。
- `community/dist/` 下 preview.3–preview.7 的历史包与解压副本。
- `releases/` 中的本地版重复快照。
- 两版旧 `.test-output/`、Python 字节码缓存及旧 `test-assets/`。
- 根目录的 `.debug.mjs`、`.inspect-pdf.mjs`、`diag-psd.mjs`、`test-parse.mjs`、`test-convert.mjs`。
- `build-{both,fallback,render}-test.mjs`、`run-{both,fallback,render}-test.cjs` 及其三个生成 bundle。这些早期脚本引用旧 API、旧 PDF.js 入口或固定机器路径；当前回归测试位于 `tests/` 和 `community/tests/`。
- 重复的 `community/figma-community-publish-kit.zip`；完整发布素材文件夹继续保留。

以上共 394,712,392 字节（约 376.4 MiB）已归档至 `.cleanup-archive/2026-09-17/`，相对路径不变，清单为该目录内的 `inventory.json`。自动审批拒绝了批量永久删除，因此采用可恢复归档，**未释放这部分磁盘空间**。归档通过 `.gitignore` 排除，也不在打包白名单内。

需要恢复时，从归档中取出对应文件；恢复同名文件前核对现有版本，避免覆盖后来修改。旧测试结论继续保留在 `docs/VALIDATION.md`。

## GitHub 内容边界

- 提交源码、锁文件、构建/测试脚本、必要引擎、许可和发布素材。
- 忽略 `node_modules/`、`.venv/`、`.workbuddy/`、本机归档、测试输出、ZIP 和生成的 `code.js` / `ui.html` / `build-info.json` / `helper/parser.mjs`。
- 根目录 README 改为两版导航；原本地版说明保留为 `LOCAL.md`。本地版打包脚本同步包含 `LOCAL.md`。
- 旧 `dist/` 的 Figma 开发注册需要改为根目录或 `community/` 的固定清单；没有改写 Figma 的注册配置。

## 整理后验证

- 本地版：类型检查、20 项核心检查、生产构建与打包通过。
- 社区版：类型检查、24 项核心检查、5 组预检/提示检查、生产构建与两种打包通过。
- 社区内嵌数据无损还原、完整引擎校验、发布体积限制及受限浏览器加载失败提示通过。
- 社区发布三文件总计 14,803,993 字节，小于构建器设置的 15,000,000 字节上限。
- 使用独立的临时 Git 元数据验证忽略规则，未触碰 `D:/` 上级仓库的索引。需要的源码模板与供应商引擎没有被忽略，归档、依赖、测试输出、生成物均不在上传清单内。
- 新增 `.gitattributes` 固定源码换行，并保持供应商原始字节，避免 Windows Git 换行转换改变引擎校验值。
- 两版浏览器回归均通过：本地版 PDF 与本机连接引导；社区版实际 EPS/PS、旧 AI、PDF、离线包、错误处理、取消/重试、超时及字体提示，社区转换测试网络请求数为 0。
- 最终 Git 上传清单为 156 个文件，约 17.3 MB（未压缩）。
- 没有重新执行私有完整样本或真实 Figma 视觉验收。
