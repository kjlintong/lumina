# P8c — HUD 与时间轴重做 实施规格（草稿，待 P8a/P8b 落地后校准）

> 交给 Claude Code 执行。先读 `CLAUDE.md`，再读本文件。
> 前置：P8a、P8b 已完成且 `npm run verify` 全绿。

## 目标

对标参考项目 2「日落收藏家」的 UI 观感，同时保留 Lumina 作为
**灯光设计工具**的产品功能。当前 UI 是「功能齐全但视觉平庸」——
纯黑面板、普通按钮、原生 `<input type="time">`，与目标差距明显。

## 参考视觉（我已实测截图，特征如下）

- **底部时间轴**：横向轨道，渐变从黄橙（日落）到蓝紫（夜晚）；
  圆球发光手柄；小时刻度 17:00/18:00/19:00/20:00 标在轨道下方；
  左端药丸形深色容器显示当前时间「18:10」。
- **左上角 HUD**：大标题 + 描述，下面三行数字统计
  （三角面数 / 部件数 / 帧率），字体小、灰色、右对齐数值。
- **右下角**：小 logo + `build <date> <hash>` 技术串。
- **面板**：深色半透明 + 圆角 + 细亮边，玻璃质感，不喧宾夺主。
- **场景预设**：暖色渐变药丸按钮，激活态高亮（参考 1 用橙色 accent 线）。

## 交付物

### 交付物 1：时间轴组件 `src/ui/panels/TimeAxis.tsx`（新建）

替换 `App.tsx` 底部的 `<input type="time">` + 速度滑杆那一整块。

```tsx
export interface TimeAxisProps {
  hour: number;              // 0..24 浮点
  onHourChange: (h: number) => void;
  speed: number;
  onSpeedChange: (v: number) => void;
  shadows: boolean;
  onShadowsChange: (v: boolean) => void;
}
```

实现要点：
- 范围 **0:00 → 24:00（全天）**。
  注：初版设计为 16:00 → 21:00（产品主场景：日落到夜晚），但用户验收后
  改为全天 24 小时，所以 `AXIS_MIN = 0`、`AXIS_MAX = 24`。引擎侧本来
  就支持 0..24（`setHour` 钳位 + `tick` 内 `timeHour -= 24` 回环），
  `solarPosition` 按天文高度角处理夜晚，不需要改渲染侧。
- 轨道：`<div>` + `background: linear-gradient(90deg, ...)`，
  颜色键按虚拟时间走一整个昼夜：午夜 `#1a1a3e` → 黎明 `#2a2a5e`
  → 日出 `#ff9040` → 正午 `#ffd24a` → 黄昏 `#c44a2a`
  → 入夜 `#5a4a8a` → 午夜 `#1a1a3e`（首尾一致，形成闭合回环）。
- 手柄：绝对定位的 `<div>`（圆形 16px，`background: radial-gradient(...)`，
  `box-shadow: 0 0 12px 3px rgba(255,200,120,0.6)`）。
- **交互**：轨道支持 `pointerdown` + `pointermove`（拖拽），
  把手柄位置转成 hour；**不要**用原生 `<input type="range">` 做主轨道
  （视觉不可定制），但可以在轨道上叠一个透明的原生 range 做可访问性兜底，
  或者用 role="slider" + aria 属性手做键盘支持。**必须**支持键盘左右键调节。
- 刻度：轨道下方 13 个小刻度标签（每 2 小时：0/2/4/.../24），
  `font-size: 10px; color: #888`。
  注：24 小时逐小时刻度的话 25 个标签在轨道宽度内会挤成一团，
  所以步长取 2 小时。
- 左端药丸：`border-radius: 999px; background: rgba(20,20,30,0.9); padding: 4px 12px`，
  显示 `HH:MM`（从 hour 格式化的 `formatHour`，App.tsx 已有该函数，可导出复用）。
  注：`hour = 24` 时显示 `24:00`，这是合法的（formatHour 不做 24→0 归一化）。
- 速度滑杆与阴影开关保留在同一行右侧（缩小、低调），不要抢时间轴风头。

单测：TimeAxis 渲染出轨道、13 个刻度、药丸；`hourToRatio` 在 0..24 区间
正确换算并钳位；`trackGradient` 含 7 个颜色键且首尾闭合；手柄 `role="slider"`
+ `aria-valuemin=0` / `aria-valuemax=24`；键盘左右键钳在 [0, 24]；
`formatHour` 正确格式化。

### 交付物 2：真实数字 HUD `src/ui/panels/HudStats.tsx`（新建）

```tsx
export interface HudStatsProps {
  /** 由 engine 提供：渲染统计 */
  stats: { triangles: number; objects: number; fps: number } | null;
}
```

- **数字必须真实**，不许写死。数据来源：
  `engine.getRenderer()` 的 `renderer.info.render.triangles`（WebGL2 路径），
  以及 `scene` 遍历统计对象数，帧率用 rAF 时间戳滑动平均（最近 30 帧）。
- 在 `SceneEngine` 上新增：
  ```ts
  getRenderStats(): { triangles: number; objects: number; fps: number }
  ```
  `triangles` 从 `renderer.info.render.triangles` 取（WebGPU 路径返回 0 并在 UI 显示 `—`）；
  `objects` 遍历 scene（只数 `Mesh` / `Points` / `Line`，不数 Group/Light）；
  `fps` 由 `animate` 循环内维护（`fps = 0.9 * fps + 0.1 * (1/delta)`，delta<=0 时不更新）。
- 布局：左上角竖排三行，形如
  ```
  三角面 12.4K
  部件    86
  帧/秒   58
  ```
  标签灰色 `#888` 12px，数值白色 14px `font-variant-numeric: tabular-nums`。
  千分位用 `Intl.NumberFormat` 或手写 `12.4K`（>9999 用 K 后缀）。
- 在 `App.tsx` 里用 500ms `setInterval` 轮询 `engine.getRenderStats()`（不要每帧 setState）。

单测：`getRenderStats` 返回的对象形状正确、数值为有限非负数；
`HudStats` 在 `stats === null` 时渲染占位 `—`，不崩。

### 交付物 3：场景预设视觉升级 `src/ui/panels/ScenePanel.tsx`（修改）

当前是 `scene-btn` 普通按钮。改为**暖色渐变药丸**：
- 未激活：`background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12)`
- 激活：`background: linear-gradient(135deg, #f0a040, #e06030); color: #1a1a2e;
  font-weight: 700; box-shadow: 0 2px 12px rgba(240,160,64,0.35)`
- 圆角 `border-radius: 999px`，padding `8px 12px`。
- 保持 3 列网格布局与既有点击行为（`onApplyScene`）不变。

### 交付物 4：build 版本号 `src/ui/panels/BuildBadge.tsx`（新建）

右下角小字：`build <YYYY-MM-DD HH:MM> · <backend>`。
日期从 `import.meta.env.VITE_BUILD_TIME` 取（在 `vite.config.ts` 里加
`define: { 'import.meta.env.VITE_BUILD_TIME': JSON.stringify(new Date().toISOString()) }`），
取不到时回退到 `new Date().toISOString()`。backend 从 props 传入。

### 交付物 5：全局玻璃质感样式（`index.html` 的 `<style>`，修改）

- `.panel` / `.overlay` / `.controls` / `.sidebar` 统一：
  `background: rgba(18,18,28,0.72); backdrop-filter: blur(14px) saturate(1.2);
  border: 1px solid rgba(255,255,255,0.10); border-radius: 12px;`
- accent 色统一为 `#f0a040`（暖橙），已在用，保持。
- 字体：保持系统 sans-serif，但把标题字重与字距拉开
  （`font-weight: 700; letter-spacing: 0.02em`）。
- 滚动条：保留现有自定义样式，但颜色改暗一点。
- **不要**引入任何 CSS 框架、不要引入网络字体。

### 交付物 6：`App.tsx` 布局微调

- 左上角：`overlay` 标题区 + `HudStats` 数字区（上下堆叠）。
- 底部：用 `TimeAxis` 替换原来的 `.controls` 整块。
- 右下角：`BuildBadge`。
- 日落提示 toast 保留。
- 三栏布局（左/中/右 sidebar）不动。

## 验证

```bash
npm run verify && npm run build
```

**必须截图目测**（我会做）。判据：
1. 时间轴是渐变轨道 + 发光圆球手柄，拖动顺滑，刻度对齐。
2. HUD 三个数字真实变化（拖动相机/加灯后三角形数会变）。
3. 场景按钮是暖色药丸，激活态醒目。
4. 面板有玻璃质感，不遮挡视线。

## 红线

- 不改 3D 渲染逻辑、不改场景数据模型、不动 ADR。
- 不新增 npm 依赖、不引入 CSS 框架、不引入网络字体。
- 所有数字统计必须真实（不许写死假数字）。
- 不破坏既有测试；新增组件要配 `ui/__tests__/` 单测。
- 键盘可访问：时间轴手柄支持左右键。

## 提交

单个 commit：`feat(P8c): time axis, live HUD stats, glass UI`
不要 push。
