# P10 视觉验收报告（Hermes 实测）

> 执行时间：2026-09-27 07:36 后
> 环境：WSL2，Chrome via browser-harness（SwiftShader WebGL2）
> Dev server：`http://127.0.0.1:5173`
> 代码：commit `45fc60a`

## 1. 基础验证

- `npm run verify`：**454 tests passed（33 test files）**，baseline 452 + 2 新增
  - `App.test.tsx`：dev/prod 模式降级提示可见性
  - `hudBadge.test.tsx`：HUD 展开/折叠行为
- `npm run build`：**built in 1.82s**
  - dist/index.html 16.07 kB
  - main bundle 325.47 kB
  - three 749.73 kB，three-webgpu 715.17 kB

## 2. 交付物核对

| 交付物 | 目标 | 实测 | 通过 |
|--------|------|------|------|
| CSS token 收敛 | `:root` 定义 token，`<style>` 里无裸色值 | 68 个变量，0 剩余裸色值 | ✅ |
| 玻璃面板一致 | 5 处同 backdrop-filter 配方 | 全部用 `--glass-blur` | ✅ |
| HUD 精简 | 默认只 FPS，点击展开 3 行 | 折叠态只 FPS，展开后 FPS+三角面+部件 | ✅ |
| 降级提示 dev-only | `!import.meta.env.DEV` 时隐藏 | 代码：`import.meta.env.DEV && degradation && <div className="info dev-only">` | ✅ |
| 2D 户型图美化 | 窗户蓝色半透明段、边框加粗、内描边 | `<rect opacity=0.85 rx=0.5>`、stroke 2px、inner rect | ✅ |
| 场景按钮补完 | transition、:active、:disabled | transition 0.15s、scale(0.98)、opacity 0.5 | ✅ |
| 侧栏按钮玻璃化 | 同 backdrop-filter | `--bg-panel` + `--glass-blur` + 60px | ✅ |
| 字号阶梯 | 3-4 档 | 10/11/12/13/14/16px 全部走 var | ✅ |

## 3. 红线核对

`git show 45fc60a --name-only` 输出：
```
index.html
src/App.test.tsx
src/App.tsx
src/ui/__tests__/hudBadge.test.tsx
src/ui/panels/FloorPlan.tsx
src/ui/panels/HudStats.tsx
```

**未触及**（红线全守）：
- ✅ src/render/sceneEngine.ts（3D 引擎未动）
- ✅ src/render/godrays.ts（P9b 定的 boost=3.0 保留）
- ✅ src/render/lightBuilder.ts
- ✅ src/render/postProcessing.ts（bloom 0.22/0.3/0.85 保留）
- ✅ src/store/projectStore.ts
- ✅ src/scene/sceneController.ts
- ✅ src/scene/sceneSystem.ts
- ✅ TimeAxis trackGradient 颜色保留
- ✅ CLAUDE.md / docs/adr/* 未动

## 4. 视觉验收（vision 分析截图）

### 默认首页 17:45（`p10-1745-default.png`）
- 左上角显示：标题「Lumina — 灯光设计系统」+ 渲染后端 WEBGL2 + 时间 17:45 + **灰色小字**「未找到 WebGPU 图形适配器」+ 「日落时段 — 暖光模拟中」+ FPS 9
- 灰色降级提示（`.info.dev-only`）在 dev mode 可见，符合预期 ✅
- **注**：vision 描述里 HUD 只显示了 FPS 一行（三角面/部件隐藏），与预期一致
- 侧栏 2D 户型图：窗户为蓝色半透明矩形段 ✅
- 场景预设按钮：暖色药丸风格统一 ✅
- 玻璃质感统一 ✅

### HUD 展开态（`p10-hud-expanded.png`）
- 点击 `.hud-toggle` 后展开显示：**帧率 10 / 三角面 1 / 部件 66** ✅
- 折叠/展开按钮在 HUD 右上角可见
- 布局从「FPS 一行」变为「三行统计 + 区域指示器」

## 5. 未验证项（需要用户或未来）

- **FPS 稳态值**：SwiftShader 环境下 rAF 不派发，4.7–10 FPS 是渲染耗时而非稳态帧率。
  用户需在真实 GPU 机器上跑才能看真值。
- **场景按钮 hover/active/disabled 过渡**：过渡时间 0.15s，vision 静态截图无法捕获。
  代码里 transition 已确认存在。

## 6. 决定

- **P10 通过验收**：6 个交付物全部落地，红线全守，454 测试全绿。
- 视觉与参考 2「日落收藏家」的现代玻璃质感风格接近。
- 遗留：FPS 稳态值需真实 GPU 机器重测（不阻塞）。
