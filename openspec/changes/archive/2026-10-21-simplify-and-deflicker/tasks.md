# Tasks

## 1. 移除字体配置

- [x] 1.1 删除 `src/settings.ts`，把固定的 `{ sans: 'sans-serif', serif: 'serif', mono: 'monospace' }` 作为常量移入 `src/types.ts`（或分类器内部），并简化 `src/index.ts` 为「创建扫描器并启动」；验证：`bun run check` 通过，`src/index.ts` 不再引用 GM API。
- [x] 1.2 从 `scripts/build.ts` 的元数据中移除 `GM_getValue`、`GM_setValue`、`GM_registerMenuCommand`、`GM_addValueChangeListener` 四个 `@grant`，并把 `@run-at` 改为 `document-start`；同步更新 `tests/build.test.ts` 的断言；验证：`bun run test:build` 通过，且 `grep -c '@grant' dist/font-override.user.js` 输出 0。
- [x] 1.3 删除 `src/userscript.d.ts` 中不再使用的 GM 类型声明与 `tests/helpers.ts` 中的 GM 存储/菜单替身；验证：`bun run check` 通过，`grep -rn 'GM_' src tests` 无结果。
- [x] 1.4 重写依赖设置的浏览器用例：删除「三项设置」「输入校验」「跨页同步」「iframe 无重复菜单」等用例，把其余用例的预期字体改为固定通用族（`sans-serif` / `serif` / `monospace`）；验证：`bun run test:browser` 全部通过。
- [x] 1.5 重写 README 中「只有三项设置」章节，改为说明最终字形由浏览器标准/无衬线/等宽字体设置决定，并说明升级后旧 `fontOverride.*` 存储键不再生效；验证：README 不再出现 GM 菜单、prompt、跨页同步的描述。

## 2. 分类与保护

- [x] 2.1 补全 `src/protection.ts` 的数学保护：字体名覆盖 `Latin Modern Math`、`STIX Two Math`、`XITS Math`、`TeX Gyre *`、`Asana Math`、`Noto Sans/Serif Math`、`Libertinus Math`、`Fira Math`、`Garamond Math` 等，容器选择器补 `.mwe-math-element`、`.math`、`.formula`、`.equation`；验证：新增 Playwright 用例断言这些元素的计算字体与替换前一致。
- [x] 2.2 在 `src/protection.ts` 或分类器中实现连字图标检测：仅对 `document.fonts` 中已知的网页 `FontFace.family` 计算整词宽度与逐字符宽度之和的比值，低于 0.6 判定为图标字体并保持原字体；探针复制元素的计算字体特性；验证：新增用例使用 Material Icons（比值约 0.25）与 Roboto Mono（比值 1.00）分别断言「保持不变」与「正常替换」。
- [x] 2.3 调整分类器输出为固定通用族，删除 `FontSettings` 相关类型与参数；保持等宽测量、衬线名称匹配、512 项缓存与语言参与缓存键的现有语义；验证：更新后的分类用例（等宽、伪等宽、缺失字体、未知比例字体、带引号通用族）全部通过。

## 3. 扫描与调度重构

- [x] 3.1 重写 `src/scanner.ts` 的启动与调度：`document-start` 安装 `MutationObserver`，在回调内同步处理，删除 `requestIdleCallback`、`batchLimit`、`fullScanTimer` 与 75ms 防抖；验证：新增用例用一个延迟 300ms 的 `defer` 脚本页面断言首次绘制前字体已替换（用 `PerformanceObserver` 的 paint 时间与逐帧采样比对）。
- [x] 3.2 实现「与父元素计算字体相同则跳过」：按文档顺序读取、先收集计划再统一写入，父元素字体系列用 `WeakMap` 缓存；验证：新增用例在大文档中统计 `setProperty` 调用次数，仅独立声明元素被写入，继承元素无内联 `font-family`。
- [x] 3.3 实现保护边界整棵子树剪枝：遍历器进入元素时用 `matches(边界选择器)` 判断并跳过后代；验证：新增用例通过测试替身统计边界内部的 `getComputedStyle` 与 `setProperty` 均为 0 次。
- [x] 3.4 实现动态变更与资源加载后的同步重扫：childList 处理新增子树并去重、characterData 重处理最近元素、attributes 对 `style` 先比较计算字体再决定、其他属性重扫目标子树；样式表 `load`、`document.fonts` 的 `ready` / `loadingdone` / `loadingerror`、`pageshow`、`resize` 触发同任务同步重扫；验证：新增或改写用例覆盖插入节点、修改类名、网页改写内联字体、延迟样式表加载，且断言在下一帧采样前已生效。
- [x] 3.5 重构原值恢复与自触发防护：重扫前恢复脚本写入的记录，读取后写入并记录序列化结果，自身写入先 `takeRecords` 再临时断开观察器；验证：现有「不增长字体栈」「保留其他内联样式」「雨课堂子树跨批次恢复」用例通过，并新增重复重扫后字体栈长度不变的断言。

## 4. 版本、文档与集成验证

- [x] 4.1 把 `package.json` 版本升为 `2.0.0`，同步构建测试中的版本与发布标签预期；验证：`bun run test:build` 通过，`dist/font-override.meta.js` 中 `@version` 为 2.0.0。
- [x] 4.2 更新 README 的分类流程图、动态处理说明、已知边界与性能说明，删除与设置、空闲调度、分批队列相关的描述，补充「公式只保护不插入 math」「连字图标检测」「首帧无闪烁」；验证：README 中的命令（`bun run check`、`bun run test`）可照文档执行成功。
- [x] 4.3 全量验证：`bun run check && bun run test` 通过；再用构建产物在真实页面（含维基百科条目与一个 KaTeX 页面）手动确认首屏无原字体闪烁、公式与图标未被改写；验证：记录观察结果到变更说明。

### 4.3 真实页面观察记录（2026-10-21）

完整记录见 `verification.md`（唯一来源）。要点：

- 自动化：`bun run check && bun run test` 通过（构建 6/6，浏览器 29/29，含外部样式表未落定时的绘制前补扫用例与网页字体集合等量替换的缓存失效用例）。
- 修复前：维基百科 Mathematics 的标题在 FCP 之后 1–43ms 才被写入，首次绘制仍使用网页原字体。
- 修复后：3 次运行 FCP 440 / 596 / 508ms，标题首次写入 425 / 577 / 493ms，均早于 FCP；样式表 `load` 晚至 520–614ms，写入不再依赖它。公式（7 个 `<math>` 均为 `math`）与页面错误符合预期。
- KaTeX · Supported Functions：首帧前未取得采样；首个 `h1` 采样已是替换后字体；969 个 `.katex`、969 个 `math`、120 个 `svg` 的计算字体与基线完全一致；页面错误 0。
- 修复方式：`src/scanner.ts` 跟踪未落定的 `<link rel="stylesheet">`，在每个渲染更新保留一次去重的 `requestAnimationFrame` 补扫，样式表全部 `load` / `error` 后停止。完整数据与根因见 `verification.md`。
- 扩展内验收：用户在真实 Chrome + Tampermonkey 中确认维基百科数学公式页面与 KaTeX 主界面的公式字体正常（2026-10-21）。

## Workflow follow-up

- 满足项目评审要求后归档该变更。
- 归档后核对主规格与增量规格一致。
