# P34 — Phase 3 · 批量布灯 + 光源预算 + 场景预设映射 + 照度伪彩

> 属于 `Lumina项目审查与后续工作方案.md` §二 Phase 3。
> 前四轮已拍板但**尚未落地**的两条硬约束，本次一并补齐：
> - §Phase 3.4「**实时光源 ≤ 8 个上限**」（W5 前必须定，否则后面推翻重写）
> - §Phase 3.1「批量布灯：沿墙等距、矩形阵列、房间居中——**单点逐个摆几十盏筒灯会让用户崩溃**」
>
> 优先级（本次交付）：**A 光源预算 → B 批量布灯 → C 场景预设映射 → D 照度伪彩**。
> A 是所有其它项的地基（B 一次可能放 20+ 盏，若不做预算必卡死），必须最先做。

---

## 1. 现状（代码级确认，非转述）

| 项 | 现状 | 证据 |
|---|---|---|
| 实时光源上限 | **无**。`buildLightFromFixture` 对任何类型都造真光源；`SceneEngine.addFixture/removeFixture` 逐盏 `add/remove` 到 `this.fixtureLights: Map` | `src/render/lightBuilder.ts:248` `switch (f.type) { case 'downlight'… new SpotLight…`；`src/scene/sceneEngine.ts:822/838` |
| 光源预算的 UI 反馈 | 无；`HudStats` 只显示 triangle / object / fps | `src/ui/panels/HudStats.tsx` |
| 批量布灯 | **无**。`FixtureLibraryPanel` 只有「点图标→点击落位」的 1×1 拖放路径 | `src/ui/panels/FixtureLibraryPanel.tsx` |
| 回路 / 场景预设 | `Fixture.control.circuit` 只有 `'main'` 一个默认值；`project.scenes` 字段存在但 `ScenePanel` 只渲染 `PRESET_SCENES`（6 个内置），从未写 `project.scenes` | `src/core/types.ts:176/241/250+`；`src/ui/panels/ScenePanel.tsx` |
| 照度伪彩 | 只有活动区行照度（`IlluminancePanel`），没有空间热图 | `src/lighting/illuminance.ts` 提供了 `fixtureContribution`，可以复用 |
| 描墙提交后能拿到房间？ | `modelingStore.commitRoom` 只写 `modelingStore.model`，`projectStore.project.model` 只在 `applyTemplate/clearModel/commitRoom/applyExtractResult` 4 处被同步 | `src/store/modelingStore.ts:syncToProjectStore` + `commitRoom:207` |

**架构判断**：以上 4 项**全是新增纯函数 + 薄 UI 面板**，不需要动现有测试，不需要动渲染管线核心（`renderOnce`、`updateSunPosition`、`postProcessing`），不需要动 `ModelGeometry` 契约。可以在 1 天内跑通 A+B，再加 0.5 天做 C+D。

---

## 2. 设计原则（本次要守住的 3 条）

1. **纯函数优先，UI 只调用不实现**：所有几何/预算/预设映射/伪彩计算都进 `src/core/*` 与 `src/render/*` 的纯模块，可 jsdom 单测。
2. **不破坏 ADR**：
   - ADR-17「user-locked 保护」——预算算法**不得**把用户锁过 `light.intensity` 的灯降级成 proxy；
   - ADR-01「删除不级联」——批量撤销必须整批撤销，不能拆成逐盏（走单条 `Command`，见 §6）；
   - ADR-12「灯具是独立实体」——批量放置仍然逐盏建 `Fixture`，不做「一组灯」这种新概念。
3. **不引入新数据概念**：不新增 `LightGroup`、`LightingScheme` 之类新实体；`Circuit` 沿用 `control.circuit`（字符串），场景预设沿用 `SceneDefinition`（`{ name, levels, cct? }`）。

---

## 3. Part A — 实时光源 ≤ 8 上限（预算）

### 3.1 `src/render/lightBudget.ts`（新增，纯函数模块）

```ts
/**
 * 实时光源预算（P34 · Phase 3 §4）。
 *
 * 背景：一盏 SpotLight（带 shadow）≈ 12–15ms，一盏 PointLight（无 shadow）≈ 5–8ms，
 * 一盏 RectAreaLight（无 shadow，需 LTC 表）≈ 6–10ms。P9 记录：2 盏 PointLight
 * 即 12 张阴影贴图；P33 后默认工程 3 盏 SpotLight + 1 盏 PointLight 已让
 * 1080p 桌面浏览器落到 30fps 边缘。**50 盏筒灯 = 50 个 SpotLight 必卡死**。
 *
 * 策略：预算按"类型优先级"分配。前 N 盏（N = MAX_REAL_LIGHTS）保留真光源，
 * 其余降级为「proxy」（只保留 `shade` 灯罩 Mesh，不建 `Light` 对象）。
 * 视觉损失可控——超过 8 盏的灯多数是远处筒灯，人眼感知不到它们的光照贡献。
 *
 * **user-locked 保护（ADR-17）**：用户手动调过 `light.intensity` 的灯**优先**
 * 保留为真光源，因为降级会让 UI 上显示的数字与视觉不一致，是最容易被投诉的一类 bug。
 */

import type { Fixture } from '../core/types.js';

/** 实时光源硬上限。审查方案 §Phase 3.4：50 盏筒灯必卡，8 盏是 P9/P26b 实测下能稳定 30fps 的临界点。 */
export const MAX_REAL_LIGHTS = 8;

/** 预算项：一盏灯的"渲染身份" */
export interface LightBudgetEntry {
  /** 灯具 id */
  id: string;
  /** true = 保留真光源；false = 只保留灯罩 Mesh（proxy 模式） */
  isReal: boolean;
  /** 保留为真光源的原因（用于 UI 提示，非必需） */
  reason: 'shadow' | 'locked' | 'budget' | 'proxy';
}

export interface LightBudgetResult {
  /** 有序的预算表，`isReal=true` 的在前，`isReal=false` 的在后 */
  entries: LightBudgetEntry[];
  /** 真光源集合（O(1) 查询） */
  realSet: ReadonlySet<string>;
  /** proxy 集合 */
  proxySet: ReadonlySet<string>;
  /** 是否被截断（`fixtures.length > MAX_REAL_LIGHTS` 时为 true） */
  truncated: boolean;
}

/** 光源类型 → 3D 引擎构造类型（用于优先级排序） */
function lightKind(f: Fixture): 'spot_shadow' | 'spot_noshadow' | 'point' | 'rect' {
  switch (f.type) {
    case 'downlight':
    case 'spot':
      return 'spot_shadow';      // buildLightFromFixture 里这两个走 SpotLight.castShadow=true
    case 'pendant':
    case 'sconce':
    case 'floor':
    case 'table':
      return 'point';            // PointLight，无 shadow
    case 'linear':
    case 'cove':
      return 'rect';             // RectAreaLight，无 shadow
  }
}

/**
 * 计算预算。
 *
 * 排序键（字典序，越小越靠前 = 越应该保留真光源）：
 *   1. `isLocked` 降序（user-locked 优先，ADR-17）
 *   2. `kind` 权重：spot_shadow=0, spot_noshadow=1, point=2, rect=3
 *      （SpotLight 带 shadow 最贵也最"可见"，先保留）
 *   3. `id` 升序（同权重的稳定排序，测试可预测）
 */
export function computeLightBudget(
  fixtures: Iterable<Fixture>,
  maxReal = MAX_REAL_LIGHTS,
): LightBudgetResult {
  const list = [...fixtures];
  const kindRank = { spot_shadow: 0, spot_noshadow: 1, point: 2, rect: 3 } as const;

  const sorted = list.slice().sort((a, b) => {
    const aLocked = a.lockedFields.has('light.intensity');
    const bLocked = b.lockedFields.has('light.intensity');
    if (aLocked !== bLocked) return aLocked ? -1 : 1;
    const ra = kindRank[lightKind(a)];
    const rb = kindRank[lightKind(b)];
    if (ra !== rb) return ra - rb;
    return a.id.localeCompare(b.id);
  });

  const entries: LightBudgetEntry[] = sorted.map((f, i) => {
    if (f.lockedFields.has('light.intensity')) return { id: f.id, isReal: true, reason: 'locked' };
    if (i < maxReal) {
      const kind = lightKind(f);
      return {
        id: f.id,
        isReal: true,
        reason: kind === 'spot_shadow' ? 'shadow' : 'budget',
      };
    }
    return { id: f.id, isReal: false, reason: 'proxy' };
  });

  const realSet = new Set(entries.filter((e) => e.isReal).map((e) => e.id));
  const proxySet = new Set(entries.filter((e) => !e.isReal).map((e) => e.id));

  return {
    entries,
    realSet,
    proxySet,
    truncated: list.length > maxReal,
  };
}
```

### 3.2 `src/render/lightBuilder.ts` — `buildLightFromFixture` 支持 proxy

在 `LightBuildResult` 加两个字段，`buildLightFromFixture` 加第二个可选参数：

```ts
// 追加到 interface LightBuildResult（在 approximated 之后）
  /** P34：本结果是否被降级为 proxy（只保留 shade，不建 Light） */
  isProxy: boolean;
  /** proxy 的降级原因（`reason` 值同 `computeLightBudget`） */
  budgetReason?: 'shadow' | 'locked' | 'budget' | 'proxy';
```

函数签名与逻辑改动：

```ts
export interface BuildLightOptions {
  /** P34：降级为 proxy 时不建 Light 对象，只返回 shade */
  proxy?: boolean;
  /** proxy 原因（用于 UI 展示，非必需） */
  budgetReason?: 'shadow' | 'locked' | 'budget' | 'proxy';
}

export function buildLightFromFixture(
  f: Fixture,
  opts: BuildLightOptions = {},
): LightBuildResult {
  // ……（原有全部逻辑保留，一直到 `switch (f.type)` 之前的所有计算）……

  // P34：proxy 分支——在 switch 之前提前返回
  if (opts.proxy) {
    // shade 依然要建（视觉不能缺），但不挂 Light 到 group
    // fixtureModels.ts 只导出 buildDownlightModel/buildSpotModel/… 8 个分型构造器，
    // 没有单一入口；proxy 分支里复用 lightBuilder 里已经 import 的 switch-on-type
    // 分支（复制一份到此处，或把「只建 shade」的部分抽成 buildShadeOnly(f)）。
    // 推荐做法：把 lightBuilder 内已有的 switch 里的「只保留 shade 部分」抽成
    // private function buildShadeOnly(f: Fixture): Mesh，switch 主路径与 proxy
    // 分支都调用它，避免重复。
    const shade = buildShadeOnly(f);
    group.add(shade);
    return { object: group, light: undefined, shade, isIES: false, approximated: false, isProxy: true, budgetReason: opts.budgetReason };
  }

  // ……（原有 switch (f.type) 完整保留）……
  // 返回时补两个字段的默认值：isProxy: false, budgetReason: undefined
}
```

**关键约束**：`buildShadeForFixture` 若不存在，就用 `fixtureModels.createFixtureMesh(f)`（P30 已有的入口）；不要动 `fixtureModels.ts`。

### 3.3 `src/scene/sceneEngine.ts` — 接入预算

**改动最小化**：不引入新数据结构，只在 `fixtureLights` Map 的写入/删除路径加上预算决策。

```ts
// 类字段新增
private lightBudget: LightBudgetResult | null = null;

/**
 * P34：根据 project.fixtures 全量重算预算，再决定要 add/remove/rebuild 哪些灯。
 *
 * 触发点（新增，不改现有方法签名）：
 *   - addFixture / removeFixture 后调用（fixtureLights 变更）
 *   - updateFixture 后**仅在 `light.intensity` 字段变化时**调用（避免拖动 50 盏灯时反复重算）
 *   - rebuildRoom / rebuildFromModel 后调用（几何变了，房间布局可能变）
 *
 * 算法（简化版，O(n log n)）：
 *   1. newBudget = computeLightBudget(current fixtures)
 *   2. 对 newBudget.realSet 中「本不在旧预算」的 id → 建真光源
 *   3. 对 newBudget.proxySet 中「本在旧预算」的 id → 拆成 proxy（shade only）
 *   4. 对 oldBudget 中已存在、新预算无变化的 id → 不动
 */
private recalculateBudget(): void {
  const fixtures = new Map<string, Fixture>();
  // 从 projectStore 读：
  //   useProjectStore.getState().project.fixtures
  // 但 sceneEngine 不 import store —— 通过已有的 `this.fixtureLights` 反查 +
  // 传入的 fixture 引用重建（addFixture 时已经存了 fixture）。
  // 更稳的做法：addFixture 已把 fixture 引用存入 entry，可直接遍历。
  const all: Fixture[] = [];
  for (const entry of this.fixtureLights.values()) {
    if (entry.fixture) all.push(entry.fixture);
  }
  const newBudget = computeLightBudget(all);

  // …… 差异同步逻辑 ……

  this.lightBudget = newBudget;
}
```

**最小实现路径**（建议子代理走这条）：
1. `fixtureLights` 的 entry 里已有 `fixture: Fixture` 字段（P28/P29 起存了）——先确认；如果没有，本次一并补上。
2. `addFixture` 内现有流程末尾追加 `this.recalculateBudget()`；`removeFixture` 同理。
3. `updateFixture` 只在 `fixture.lockedFields` 或 `fixture.type` 变化时触发重算（`light.intensity` 的锁定影响 ADR-17 优先权）。

`buildLightFromFixture` 的调用点全部改为：
```ts
const result = buildLightFromFixture(fixture, {
  proxy: !budget.realSet.has(fixture.id),
  budgetReason: entry.reason,
});
```

### 3.4 `src/ui/panels/HudStats.tsx` — 顶部提示行

在 FPS/triangles 那一行的**上方**新增一行（不动现有内容）：

```tsx
{budgetTruncated && (
  <div style={{ color: 'rgba(255,200,120,0.75)', fontSize: 11 }}>
    光源 {realCount}/{total} 实时，其余为投影；{lockedDropped} 盏锁定灯已保留
  </div>
)}
```

数据来源：给 `SceneEngine` 加一个只读接口 `getLightBudget(): LightBudgetResult | null`，让 App 层传给 `HudStats`。

### 3.5 Part A 验收

- `npm run typecheck` 0 error
- `npm test` 全绿，新增 `src/render/__tests__/lightBudget.test.ts` 8 用例
- `npm run build` 仍 2 chunk
- 端到端回归：默认工程 3 盏灯全真光源；把默认工程复制粘贴 20 盏筒灯后，`getLightBudget().entries` 中 `isReal=true` 恰好 8 个，其余 12 个 `isProxy=true`，**且**被降级的 12 盏灯罩 Mesh 依然可见（`engine.getFixtureDiagnostics()` 里 `shade.visible=true`）。

---

## 4. Part B — 批量布灯

### 4.1 `src/render/layout.ts`（新增，纯函数）

**只放几何，不造 Fixture**——避免让 `core/` 之外的模块反向 import `makeFixture` 造成循环依赖。所有 Fixture 构造放到 UI/store 层做。

```ts
/**
 * 批量布灯几何（P34 · Phase 3 §1）。
 *
 * 4 种摆放模式（审查方案原文）：
 *   - 'grid'     : 矩形阵列（用户给 x/z 范围 + 行列数）
 *   - 'perimeter': 沿墙等距（给定 walls 集合，两端 inset 后等分）
 *   - 'center'   : 房间居中（1 盏，取 `roomArea.centroid`）
 *   - 'sconce'   : 沿墙等距壁灯（同 perimeter，但 y = 壁灯高度、方向朝外）
 *
 * 输出**位置候选**（世界坐标 [x, y, z] + mount + 法线），UI/store 层负责调
 * makeFixture() 造 Fixture 并写回 store。这样便于：
 *   - 复用 `mountFromNormal` 决定 mount 值
 *   - 复用命令栈的"整批一条 Command"模式（P27 已有）
 *   - 在 jsdom 单测里精确断言位置
 *
 * 单位一律米（内部 SI，与 modeling.ts 契约一致）。
 */

import type { PlanePoint, WallSegment } from '../core/modeling.js';
import { wallLength } from '../core/topology.js';

export type LayoutMode = 'grid' | 'perimeter' | 'center' | 'sconce';

/** 位置候选 */
export interface FixtureDraft {
  /** 世界坐标（米） */
  pos: readonly [x: number, y: number, z: number];
  /** 安装法线（Y+ = 天花下，Y- = 地面朝上，X/Z ± = 墙面法线） */
  normal: readonly [nx: number, ny: number, nz: number];
  /** 灯具类型建议（UI 可以覆盖） */
  suggestedType: 'downlight' | 'sconce' | 'pendant';
}

/** 布灯参数 */
export interface LayoutOptions {
  mode: LayoutMode;
  /** 灯具距天花（或地面/墙面）的距离，米 */
  offsetFromCeiling?: number;
  /** 层高，米（决定 y 值） */
  ceilingH: number;
  /** 最小间距（防呆） */
  minSpacing?: number;
}

export const DEFAULT_LAYOUT_OPTIONS: Required<LayoutOptions> = {
  mode: 'grid',
  offsetFromCeiling: 0.05,
  ceilingH: 2.8,
  minSpacing: 0.8,
};

/**
 * 矩形阵列（用户给范围 + 行列数）。
 * inset 保证灯不出界：`min(0.3m, spacing * 0.25)`。
 * 返回按行优先（先 row 后 col）稳定的顺序，测试可断言。
 */
export function rectangularGrid(
  bounds: { x0: number; x1: number; z0: number; z1: number },
  cols: number,
  rows: number,
  opts: LayoutOptions = DEFAULT_LAYOUT_OPTIONS,
): FixtureDraft[] {
  const { x0, x1, z0, z1 } = bounds;
  if (cols < 1 || rows < 1) return [];
  const xSpan = x1 - x0;
  const zSpan = z1 - z0;
  const minXSpacing = 0.3;
  const minZSpacing = 0.3;
  // 端部 inset：留 0.15m（约半盏筒灯直径）
  const inset = 0.15;
  const usableX = xSpan - inset * 2;
  const usableZ = zSpan - inset * 2;
  if (usableX < -1e-6 || usableZ < -1e-6) return [];

  const y = opts.ceilingH - opts.offsetFromCeiling;
  const out: FixtureDraft[] = [];
  for (let r = 0; r < rows; r++) {
    const z = rows === 1 ? (z0 + z1) / 2 : z0 + inset + (usableZ * r) / (rows - 1);
    for (let c = 0; c < cols; c++) {
      const x = cols === 1 ? (x0 + x1) / 2 : x0 + inset + (usableX * c) / (cols - 1);
      out.push({
        pos: [x, y, z],
        normal: [0, -1, 0],
        suggestedType: 'downlight',
      });
    }
  }
  return out;
}

/**
 * 沿一条墙等分（perimeter 的原子操作）。
 * 端部 inset 固定 0.3m（防与墙体端面打架）。
 * segments < 1 → 返回 []。
 */
export function wallLineSegments(
  wall: WallSegment,
  segments: number,
  opts: LayoutOptions = DEFAULT_LAYOUT_OPTIONS,
): FixtureDraft[] {
  if (segments < 1) return [];
  const len = wallLength(wall);
  if (len < 0.6) return []; // 太短的墙放不出
  const inset = Math.min(0.3, len * 0.1);
  const usable = len - inset * 2;
  if (usable <= 0) return [];
  const dx = wall.b[0] - wall.a[0];
  const dz = wall.b[1] - wall.a[1];
  const ux = dx / len;
  const uz = dz / len;
  // 墙面法线：左侧，(uz, -ux)（与 wallLabels 的法线约定一致）
  const nx = uz;
  const nz = -ux;

  const out: FixtureDraft[] = [];
  for (let i = 0; i < segments; i++) {
    const t = segments === 1 ? 0.5 : i / (segments - 1);
    const along = inset + usable * t;
    const x = wall.a[0] + ux * along;
    const z = wall.a[1] + uz * along;
    // sconce 高度固定 1.6m（人眼），downlight 走天花
    const y = opts.mode === 'sconce' ? 1.6 : opts.ceilingH - opts.offsetFromCeiling;
    out.push({
      pos: [x, y, z],
      normal: [nx, 0, nz],
      suggestedType: opts.mode === 'sconce' ? 'sconce' : 'downlight',
    });
  }
  return out;
}

/**
 * 房间居中（1 盏）。
 *
 * 用**顶点均值**作为近似质心——对矩形房间精确；对非凸多边形可能与真实质心
 * 不同，但对室内布灯用途够用（真实质心算法要引入 polygon centroid 库，不值）。
 */
export function roomCenter(
  vertices: readonly (readonly [x: number, z: number])[],
  opts: LayoutOptions = DEFAULT_LAYOUT_OPTIONS,
): FixtureDraft[] {
  if (vertices.length < 3) return [];
  let cx = 0, cz = 0;
  for (const v of vertices) {
    cx += v[0];
    cz += v[1];
  }
  cx /= vertices.length;
  cz /= vertices.length;
  const y = opts.ceilingH - opts.offsetFromCeiling;
  return [{ pos: [cx, y, cz], normal: [0, -1, 0], suggestedType: 'pendant' }];
}
```

### 4.2 `src/ui/panels/LayoutPanel.tsx`（新增）

```tsx
/**
 * 批量布灯面板（P34 · Phase 3 §1）。
 *
 * 4 个预设按钮 + 高级参数。点击后一次性 pushCommand（整批一条 Command），
 * 撤销时整批撤销——严格遵守 ADR-01「不级联」的反向（这里是"不拆分"）。
 *
 * 数据来源：`useProjectStore.getState().project.model`。
 *   - 若为 null 或空：提示「请先描墙或使用模板」，按钮禁用
 *   - 若有 rooms：默认选中第一个房间，用户可切换
 *   - 若为空 rooms 但有 walls：只显示 'perimeter' / 'grid'（用户需手输范围）
 */
import { useMemo, useState } from 'react';
import { useProjectStore } from '../../store/projectStore.js';
import { Panel } from './Panel.js';
import {
  rectangularGrid, wallLineSegments, roomCenter,
  DEFAULT_LAYOUT_OPTIONS,
} from '../../render/layout.js';
import { makeFixture } from '../../core/makeFixture.js';
import { pushCommand } from '../../store/commandBus.js';

export function LayoutPanel() {
  const model = useProjectStore((s) => s.project.model);
  const [roomIdx, setRoomIdx] = useState(0);
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(3);
  const [spacing, setSpacing] = useState(1.2); // perimeter 段数
  const [ceilingH, setCeilingH] = useState(model?.slab.ceilingH ?? 2.8);
  const [mode, setMode] = useState<'grid' | 'perimeter' | 'center' | 'sconce'>('grid');

  const disabled = model === null || (model.rooms.length === 0 && model.walls.length === 0);

  const apply = () => {
    if (!model) return;
    const before = useProjectStore.getState().project;
    const drafts = buildDrafts();
    if (drafts.length === 0) return;

    // 造 Fixture
    const fixtures = drafts.map((d) => {
      // 用 mountFromNormal 决定 mount（P28 已有）
      const f = makeFixture({
        type: d.suggestedType,
        pos: [...d.pos] as [number, number, number],
      });
      return f;
    });

    pushCommand({
      label: `批量布灯: ${mode} × ${fixtures.length}`,
      execute: () => {
        const st = useProjectStore.getState();
        const next = { ...st.project, fixtures: { ...st.project.fixtures } };
        for (const f of fixtures) next.fixtures[f.id] = f;
        st.setState({ project: next });
        // 通知 engine：engine.addFixture 每盏调一次
        // （在 App 的 store 订阅里已有；若没有，此处补一个 controller.addFixtures 批处理）
      },
      undo: () => {
        const st = useProjectStore.getState();
        const next = { ...st.project, fixtures: { ...st.project.fixtures } };
        for (const f of fixtures) delete next.fixtures[f.id];
        st.setState({ project: next });
      },
    });
  };

  // …… 略：buildDrafts 根据 mode 调用上面 3 个纯函数 ……

  return (
    <Panel title="批量布灯" defaultOpen={false}>
      {disabled && <div className="empty">请先描墙或选模板</div>}
      {/* 模式按钮 4 个 + 房间下拉 + 参数输入 + 应用按钮 */}
    </Panel>
  );
}
```

### 4.3 App 层订阅：`addFixture` → `engine.addFixture` 批量通知

**关键**：现有 `projectStore.addFixture` 是通过 App 的 useEffect 订阅同步到 engine 的（P28）。批量时若逐盏调用 `engine.addFixture` 会触发 20 次 `recalculateBudget`（A 部分），O(n²)。**必须**改成批量通知：

在 `src/store/projectStore.ts` 追加：

```ts
  /** P34：一次性加入多盏灯（批量布灯路径），避免 N 次触发订阅回调 */
  addFixtures: (fixtures: Fixture[]) => void;
```

实现在 `addFixture` 之后：

```ts
    addFixtures: (newFixtures) => {
      const before = structuredClone(get().project);
      const after = { ...get().project, fixtures: { ...get().project.fixtures } };
      for (const f of newFixtures) after.fixtures[f.id] = structuredClone(f);
      set({ project: after });
      pushCommand({
        label: `批量布灯: ${newFixtures.length} 盏`,
        execute: () => set({ project: after }),
        undo: () => set({ project: before }),
      });
    },
```

在 App 层，把「store 变更 → engine 同步」从**逐盏 diff** 改成**批处理**：

```ts
// 现有：useEffect(() => { if (fixtureId) engine.addFixture(fixture) }, [fixtureId])
// 新增：useEffect(() => { engine.syncFixtures(allIds, addedIds, removedIds) }, [allFixtureIds])
```

`SceneEngine` 追加一个批处理入口：

```ts
  /** P34：一次性同步一批 fixtures 的差异，只重算一次预算 */
  syncFixtures(allFixtures: Record<string, Fixture>): void {
    const before = new Set([...this.fixtureLights.keys()]);
    const after = new Set(Object.keys(allFixtures));
    const removed = [...before].filter((id) => !after.has(id));
    const added = [...after].filter((id) => !before.has(id));

    for (const id of removed) this.removeFixtureInternal(id);
    for (const id of added) {
      const f = allFixtures[id];
      if (f) this.addFixtureInternal(f);
    }
    // 预算只在末尾算一次
    this.recalculateBudget();
  }
```

**约束**：`syncFixtures` 内部**不得**再触发 `recalculateBudget` 于循环里。现有 `addFixture` 是"外部 API"，`addFixtureInternal` 才是内部实现；把 `addFixture` 变成 wrapper，内部 `addFixtureInternal + recalculateBudget`。

### 4.4 Part B 验收

- 4 个纯函数各 6+ 用例，覆盖：正常、退化（`cols=0`、房间 2 顶点）、超小房间（`usableX < 0` 返回 `[]`）、`segments=1` 边界、法线方向正确性
- UI 测试：`LayoutPanel` 在空 model 时按钮禁用；有 model 时能显示 4 个模式按钮
- 端到端：默认工程 → 打开 `LayoutPanel` → 选 'grid 3×3' → 点应用 → HUD 显示「光源 8/10 实时」→ Ctrl+Z → 撤销 9 盏全消失

---

## 5. Part C — 场景预设映射（会客 / 观影 / 阅读）

### 5.1 `src/core/circuitMapping.ts`（新增，纯函数）

```ts
/**
 * 回路 / 场景预设映射（P34 · Phase 3 §2）。
 *
 * **不做**新的 `ScenePreset` 类型——`SceneDefinition` 已有 `{ name, levels, cct? }`，够用。
 * 三种预设（会客/观影/阅读）是「按 circuit 分组的亮度模板」，本文件提供从
 * `Fixture[]` + `PresetId` 到 `SceneDefinition` 的纯映射。
 *
 * 语义边界（**与方案原文对齐**）：
 *   - 只改 `sceneLevels`（每盏灯的亮度）+ `electrical.cct`（色温）
 *   - **不动** `pos` / `shape` / `rot`（ADR「场景只写此表，不动位置与形状」）
 *   - **不动** `lockedFields` 里的字段（ADR-17）
 *   - 场景预设不写 `control.circuit`（circuit 是「物理回路」，跟场景无关；
 *     但预设可以选择「按 circuit 分组应用」——见 `applyToFixtures`）
 */

import type { SceneDefinition, Fixture, CCTValue } from './types.js';

export type PresetId = 'reception' | 'cinema' | 'reading';

/** 3 个预设的元数据 */
export interface PresetMeta {
  id: PresetId;
  name: string;
  description: string;
}

export const PRESET_META: Record<PresetId, PresetMeta> = {
  reception: { id: 'reception', name: '会客', description: '整体明亮、中性偏暖' },
  cinema:    { id: 'cinema',    name: '观影', description: '筒灯全关，边灯/氛围光为主' },
  reading:   { id: 'reading',   name: '阅读', description: '局部高亮、暖色' },
};

/** 每盏灯的亮度/色温目标 */
export interface PresetTarget {
  level: number;
  cct: CCTValue;
}

/** 按 fixture.type 决定目标亮度/色温 */
export function presetTarget(fixture: Fixture, preset: PresetId): PresetTarget {
  switch (preset) {
    case 'reception':
      // 全亮，主灯 100%，边灯 70%，色温 3500K
      if (fixture.type === 'sconce' || fixture.type === 'floor') return { level: 0.7, cct: 3200 };
      return { level: 1.0, cct: 3500 };

    case 'cinema':
      // 筒灯/吊灯/射灯全关，壁灯/落地灯/台灯留 30%，色温暖
      if (fixture.type === 'downlight' || fixture.type === 'spot' || fixture.type === 'pendant')
        return { level: 0, cct: 2700 };
      return { level: 0.3, cct: 2400 };

    case 'reading':
      // 局部（table/spot 高亮），其它低亮
      if (fixture.type === 'table' || fixture.type === 'spot') return { level: 1.0, cct: 3000 };
      if (fixture.type === 'pendant') return { level: 0.5, cct: 3000 };
      return { level: 0.1, cct: 2700 };
  }
}

/**
 * 把预设写到 fixture 上。
 *
 * 返回**新的** `Fixture`（不 mutate），并保留原 `lockedFields` 未锁的字段更新。
 * 若 `fixture.control.sceneLevels[presetKey]` 已存在（用户手动调过），
 * **不覆盖**——遵循 ADR-17。
 */
export function applyPresetToFixture(
  fixture: Fixture,
  preset: PresetId,
  presetKey = preset,
): Fixture {
  const target = presetTarget(fixture, preset);
  const sceneLevels = { ...fixture.control.sceneLevels };
  // ADR-17：用户已锁过 sceneLevels[preset] 的不动
  if (!fixture.lockedFields.has(`control.sceneLevels.${presetKey}`)) {
    sceneLevels[presetKey] = target.level;
  }
  const electrical = {
    ...fixture.electrical,
    // 色温锁定：cct 字段本身
    cct: fixture.lockedFields.has('electrical.cct')
      ? fixture.electrical.cct
      : target.cct,
  };
  return {
    ...fixture,
    control: { ...fixture.control, sceneLevels },
    electrical,
  };
}

/**
 * 把预设写成 SceneDefinition（可保存到 project.scenes）。
 *
 * `SceneDefinition` 契约（src/core/types.ts:250+）：
 *   { key, name, transitionMs, levels: Record<string, number>,
 *     cct: Record<string, number>, exposure?: number }
 * `cct` 是 `Record<string, number>`（**不是** `CCTValue`）——每盏灯的色温值直接写 K 数。
 *
 * `transitionMs` 默认 800ms（与 P28 已有的场景过渡一致）。
 * 用户保存后走 `sceneController.applyScene(sceneKey)` 复用已有动画通道。
 */
export function presetToSceneDefinition(
  fixtures: Iterable<Fixture>,
  preset: PresetId,
  transitionMs = 800,
): SceneDefinition {
  const meta = PRESET_META[preset];
  const levels: Record<string, number> = {};
  const cct: Record<string, number> = {};
  for (const f of fixtures) {
    const t = presetTarget(f, preset);
    levels[f.id] = t.level;
    // presetTarget 返回 CCTValue（number | [min,max]），这里统一取中点作为渲染值
    cct[f.id] = typeof t.cct === 'number' ? t.cct : (t.cct[0] + t.cct[1]) / 2;
  }
  return { key: preset, name: meta.name, transitionMs, levels, cct };
}
```

### 5.2 `src/ui/panels/ScenePanel.tsx` — 追加 3 个预设保存按钮

在现有 6 个内置预设下方追加：

```tsx
<div className="scene-grid" style={{ marginTop: 6 }}>
  <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginBottom: 4 }}>
    快速预设（自动保存到工程）：
  </div>
  {(['reception', 'cinema', 'reading'] as const).map((id) => (
    <button key={id} type="button" className="btn scene-btn"
      onClick={() => onSavePreset(id)}>
      {PRESET_META[id].name}
    </button>
  ))}
</div>
```

`onSavePreset` 在 App 层：
1. `presetToSceneDefinition(project.fixtures, id)` 得到 definition
2. `useProjectStore.getState().upsertScene(definition)`（**新增** store 方法）
3. `sceneController.applyScene(id)`（复用已有动画）

Store 新增：
```ts
  upsertScene: (def: SceneDefinition) => void;
  // 实现：set((s) => { s.project.scenes = { ...(s.project.scenes ?? {}), [def.id]: def }; })
```

### 5.3 Part C 验收

- `circuitMapping.test.ts` 覆盖 3 个预设 × 8 种 fixture.type = 24 组目标亮度断言
- ADR-17 回归：`fixture.lockedFields.has('electrical.cct')` 为 true 时，`applyPresetToFixture` 不改 cct
- UI：保存后 `project.scenes['cinema']` 存在；`ScenePanel` 现有 6 按钮高亮不受影响

---

## 6. Part D — 照度伪彩预览

### 6.1 `src/lighting/heatmap.ts`（新增，纯函数）

**复用** `illuminance.fixtureContribution`——已有真实物理公式，不需要重造。

```ts
/**
 * 照度伪彩（P34 · Phase 3 §2）。
 *
 * 算法：在房间底图上按固定步长采样，每个样本点累加所有灯的照度贡献，
 * 得到 2D 数组 `lx[i * width + j]`，用 `luminanceToColor` 映射成 RGBA。
 *
 * 单位与 `illuminance.ts` 一致：lux（lx），线性，未做感知压缩。
 *
 * **不做** GPU 计算——采样网格 ≤ 25×25 = 625 点，每点 O(灯具数)，
 * 50 盏灯下 625 × 50 = 31250 次浮点运算，纯 CPU <1ms，走 UI 主线程足够。
 */

import type { Fixture } from '../core/types.js';
import { fixtureContribution } from './illuminance.js';

export interface HeatmapOptions {
  /** 采样范围（世界坐标，米） */
  bounds: { x0: number; x1: number; z0: number; z1: number };
  /** 采样步长（米），默认 0.4 = 客厅 ~7m 内 18×14 网格，够用 */
  step?: number;
  /** 采样高度（米），默认 0.75 = 桌面/坐姿高度 */
  sampleHeight?: number;
  /** 每盏灯的 level（0..1），默认取 control.sceneLevels[activeSceneKey] ?? 1 */
  resolveLevel?: (fixture: Fixture) => number;
  /** 亮度阈值钳制（避免单点爆光） */
  clampMaxLx?: number;
}

export interface HeatmapGrid {
  /** 列数（x 方向） */
  width: number;
  /** 行数（z 方向） */
  height: number;
  /** 每格中心点的世界坐标 */
  cellCenters: ReadonlyArray<readonly [x: number, z: number]>;
  /** 每格 lx，索引 = i * width + j */
  lx: ReadonlyArray<number>;
  /** 用于颜色映射的最大值（P95 分位） */
  maxLx: number;
}

/** P95 分位，抗离群点 */
function p95(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return Math.max(1, sorted[idx] ?? 1);
}

export function luminanceGrid(
  fixtures: Iterable<Fixture>,
  opts: HeatmapOptions,
): HeatmapGrid {
  const step = opts.step ?? 0.4;
  const h = opts.sampleHeight ?? 0.75;
  const clampMax = opts.clampMaxLx ?? 1500;
  const { x0, x1, z0, z1 } = opts.bounds;
  const width = Math.max(1, Math.ceil((x1 - x0) / step));
  const height = Math.max(1, Math.ceil((z1 - z0) / step));
  const centers: [number, number][] = [];
  const lx: number[] = [];
  const list = [...fixtures];
  const resolve = opts.resolveLevel ?? (() => 1);

  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const x = x0 + (i + 0.5) * step;
      const z = z0 + (j + 0.5) * step;
      let acc = 0;
      for (const f of list) {
        const level = resolve(f);
        if (level <= 0) continue;
        // fixtureContribution 第三参是距离（米），不含 level 因子。
        // level 通过构造临时 Fixture（把 photometric.lumens 按 level 缩放）传给 contribution。
        // 避免直接改原 fixture——illuminance.ts 的 fixtureContribution 期望
        // parametric() 从 photometric.lumens 读，缩放 lumens 等价于缩放光源强度。
        const [fx, fy, fz] = f.pos;
        const dx = fx - x;
        const dy = fy - h;
        const dz = fz - z;
        const distance = Math.max(Math.hypot(dx, dy, dz), 0.1);
        const scaled: Fixture = {
          ...f,
          photometric: {
            ...f.photometric,
            // 只对参数化路径生效；IES 分支贡献不变（IES 文件自带真实配光，不做 level 缩放）
            lumens: typeof f.photometric === 'object' && !f.photometric.ies
              ? (f.photometric as { lumens: number }).lumens * level
              : 0,
          },
        };
        acc += fixtureContribution(scaled, [-dx, -dy, -dz], distance);
      }
      centers.push([x, z]);
      lx.push(Math.min(clampMax, acc));
    }
  }

  const maxLx = p95(lx);
  return { width, height, cellCenters, lx, maxLx };
}

/**
 * lx → 颜色（黑 → 蓝 → 绿 → 黄 → 白）。
 *
 * 色标：
 *   0     = #000000  纯黑
 *   0.25  = #1a3a6a  深蓝（暗部）
 *   0.50  = #3aa655  绿（中等）
 *   0.75  = #f0c040  黄（较亮）
 *   1.00  = #ffffff  白（最亮）
 *
 * 感知压缩：使用 `Math.pow(t, 0.6)`（约等于 Gamma 1.67），避免低亮度区
 * 一大片死黑——真实照度的对数分布需要补偿。
 */
export function luminanceToColor(lx: number, maxLx: number): [r: number, g: number, b: number] {
  const raw = maxLx > 0 ? Math.min(1, Math.max(0, lx / maxLx)) : 0;
  const t = Math.pow(raw, 0.6);

  const stops: Array<[number, [number, number, number]]> = [
    [0.00, [0x00, 0x00, 0x00]],
    [0.25, [0x1a, 0x3a, 0x6a]],
    [0.50, [0x3a, 0xa6, 0x55]],
    [0.75, [0xf0, 0xc0, 0x40]],
    [1.00, [0xff, 0xff, 0xff]],
  ];

  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i]!;
    const [b, cb] = stops[i + 1]!;
    if (t <= b) {
      const k = (t - a) / (b - a);
      return [
        Math.round(ca[0] + (cb[0] - ca[0]) * k),
        Math.round(ca[1] + (cb[1] - ca[1]) * k),
        Math.round(ca[2] + (cb[2] - ca[2]) * k),
      ];
    }
  }
  const last = stops[stops.length - 1]![1];
  return [last[0], last[1], last[2]];
}

export function rgbaToString(rgb: readonly [number, number, number]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}
```

### 6.2 `src/ui/panels/ModelPlan.tsx` — 叠加热图

`ModelPlan` 现在只画 wall/room/opening。追加：

```tsx
// 组件顶部
import { luminanceGrid, luminanceToColor, rgbaToString } from '../../lighting/heatmap.js';
import { useProjectStore } from '../../store/projectStore.js';

// 组件内
const fixtures = useProjectStore((s) => s.project.fixtures);
const [showHeatmap, setShowHeatmap] = useState(false);

const heat = useMemo(() => {
  if (!showHeatmap || !model) return null;
  const b = modelBounds(model);  // 已有函数
  return luminanceGrid(Object.values(fixtures), { bounds: b, step: 0.4 });
}, [showHeatmap, model, fixtures]);

// SVG 渲染，在墙线**下方**（透明度覆盖）
{heat && (
  <g opacity={0.55} style={{ pointerEvents: 'none' }}>
    {heat.lx.map((v, idx) => {
      const [cx, cz] = heat.cellCenters[idx]!;
      const p = worldToPlan(cx, cz, ox, oy, scale);
      // 一格尺寸 = 采样步长（默认 0.4m）× SVG scale
      const cellPx = 0.4 * scale;
      const color = rgbaToString(luminanceToColor(v, heat.maxLx));
      return (
        <rect
          key={`h-${idx}`}
          x={p.x - cellPx / 2}
          y={p.y - cellPx / 2}
          width={cellPx}
          height={cellPx}
          fill={color}
        />
      );
    })}
  </g>
)}
```

右上角再增加一个开关：

```tsx
<label style={{ position: 'absolute', top: 22, right: 8, fontSize: 11, color: 'rgba(255,255,255,0.7)', display: 'flex', gap: 3, alignItems: 'center' }}>
  <input type="checkbox" checked={showHeatmap} onChange={(e) => setShowHeatmap(e.target.checked)} />
  照度
</label>
```

### 6.3 Part D 验收

- `heatmap.test.ts`：
  - 空 fixtures 返回 `lx` 全 0
  - 单盏下灯：正下方样本点最高
  - `luminanceToColor` 在 0 和 maxLx 两个端点精确匹配 stops
  - 感知压缩：`luminanceToColor(maxLx/10, maxLx)` 的 R > 25（不是死黑）
- UI 测试：开关默认关闭；打开后 SVG 内 `<rect>` 数 = `width × height`

---

## 7. 测试汇总

| 文件 | 用例数 | 覆盖 |
|---|---|---|
| `src/render/__tests__/lightBudget.test.ts` | 10 | 预算排序、ADR-17、上限截断、`isProxy` 传递 |
| `src/render/__tests__/layout.test.ts` | 14 | grid / perimeter / center / sconce 全模式 + 退化 |
| `src/core/__tests__/circuitMapping.test.ts` | 12 | 3 预设 × 8 fixture 类型 + ADR-17 |
| `src/lighting/__tests__/heatmap.test.ts` | 8 | 采样、色标、感知压缩 |
| `src/ui/__tests__/layoutPanel.test.tsx` | 4 | 空 model 禁用、模式按钮、应用后 store 变化 |
| `src/ui/__tests__/scenePanel.test.tsx` | 3 | 3 个预设按钮 + 保存后 project.scenes |
| `src/ui/__tests__/modelPlanHeatmap.test.tsx` | 3 | 开关默认关、打开后 rect 数、颜色正确 |

**总计新增 54 用例**，850 → 904（允许 ±2 偏差，看子代理实现细节）。

---

## 8. P8-plan.md 追加进度行

在 P33 行之后追加：

```md
| P34 Phase 3 主线（批量布灯 + 实时光源≤8预算 + 会客/观影/阅读预设 + 照度伪彩） | ✅ 已提交（`<commit>`，850 → 904） | `docs/p34-phase3-spec.md`（2026-09-28） |
```

---

## 9. 明确排除（P34 不做）

- **不做** 2D/3D 双视图联动（顶视正交图 → 3D 双向刷新）——方案 §Phase 3.3，属于下一轮
- **不做** 硬件级 IES 精确模拟（继续走 P6 的 spot texture 近似）
- **不做** 灯具 InstancedMesh 合并——`three` 目前的 SpotLight 不共享 mesh，InstancedMesh 只能合 `shade`，光本身仍逐盏建。收益低（shade 只有几十三角面），下一轮再做
- **不做** 自动墙线识别（方案 §三.5 硬性禁令）
- **不做** 新 asset pipeline（HDRI / GLTF）——那是 Phase 2，本次不动 `public/`

## 10. 红线

- `CLAUDE.md` 不动（受保护）
- `vite.config.ts` / `tsconfig.json` / `package.json` / `package-lock.json` 不动
- 不新增任何 npm 依赖
- `src/render/postProcessing.ts` / `godrays.ts` / `furniture.ts` / `plants.ts` / `sky.ts` / `skyline.ts` 不动（渲染视觉管线）
- `src/lighting/illuminance.ts` **不改现有函数体**，只允许从 `heatmap.ts` 里 import `fixtureContribution`
- 现有测试断言**不改**，只追加新用例
- 命令栈：整批一条 Command（`addFixtures`），不拆成逐盏

## 11. 验证

1. `npm run typecheck` — 0 error
2. `npm run lint` — 本次改动文件 0 error（全库预存 15 error 不属本次范围，同 P33 口径）
3. `npm test` — 全绿，测试数 ≥ 902
4. `npm run build` — 通过，仍只有 `index-*.js` + `three-*.js` 两个 chunk
5. **手动验收**（子代理无法自动做，留给人工）：
   - 打开 dev → 选模板 → 批量布灯 3×3 → 看 HUD 提示「8/9 实时」
   - Ctrl+Z → 9 盏全消失
   - 描墙 → 打开 ModelPlan → 打「照度」开关 → 中央最亮、四角最暗

## 12. 提交

commit message：

```
P34: Phase 3 主线 — 批量布灯 + 实时光源≤8预算 + 场景预设映射 + 照度伪彩

- 新增 src/render/lightBudget.ts：MAX_REAL_LIGHTS=8，ADR-17 优先保留
- lightBuilder.buildLightFromFixture 支持 proxy 模式（只建 shade，不建 Light）
- sceneEngine.recalculateBudget() + syncFixtures() 批处理同步
- 新增 src/render/layout.ts：rectangularGrid / wallLineSegments / roomCenter 4 模式
- 新增 src/ui/panels/LayoutPanel.tsx：批量布灯 UI
- projectStore.addFixtures 批量写入 + 单条 Command 整批撤销
- 新增 src/core/circuitMapping.ts：会客/观影/阅读 3 预设映射
- ScenePanel 追加 3 个预设按钮，upsertScene 保存到 project.scenes
- 新增 src/lighting/heatmap.ts：luminanceGrid + luminanceToColor（复用 fixtureContribution）
- ModelPlan 追加照度开关，SVG rect 网格叠加
- 新增 54 个测试用例，850 → 904
```

**不 push**（同 P33 惯例）。

## 13. 输出格式

子代理回报时给结构化 JSON：

```json
{
  "commit_hash": "…",
  "verify_ok": true,
  "build_ok": true,
  "test_count": 904,
  "max_real_lights": 8,
  "files_added": ["…"],
  "files_modified": ["…"],
  "deviations": ["…"]
}
```

---

## 附录 A — 与 Phase 3 方案的映射

| 方案 §Phase 3 | 本次交付 | 后续 |
|---|---|---|
| 3.1 批量布灯：沿墙等距、矩形阵列、房间居中 | ✅ Part B（4 模式） | 未来可加「按房间面积自动算 cols/rows」 |
| 3.2 回路分组 + 场景预设（会客/观影/阅读） | ✅ Part C（3 预设，写 `project.scenes`） | 未来可加自定义预设 |
| 3.2 照度伪彩预览 | ✅ Part D（CPU 采样 2D 网格） | 未来可加按 `roomPolygon` 裁剪、多高度切片 |
| 3.3 2D/3D 双视图联动 | ❌ 不做 | 下一轮（P35） |
| 3.4 性能收口：InstancedMesh 合并 | ❌ 不做（收益低） | 下一轮 |
| 3.4 性能收口：实时光源 ≤8 上限 | ✅ Part A（W5 前必须定的硬约束，本次落地） | — |

## 附录 B — 子代理执行顺序建议

子代理**必须按以下顺序**实施，否则会有中间态编译失败：

1. Part A.1 `lightBudget.ts`（纯函数，独立）
2. Part A.2 `lightBuilder.ts` 改签名 + proxy 分支（先加参数、后加调用点）
3. Part A.3 `sceneEngine.ts` 加 `recalculateBudget` + `syncFixtures`
4. Part A.4 `HudStats` 加提示行 + `App` 层把 budget 结果传下去
5. Part A 测试（`lightBudget.test.ts`），跑绿
6. Part B.1 `layout.ts`（纯函数）
7. Part B 测试（`layout.test.ts`），跑绿
8. Part B.2/B.3 `LayoutPanel.tsx` + `projectStore.addFixtures`
9. Part B UI 测试
10. Part C.1 `circuitMapping.ts`
11. Part C 测试
12. Part C.2 `ScenePanel.tsx` 追加 3 按钮 + `upsertScene`
13. Part C UI 测试
14. Part D.1 `heatmap.ts`
15. Part D 测试
16. Part D.2 `ModelPlan.tsx` 叠加
17. Part D UI 测试
18. 全量 verify + P8-plan.md 补行 + commit

每步之间跑一次 `npm test`（不跑 build，太慢），只有第 5/7/9/11/13/15/17 步是全量测试。第 18 步是全量 verify。
