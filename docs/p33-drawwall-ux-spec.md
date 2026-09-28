# P33 — 描墙端点吸附 + 已完成墙体尺寸标注

> 属于 `Lumina项目审查与后续工作方案.md` §二 Phase 1 收尾。
> 方案 §二.2 原文：「90° 正交吸附 + 端点吸附 + 连续绘制 + Ctrl+Z」「尺寸标注开关：
> 每段墙长、房间面积标出来让用户核对——**这是产品信任度的关键**」。
> P22/P25 已交付正交吸附 + 网格吸附 + 描墙预览线长度，但**端点吸附**与**已完成
> 墙体/房间的标注**两块至今未做。本规格补齐。

---

## 1. 目标（判定标准，可勾选）

1. **端点吸附**：描墙时鼠标靠近已有墙体端点（含 `model.walls` 端点、`model.rooms`
   顶点、以及当前已放置的 `pendingVertices` 除最后一个之外的全部顶点）
   半径 0.15 m 内，点击会精确吸附到该端点。吸附生效时高亮显示被吸附的端点。
2. **尺寸标注开关**：2D 户型图面板（`ModelPlan`）右上角有「尺寸」开关，默认**关闭**。
   打开后：每段墙在其 SVG 中点显示长度 `2.40m`；每个房间名下方追加面积行 `12.34㎡`。
3. 已有测试全绿（839 → 839 + 新增用例，无回归）；`tsc --noEmit` 与 `lint` 均 0 error。

---

## 2. 交付物（每条给完整可粘的代码）

### 2.1 `src/render/modelPlanLayout.ts` 追加 4 个纯函数

在文件末尾、`closeVertices` 之后追加（保持"布局数学抽纯函数"的架构）：

```ts
// ---------------------------------------------------------------------------
// 端点吸附（P33）
// ---------------------------------------------------------------------------

/** 端点吸附候选点（世界坐标，米） */
export interface SnapCandidate {
  x: number;
  z: number;
}

/**
 * 端点吸附半径（米）。
 *
 * 取 0.15：大于 `GRID_SNAP_M`（0.1）保证端点优先于网格；小于 0.3 保证不误吸
 * 到远处顶点（住宅户型最小开间 2.7m，0.15m 半径在正常鼠标操作下已足够宽容）。
 */
export const ENDPOINT_SNAP_RADIUS_M = 0.15;

/**
 * 从候选集中吸附最近端点。
 *
 * 严格小于等于 `radiusM` 的候选中取最近的一个；无候选或全部超出半径返回 null。
 * 等距时取遍历到的第一个（保持结果稳定，便于测试）。
 */
export function snapEndpoint(
  p: readonly [x: number, z: number],
  candidates: readonly SnapCandidate[],
  radiusM: number = ENDPOINT_SNAP_RADIUS_M,
): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  let bestDist = radiusM;
  for (const c of candidates) {
    const d = Math.hypot(c.x - p[0], c.z - p[1]);
    if (d <= bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/**
 * 汇总吸附候选点。
 *
 * 来源：`model.walls` 每个端点（a/b）+ `model.rooms` 每个顶点 +
 * 当前已放置的 `pendingVertices`（**排除最后一个**，因为它就是"上一顶点"，
 * 不该吸附回自己；保留前面的点便于闭合多边形时吸附回首点）。
 *
 * 不去重：候选集通常几十到几百个，去重的复杂度不值得；`snapEndpoint` 取
 * 最近的那个即可，同一点重复出现只是多做几次 hypot。
 */
export function collectSnapCandidates(
  model: ModelGeometry,
  pendingVertices: readonly (readonly [x: number, z: number])[] = [],
): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  for (const w of model.walls) {
    out.push({ x: w.a[0], z: w.a[1] });
    out.push({ x: w.b[0], z: w.b[1] });
  }
  for (const r of model.rooms) {
    for (const v of r.vertices) out.push({ x: v[0], z: v[1] });
  }
  for (let i = 0; i + 1 < pendingVertices.length; i++) {
    const v = pendingVertices[i]!;
    out.push({ x: v[0], z: v[1] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 尺寸标注（P33）
// ---------------------------------------------------------------------------

/** 墙段尺寸标注：SVG 中点偏移 8px 沿墙法线外侧，文本 = `2.40m` */
export interface WallLabel {
  /** SVG 坐标（已含偏移），直接用于 `<text x={x} y={y}>` */
  x: number;
  y: number;
  /** 已格式化的长度文本 */
  text: string;
  /** 文本旋转角（度）；轴对齐墙（水平/竖直）为 0，斜墙沿墙方向 */
  angle: number;
}

/**
 * 墙段 → 标注。
 *
 * 位置：墙 SVG 中点沿法线外侧偏移 8px（避免压墙线）。
 * 角度：轴对齐墙（与水平/竖直夹角 < 15°）保持文本水平；斜墙沿墙方向旋转，
 * 并翻转 180° 保证文本不朝下（`raw > 90 → raw - 180`）。
 */
export function wallLabels(
  walls: readonly WallSegment[],
  ox: number,
  oy: number,
  scale: number,
): WallLabel[] {
  const out: WallLabel[] = [];
  for (const w of walls) {
    const a = worldToPlan(w.a[0], w.a[1], ox, oy, scale);
    const b = worldToPlan(w.b[0], w.b[1], ox, oy, scale);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const svgLen = Math.hypot(dx, dy);
    if (svgLen === 0) continue;
    const ux = dx / svgLen;
    const uy = dy / svgLen;
    // 法线（左侧）；偏移 8px 让文本落在墙线外侧
    const px = -uy * 8;
    const py = ux * 8;
    const raw = (Math.atan2(dy, dx) * 180) / Math.PI;
    let angle = 0;
    if (Math.abs(Math.abs(raw) - 90) > ORTHO_ANGLE_DEG && Math.abs(raw) > ORTHO_ANGLE_DEG) {
      angle = raw > 90 ? raw - 180 : raw;
    }
    out.push({
      x: (a.x + b.x) / 2 + px,
      y: (a.y + b.y) / 2 + py,
      text: `${wallLength(w).toFixed(2)}m`,
      angle,
    });
  }
  return out;
}

/** 房间尺寸标注：SVG 质心，含面积 */
export interface RoomLabel {
  x: number;
  y: number;
  name: string;
  area: number;
  areaText: string;
}

/**
 * 房间 → 标注。
 *
 * 位置取顶点均值（与 `roomsToPaths` 的 `cx`/`cy` 一致）；面积走
 * `topology.roomArea`（shoelace 公式，无需预先闭合）。
 */
export function roomLabels(
  rooms: readonly RoomPolygon[],
  ox: number,
  oy: number,
  scale: number,
): RoomLabel[] {
  return rooms.map((r) => {
    const pts = r.vertices.map(([x, z]) => worldToPlan(x, z, ox, oy, scale));
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p.x;
      cy += p.y;
    }
    const n = pts.length || 1;
    const area = roomArea(r);
    return {
      x: cx / n,
      y: cy / n,
      name: r.name,
      area,
      areaText: `${area.toFixed(2)}㎡`,
    };
  });
}
```

文件顶部的 `import` 段需新增 `ModelGeometry`、`WallSegment`、`RoomPolygon`
（前两者已存在，`RoomPolygon` 也已存在——请核对，若无则补；`RoomPolygon`
已 import，无需改）。

### 2.2 `src/store/modelingStore.ts` 增加 `endpointSnap` 状态

`ModelingState` 接口追加两行（放在 `orthoSnap` 之后）：

```ts
  endpointSnap: boolean;
  setEndpointSnap: (v: boolean) => void;
```

`create<ModelingState>()(immer(...))` 的初始状态追加（放在 `orthoSnap: true` 之后）：

```ts
    endpointSnap: true,
```

store 实现里追加（放在 `setOrthoSnap` 之后）：

```ts
    setEndpointSnap: (v) => set({ endpointSnap: v }),
```

### 2.3 `src/ui/panels/ModelCanvas.tsx` 接入端点吸附

改动 4 处：

**(a) 解构 state 追加两个字段**（在 `orthoSnap` 之后）：

```ts
    endpointSnap,
    setEndpointSnap,
```

**(b) `getWorldPoint` 里接入端点吸附，返回同时输出"是否吸附"标志**：

将现有 `getWorldPoint` 整体替换为：

```ts
  // 鼠标 SVG 坐标 → 世界坐标 → 吸附
  // 顺序：网格 → 正交 → 端点（端点最后，优先级最高：吸到具体点，覆盖网格与角度）
  const snapResult = useCallback(
    (clientX: number, clientY: number): {
      p: readonly [number, number] | null;
      snapped: SnapCandidate | null;
    } => {
      const svg = svgRef.current;
      if (svg === null) return { p: null, snapped: null };
      const rect = svg.getBoundingClientRect();
      const sx = ((clientX - rect.left) / rect.width) * width;
      const sy = ((clientY - rect.top) / rect.height) * height;
      let [wx, wz] = planToWorld(sx, sy, ox, oy, scale);
      if (gridSnap) [wx, wz] = snapToGrid([wx, wz], GRID_SNAP_M);
      if (orthoSnap && pendingVertices.length > 0) {
        [wx, wz] = snapOrtho(pendingVertices[pendingVertices.length - 1]!, [wx, wz]);
      }
      const snapped = endpointSnap
        ? snapEndpoint([wx, wz], collectSnapCandidates(model, pendingVertices))
        : null;
      if (snapped) return { p: [snapped.x, snapped.z] as const, snapped };
      return { p: [wx, wz] as const, snapped: null };
    },
    [gridSnap, orthoSnap, endpointSnap, model, pendingVertices, ox, oy, scale],
  );
```

`(c) 相应更新调用点`：

```ts
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDrawing) return;
      const r = snapResult(e.clientX, e.clientY);
      setMouseWorld(r.p);
      setHoverSnap(r.snapped);
    },
    [isDrawing, snapResult],
  );

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isDrawing) return;
      const p = snapResult(e.clientX, e.clientY).p;
      if (p !== null) addPendingVertex([p[0], p[1]]);
    },
    [isDrawing, snapResult, addPendingVertex],
  );
```

**新增 hover 吸附状态**（放在 `const [mouseWorld, ...]` 之后）：

```ts
  const [hoverSnap, setHoverSnap] = useState<SnapCandidate | null>(null);
```

**顶部 import 补两个符号**：

```ts
import {
  modelBounds,
  snapToGrid,
  snapOrtho,
  planToWorld,
  worldToPlan,
  modelPlanOrigin,
  computeModelScale,
  GRID_SNAP_M,
  snapEndpoint,
  collectSnapCandidates,
} from '../../render/modelPlanLayout.js';
import type { SnapCandidate } from '../../render/modelPlanLayout.js';
```

**(d) SVG 里画吸附高亮环**：在"已放置顶点"渲染块**之前**（这样高亮在最上层）追加：

```tsx
        {isDrawing && hoverSnap && (
          <circle
            cx={toSvg(hoverSnap.x, hoverSnap.z).x}
            cy={toSvg(hoverSnap.x, hoverSnap.z).y}
            r={7}
            fill="none"
            stroke="#f0a040"
            strokeWidth={2}
            style={{ pointerEvents: 'none' }}
          />
        )}
```

**(e) 控制栏追加「端点」checkbox**：在「正交」checkbox 之后（与「网格」「正交」同一行）：

```tsx
            <label style={{ display: 'flex', alignItems: 'center', gap: 2, color: 'rgba(255,255,255,0.6)' }}>
              <input
                type="checkbox"
                checked={endpointSnap}
                onChange={(e) => setEndpointSnap(e.target.checked)}
              />
              端点
            </label>
```

### 2.4 `src/ui/panels/ModelPlan.tsx` 增加尺寸标注开关

改动 3 处：

**(a) 顶部 import 补两个符号**：把现有的

```ts
import { useMemo } from 'react';
import {
  modelBounds,
  wallsToSvg,
  roomsToPaths,
  openingsToSvg,
  modelPlanOrigin,
  computeModelScale,
} from '../../render/modelPlanLayout.js';
```

改成：

```ts
import { useMemo, useState } from 'react';
import {
  modelBounds,
  wallsToSvg,
  roomsToPaths,
  openingsToSvg,
  modelPlanOrigin,
  computeModelScale,
  wallLabels,
  roomLabels,
} from '../../render/modelPlanLayout.js';
```

**(b) 组件内加状态**（放在 `const scale = ...` 之后）：

```tsx
  const [showDims, setShowDims] = useState(false);
```

**(c) 渲染层追加两块**：

墙体标注，放在 `{openings.map(...)}` 块**之后**：

```tsx
        {/* 墙段尺寸标注（P33） */}
        {showDims &&
          wallLabels(model.walls, ox, oy, scale).map((l, i) => (
            <text
              key={`wlabel-${i}`}
              x={l.x}
              y={l.y}
              textAnchor="middle"
              fill="rgba(255, 255, 255, 0.7)"
              fontSize={9}
              transform={`rotate(${l.angle} ${l.x} ${l.y})`}
              style={{ userSelect: 'none' }}
            >
              {l.text}
            </text>
          ))}
```

房间面积标注，**替换**现有 `{rooms.map((r) => ... r.name ... )}` 块为：

```tsx
        {/* 房间标签（P33：可选追加面积行） */}
        {showDims
          ? roomLabels(model.rooms, ox, oy, scale).map((l) => (
              <text
                key={`rlabel-${l.name}`}
                x={l.x}
                y={l.y}
                textAnchor="middle"
                fill="rgba(255, 255, 255, 0.6)"
                fontSize={10}
                style={{ userSelect: 'none' }}
              >
                <tspan x={l.x} dy={0}>
                  {l.name}
                </tspan>
                <tspan x={l.x} dy={12}>
                  {l.areaText}
                </tspan>
              </text>
            ))
          : rooms.map((r) => (
              <text
                key={`label-${r.id}`}
                x={r.cx}
                y={r.cy}
                textAnchor="middle"
                fill="rgba(255, 255, 255, 0.5)"
                fontSize={10}
                style={{ userSelect: 'none' }}
              >
                {r.name}
              </text>
            ))}
```

**(d) 右上角开关按钮**：替换现有右下角"X 房间 · Y 墙段"块——把它改成右下角保留计数、右上角新增尺寸开关：

```tsx
      {/* 面积显示 */}
      <div
        style={{
          position: 'absolute',
          bottom: 4,
          right: 8,
          fontSize: 11,
          color: 'rgba(255, 255, 255, 0.5)',
        }}
      >
        {model.rooms.length} 房间 · {model.walls.length} 墙段
      </div>

      {/* 尺寸标注开关（P33） */}
      <label
        style={{
          position: 'absolute',
          top: 6,
          right: 8,
          fontSize: 11,
          color: 'rgba(255, 255, 255, 0.7)',
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={showDims}
          onChange={(e) => setShowDims(e.target.checked)}
        />
        尺寸
      </label>
```

### 2.5 测试

**A. `src/render/__tests__/modelPlanLayout.test.ts` 追加 5 个用例**（追加到 describe 末尾）：

```ts
  describe('snapEndpoint (P33)', () => {
    it('returns the nearest candidate within radius', () => {
      const cands = [
        { x: 0, z: 0 },
        { x: 3, z: 3 },
        { x: 0.05, z: 0.05 },
      ];
      const got = snapEndpoint([0.1, 0.1], cands);
      expect(got).toEqual({ x: 0.05, z: 0.05 });
    });

    it('returns null when no candidate is within radius', () => {
      const cands = [{ x: 5, z: 5 }, { x: -4, z: -4 }];
      expect(snapEndpoint([0, 0], cands, ENDPOINT_SNAP_RADIUS_M)).toBeNull();
    });

    it('returns null on empty candidate set', () => {
      expect(snapEndpoint([0, 0], [])).toBeNull();
    });

    it('uses the given radius parameter', () => {
      // 0.5 m 半径下 0.3 m 的候选能吸上；默认 0.15 半径吸不上
      const cands = [{ x: 0.3, z: 0.3 }];
      expect(snapEndpoint([0, 0], cands)).toBeNull();
      expect(snapEndpoint([0, 0], cands, 0.5)).toEqual({ x: 0.3, z: 0.3 });
    });

    it('snapEndpoint is deterministic on ties (first wins)', () => {
      // 等距候选：取遍历到的第一个，保证稳定
      const cands = [{ x: 0.1, z: 0 }, { x: -0.1, z: 0 }];
      expect(snapEndpoint([0, 0], cands)).toEqual({ x: 0.1, z: 0 });
    });
  });

  describe('collectSnapCandidates (P33)', () => {
    it('includes every wall endpoint and room vertex, excludes last pending', () => {
      const m = rectModel();
      const out = collectSnapCandidates(m);
      // 每个 wall 贡献 2 个端点；rooms 顶点全贡献
      const wallEnds = m.walls.length * 2;
      const roomVerts = m.rooms.reduce((s, r) => s + r.vertices.length, 0);
      expect(out.length).toBe(wallEnds + roomVerts);
    });

    it('includes pendingVertices except the last one (for closing the loop)', () => {
      const m = rectModel();
      const pend: [number, number][] = [
        [0, 0],
        [2, 0],
        [2, 2],
      ];
      const out = collectSnapCandidates(m, pend);
      const wallEnds = m.walls.length * 2;
      const roomVerts = m.rooms.reduce((s, r) => s + r.vertices.length, 0);
      // pendingVertices 排除最后一个 → 2 个候选（[0,0] 和 [2,0]）
      expect(out.length).toBe(wallEnds + roomVerts + 2);
      expect(out).toContainEqual({ x: 0, z: 0 });
      expect(out).toContainEqual({ x: 2, z: 0 });
      expect(out).not.toContainEqual({ x: 2, z: 2 });
    });
  });

  describe('wallLabels / roomLabels (P33)', () => {
    it('wallLabels emits one label per non-degenerate wall with meters text', () => {
      const m = rectModel();
      const labels = wallLabels(m.walls, 200, 200, 40);
      expect(labels.length).toBe(m.walls.length);
      for (const l of labels) {
        expect(l.text).toMatch(/^\d+\.\d{2}m$/);
        expect(Number.isFinite(l.angle)).toBe(true);
      }
    });

    it('axis-aligned walls produce angle 0 (readable horizontal text)', () => {
      // 构造一条水平墙 + 一条竖直墙
      const horizontal: WallSegment = {
        id: 'h',
        a: [0, 0],
        b: [2, 0],
        thickness: 0.15,
        height: 2.8,
        confidence: 1,
        provenance: { kind: 'user_edit' },
      };
      const vertical: WallSegment = {
        id: 'v',
        a: [0, 0],
        b: [0, 2],
        thickness: 0.15,
        height: 2.8,
        confidence: 1,
        provenance: { kind: 'user_edit' },
      };
      const labels = wallLabels([horizontal, vertical], 200, 200, 40);
      expect(labels.length).toBe(2);
      for (const l of labels) expect(l.angle).toBe(0);
      expect(labels[0]!.text).toBe('2.00m');
      expect(labels[1]!.text).toBe('2.00m');
    });

    it('roomLabels emits centroid + area text per room', () => {
      const m = rectModel();
      const labels = roomLabels(m.rooms, 200, 200, 40);
      expect(labels.length).toBe(m.rooms.length);
      for (const l of labels) {
        expect(l.area).toBeGreaterThan(0);
        expect(l.areaText).toMatch(/^\d+\.\d{2}㎡$/);
      }
    });
  });
```

test 文件顶部 import 追加：

```ts
import {
  snapEndpoint,
  collectSnapCandidates,
  wallLabels,
  roomLabels,
  ENDPOINT_SNAP_RADIUS_M,
} from '../../render/modelPlanLayout.js';
import type { WallSegment } from '../../core/modeling.js';
```

**B. `src/ui/__tests__/modelCanvas.test.tsx` 追加 1 个用例**（追加到 describe 末尾）：

```tsx
  it('exposes endpointSnap state, default on (P33)', () => {
    render(<ModelCanvas />);
    fireEvent.click(screen.getByText('描墙'));
    // 描墙模式下控制栏应出现 3 个 checkbox：网格 / 正交 / 端点
    const boxes = container.querySelectorAll('input[type="checkbox"]');
    expect(boxes.length).toBe(3);
    expect(useModelingStore.getState().endpointSnap).toBe(true);
  });
```

### 2.6 P8-plan.md 追加进度行

在 P32c 行之后追加：

```md
| P33 描墙端点吸附 + 已完成墙体/房间尺寸标注（Phase 1 收尾） | ✅ 已提交（`<hash>`） | `docs/p33-drawwall-ux-spec.md`（2026-09-28） |
```

（`<hash>` 由子代理填，父代理会在最终 commit 里补上。）

---

## 3. 不做的事（明确排除）

- **不做**描墙过程中的"已放置段落"长度显示（预览线已够，方案没要求）。
- **不做**尺寸标注的持久化设置（component 内 `useState` 即可，无需写 store）。
- **不做**任何渲染/材质/后处理改动。
- **不新增依赖**（不装任何 npm 包）。
- **不 push**（只本地 commit）。
- **不删代码**，只加字段/加函数/加渲染块。

## 4. 红线

- `vite.config.ts` / `tsconfig.json` / `package.json` / `package-lock.json` 不动。
- `CLAUDE.md` 不动（受保护文件）。
- `src/render/godrays.ts` / `postProcessing.ts` / `lightBuilder.ts` / `furniture.ts` 不动。
- 现有 `snapToGrid` / `snapOrtho` / `wallLength` / `roomArea` / `planToWorld` / `worldToPlan` 函数体**不改**，只加新函数。
- 现有测试断言**不改**，只追加新用例。
- 命令栈（`commandStack` / `commandBus`）**不引入**新 command —— P33 只改吸附与展示，不产生可撤销动作。

## 5. 验证

1. `npm run typecheck` — 0 error
2. `npm run lint` — 0 error
3. `npm test` — 全绿，测试数 ≥ 846（新增 12 个用例）
4. `npm run build` — 通过，仍只有 `index-*.js` + `three-*.js` 两个 chunk

## 6. 提交

commit message：

```
P33: 描墙端点吸附 + 已完成墙体/房间尺寸标注（Phase 1 收尾）

- modelPlanLayout 新增 snapEndpoint/collectSnapCandidates/wallLabels/roomLabels
- modelingStore 新增 endpointSnap 状态（默认开）
- ModelCanvas 接入端点吸附，hover 时高亮被吸附端点，控制栏新增"端点"开关
- ModelPlan 新增"尺寸"开关（默认关），打开显示墙段长度 + 房间面积
- 新增 12 个测试用例，839 → 846 全绿
```

**不 push**。

## 7. 输出格式

子代理回报时给结构化 JSON：

```json
{
  "commit_hash": "…",
  "verify_ok": true,
  "build_ok": true,
  "test_count": 846,
  "files_changed": ["…"],
  "deviations": ["…"]
}
```
