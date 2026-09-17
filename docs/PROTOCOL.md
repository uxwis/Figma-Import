# 场景 v2 与本机接口

`src/types.ts` 是 TypeScript 场景协议；`ParseResult.version` 固定为 2。节点为 bottom-to-top 绘制顺序。几何以左上角坐标和源单位表示，矩阵为 [a,b,c,d,e,f]；图片保留资源 ID，二进制存在资源表中。

节点包含源对象 ID、来源类型/资源实例 ID、可见性、透明度、混合、效果和保真状态。保真状态区分 editable、outlined-text、original-image、rasterized、unsupported。recovery 表示隐藏关联源结构；其后代不计入可见导入统计。构建器生成的诊断包含实际 Figma nodeId，解析候选节点不会冒充已创建节点。

Figma relativeTransform 不能直接保存缩放，构建器将完整仿射变换写入路径/图片填充；局部 SVG 使用受控矩阵包装。分组结构与绘制顺序由场景表达，不依赖整页 SVG。效果尺寸在包含它的父坐标空间中定义。

创建结果中的 `stats` 统计成功创建的场景对象；`nativeStats` 遍历最终 Figma 树，包含 SVG 展开的子路径。带图片填充的 Vector 仍计作图片，隐藏 recovery 子树不计入这些统计。界面展示 `nativeStats` 的路径数量，不能将路径数理解为原始图层数量。

验收导出 ZIP 的 schema 为 `figma-export-package`：`manifest.json` 记录各画板 sourceId，`renders/*.png` 为原尺寸图，`geometry.json` 为实际节点边界。对照脚本按 sourceId 匹配转换包参考图，不依赖画板顺序。

## 离线包

ZIP 容器使用 `.figimport` 扩展名：
- manifest.json：schema = figma-import-package，version = 2，scene 路径，源哈希，参考图与引擎版本，fidelityValidated = false。
- scene.json：场景 v2；resources 对应包内资源路径。
- resources/*：原始图片、像素蒙版或明确标记的局部外观。
- references/*：保存的 PSD 合成图或 MuPDF 参考；不进入可编辑场景。

插件拒绝非法包内路径、未知版本、缺失资源、过深结构和超出体积限制的包，不执行包内代码。

## HTTP（插件访问 localhost:47823，服务监听 127.0.0.1:47823）

除 CORS OPTIONS 外，每个请求需要 `Authorization: Bearer <pairing-token>`。服务校验 Host 与 Origin，拒绝其他网页来源。令牌每次启动更新。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | /capabilities | 协议与引擎能力 |
| POST | /jobs?name=design.eps | 原始文件字节，返回任务 id |
| GET | /jobs/{id} | queued/running/done/error/cancelled 与进度 |
| DELETE | /jobs/{id} | 取消任务；已结束的任务清理资源 |
| GET | /jobs/{id}/result | 下载 .figimport |
| GET | /jobs/{id}/resources/{filename} | 读取任务包内指定图片资源 |

只在回环接口提供服务；默认队列上限 2，转换工作线程 1，源文件上限 256 MB。子进程超时或取消后被终止，临时工作目录自动清理。服务关闭会取消所有任务并清理会话资源。连接失败时用户可以直接运行 CLI 生成离线包。

