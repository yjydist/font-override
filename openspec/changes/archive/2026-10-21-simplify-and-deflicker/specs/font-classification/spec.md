# Spec Delta

## Purpose

根据元素的计算字体样式判定 sans、serif、mono 类别，并生成「通用族前缀 + 网页原字体栈」的替换声明，使浏览器字体设置决定最终字形，同时保留原字体栈的缺字回退能力。

## ADDED Requirements

### Requirement: 固定使用浏览器通用族

脚本 SHALL 把三个字体类别分别映射为固定的通用族：sans 对应 `sans-serif`，serif 对应 `serif`，mono 对应 `monospace`。脚本 MUST NOT 提供任何自定义字体名称、字体列表或设置入口；最终字形由浏览器的标准、无衬线、等宽字体设置决定。

#### Scenario: 使用无衬线内容
- **WHEN** 元素被判定为 sans 且原字体栈为 `Arial, sans-serif`
- **THEN** 应用后的字体栈以 `sans-serif` 开头，并保留 `Arial, sans-serif` 作为后续回退

#### Scenario: 不存在设置入口
- **WHEN** 脚本在页面上运行
- **THEN** 不注册任何字体设置菜单，不读取也不写入脚本自定义的字体存储键

### Requirement: 等宽判定基于字形宽度

脚本 SHALL 通过隔离测量节点比较多个拉丁字符的渲染宽度来判定等宽，MUST NOT 仅凭字体名包含 `mono` 或字体栈以 `monospace` 结尾就判定为等宽。宽度差在容差内时判定为 mono。

#### Scenario: 实际等宽字体
- **WHEN** 元素字体栈包含一款实际渲染宽度一致的等宽字体，且字体栈不含 `monospace`
- **THEN** 该元素被判定为 mono，前缀为 `monospace`

#### Scenario: 等宽通用族后跟比例字体
- **WHEN** 元素字体栈为 `Arial, monospace`，实际渲染为比例字体
- **THEN** 该元素被判定为 sans，前缀为 `sans-serif`

### Requirement: 衬线判定按字体栈顺序进行

当元素被判定为非等宽时，脚本 SHALL 按字体栈顺序匹配通用类别与内置的常见衬线、无衬线字体名。命中衬线通用族或已知衬线字体名时判定为 serif；命中无衬线通用族或已知无衬线字体名时判定为 sans；无法识别时 MUST 默认判定为 sans。

#### Scenario: 已知衬线字体
- **WHEN** 元素字体栈为 `Georgia, sans-serif`
- **THEN** 该元素被判定为 serif，前缀为 `serif`

#### Scenario: 未知比例字体
- **WHEN** 元素字体栈只有未知字体 `UnknownProportionalFont`
- **THEN** 该元素被判定为 sans，前缀为 `sans-serif`

### Requirement: 保留原字体栈且不重复前缀

替换声明 SHALL 由通用族前缀与网页原字体栈组成，原字体栈的字体名称与顺序 MUST 保持不变；引号形式以浏览器 CSSOM 的序列化结果为准（例如单引号会被规范化为双引号）。若原字体栈已经以相同通用族开头，脚本 MUST NOT 再次添加前缀，避免字体栈随重扫不断增长。

#### Scenario: 原字体栈已含同类通用族
- **WHEN** 元素的字体栈为 `serif, Georgia, serif`
- **THEN** 应用后的字体栈不新增重复的 `serif` 前缀

#### Scenario: 多次重扫
- **WHEN** 同一元素因页面变更被多次重新检测
- **THEN** 其字体栈长度保持不变，不出现重复的通用族前缀

### Requirement: 分类结果按字体环境缓存

脚本 SHALL 按字体栈、字号、字重、样式、字体特性与语言缓存分类结果，并在测量缓存达到上限时整体失效，避免测量成本随页面元素数量线性增长。

#### Scenario: 大量同字体元素
- **WHEN** 页面中数千个元素共享同一字体环境
- **THEN** 该字体环境只进行一次字形测量，后续元素直接复用缓存结果
