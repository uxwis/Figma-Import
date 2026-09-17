# 有条件的原生混合转换

依据 [Adobe 对混合模式的定义](https://helpx.adobe.com/in/photoshop/desktop/repair-retouch/adjust-light-tone/blending-mode-descriptions.html) 和 [W3C Color Dodge 公式](https://www.w3.org/TR/compositing-1/#blendingcolordodge)，逐通道可推导：

- Subtract：`max(0, backdrop - source)` 等于对 `1 - source` 使用 Linear Burn。
- Divide：`min(1, backdrop / source)` 等于对 `1 - source` 使用 Color Dodge。零除边界会因渲染器而异，目前含零颜色通道的填充不采用该转换。

这两个推导只用于单一形状填充、无描边/其他效果、不含特殊填充混合且填充透明度为 1 的已覆盖路径。之后的纯色羽化作用在透明度上。原始颜色与混合模式写入节点数据；最终节点仍为原生矢量，用户调整颜色时看到的是用于等价计算的反相颜色。

Hard Mix 在确定的不透明白色背景上输出白色。实现只识别白色画板中连续、未被其他可见内容改变背景的底部对象，保留路径及透明度，把最终原生填充变为白色；不把这一规则推广到未知背景或图片。原始填充保存在节点数据，诊断明确提示：改变背景或下方内容后需重新转换。

真实 dribbble 样本验证了以上条件下的外观，不能代替其他文件的视觉对照。未知情况继续报告未支持，不自动整页栅格化。
