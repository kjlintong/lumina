# P26a · Phase 0 止血（工程部分）

> 来源：`/home/ryan/project/Lumina项目审查与后续工作方案.md` §二 Phase 0 第 1、2、4、5 项。
> HEAD 基线：`7ac61a2`（P25 完成），774 测试全绿，构建通过。
> 本阶段**不动**：入夜画面（P26b 单独规格）、SceneDoc/命令栈、拖放、资产管线、WebGPU 复活。

---

## 1. 目标（判定标准）

1. `dist/assets/` 下**不存在**任何 `three-webgpu-*.js` chunk（`ls dist/assets/ | grep -i webgpu` 应无输出）。
2. `src/` 下 `grep -rln 'three/webgpu\|WebGPURenderer\|BackendType' src --include=*.ts --include=*.tsx` 应无输出（`iesTexture.createIESTexture` 例外，见 §2.4）。
3. 打开 dev server，首屏 17:45 **时间不再自动流逝**：`__lumina.stats().timeSpeed === 0`，且 10 秒后仍为 17:45。
4. 1600×900 视口，左侧 sidebar 展开时，标题「Lumina — 灯光设计系统」**不与**任何左栏内容重叠（overlay 与 sidebar 之间留 ≥ 8px 间距，或 overlay 在 sidebar 内）。
5. 专业模式**未开启**时，Bloom / Godrays 的所有滑块在 DOM 里**不存在**（非仅 CSS 隐藏）。
6. `__lumina.perfBill()` 一次性返回性能账单表；`npm run verify` + `npm run build` 全绿。

---

## 2. 交付物

### 2.1 冻结 WebGPU —— 删除双后端

**范围**：以下所有出现的 `webgpu` 后端代码路径。

- `src/render/backend.ts`
  - 删除 `BackendType` 联合类型里的 `'webgpu'`，改成 `export type BackendType = 'webgl2';`
  - 删除 `detectWebGPU` 函数（第 151–169 行）
  - 删除 `BackendOptions.forceBackend`（无 webgpu 后无意义）
  - 删除 `BackendOptions.canvas` 之外的分支，`createBackend` 直接返回 WebGL2 后端
  - 删除 `BackendCapabilities` 中 `supportsIES: true` / `supportsGodrays: true` / `supportsEffectComposer: false` 的 webgpu 分支；保留 WebGL2 分支的值：`supportsIES: false`（IES 走 `iesParser` + spot 纹理近似路径，见 §2.4 说明）、`supportsGodrays: enablePost`、`supportsEffectComposer: enablePost`
  - 删除 `import type { WebGPURenderer } from 'three/webgpu';`
  - 删除 catch 里 `degradationReason = 'WebGPU 初始化失败…降级到 WebGL2'` 那段（不再有降级）
  - 文件头注释改为「单后端：WebGL2」

- `src/render/autoExposure.ts`
  - 删除文件头注释中 `- WebGPU: compute pass / 回读 buffer` 一行
  - **保留**整个类与 `ExposureSampler` 接口（`sceneEngine.ts` 里仍 new 一份做未来恢复；P9b 注释说得很清楚：类保留但 `update()` 不再调用）

- `src/render/iesTexture.ts`
  - 文件头第 13 行 `2. createIESTexture — 180×1 DataTexture，供 WebGPU IESSpotLight.iesMap（P8）` 改写为：`2. createIESTexture — 180×1 DataTexture（当前 WebGL2 路径暂不使用，为未来 WebGL2 自定义 IES 纹理或 WebGPU 复活保留；本轮不删函数体）`
  - 删除 `// WebGPU: 1D IES 纹理` 那一行内联注释，改为 `// IES 1D 纹理（历史包袱，暂留）`
  - **不删** `createIESTexture` 函数体本身 —— 现有 `iesTexture.test.ts` 有 4 个用例覆盖它，删了会连带删测试。

- `src/render/__tests__/iesTexture.test.ts`
  - `describe('createIESTexture — WebGPU 1D 纹理', …)` 改为 `describe('createIESTexture — 1D IES 纹理', …)`
  - 用例不动

- `src/render/plants.ts`
  - 第 112 行注释 `canvas 不参与，jsdom / WebGPU / WebGL2 均可用` → `canvas 不参与，jsdom / WebGL2 均可用`

- `src/render/backend.ts` 里 `type: 'webgl2'` 相关断言全保留。

- `src/scene/sceneEngine.ts`
  - 第 404 行附近注释 `// WebGPU 后端不实现 getAverageLuminance（异步 render + buffer 回读` 整段改写，去掉 webgpu 提法，保留「仅 WebGL2 路径」这一事实。
  - 第 499 行注释 `// 仅 WebGL2 路径生成；WebGPU / 测试 mock 安全跳过（见 initEnvironment）。` → `// 仅 WebGL2 路径生成；测试 mock 安全跳过（见 initEnvironment）。`
  - 第 757 行注释 `仅 WebGL2 后端可用；WebGPU 后端跳过（保留 ambient/hemi 兜底）。` → `WebGL2 后端可用；测试 mock 跳过（保留 ambient/hemi 兜底）。`
  - 第 761–762 行注释整段删除（「已知缺口（P12 标注）：WebGPU 路径无 IBL…」——不再需要）
  - 第 1121 行注释 `// setBloom 是可选方法（WebGPU 后端无后处理），用 ?. 保底。` → `// setBloom 是可选方法（部分 mock 后端无后处理），用 ?. 保底。`
  - 第 1244 行注释 `// - triangles：WebGL2 取 renderer.info.render.triangles；WebGPU 无此 API，` → `// - triangles：renderer.info.render.triangles（部分 mock 无此 API，`

- `src/App.tsx`
  - 删除 `const [degradation, setDeggradation] = useState<string | null>(null);`
  - 删除 `init()` 中 `setDeggradation(result.degradationReason ?? null);`（若存在）
  - 删除 JSX 里 `{import.meta.env.DEV && degradation && ( <div className="info dev-only">…</div> )}` 那整块（第 546–551 行）
  - 删除 `{!ready && !degradation && <div className="loading">加载中...</div>}` 中的 `!degradation && `，改成 `{!ready && <div className="loading">加载中...</div>}`
  - `const [backendType, setBackendType] = useState<BackendType>('webgl2');` 保留；`setBackendType(result.backend.type);` 保留（现在只会是 `'webgl2'`）
  - 保留 `import type { BackendType, RenderBackend } from './render/backend.js';`（`BuildBadge` 仍要显示后端）

- `src/ui/panels/RenderPanel.tsx`
  - 删除 `postProcessing` prop（WebGPU 单后端下恒为 true）；Bloom 条件 `{postProcessing && bloom && (…` 改成 `{bloom && (…`
  - 第 251 行注释 `不依赖 EffectComposer，WebGL2 与 WebGPU 后端均可用。` → `不依赖 EffectComposer。`

- `src/ui/panels/BuildBadge.tsx`
  - 第 10 行注释 `/** 渲染后端标识（webgl2 / webgpu） */` → `/** 渲染后端标识 */`
  - `props.backend: BackendType` 类型改为字面量 `'webgl2'`（或保留引用 `BackendType`，二者都行）

- `src/ui/panels/HudStats.tsx`
  - 第 15 行注释 `三角面数；WebGPU 路径无此数据，传 null 显示 —` → `三角面数；mock 后端无此数据，传 null 显示 —`

- `src/ui/__tests__/hudBadge.test.tsx`
  - 用例「WebGPU（triangles=null）折叠态只显示 FPS；展开后三角面为占位 —」改标题为「mock 后端（triangles=null）…；其余不动。
  - 若该用例里传了 `backend="webgpu"`，改为 `backend="webgl2"`。

- `src/App.test.tsx`
  - 顶部整块「P10：WebGPU → WebGL2 降级提示（`degradation`）只在 dev 模式显示。」的 mock setup 与 `describe('App：degradation 提示的 dev/prod 可见性（P10 §交付物 3）'…` 整段**删除**。
  - 保留 `vi.mock('./render/backend.js', …)`，但改成返回**没有** `degradationReason` 的成功结果；`vi.mock('./render/sceneEngine.js', …)` 原样保留。
  - `setDev` 辅助函数与「专业模式门禁」`describe` 块原样保留（仍依赖 `import.meta.env.DEV`）。

- `src/scene/__tests__/sceneEngineFixture.test.ts`、`sceneEngine.test.ts`、`sceneController.test.ts`
  - 各文件的 mock capabilities 里保留 `supportsIES/supportsGodrays/supportsEffectComposer` 字段（backend.ts 里 `BackendCapabilities` 接口保留），无 webgpu 语义改动，不动。

- `package.json`
  - `description` 由 `Lumina — 家庭/室内灯光设计系统（Three.js r186，WebGPU 主 / WebGL2 兜底）` 改为 `Lumina — 家庭/室内灯光设计系统（Three.js r186，WebGL2 单后端）`

- `docs/lookdev/README.md`、`docs/lookdev/frames.md`、`CLAUDE.md`
  - `CLAUDE.md`：整段「### 导入路径」里 `// WebGPU 渲染器（独立 entry，不在 three 主入口导出）`、`// WebGPU 专属`、`// WebGPU 路径无 IBL`、`// 双后端后期链不做像素一致承诺` 全部删除；保留 WebGL2 侧。
  - `docs/lookdev/README.md`、`docs/lookdev/frames.md` 里若有 webgpu 提及，全部删除或改写为 WebGL2 单后端。

**验证**：`grep -rIn "webgpu\|WebGPU" src docs package.json CLAUDE.md` 应只匹配到 `src/render/iesTexture.ts`（函数注释保留）与 `src/render/__tests__/iesTexture.test.ts` 中「1D IES 纹理」这类纯描述（不能带「WebGPU」词）。构建产物 `dist/assets/` 无 webgpu chunk。

### 2.2 时间默认冻结

- `src/App.tsx` 第 341 行 `timeSpeed: 0.1,` → 删除该行（engine 默认 0，见 `sceneEngine.ts:326`）。
- 同段注释改写为「初始 17:45（日落前），默认 timeSpeed=0 冻结；播放由 TimeAxis 速度滑杆显式操作」。
- `TimeAxis` 里的 speed 状态初值已是 0（`App.tsx:222` `useState(0)`），无需改。

### 2.3 布局修复 —— 户型图 / HUD 重叠

现状：`index.html` 里 `.overlay { top:10px; left:10px; z-index:5 }`，`.sidebar-left { left:0; top:0; z-index:6 }`。左侧 sidebar 展开时（默认 `leftOpen=true`）overlay 被 sidebar 完全覆盖，但 overlay 里「时间 / 后端 / 帧率」仍在 DOM 上，视觉上挤在左上角。

**修法**：把 overlay 拆成上下两块，HUD 数字下移到 sidebar 下方。

- `index.html` `.overlay` 改为：
  ```css
  .overlay { position: absolute; top: 10px; left: 10px; right: 340px; display: flex; gap: 12px; align-items: flex-start; z-index: 5; pointer-events: none; }
  .overlay .hud-block { background: var(--bg-panel); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border: var(--border-subtle); border-radius: var(--radius-lg); padding: 10px 14px; font-size: var(--font-size-md); line-height: 1.5; }
  ```
- `.overlay` 的 padding 属性从 overlay 本身移除，改到 `.hud-block`（如上）。
- App.tsx JSX 里把 overlay 内部拆成两个 `<div className="hud-block">`：
  - 左块：title + 渲染后端 + 时间 + 日落 warning（原 overlay 内容）
  - 右块：`<HudStats stats={renderStats} />`（帧率）
- 保持右侧 sidebar 展开时 overlay `right: 340px` 不侵入。若右侧也展开（默认 `rightOpen=true`），overlay `right` 也应预留 340px；用 CSS 变量或简单 `right: 340px` 硬编码即可（当前两 sidebar 都是 320px + 22px toggle）。
- 新增 CSS：`.app-root.app-no-right .overlay { right: 10px; }`（可选，非必需，本轮不做）。

**判定**：1600×900 视口 + 两侧 sidebar 展开，overlay 与左右 sidebar 内容均无重叠（截图人工确认）。

### 2.4 Bloom / Godrays 滑块收进 dev 面板

审查方案 §Phase 0 第 5 项：「Bloom/Godrays 滑块收进 `import.meta.env.DEV` 才显示的 dev 面板」。C 端用户（含专业模式）只看到「氛围层」与「项目管理」。

- `src/App.tsx`
  - 新增 `const isDev = import.meta.env.DEV;`（组件作用域顶部，或直接在 JSX 表达式里用）。
  - `<RenderPanel … postProcessing={backendType === 'webgl2'} />` 里去掉 `postProcessing` prop（见 §2.1）。
  - 新增 prop `devOnly={{ bloom: isDev, godrays: isDev }}`（或干脆 `hidePostProcessing={!isDev}` 一个布尔）。选择后者更简单：`<RenderPanel hidePostProcessing={!import.meta.env.DEV} … />`

- `src/ui/panels/RenderPanel.tsx`
  - Props 新增 `hidePostProcessing?: boolean;`（默认 false）
  - Bloom 区块外层条件从 `{bloom && (` 改为 `{bloom && !hidePostProcessing && (`
  - Godrays 区块外层条件同理
  - 「氛围层」「项目管理」「开发者」区块**不受影响**，保持可见。
  - 文件头注释补一句：`hidePostProcessing=true 时（生产环境）隐藏 Bloom/Godrays 调参；氛围层（尘埃/光柱）与项目管理对所有人可见。`

- `src/App.test.tsx`
  - 新增用例「生产模式（DEV=false）下 Bloom/Godrays 滑块不渲染」：`setDev(false); renderApp(); flushEffects();` 断言 `container.textContent` 不含 `光晕 (Bloom)` 与 `体积光 (Godrays)`。
  - 新增用例「开发模式（DEV=true）下 Bloom/Godrays 滑块渲染」：反向断言。
  - **注意**：这两个用例依赖 RenderPanel 在专业模式下才挂载。先勾选专业模式（复用现有「专业模式门禁」块的展开逻辑），再断言。

### 2.5 性能账单探针 —— `__lumina.perfBill()`

- `src/dev-debug.ts` 新增 `perfBill(): Promise<PerfBillResult>`：
  ```ts
  perfBill(): Promise<PerfBillResult> {
    return (async () => {
      const r = ready();
      if (!r) return { gpu: '(engine not ready)', cells: [] };
      const engine = r.engine;
      const backend = r.backend;
      const R = backend.getRenderer();
      const gpu = detectGPU();   // 见下
      const cells: PerfBillCell[] = [];
      const matrix: Array<{ label: string; apply: () => void }> = [
        { label: 'baseline',            apply: () => {} },
        { label: 'shadows off',         apply: () => R.shadowMap.enabled = false },
        { label: 'shadows on',          apply: () => R.shadowMap.enabled = true },
        { label: 'godrays off',         apply: () => backend.setGodrays?.({ enabled: false }) },
        { label: 'godrays on',          apply: () => backend.setGodrays?.({ enabled: true, weight: 1.0, density: 1.0, decay: 0.9, screenRadius: 0.35, sampleCount: 24 }) },
        { label: 'bloom off',           apply: () => backend.setBloom?.(0, 0, 1) },
        { label: 'bloom on',            apply: () => backend.setBloom?.(0.22, 0.3, 0.85) },
      ];
      for (const { label, apply } of matrix) {
        apply();
        // 稳定 60 帧，取中位数 FPS
        const fpsSamples = [];
        for (let i = 0; i < 60; i++) {
          await new Promise((res) => requestAnimationFrame(res));
          fpsSamples.push(engine.getRenderStats().fps);
        }
        fpsSamples.sort((a, b) => a - b);
        const median = fpsSamples[Math.floor(fpsSamples.length / 2)] ?? 0;
        cells.push({ label, medianFps: +median.toFixed(1), drawCalls: R.info.render.calls, triangles: R.info.render.triangles });
      }
      return { gpu, cells, hour: engine.getHour(), toneMappingExposure: R.toneMappingExposure };
    })();
  },
  ```
  - `detectGPU()`:
    ```ts
    function detectGPU(): string {
      const R = (() => {
        try {
          const c = document.createElement('canvas');
          const gl = c.getContext('webgl2') || c.getContext('webgl');
          if (!gl) return '(no webgl)';
          const dbg = gl.getExtension('WEBGL_debug_renderer_info');
          return dbg ? (gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '(unknown)') : '(unknown)';
        } catch {
          return '(unknown)';
        }
      })();
      return R;
    }
    ```
  - 顶部类型：
    ```ts
    interface PerfBillCell { label: string; medianFps: number; drawCalls: number; triangles: number; }
    interface PerfBillResult { gpu: string; cells: PerfBillCell[]; hour: number; toneMappingExposure: number; }
    ```
- 用法文档：写在 `src/dev-debug.ts` 顶部注释 —— `访问 /?debug，console 执行 __lumina.perfBill().then(console.table)` 得到 7 行账单表（baseline + 6 个开关组合）。

**验证**：在真实 GPU 上 `npm run dev` → 打开 `/?debug` → console 里 `__lumina.perfBill().then(console.table)`，产出 7 行；至少 1 个 case ≥30fps 才算 Phase 0 DoD 达标（方案 §Phase 0 DoD：1920×1080 稳定 ≥30fps）。

---

## 3. 不做的事（明确排除）

- **不**修入夜全黑 —— 见 P26b 规格，独立提交。
- **不**动 `src/core/**`、`src/modeling/**`、`src/store/modelingStore.ts`、`ModelPanel.tsx`、`ModelCanvas.tsx`、`ImportPanel.tsx`、`ModelPlan.tsx`、`zonePanel`、`FixturePanel`。
- **不**新增 npm 依赖（尤其是 `@types/webgpu` 之类）。
- **不**改 `vite.config.ts`、`tsconfig.json`、`eslint.config.js`。
- **不**引入 `three/webgpu` 之外的新 entry（不要 `three/examples/jsm/loaders/IESLoader` 之类）。
- **不**改 AutoExposure 类逻辑（P9b 已定型），只改注释。
- **不**改测试断言来「凑绿」——若某个断言因改动不再成立，改断言**并**在 commit message 里说明。

---

## 4. 测试

- **既有测试**：`npm run verify` 全绿；总测试数应 ≥ 774（可能因删除 `App.test.tsx` 里的 degradation 块而下降 2 个，但新增 2 个 dev/prod Bloom/Godrays 用例，最终 ≥ 774）。
- **新增/修改的测试**：
  - `App.test.tsx` 新增两个用例（见 §2.4）。
  - `App.test.tsx` 删除 degradation describe 块。
  - `hudBadge.test.tsx` 用例标题改。
  - `iesTexture.test.ts` 用例标题改。
- **手动验证清单**（真实 GPU 上）：
  1. `npm run dev` → 打开首页 → 观察 10 秒，右上角时间始终是 17:45。
  2. 1600×900 视口，截图，检查 overlay 与两侧 sidebar 无重叠。
  3. 未勾选专业模式，DOM 里搜 `光晕`、`体积光`、`Bloom`、`Godrays` 均无匹配。
  4. 勾选专业模式 + 生产模式（无 `?debug`），DOM 里仍无 Bloom/Godrays 滑块。
  5. `/?debug` + console `__lumina.perfBill().then(console.table)` 输出 7 行。

---

## 5. 红线

- `src/render/backend.ts` 是本轮核心改动点，改动范围**仅限** §2.1 列出的删除/改写；不得重写整文件、不得引入新抽象层。
- `sceneEngine.ts` 只改注释，不动逻辑。
- `App.tsx` 只改：degradation 状态与 JSX 分支、`timeSpeed` 初始值、overlay 结构拆分、`<RenderPanel>` prop、`isDev` 引入。**不动** store 订阅、`syncFixtures/syncZones`、`onPointerDown/Up` 选灯、IES 预加载、`setFrameCallback`。
- **不**删除 `src/render/autoExposure.ts`（P9b 注释里明确「类保留供未来恢复」）。
- **不**删除 `createIESTexture` 函数体（§2.1）。
- 回退成本：本阶段所有改动都是删除或改写，没有新增抽象。若整体回退，`git revert <P26a-hash>` 即可。

---

## 6. 提交

一次 commit，格式：

```
P26a: Phase 0 止血（工程部分）

- 冻结 WebGPU：删除双后端与 detectWebGPU，锁 WebGL2 单后端，构建产物瘦身
- 时间默认冻结：App 不再传 timeSpeed=0.1，engine 默认 0
- 布局修复：overlay 拆两块 HUD + 与两侧 sidebar 留 340px 通道
- Bloom/Godrays 滑块收进 dev 面板（生产环境不可见）
- 新增 __lumina.perfBill() 性能账单探针（7 个开关组合）
- 同步 CLAUDE.md / lookdev 文档中的 webgpu 描述
```

不 push。

---

## 7. 交付证据

回报时给出：
- `commit_hash`（`git rev-parse HEAD`）
- `npm run verify` 结果（含测试总数）
- `npm run build` 后 `ls dist/assets/*.js` 输出（**必须无 webgpu**）
- `grep -rIn "webgpu\|WebGPU" src package.json CLAUDE.md docs/lookdev` 剩余匹配（应仅 `iesTexture.ts` 与 `iesTexture.test.ts` 中的纯描述）
- 改动文件清单（`git show --stat HEAD`）
- `deviations`（任何偏离规格的地方 + 理由）
