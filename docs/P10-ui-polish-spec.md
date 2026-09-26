# P10 — UI 视觉统一

> 交给 Claude Code 执行。先读 `CLAUDE.md`（ADR 与红线），再读本文件。
>
> P9/P9b 完成后视觉已达标（曝光分档、光柱可见、WebGPU 提示降级）。
> 本轮**只做 UI 视觉层的收敛和补全**，不引入新业务功能、不动渲染逻辑。
>
> 当前所有 CSS 堆在 `index.html` 的 `<style>` 块里（142 行，130+ 条规则），
> 色值和圆角在各处硬编码。**P10 的核心是把这堆散点收敛成一套设计 token，
> 让后续任何 UI 迭代都有一致的语义层可依赖**——但**不引入新的样式系统**
> （不装 tailwind / styled-components），继续用纯 CSS + CSS 变量。
>
> 本轮**不得破坏**任何既有测试（当前 452 条，`npm run verify` 全绿）。
> **UI 视觉改动**必须走浏览器目测验收（Hermes 会截图对比）。

## 0. 验收判据

**全部必须满足（截图目测 + 代码检查双重把关）：**

1. **CSS 变量收敛**：`index.html` 的 `<style>` 块顶部有 `:root { ... }`
   块定义了完整的颜色/圆角/边框/模糊 token；`<style>` 里后续规则
   **不得再出现裸色值 `#xxxxxx`**（token 定义块内除外），全部改成
   `var(--xxx)`。
2. **玻璃面板一致性**：`.overlay` / `.panel` / `.time-axis` / `.build-badge`
   / `.floor-plan` 五处的 `background` + `backdrop-filter` + `border`
   完全一致（同一个 token 组合），视觉上无差异。
3. **HUD 精简**：左上角默认只显示 **FPS 一行**（用户关心的实时指标），
   「三角面 / 部件」两行被移入可展开的子块（点击小 ⓘ 图标展开），
   普通用户看不到 `三角面 66` 这种工程术语。展开后三行按现在的样式。
4. **降级提示 dev-only**：WebGPU 降级到 WebGL2 的提示（当前 `degradation`
   字段的显示）在生产模式（`!import.meta.env.DEV`）不显示，dev 模式保留
   （方便调试）。「日落时段」提示保留（有 UX 价值）。
5. **2D 户型图美化**：
   - 窗户从纯线 + "窗" 字标注改成**蓝色半透明段**（明显表示开口）
   - 活动区选中态边框粗细从 1.5px 提到 2px，fill 透明度略高
   - 房间外框加 1px 内的暗色内描边（表达"墙厚"感）
6. **场景按钮补完态**：
   - `.scene-btn` 增加 `:disabled` 态（opacity 0.5，pointer-events none）
   - hover 态加 0.15s 缓动过渡（背景 / 边框）
   - active 态保留暖色渐变，加轻微 scale(0.98) 按下反馈（`:active`）
7. **侧栏折叠按钮对齐**：`.sidebar-toggle` 从「贴边圆角方块」改成
   「更贴玻璃质感的窄条」——`background: rgba(18,18,28,0.6)` + `backdrop-filter`
   + 更细边框（1px）+ 高度 60px（易点击）。
8. **字号阶梯统一**：整站只有 3 档字号（10px 极小标注 / 12px 说明 /
   14px 正文），标题 16px、面板标题 13px。目前 index.html 里混了
   10/11/12/13/14/16/18，收敛到 3-4 档。

## 1. 已确证的问题（Hermes 实测 + 代码走读）

### 现状：CSS 全部堆在 index.html `<style>` 里

**问题 1**：色值散点
- 背景色：`#1a1a2e`（body）、`rgba(18,18,28,0.72)`（面板/overlay）
- Accent：`#f0c040`（面板标题、item 选中）、`#f0a040`（场景按钮渐变、warning）
- 边框：`rgba(255,255,255,0.10)`、`rgba(255,255,255,0.12)`、`#333`、`#444`、`#555`
- 文字：`#eee`、`#aaa`、`#999`、`#888`、`#777`、`#666`、`#fff`、`#1a1a2e`
- 圆角：`4px`、`6px`、`8px`、`10px`、`12px`、`999px`

**问题 2**：backdrop-filter 配方重复
- `.overlay`、`.time-axis`、`.build-badge`、`.panel`、`.floor-plan` 五处都写了
  `backdrop-filter: blur(14px) saturate(1.2); -webkit-backdrop-filter: blur(14px) saturate(1.2);`
  完全一样，应该提取成类或变量。

**问题 3**：HUD 术语对普通用户不友好
- `三角面 66` / `部件 9` 是渲染工程师术语，普通用户看到会困惑。
  P9 视觉验收报告也记录过这点（`docs/P9-visual-acceptance.md` §7）：
  "HUD「三角形 66」数字普通用户看不懂"。
- 只有 FPS 是用户真正关心的实时指标。

**问题 4**：WebGPU 降级提示在非 dev 环境不该显示
- `App.tsx:495` 无条件渲染 `{degradation && <div className="info">...`。
  P9b 已经把样式从红色改灰色，但仍是常态显示——**WebGL2 是默认后端，
  多数用户根本不需要知道这个**。应只在 dev mode 显示。

**问题 5**：2D 户型图的窗户表达弱
- `FloorPlan.tsx:103` 用一条 3px 蓝色 `<line>` 加"窗"字标注。
  视觉上只是一条短线，看不出"这里是房间开口"的语义。
  参考设计里窗户应该是明显的**房间外框上的暗色段**（表示这里没有墙）。

**问题 6**：侧栏折叠按钮（`.sidebar-toggle`）与整体玻璃质感不搭
- 当前 `background: rgba(0,0,0,0.7)` + `border: 1px solid #444` + `border-radius: 4px`
  + `width: 20px height: 48px`，看起来像原生按钮硬贴上去。
- 应该跟玻璃面板同质感（同 backdrop-filter，同 border 配方）。

**问题 7**：场景按钮过渡缺失
- `.scene-btn` 没有 `transition`，点击/hover 状态切换是瞬时跳变。
  参考 2 的暖色药丸有丝滑的悬停过渡。
- 缺 `:disabled` 态和 `:active` 按压反馈。

## 2. 交付物

### 交付物 1：CSS token 化（`index.html` `<style>` 块）

**顶部加 `:root { ... }` 块**（不动 body / html 结构）：

```css
:root {
  /* 背景层次 */
  --bg-deep: #1a1a2e;          /* body 主背景 */
  --bg-panel: rgba(18, 18, 28, 0.72);   /* 玻璃面板底 */
  --bg-panel-solid: #121220;   /* 药丸、toast 等实心深色 */
  --bg-item: rgba(255, 255, 255, 0.03); /* 列表项、输入框 */
  --bg-item-hover: rgba(255, 255, 255, 0.06);
  --bg-item-active: rgba(240, 192, 64, 0.08);
  --bg-input: #2a2a3e;

  /* 边框（三档粗细 × 两档不透明） */
  --border-subtle: 1px solid rgba(255, 255, 255, 0.10);
  --border-strong: 1px solid rgba(255, 255, 255, 0.22);
  --border-hairline: 1px solid rgba(255, 255, 255, 0.04);
  --border-input: 1px solid #444;
  --border-input-focus: 1px solid var(--accent-warm);

  /* 玻璃模糊配方 */
  --glass-blur: blur(14px) saturate(1.2);

  /* 阴影 */
  --shadow-glass: 0 0 24px rgba(0, 0, 0, 0.45);
  --shadow-accent: 0 2px 12px rgba(240, 160, 64, 0.35);

  /* 强调色 */
  --accent-warm: #f0c040;      /* 面板标题、选中边框 */
  --accent-warm-strong: #f0a040; /* 场景按钮渐变起点、warning */
  --accent-warm-deep: #e06030;    /* 场景按钮渐变终点 */
  --accent-cool: #60a0d0;      /* 窗户、冷色点缀 */

  /* 文字层次（4 档） */
  --text-primary: #eee;
  --text-secondary: #aaa;
  --text-muted: #888;
  --text-dim: #666;
  --text-on-accent: #1a1a2e;  /* 暖色按钮上的深色文字 */

  /* 字体阶梯 */
  --font-size-xs: 10px;
  --font-size-sm: 11px;
  --font-size-body: 12px;
  --font-size-md: 13px;
  --font-size-lg: 14px;
  --font-size-title: 16px;

  /* 圆角（4 档） */
  --radius-xs: 4px;   /* 按钮、输入框 */
  --radius-sm: 6px;   /* 列表项 */
  --radius-md: 8px;   /* 小卡片 */
  --radius-lg: 12px;  /* 面板、overlay、时间轴 */
  --radius-pill: 999px;
}
```

**规则收敛**：把 `<style>` 块里所有 `#xxxxxx` / `rgba(...)` 硬编码的色值替换成
`var(--xxx)`。**注意**：

- `<style>` 块内可以保留原始值定义（`:root` 里），但 `<style>` 内其他规则不允许裸色值。
- **例外**：`scene-btn.active` 的 `linear-gradient(135deg, ...)` 直接引用
  `var(--accent-warm-strong)` 和 `var(--accent-warm-deep)`。
- **例外**：`time-track` 的 `trackGradient()` 在 `TimeAxis.tsx` 里生成的字符串，
  本轮**不改**（那是一整套时间渐变，改动会引入视觉回归；P11 再统一）。
- **例外**：`.badge-warn`、`.badge-ok` 里的绿/黄色保留（业务语义色）。
- **例外**：SVG 内联 `fill="#..."`（FloorPlan 里的 `fill="#60a0d0"`、
  `fill="#f0a040"` 等），本轮**不改**——改到用 CSS 变量的话需要 `fill="currentColor"`
  + `color: var(--xxx)`，属于下一轮重构范畴。

### 交付物 2：HUD 精简（`src/ui/panels/HudStats.tsx` + `App.tsx`）

**HudStats 组件重做**：

```tsx
// 顶部只有一行：FPS
// 小 ⓘ 图标点击展开/折叠"三角面 / 部件"细节
export function HudStats({ stats }: HudStatsProps) {
  const [expanded, setExpanded] = useState(false);
  const triangles = stats?.triangles !== null && stats ? formatCount(stats.triangles) : '—';
  const objects = stats ? formatCount(stats.objects) : '—';
  const fps = stats ? formatFps(stats.fps) : '—';
  return (
    <div className="hud-stats">
      <button type="button" className="hud-toggle" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} title="展开渲染统计">
        <span className="hud-label">帧/秒</span>
        <span className="hud-value">{fps}</span>
        <span className="hud-caret">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="hud-details">
          <div className="hud-row">
            <span className="hud-label">三角面</span>
            <span className="hud-value">{triangles}</span>
          </div>
          <div className="hud-row">
            <span className="hud-label">部件</span>
            <span className="hud-value">{objects}</span>
          </div>
        </div>
      )}
    </div>
  );
}
```

**新增 CSS**：

```css
.hud-stats { margin-top: 6px; padding-top: 6px; border-top: var(--border-subtle); display: flex; flex-direction: column; gap: 4px; }
.hud-toggle { width: 100%; display: flex; align-items: center; gap: 8px; background: none; border: none; cursor: pointer; padding: 2px 0; color: inherit; font: inherit; }
.hud-toggle:hover .hud-label { color: var(--text-primary); }
.hud-toggle .hud-caret { margin-left: auto; font-size: 10px; color: var(--text-muted); }
.hud-details { display: flex; flex-direction: column; gap: 2px; padding-top: 4px; }
.hud-row { display: flex; justify-content: space-between; gap: 16px; }
.hud-label { color: var(--text-muted); font-size: var(--font-size-xs); }
.hud-value { color: var(--text-primary); font-size: var(--font-size-md); font-variant-numeric: tabular-nums; }
```

**单测更新**：`src/ui/__tests__/hudBadge.test.tsx` 里若有断言"三行显示"要改成
"折叠态只显示 FPS 一行"、"展开态显示三行"。

### 交付物 3：降级提示 dev-only（`App.tsx`）

**改动**：`App.tsx:495` 那一行

```diff
- {degradation && <div className="info">{degradation}</div>}
+ {import.meta.env.DEV && degradation && <div className="info dev-only">{degradation}</div>}
```

**新增 CSS**：

```css
.info.dev-only { color: var(--text-dim); font-size: var(--font-size-xs); }
```

**理由**：WebGL2 是默认后端，绝大多数浏览器没有 WebGPU；降级到 WebGL2 是常态，
不应在 UI 上占位。开发时用 dev mode 保留诊断信息。

### 交付物 4：2D 户型图美化（`FloorPlan.tsx`）

**改动 1：窗户从线改成段**

把 `<line x1={win.x1} ...>` 改成 `<rect>`（有厚度）：

```tsx
<rect x={win.x1} y={win.y - 1.5} width={win.x2 - win.x1} height={3} fill="#60a0d0" opacity={0.85} rx={0.5} />
```

**改动 2：选中态边框加粗**

```diff
- strokeWidth={selectedZoneKey === z.key ? 1.5 : 1}
+ strokeWidth={selectedZoneKey === z.key ? 2 : 1}
```

**改动 3：活动区 fill 略亮**

```diff
- fill="rgba(240,160,64,0.18)"
+ fill="rgba(240,160,64,0.22)"
```

**改动 4：房间外框加内描边**

在现有 `<rect>` 内加一层内描边（表达墙厚感）：

```tsx
<rect
  x={r.x + 1}
  y={r.y + 1}
  width={r.w - 2}
  height={r.h - 2}
  fill="none"
  stroke="rgba(0,0,0,0.35)"
  strokeWidth={1}
/>
```

### 交付物 5：侧栏折叠按钮贴合玻璃质感（`index.html` CSS）

```css
.sidebar-toggle {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 7;
  background: var(--bg-panel);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: var(--border-subtle);
  border-radius: var(--radius-xs);
  width: 22px;
  height: 60px;
  cursor: pointer;
  font-size: 11px;
  color: var(--text-secondary);
  padding: 0;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.sidebar-toggle:hover {
  background: rgba(255, 255, 255, 0.10);
  border-color: var(--border-strong);
}
```

### 交付物 6：场景按钮补完态（`index.html` CSS）

```css
.scene-btn {
  padding: 8px 12px;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #ddd;
  font-weight: 500;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}
.scene-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.22);
}
.scene-btn:active {
  transform: scale(0.98);
}
.scene-btn:disabled {
  opacity: 0.5;
  pointer-events: none;
}
.scene-btn.active {
  background: linear-gradient(135deg, var(--accent-warm-strong), var(--accent-warm-deep));
  border-color: transparent;
  color: var(--text-on-accent);
  font-weight: 700;
  box-shadow: var(--shadow-accent);
}
```

## 3. 单测要求

- 既有 452 条必须全绿。
- 新增/更新：
  - `src/ui/__tests__/hudBadge.test.tsx`：
    - 默认渲染只显示 FPS 一行（`frame/秒 60` 之类）
    - 点击 `.hud-toggle` 后展开显示"三角面"和"部件"
    - 再次点击折叠回去
  - `App.test.tsx`（如果没有就新建）：`import.meta.env.DEV` 为 true 时降级提示可见，
    为 false 时不可见（用 `vi.stubEnv`）。
- **不要**在单测里做视觉断言（css 值、颜色），jsdom 不支持。

## 4. 验证

```bash
npm run verify    # typecheck + lint + 全部测试
npm run build
```

然后**必须起 dev server 截图目测**（Hermes 会做这一步）。

## 5. 红线

- 不新增 npm 依赖。
- 不动 ADR-08 / 02 / 13 / 17 / 01。
- **不动 3D 渲染逻辑**（`sceneEngine`、`godrays`、`lightBuilder`、`postProcessing`
  一律不动）。P9/P9b 已定的光柱强度、曝光分档、bloom 参数**不许回退**。
- **不动 store 层**（`projectStore`、`sceneController`、`sceneSystem`）—— 本轮
  只做 UI 表现层。
- **不动 `trackGradient()` 的时间渐变颜色**（TimeAxis 里的 `linear-gradient(90deg, ...)`
  字符串），保留 P8c 定的一整套时间色。
- 不改动时间轴、场景预设、灯具面板、活动区面板的**业务行为**——本轮只调视觉。
- 每帧不 `new` 对象；不引入 requestAnimationFrame 之外的高频轮询。

## 6. 提交

单个 commit：`style(P10): ui polish — design tokens, hud simplification, dev-only degradation notice`

不要 push。改完把 `npm run verify` 与 `npm run build` 的真实输出贴到最终回复里，
**并报告**（Hermes 会做浏览器截图验证）：

- CSS 变量收敛情况（`:root` 里定义了哪些变量、`<style>` 里剩余裸色值数量）
- `HudStats` 默认是否只显示 FPS、展开后是否三行
- WebGPU 降级提示在 dev / prod 模式下的行为差异
- 2D 户型图的窗户 / 活动区视觉差异
- 侧栏折叠按钮、场景按钮的过渡效果

## 7. 视觉验收点（Hermes 会截图对比）

- 默认首页（17:45，未展开 HUD）：左上角只有 FPS 一行
- 点击 HUD ⓘ 后展开显示三行
- `import.meta.env.DEV = false` 时看不到降级提示
- 2D 户型图窗户从细线变成蓝色半透明段
- 拖动时间轴滑块：药丸时间实时更新
- 场景预设按钮 hover / active / 切换：过渡丝滑
