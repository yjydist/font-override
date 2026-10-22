# Spec Delta

## Purpose

识别图标字体、数学公式、SVG、MathML 与已知加密字体等必须保留原始字体的内容，使脚本只替换普通文本的字体，不破坏依赖字体映射的图标、公式与加密字形。

## ADDED Requirements

### Requirement: 已知图标内容保持原字体

脚本 SHALL 保持图标字体与图标内容的原字体声明不变，包括字体名匹配常见图标字体（Font Awesome、Material Icons/Symbols、Iconfont、IcoMoon、Glyphicons 等）、类名匹配常见图标约定、元素直接文本或伪元素内容位于 Unicode 私用区的元素。伪元素的内容与字体 MUST 与替换前一致。

#### Scenario: Material Icons 连字图标
- **WHEN** 元素使用 `Material Icons` 字体并通过连字显示图标
- **THEN** 不插入通用族前缀，图标字形与替换前逐像素一致

#### Scenario: 私用区伪元素图标
- **WHEN** 元素的 `::before` 内容为私用区字符且使用图标字体
- **THEN** 该伪元素的计算字体保持原值

### Requirement: 未知连字图标字体可被通用识别

当元素的首选字体是网页提供的字体时，脚本 SHALL 通过比较整词渲染宽度与逐字符宽度之和来识别连字图标字体：整词宽度明显小于逐字符宽度之和时，该字体被判定为图标字体并保持原字体。系统字体 MUST NOT 被此规则判定为图标字体。

#### Scenario: 自建连字图标字体
- **WHEN** 页面加载了不在内置名单中的连字图标字体，且其整词宽度远小于逐字符宽度之和
- **THEN** 使用该字体的元素保持原字体，不插入通用族前缀

#### Scenario: 普通比例字体
- **WHEN** 网页 webfont 的整词宽度与逐字符宽度之和一致
- **THEN** 该字体不被判定为图标字体，正常参与类别判定

### Requirement: 数学、SVG 与公式容器保持原样

脚本 SHALL 保持公式与矢量内容的原字体声明不变，覆盖 MathML（`math`）、KaTeX、MathJax（含 `mjx-container`）、常见数学字体名（Cambria Math、STIX、Latin Modern Math、XITS Math、TeX Gyre、Asana Math、Noto Math 等）以及 SVG 子树。脚本 MUST NOT 为这些内容插入 `math` 或其他通用族前缀。

#### Scenario: MathML 公式
- **WHEN** 页面的 `<math>` 元素及其子元素使用浏览器数学字体
- **THEN** 公式内部的计算字体与替换前完全一致

#### Scenario: KaTeX 公式
- **WHEN** `.katex` 容器内部元素使用 KaTeX 自有字体
- **THEN** 不向容器及其后代写入字体声明

### Requirement: 已知加密字体保持原字体

脚本 SHALL 识别已知加密字体名称（如 `exam-data-decrypt-font`，不区分大小写）与已知加密标记子树（如 `.xuetangx-com-encrypted-font`），并保持其字体栈与顺序不变；标记子树内新增的内容 MUST 同样保持原字体，标记移除后恢复正常替换。

#### Scenario: 雨课堂加密文本
- **WHEN** 元素字体栈包含 `exam-data-decrypt-font`，或位于加密标记子树内
- **THEN** 不插入通用族前缀，字形与替换前一致

#### Scenario: 标记子树移除
- **WHEN** 加密标记子树被移除标记
- **THEN** 该子树中的普通文本恢复为插入通用族后的字体栈

### Requirement: 保护边界整棵子树剪枝

当遍历命中保护边界时，脚本 SHALL 跳过整棵子树的读取与写入，MUST NOT 为边界内部元素生成替换声明。边界元素自身已有的字体声明 MUST 保持原值与优先级。

#### Scenario: 公式内部元素
- **WHEN** 遍历进入 `.katex` 或 `svg` 子树
- **THEN** 不再读取其后代的计算样式，也不写入任何字体声明
