# 实现验证记录

## 自动化验证

| 命令 | 结果 |
| --- | --- |
| `bun run check` | 通过（业务源码、构建工具、测试的类型检查） |
| `bun run test:build` | 6/6 通过 |
| `bun run test:browser` | 29/29 通过 |
| `grep -c '@grant' dist/font-override.user.js` | `0` |
| `dist/font-override.meta.js` | `@version 2.0.0`、`@run-at document-start` |

扩展内验收：**已由用户在真实 Chrome + Tampermonkey 中人工确认（2026-10-21）**：维基百科数学公式页面与 KaTeX 主界面的公式字体正常。此前的自动化尝试因本机 macOS 屏幕/辅助功能权限被拒绝而无法驱动真实窗口；Playwright 独立配置中出现的全站匹配未注入属于临时配置的站点授权差异，不代表产物行为。

浏览器用例覆盖：

- 分类：真实等宽字体、伪等宽、缺失字体、未知比例字体、带引号通用族。
- 继承：仅独立声明元素写入；独立等宽声明本身及其后代均不产生重复写入；2000 个继承元素无内联 `font-family`，重复重扫后字体栈不增长。
- 首帧：延迟 300ms 的 `defer` 脚本页面中，解析期读取与全部帧采样都已是替换后的字体，存在首次绘制记录；外部样式表未落定时，样式变化在下一个采样帧前完成替换（`scans before paint while an external stylesheet is still loading`）。
- 动态：插入节点、类名变化、`lang` 属性、网页改写内联字体、延迟样式表加载均在下一帧前生效；样式文本与媒体查询变化同步重扫。与父元素同族的样式表声明在父元素写入后仍被单独替换；自身写入落定后写入计数不再增长。
- 保护：Material Icons 连字图标、私用区文本/伪元素、SVG/MathML/KaTeX、扩展数学字体名（含 STIX、STIXGeneral、STIXSizeOneSym、Noto Math）与 `.mwe-math-element`、`.math`、`.formula`、`.equation` 容器；保护子树内部的 `getComputedStyle` 与 `setProperty` 计数为 0。
- 伪元素读取：只在样式表伪元素规则匹配到的候选元素上读取 `::before` / `::after` / `::marker`；无伪元素规则的 200 元素页面读取次数为 0，含两条伪元素规则的页面读取次数保持在 30 次以内，且继承型图标宿主的等值声明仍然生效；跨域不可读样式表回退为逐个元素检查时仍能识别伪元素图标。
- 异常隔离：指定元素的 `getComputedStyle` 抛错时，其余元素仍完成替换，该元素保持原字体且无页面异常。
- 连字图标：未知网页字体按整词/逐字符宽度比识别（用例以 `MysteryIcons` 包装 Material Icons 的字体二进制，避开已知字体名分支，比值约 0.25，保持原字体；等宽与比例 webfont 均为 1.00，分别正常替换为 `monospace` / `sans-serif`）；迟到的网页字体加载会重新分类，随后再次触发 `document.fonts.ready` 与 `resize` 时字体栈长度不变。
- 字体集合缓存：在同一任务内删除一个网页字体并加入另一个字体（`document.fonts.size` 不变）后，脚本重新枚举字体集合并按新字体识别连字图标；该用例在按 `size` 失效的旧实现下失败，改为集合指纹后通过。
- 雨课堂：加密字体名、加密标记子树、动态标记切换、子树内新增内容与 iframe。
- 资源：延迟字体加载后重新分类；加载失败、0 字号隐藏文本不抛错。

## 真实页面验证（2026-10-21，唯一记录）

方法：Chromium（Playwright 1.64.1，headless）在 `document-start` 注入 `dist/font-override.user.js`；另一 context 作为无脚本基线。逐帧用 `requestAnimationFrame` 记录目标元素的计算字体与视口位置，用 `PerformanceObserver` 记录 paint 时间，用 `MutationObserver` 记录脚本对目标元素的写入时间，并收集 `pageerror`。采样器的 rAF 早于脚本的补扫注册，因此绘制前最后一次采样可能仍是网页原字体；判断首帧是否已替换以**脚本写入时间早于 FCP** 为准。

| 页面 | 修复后观测结果 | 保护内容 | 页面错误 |
| --- | --- | --- | --- |
| 维基百科 · Mathematics | 3 次运行 FCP 440 / 596 / 508ms，脚本对标题的首次写入 425 / 577 / 493ms，均早于 FCP 15–19ms；标题 rect top=90、600×40，位于首屏；样式表 `load` 晚至 535 / 614 / 520ms，写入不依赖它。最终字体 `serif, "Linux Libertine", Georgia, Times, "Source Serif 4", serif`。 | 7 个 `<math>` 替换前后均为 `math`。 | 0 |
| KaTeX · Supported Functions | FCP 556ms；首个包含 `h1` 的采样（725ms）已是 `sans-serif, -apple-system, …`；首帧前没有取得该元素的采样，因此不对该页首帧作断言。 | 969 个 `.katex`、969 个 `math`、120 个 `svg` 的计算字体集合与基线完全一致：`.katex` 均为 `KaTeX_Main, math, "Times New Roman", serif`，`math` 均为 `math`。 | 0 |

### 修复前后的首帧时序

修复前（同一采样方法，4 次运行）：FCP 428–536ms，标题首次写入发生在 FCP 之后 1–43ms，首次绘制时仍使用网页原字体。

根因：

1. 解析期首次扫描时外部样式表尚未应用，标题与父元素都读到 UA 默认字体，按「与父元素相同则继承跳过」没有写入。
2. 样式表随后应用，但不产生任何 DOM 变更，观察器收不到通知。
3. 唯一的重扫触发是 `<link>` 的 `load` 事件；它可能晚于首次绘制。设计文档原先“样式表会阻塞首次绘制”的前提对 `load` 事件不成立——样式已经应用，事件却尚未派发。

修复：`src/scanner.ts` 跟踪尚未 `load` / `error` 的 `<link rel="stylesheet">`；只要存在待定样式表，就在每个渲染更新中保留一次去重的 `requestAnimationFrame` 补扫，样式表全部落定后停止。补扫不替代 mutation 路径的同步应用，没有外部样式表的页面不增加扫描；新增的浏览器用例在关闭补扫时会失败，开启后通过。

修复后 3 次真实页面测量均满足“首次绘制前完成替换”。本次扩展内验收已由用户完成（见上文）；后续发布仍按 README「自动化测试…不代替实际扩展验收」的流程执行。

## 已知差异

- 连字图标检测只对 `document.fonts` 中枚举得到的网页字体生效；跨域样式表无法枚举时退化为名称与私用区规则。
- 通用族始终优先，网页 webfont 仅作为缺字回退；这是本变更的预期行为。
- 绘制前补扫只等待 `<link rel="stylesheet">`；内联 `@import` 或通过 CSSOM 插入的规则不纳入等待范围，仍按 design.md 的非目标处理。
