# 社区版验证范围

当前测试均从 community/ 执行。浏览器测试使用真实内嵌 Ghostscript WASM、实际 code.js / ui.html 与严格节点 API 模拟环境；该环境不是 Figma 渲染器。真实字体字形、布局和复杂效果仍需在 Figma 核对。

| 测试 | 范围 |
| --- | --- |
| npm test | 类型、PDF 指令、PSD 几何、可编辑文字、渐变文字、矢量叠加、内存预检及提示分类 |
| npm run test:responsive | 大字体列表、选择缓存、字体 API 挂起/超时、创建阶段取消、迟到结果及重新导入 |
| node tests/pdf-batch.mjs | 重复纹样的安全边界、几何与像素对照、批量大小限制 |
| npm run test:pdf-text | 真实 PDF 兼容 AI、Unicode、字体替代/加载失败、TJ/段落/缩进/混合样式、多栏边界、裁剪精简、完整字形去重与孔洞保护 |
| npm run test:pdf-semantic | 空 Type3 字形与 Artifact 轮廓替换、原绘制顺序和颜色、装饰保护、隐藏回退提示、原生换行 |
| npm run test:pdf-semantic-sample / test:compiled-semantic | 私有 PDF 的 44 段内容、976 个字形对应、44 个重复轮廓移除、原始图片保留及实际构建包检查 |
| npm run test:browser | 实际 EPS、旧 AI、多页 PS、PDF、二进制 EPS、默认字体提示、取消重试、超时及零网络请求 |
| npm run test:bundle | 内嵌引擎完整性、15 MB 发布限制、代码恢复与损坏提示 |
| npm run test:ui | 固定窗口、导入过程、完成页及最多三类提醒 |

私有 PSD 样本回归通过 PSD_TEXT_SAMPLE、PSD_VECTOR_SAMPLE 或 SAMPLE_DIR 指定样本路径，不将源文件上传到 Figma。历史 PSD 专项修复说明保留在本目录对应文档中。

AI/EPS 文字修复只恢复源文件中仍含有效文字编码的内容。已转曲路径无法推回原文字；文字填充、描边、渐变及文字裁剪均保留 TEXT；编码缺失使用替代字符并明确提示。字体替代、非等比缩放或倾斜会提示核对排版。可使用 AI_PERF_SAMPLE 指定私有样本运行 test:ai-performance / test:compiled-ai，检查源解析、实际构建包和矢量像素。测试报告在 community/.test-output/，发布包在 community/dist/。

本地验证与打包不等于已更新 Figma 社区；需通过现有条目重新发布。

preview.14 的段落与裁剪改动见 [专项验证](PDF-PARAGRAPH-CLIP-FIX.md)。该轮回归使用本地生成的同位置可编辑文字与 charpath 重复轮廓；后来用户提供的真实 PDF 采用不同的空 Type3 语义字体结构，preview.15 的修复与实测见 [PDF 重影复现记录](PDF-SEMANTIC-TEXT-FIX.md)。
