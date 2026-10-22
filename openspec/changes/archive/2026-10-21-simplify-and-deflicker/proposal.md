# Proposal

## Why

网页在脚本生效前会先用原字体完成首次绘制，用户能看到约 0.1-0.7 秒的字体闪烁；同时三项可配置字体（菜单、GM 存储、输入校验、跨页同步）与脚本的核心目标无关，浏览器自身的通用字体设置已经能完成「用哪款字体」的选择。脚本只需要按类别插入通用族，并保证图标、公式、加密字体保持原样。

## What Changes

- **BREAKING** 移除 sans / serif / mono 三项设置：不再注册 GM 菜单、不再读写 GM 存储、不再跨页同步；固定使用 `sans-serif` / `serif` / `monospace`，实际字体由浏览器字体设置决定。删除 `src/settings.ts` 与全部 `@grant`。
- **BREAKING** 启动时机从 `document-end` 改为 `document-start`，并把首次扫描从空闲回调改为在 `MutationObserver` 回调内同步执行（先读后写），去掉 `requestIdleCallback` 与「64 元素/批」的节流，从首帧起即为替换后的字体。
- 只处理计算字体系列与父元素不同的元素，其余依赖继承跳过；命中保护边界时整棵子树剪枝。
- 样式表加载、字体加载完成、属性与文本变化触发的重扫，都在产生该变化的同一任务内同步完成，不再经过定时器或空闲队列。
- **BREAKING** 扩展现有行为的保护面：补全数学字体名与公式容器，公式内容保持原字体栈不变；新增通用连字图标字体检测，未知图标字体不再被插入通用族。
- 雨课堂加密字体（`exam-data-decrypt-font`、`.xuetangx-com-encrypted-font`）保护保持不变。
- 版本号升为 `2.0.0`；旧存储键不再读取，也不做迁移。

## Capabilities

### New Capabilities

- `font-classification`: 由计算样式判定 sans、serif、mono 类别，并以「通用族 + 原字体栈」的形式生成替换声明；原字体栈必须保留为回退。
- `font-protection`: 图标字体、公式、SVG、加密字体等边界保持原字体；包含通用连字图标检测、伪元素与私用区字符处理。
- `font-application`: 从文档解析期开始的同步应用策略、继承跳过、保护子树剪枝、动态变更与资源加载后的同步重扫，以及不产生原字体首帧的要求。

### Modified Capabilities

无（项目此前没有已归档的 capability 规格）。

## Impact

- 源码：删除 `src/settings.ts`；重写 `src/scanner.ts` 的调度与遍历；扩展 `src/protection.ts`、`src/classifier.ts`；简化 `src/index.ts`、`src/types.ts`。
- 构建：`scripts/build.ts` 移除四个 `@grant`，`@run-at` 改为 `document-start`，版本号变更影响元数据与发布标签校验。
- 测试：删除设置菜单、存储校验、跨页同步相关用例；新增首帧无闪烁、继承跳过、图标连字检测、同步重扫的用例。
- 文档：README 的设置章节、分类章节与已知边界需要重写。
- 用户影响：曾自定义字体的用户升级后会改用浏览器默认字体，需要在发布说明中提示改用浏览器字体设置；旧 `fontOverride.*` 存储键成为无人读取的残留数据。
