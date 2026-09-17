# Figma Community 发布素材

适用版本：`community` 社区版 `2.1.0-preview.6`。整理日期：2026-09-17。

## 直接填写

| 发布字段 | 使用内容 |
| --- | --- |
| Name（建议） | PDF / AI / EPS / PSD Importer · 导入器 |
| Tagline | 复制 `tagline.txt` |
| Description | 复制 `description.txt`，已按中文在前、英文在后排列 |
| Thumbnail | `thumbnail-1920x1080.png` |
| Upload at least 1 image or video | 依次上传 `gallery-01-workflow-1920x1080.png`、`gallery-02-formats-1920x1080.png`、`gallery-03-layers-1920x1080.png` |
| Icon（另附） | `icon-128x128.png` |
| Category（建议） | Design tools，子分类按发布表单的实际选项选择 |
| Tags（如表单提供） | `pdf import`、`illustrator`、`eps`、`photoshop`、`file converter` |
| Support contact | 填写你自己的支持邮箱、网站或帮助中心链接 |

“Upload at least 1 image or video” 表示图片和视频任选其一；这套素材使用 PNG 展示图即可。图片均为 1920 × 1080 像素，无需再裁切。第 01 张是推荐的首张展示图。

双击 `index.html` 可一次预览全部素材、复制文案和下载图片。`tagline.txt` 为 53 个 Unicode 字符（不含换行），短句便于社区列表显示；实际长度限制以发布表单为准。

## 图像内容

- Thumbnail：格式名称与导入用途，保留较大的文字便于缩略显示。
- Gallery 01：当前插件界面与三步使用流程。
- Gallery 02：PDF、AI、EPS / PS、PSD / PSB 的支持条件及文件大小限制。
- Gallery 03：导入内容结构示意，以及字体和复杂效果的兼容说明。
- Icon：原创图层符号，128 × 128 PNG。

宣传图采用统一的紫色、米白和淡绿色。封面与第 03 张的插画为原创功能示意，已在图内标注；它们不是实测导入结果，也不是 Figma 产品界面截图。第 01 张中的插件内容来自现有 `code.js` 和 `ui.html` 的浏览器渲染截图，未重画、翻译或添加不存在的插件功能；外侧窗口标题栏仅用于展示排版。

素材没有使用仓库外的用户设计样本，也没有引用未经确认的还原率、导入速度、收费或用户量。

## 可修改源文件

- `source/build-assets.mjs`：封面、展示图、图标以及预览页的生成源文件。
- `source/pages/`：每张图片的独立 HTML 排版文件。
- `assets/plugin-home.png` / `assets/plugin-instructions.png`：当前插件原始界面截图，2 倍像素密度。
- `assets/verification.json`：输出图像尺寸与文件大小记录。

在项目根目录重新生成：

```powershell
node community/publish-kit/source/capture-plugin.mjs
node community/publish-kit/source/build-assets.mjs
```

图像按代码原生排版生成；文字、颜色、布局和 SVG 插画可在源文件中继续修改。

## 依据

功能与限制依据本地 `community/README.md`、`community/src/ui.ts`、`community/src/conversion-limits.ts` 和 `community/manifest.json`。未改动插件代码、名称或发布状态。

Figma 官方说明建议图标为 128 × 128，缩略图为 1920 × 1080，并支持图片或视频轮播；发布时需提供支持联系方式。参见 [Publish classic plugins to the Figma Community](https://help.figma.com/hc/en-us/articles/360042293394-Publish-classic-plugins-to-the-Figma-Community)。展示图尺寸与标签建议参见 [Grow your audience on Community](https://help.figma.com/hc/en-us/articles/22166943560983-Grow-your-audience-on-Community)。
