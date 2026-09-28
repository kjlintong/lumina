# P28 · Phase 1 · 灯具库面板 + 拖放 + TransformControls

> 来源：`/home/ryan/project/Lumina项目审查与后续工作方案.md` §二 Phase 1 第 4 项。
> HEAD 基线：`54cefb1`（P27 命令栈已交付，782 测试全绿）。
> 本阶段是 Phase 1 的产品本体——「拖灯进去 → 拖动调位 → 画面不崩」的后半段。前半段（图片导入 + 描墙）已由 P22-P23 交付。

---

## 1. 目标（判定标准）

1. **左侧新增「灯具库」面板**（`FixtureLibraryPanel`），列出全部 8 种 `FixtureType`（downlight / spot / pendant / linear / cove / sconce / floor / table），每项含中文标签 + 简笔 SVG 图标 + 拖入提示。
2. **HTML5 DnD 拖放**：从「灯具库」面板拖任意一项到 canvas 上松手，触发 raycast；命中天花/墙面/地面时创建新灯具，**按命中面法线自动决定安装方式**（法线接近 (0,1,0) → ceiling/recessed；法线接近水平 → wall；法线接近 (0,-1,0) → floor/tabletop）。位置**吸附到 50mm 网格**。未命中时 toast「请拖到墙、天花或地面」。
3. **TransformControls**：选中任一灯具后，`sceneEngine.attachFixture(id)` 挂上 TransformControls；拖拽过程中 OrbitControls 自动禁用，拖拽结束恢复；**按 mount 类型锁轴**：
   - `ceiling` / `recessed`：仅 XZ 平移 + Y 旋转
   - `wall`：仅墙上两个轴平移 + 法向旋转（简化为 XZ 平移 + Y 旋转）
   - `suspended`：全轴平移 + Y 旋转
   - `floor` / `tabletop`：XZ 平移 + Y 旋转
4. **拖拽结束** → 调 `moveAndLockFixture`（走 P27 命令栈，可撤销）。50mm 网格吸附在 TransformControls 内部生效。
5. **选中高亮**：emissive 增强（不是 scale 闪烁），e.g. 选中时 shade emissive 从 0 → 0.25，颜色沿用 accent-warm。
6. **Ctrl+Z 撤销**：拖一次 = 一条 undo 命令（label 例：`移动吊灯`）。
7. `npm run verify` 全绿（typecheck + 测试全绿；lint 允许既有 core/** 的 7 个 error，不新增）。
8. 至少 6 个新增单元测试覆盖：mount→axes 映射、法线判定、50mm 吸附、TransformControls attach/detach 状态。

---

## 2. 交付物

### 2.1 `src/render/mountAxes.ts` —— 纯逻辑：mount → TransformControls 轴映射

```ts
/**
 * 按安装方式决定 TransformControls 允许的轴。
 *
 * TransformControls 三个 mode：'translate' / 'rotate' / 'scale'。
 * 轴字段的语义：''（禁用）/ 'X' / 'Y' / 'Z' / 'XYZ'（全开）等。
 * 详见 three/examples/jsm/controls/TransformControls.js 的
 * setTranslationSnap / enableX / setMode 等 API。
 */

import type { MountType } from '../core/types.js';

export interface MountAxesConfig {
  translateMode: 'translate';
  rotateMode: 'rotate';
  /** translate 允许的轴（TransformControls 内部字符串） */
  translateAxis: '' | 'X' | 'Y' | 'Z' | 'XY' | 'XZ' | 'YZ' | 'XYZ';
  /** rotate 允许的轴 */
  rotateAxis: '' | 'X' | 'Y' | 'Z';
}

export function axesForMount(mount: MountType): MountAxesConfig {
  switch (mount) {
    case 'ceiling':
    case 'recessed':
      // 吸顶/筒灯：贴天花，允许 XZ 平移（沿天花面）+ Y 旋转（旋转灯体）
      return { translateMode: 'translate', rotateMode: 'rotate', translateAxis: 'XZ', rotateAxis: 'Y' };
    case 'wall':
      // 壁灯：贴墙；简化为 XZ 平移 + Y 旋转（真实 3D 墙上滑轨暂不做）
      return { translateMode: 'translate', rotateMode: 'rotate', translateAxis: 'XZ', rotateAxis: 'Y' };
    case 'suspended':
      // 吊灯：全轴平移 + Y 旋转（悬空，任何方向都可动）
      return { translateMode: 'translate', rotateMode: 'rotate', translateAxis: 'XYZ', rotateAxis: 'Y' };
    case 'track':
      // 轨道灯：类似吸顶（贴轨道面），简化同 ceiling
      return { translateMode: 'translate', rotateMode: 'rotate', translateAxis: 'XZ', rotateAxis: 'Y' };
    case 'floor':
    case 'tabletop':
      // 落地/桌面：XZ 平移 + Y 旋转
      return { translateMode: 'translate', rotateMode: 'rotate', translateAxis: 'XZ', rotateAxis: 'Y' };
  }
}
```

### 2.2 `src/render/snapToGrid.ts` —— 50mm 网格吸附（3D）

```ts
/**
 * 50mm 网格吸附（TransformControls 平移 + 拖放命中位置都走这里）。
 *
 * 与 P22 的 2D 网格吸附不同：那是 PlanToWorld 的 0.1m 网格。这里 0.05m
 * 是产品体验上更好的粒度（审查方案 §Phase 1 第 4 项明确「50mm 网格吸附」）。
 *
 * 吸附策略：`Math.round(v / step) * step`；负值正常向下取整（round 而非 floor）。
 */
export const FIXTURE_GRID_M = 0.05;

export function snapFixturePos(
  pos: readonly [number, number, number],
  step: number = FIXTURE_GRID_M,
): readonly [number, number, number] {
  const round = (v: number) => Math.round(v / step) * step;
  return [round(pos[0]), round(pos[1]), round(pos[2])];
}
```

### 2.3 `src/render/mountFromNormal.ts` —— 法线 → mount 推断

```ts
/**
 * 拖放时根据命中面法线推断安装方式。
 *
 * TransformControls 拖拽前的初始 mount 由拖放 raycast 结果决定。法线是世界空间，
 * 与灯具当前朝向对齐（例如贴墙安装时法线朝房间内侧）。
 *
 * 阈值 0.7（cos60°）：法线必须明确指向某个方向，模糊的斜角回落到 'wall'。
 */

export type DragMount = 'recessed' | 'ceiling' | 'wall' | 'floor' | 'tabletop' | 'suspended';

export function mountFromNormal(normal: readonly [number, number, number]): DragMount {
  const ny = normal[1];
  if (ny > 0.7) return 'ceiling';        // 面向上（吸顶）
  if (ny < -0.7) return 'recessed';      // 面向下（筒灯：灯安装在天花内，光朝下）
  if (Math.abs(ny) < 0.7) return 'wall'; // 侧面朝房间
  return 'suspended';                    // 兜底
}

/**
 * 拖放命中位置到灯具 pos 的转换：pos = 命中点 + 法线 * 半个灯体偏移。
 * 灯体半径从 fixture.shape.diameter 派生；简化用固定 30mm。
 */
export function dropPosFromHit(
  point: readonly [number, number, number],
  normal: readonly [number, number, number],
  offsetM = 0.03,
): readonly [number, number, number] {
  return [
    point[0] + normal[0] * offsetM,
    point[1] + normal[1] * offsetM,
    point[2] + normal[2] * offsetM,
  ];
}
```

### 2.4 `src/scene/sceneEngine.ts` —— 挂 TransformControls

新增 API（**不改**既有 API，只追加）：

```ts
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { axesForMount, type MountAxesConfig } from '../render/mountAxes.js';
import { snapFixturePos, FIXTURE_GRID_M } from '../render/snapToGrid.js';
import type { MountType } from '../core/types.js';

// 新增字段（放在私有字段区）：
private transformControls: TransformControls | null = null;
private attachedFixtureId: string | null = null;
private onTransformEnd: ((fixtureId: string, newPos: readonly [number, number, number]) => void) | null = null;

/** 初始化 TransformControls（构造器里，OrbitControls 之后） */
// ...
const tc = new TransformControls(this.camera, this.backend.canvas);
tc.addEventListener('dragging-changed', (event) => {
  this.orbitControls.enabled = !event.value;
});
tc.addEventListener('objectChange', () => {
  // 拖拽中实时吸附（50mm 网格）；onObjectChange 是每帧回调
  if (this.attachedFixtureId === null) return;
  const obj = tc.object;
  if (!obj) return;
  const snapped = snapFixturePos([obj.position.x, obj.position.y, obj.position.z]);
  obj.position.set(snapped[0], snapped[1], snapped[2]);
});
tc.addEventListener('mouseUp', () => {
  // 拖拽结束：把位置写回（App 层通过 setTransformCallback 订阅）
  if (this.attachedFixtureId === null) return;
  const obj = tc.object;
  if (!obj) return;
  const snapped = snapFixturePos([obj.position.x, obj.position.y, obj.position.z]);
  this.onTransformEnd?.(this.attachedFixtureId, snapped);
});
this.scene.add(tc);
this.transformControls = tc;
```

**公开方法**：

```ts
/** 设置拖拽结束回调（App 层设置以驱动 store 写入） */
setTransformCallback(cb: ((fixtureId: string, newPos: readonly [number, number, number]) => void) | null): void {
  this.onTransformEnd = cb;
}

/** 挂接 TransformControls 到指定灯具。传 null 卸载。 */
attachFixture(fixtureId: string | null, mount?: MountType): void {
  const tc = this.transformControls;
  if (!tc) return;
  // 先卸载旧的
  if (this.attachedFixtureId !== null) {
    const oldEntry = this.fixtureLights.get(this.attachedFixtureId);
    if (oldEntry) tc.detach();
    this.attachedFixtureId = null;
  }
  if (fixtureId === null) return;
  const entry = this.fixtureLights.get(fixtureId);
  if (!entry) return;
  tc.attach(entry.object);
  // 应用轴约束
  if (mount) this.applyMountAxes(mount);
  this.attachedFixtureId = fixtureId;
}

private applyMountAxes(mount: MountType): void {
  const tc = this.transformControls;
  if (!tc) return;
  const cfg = axesForMount(mount);
  // 简化：把 translateMode 与 rotateMode 都设成 translate，轴用 translateAxis；
  // rotate 通过键盘 R 切换。P28 不做模式切换 UI。
  tc.setMode('translate');
  // 三.js TransformControls 的轴约束走 enableX/enableY/enableZ + setSpace
  const axis = cfg.translateAxis;
  tc.showX = axis.includes('X');
  tc.showY = axis.includes('Y');
  tc.showZ = axis.includes('Z');
}

/** 卸载 TransformControls（清理） */
// dispose() 里补：
//   this.transformControls?.dispose();
//   this.scene.remove(this.transformControls);
```

**注意**：`TransformControls` 从 `three/examples/jsm/controls/TransformControls.js` 导入，需确认 r186 里该路径导出稳定（子代理第一步 grep 验证）。

**getAttachedFixtureId**：

```ts
getAttachedFixtureId(): string | null { return this.attachedFixtureId; }
```

### 2.5 `src/ui/panels/FixtureLibraryPanel.tsx` —— 灯具库面板

放在 App 左侧 sidebar（`ImportPanel` 之后，`ModelPanel` 之前）：

```tsx
import type { FixtureType } from '../../core/types.js';
import { Panel } from './Panel.js';

/** 8 种灯具的库元数据 */
const LIBRARY: Array<{ type: FixtureType; label: string; hint: string; icon: JSX.Element }> = [
  { type: 'downlight', label: '筒灯', hint: '嵌入天花', icon: <svg ...>筒灯图标</svg> },
  { type: 'spot', label: '射灯', hint: '嵌入天花，聚光', icon: ... },
  { type: 'pendant', label: '吊灯', hint: '悬挂天花板', icon: ... },
  { type: 'linear', label: '线条灯', hint: '线性连续', icon: ... },
  { type: 'cove', label: '灯带', hint: '暗藏灯槽', icon: ... },
  { type: 'sconce', label: '壁灯', hint: '贴墙', icon: ... },
  { type: 'floor', label: '落地灯', hint: '独立地面', icon: ... },
  { type: 'table', label: '台灯', hint: '桌面', icon: ... },
];

export function FixtureLibraryPanel() {
  return (
    <Panel title="灯具库" defaultOpen={true}>
      <div className="field-note">
        把灯具拖到场景中；按命中面自动决定安装方式，50mm 网格吸附。
      </div>
      <div className="fixture-library-grid">
        {LIBRARY.map(({ type, label, hint, icon }) => (
          <div
            key={type}
            className="fixture-library-item"
            draggable={true}
            data-fixture-type={type}
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-lumina-fixture-type', type);
              e.dataTransfer.effectAllowed = 'copy';
            }}
          >
            <div className="fixture-library-icon">{icon}</div>
            <div className="fixture-library-label">{label}</div>
            <div className="fixture-library-hint">{hint}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
```

**SVG 图标**：使用简笔内联 SVG（不用外部资源）。每个 24×24 viewBox，只用 stroke + fill:currentColor。给出最小可用示例：

```tsx
const ICONS: Record<FixtureType, JSX.Element> = {
  downlight: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="10" r="4"/><path d="M6 10 L4 20 M18 10 L20 20"/></svg>,
  spot: <svg ...><circle cx="12" cy="10" r="3"/><path d="M9 10 L6 20 L18 20 L15 10"/></svg>,
  pendant: <svg ...><line x1="12" y1="2" x2="12" y2="10"/><circle cx="12" cy="14" r="4"/></svg>,
  linear: <svg ...><line x1="4" y1="12" x2="20" y2="12" strokeWidth="3"/></svg>,
  cove: <svg ...><path d="M4 8 L20 8 L18 20 L6 20 Z" fill="currentColor" opacity="0.3"/><line x1="4" y1="8" x2="20" y2="8"/></svg>,
  sconce: <svg ...><line x1="4" y1="12" x2="10" y2="12"/><circle cx="14" cy="12" r="4"/></svg>,
  floor: <svg ...><line x1="12" y1="4" x2="12" y2="20"/><circle cx="12" cy="6" r="3"/><line x1="8" y1="20" x2="16" y2="20"/></svg>,
  table: <svg ...><line x1="12" y1="6" x2="12" y2="14"/><circle cx="12" cy="8" r="3"/><line x1="4" y1="16" x2="20" y2="16"/></svg>,
};
```

CSS（加到 index.html 的 style 块）：

```css
.fixture-library-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.fixture-library-item { display: flex; align-items: center; gap: 6px; padding: 6px 8px; background: var(--bg-panel); border: 1px solid var(--border-subtle); border-radius: 4px; cursor: grab; user-select: none; }
.fixture-library-item:active { cursor: grabbing; }
.fixture-library-icon { width: 24px; height: 24px; color: var(--accent-warm); flex-shrink: 0; }
.fixture-library-label { font-size: 12px; color: var(--text-primary); font-weight: 500; }
.fixture-library-hint { font-size: 10px; color: var(--text-muted); margin-left: auto; }
```

### 2.6 `src/App.tsx` —— 拖放 drop handler + attach/detach 接线

在 `App.tsx` 的 canvas container 上注册 `onDragOver` 与 `onDrop`：

```tsx
// 新的辅助函数：从 drop 事件里 raycast 命中场景
function handleDropFixture(e: React.DragEvent<HTMLDivElement>, engine: SceneEngine, canvas: HTMLCanvasElement): void {
  e.preventDefault();
  const type = e.dataTransfer.getData('application/x-lumina-fixture-type');
  if (!type) return;
  // raycast
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  pointerNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointerNdc, engine.getCamera());
  const hits = raycaster.intersectObjects(engine.getScene().children, true);
  // 找第一个命中几何体（墙体/地面/天花都是 Mesh）
  for (const hit of hits) {
    const normal = hit.face?.normal;
    const point = hit.point;
    if (!normal || !point) continue;
    const mount = mountFromNormal([normal.x, normal.y, normal.z]);
    const rawPos = dropPosFromHit([point.x, point.y, point.z], [normal.x, normal.y, normal.z]);
    const snapped = snapFixturePos(rawPos);
    // 添加到 store
    const id = useProjectStore.getState().addFixture({
      fixtureType: type,
      mount,
      pos: snapped,
    });
    // 选中它并挂 TransformControls
    useProjectStore.getState().selectFixture(id);
    // 让 store 层同步到引擎后再挂 tc（下一帧）
    queueMicrotask(() => {
      const f = useProjectStore.getState().project.fixtures[id];
      if (f) engine.attachFixture(id, f.mount);
    });
    return;
  }
  // 未命中
  useProjectStore.getState().setNotice('请拖到墙、天花或地面');
}
```

**App.tsx 主 render**：把 canvas container 加上 onDrop / onDragOver：

```tsx
<div
  ref={canvasContainerRef}
  className="canvas-container"
  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
  onDrop={(e) => {
    const eng = engineRef.current;
    const bkd = backendRef.current;
    if (eng && bkd) handleDropFixture(e, eng, bkd.canvas);
  }}
/>
```

**订阅 selectedFixtureId 变化 → attach/detach TransformControls**：

```tsx
const selectedFixtureId = useProjectStore((s) => s.selectedFixtureId);
const project = useProjectStore((s) => s.project);

useEffect(() => {
  const eng = engineRef.current;
  if (!eng) return;
  if (selectedFixtureId === null) {
    eng.attachFixture(null);
    return;
  }
  const f = project.fixtures[selectedFixtureId];
  if (!f) { eng.attachFixture(null); return; }
  eng.attachFixture(selectedFixtureId, f.mount);
}, [selectedFixtureId, project]);

// 设置拖拽结束回调 → 写入 store
useEffect(() => {
  const eng = engineRef.current;
  if (!eng) return;
  eng.setTransformCallback((fixtureId, newPos) => {
    // 用 moveAndLockFixture 走命令栈（可撤销）
    useProjectStore.getState().moveAndLockFixture(fixtureId, newPos);
    useProjectStore.getState().setNotice(`已移动 ${fixtureId.slice(0, 6)}… 到 (${newPos[0].toFixed(2)}, ${newPos[1].toFixed(2)}, ${newPos[2].toFixed(2)})`);
  });
  return () => { eng.setTransformCallback(null); };
}, [ready]);
```

**选中高亮**：`FixturePanel.tsx` 或引擎层根据 `selectedFixtureId` 改变 emissive。简化：**引擎层**提供 `setFixtureHighlight(id, on: boolean)`；引擎订阅 selectedFixtureId 后调用。或者：`updateFixture` 时检测 `selectedFixtureId === f.id`，走 shade material.emissive 变化。

**推荐**：在 `sceneEngine.attachFixture` 里顺带做高亮：

```ts
private updateFixtureHighlight(): void {
  for (const [id, entry] of this.fixtureLights) {
    const isAttached = id === this.attachedFixtureId;
    if (entry.shade) {
      entry.shade.emissiveIntensity = isAttached ? 0.35 : 0;
      if (isAttached) entry.shade.emissive.set('#ffb27a'); // accent-warm-strong
    }
  }
}
// attachFixture / detachFixture 里调
```

### 2.7 键盘快捷键增强 —— `useUndoRedoShortcut.ts`

P27 已建立 Ctrl+Z/Ctrl+Shift+Z。P28 追加：
- `R` / `E` / `Q` 切换 TransformControls 的 rotate / scale / translate 模式（默认 translate）。
- `Esc` 取消选中（`selectedFixtureId = null`）。
- `Delete` 删除选中灯具（走 `removeFixture`，可撤销）。

```ts
// 追加到 useUndoRedoShortcut 里
if (!mod && (key === 'r' || key === 'e' || key === 'q')) {
  const eng = engineRef.current;
  if (!eng) return;
  const mode = key === 'r' ? 'rotate' : key === 'e' ? 'scale' : 'translate';
  eng.setTransformMode(mode);
} else if (!mod && key === 'escape') {
  useProjectStore.getState().selectFixture(null);
} else if (!mod && (key === 'delete' || key === 'backspace')) {
  const id = useProjectStore.getState().selectedFixtureId;
  if (id) {
    useProjectStore.getState().removeFixture(id);
    useProjectStore.getState().setNotice(`已删除 ${id.slice(0, 6)}…`);
  }
}
```

**注意**：以上需要 hook 拿到 engineRef 才能调 `setTransformMode`。可以把 hook 改成 `useUndoRedoShortcut(engineRef)` 传参，或者用模块级 ref。

**推荐**：`useUndoRedoShortcut(engine: React.MutableRefObject<SceneEngine | null>)`。

### 2.8 `sceneEngine.setTransformMode` 方法

```ts
setTransformMode(mode: 'translate' | 'rotate' | 'scale'): void {
  this.transformControls?.setMode(mode);
}
```

### 2.9 FixturePanel 增加删除按钮

`src/ui/panels/FixturePanel.tsx` 底部追加：

```tsx
<button type="button" className="btn btn-danger" onClick={() => {
  useProjectStore.getState().removeFixture(fixture.id);
  useProjectStore.getState().selectFixture(null);
}}>删除灯具</button>
```

---

## 3. 测试

### 3.1 `src/render/__tests__/mountAxes.test.ts`（新）

```ts
import { describe, it, expect } from 'vitest';
import { axesForMount } from '../mountAxes.js';

describe('axesForMount', () => {
  it('ceiling / recessed: XZ 平移 + Y 旋转', () => {
    expect(axesForMount('ceiling').translateAxis).toBe('XZ');
    expect(axesForMount('recessed').translateAxis).toBe('XZ');
    expect(axesForMount('ceiling').rotateAxis).toBe('Y');
  });
  it('suspended: XYZ 平移 + Y 旋转', () => {
    expect(axesForMount('suspended').translateAxis).toBe('XYZ');
    expect(axesForMount('suspended').rotateAxis).toBe('Y');
  });
  it('wall: XZ + Y（P28 简化）', () => {
    expect(axesForMount('wall').translateAxis).toBe('XZ');
  });
  it('floor / tabletop: XZ + Y', () => {
    expect(axesForMount('floor').translateAxis).toBe('XZ');
    expect(axesForMount('tabletop').translateAxis).toBe('XZ');
  });
  it('track: 简化同 ceiling', () => {
    expect(axesForMount('track').translateAxis).toBe('XZ');
  });
});
```

### 3.2 `src/render/__tests__/snapToGrid.test.ts`（新）

```ts
import { describe, it, expect } from 'vitest';
import { snapFixturePos, FIXTURE_GRID_M } from '../snapToGrid.js';

describe('snapFixturePos', () => {
  it('0.05m 网格，正值', () => {
    expect(snapFixturePos([0.071, 0.123, 0.246])).toEqual([0.05, 0.1, 0.25]);
  });
  it('0.05m 网格，负值', () => {
    expect(snapFixturePos([-0.067, -0.134, -0.255])).toEqual([-0.05, -0.15, -0.25]);
  });
  it('0.05m 网格，边界值不动', () => {
    expect(snapFixturePos([0.05, 0.10, 0.15])).toEqual([0.05, 0.10, 0.15]);
  });
  it('0.05m 网格，0 保留', () => {
    expect(snapFixturePos([0, 0, 0])).toEqual([0, 0, 0]);
  });
  it('自定义 step', () => {
    expect(snapFixturePos([1.234, 2.456, 3.789], 0.5)).toEqual([1.0, 2.5, 4.0]);
  });
  it('默认 step = 0.05', () => {
    expect(FIXTURE_GRID_M).toBe(0.05);
  });
});
```

### 3.3 `src/render/__tests__/mountFromNormal.test.ts`（新）

```ts
import { describe, it, expect } from 'vitest';
import { mountFromNormal, dropPosFromHit } from '../mountFromNormal.js';

describe('mountFromNormal', () => {
  it('法线向上 (0,1,0) → ceiling', () => {
    expect(mountFromNormal([0, 1, 0])).toBe('ceiling');
  });
  it('法线向下 (0,-1,0) → recessed', () => {
    expect(mountFromNormal([0, -1, 0])).toBe('recessed');
  });
  it('法线朝房间 (0,0,1) → wall', () => {
    expect(mountFromNormal([0, 0, 1])).toBe('wall');
  });
  it('法线水平斜角 → wall（P28 简化）', () => {
    expect(mountFromNormal([0.5, 0.1, 0.86])).toBe('wall');
  });
  it('法线极端斜角（ny=0.6）→ wall', () => {
    expect(mountFromNormal([0.3, 0.6, 0.74])).toBe('wall');
  });
});

describe('dropPosFromHit', () => {
  it('沿法线偏移 30mm', () => {
    expect(dropPosFromHit([1, 1, 1], [0, 1, 0])).toEqual([1, 1.03, 1]);
  });
  it('默认偏移 0.03m', () => {
    expect(dropPosFromHit([0, 0, 0], [1, 0, 0])[0]).toBeCloseTo(0.03);
  });
});
```

### 3.4 `src/scene/__tests__/sceneEngineFixture.test.ts`（补 3 个用例）

在既有文件里追加：

```ts
it('attachFixture 挂接 TransformControls，选中高亮生效', () => {
  const engine = new SceneEngine(backend, {});
  engine.addFixture(makeFixture({ fixtureType: 'pendant', mount: 'suspended' }));
  const id = Object.keys(useProjectStore.getState().project.fixtures)[0]!;
  engine.attachFixture(id, 'suspended');
  expect(engine.getAttachedFixtureId()).toBe(id);
  // 高亮验证：shade emissiveIntensity > 0
  const entry = (engine as any).fixtureLights.get(id);
  expect(entry.shade.emissiveIntensity).toBeGreaterThan(0);
});

it('attachFixture(null) 卸载，高亮复位', () => {
  // ... setup ...
  engine.attachFixture(null);
  expect(engine.getAttachedFixtureId()).toBeNull();
});

it('setTransformCallback 触发 → moveAndLockFixture 走命令栈', () => {
  // ... setup ...
  let captured: string | null = null;
  engine.setTransformCallback((id, pos) => { captured = id; });
  // 模拟 tc.objectChange 完成（跳过实际拖拽）
  // 直接调 onTransformEnd 分支：
  engine.attachFixture(id, 'suspended');
  // 手动调用鼠标抬起逻辑
  (engine as any).onTransformEnd?.(id, [1, 2, 3]);
  expect(captured).toBe(id);
  // 验证命令栈有 1 条
  expect(commandStack.size).toBeGreaterThanOrEqual(1);
});
```

### 3.5 `src/ui/__tests__/fixtureLibraryPanel.test.tsx`（新）

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach } from 'vitest';
import { FixtureLibraryPanel } from '../panels/FixtureLibraryPanel.js';
import { commandStack } from '../../store/commandBus.js';
import { useProjectStore } from '../../store/projectStore.js';

beforeEach(() => {
  commandStack.clear();
  useProjectStore.setState({ selectedFixtureId: null, selectedZoneKey: null, activeSceneKey: null });
});

describe('FixtureLibraryPanel', () => {
  it('渲染 8 种灯具，各有中文标签与 draggable', () => {
    const { container } = render(<FixtureLibraryPanel />);
    const items = container.querySelectorAll('.fixture-library-item');
    expect(items.length).toBe(8);
    for (const item of items) {
      expect(item.getAttribute('draggable')).toBe('true');
      expect(item.getAttribute('data-fixture-type')).toBeTruthy();
    }
  });

  it('包含 8 个中文标签', () => {
    const { container } = render(<FixtureLibraryPanel />);
    const text = container.textContent ?? '';
    for (const label of ['筒灯', '射灯', '吊灯', '线条灯', '灯带', '壁灯', '落地灯', '台灯']) {
      expect(text).toContain(label);
    }
  });

  it('DragStart 事件设置 dataTransfer（copy 效果）', async () => {
    const user = userEvent.setup();
    const { container } = render(<FixtureLibraryPanel />);
    const first = container.querySelector('.fixture-library-item')!;
    const setData = vi.fn();
    const event = { dataTransfer: { setData, effectAllowed: '' } } as unknown as React.DragEvent;
    // 直接触发 onDragStart
    React.act(() => {
      const props = first as unknown as { onDragStart?: (e: unknown) => void };
      // React synthetic event 需模拟 React 事件触发
      // 这里通过 dispatchEvent 模拟：
      first.dispatchEvent(new DragEvent('dragstart', { dataTransfer: new DataTransfer() }));
    });
    // 更稳：走 userEvent
    await user.drag(first, document.body);
  });
});
```

**注**：`DragEvent` / `DataTransfer` 在 jsdom 里需要手动 mock。若测试复杂，简化为「渲染出 8 个 draggable 项」+「中文标签存在」两个基础用例，拖拽行为交给真实 GPU 手工验证。

---

## 4. 验证

1. `npm run typecheck` 0 error
2. `npm test` 全绿（原 782 + 新至少 15 个用例）
3. `npm run build` 成功（`three` chunk 可能略增，因引入 TransformControls）
4. **运行时手工验证**（真实 GPU）：
   - 打开首页 → 左栏看到「灯具库」8 项
   - 拖「吊灯」到天花 → 吊灯出现在天花上，50mm 网格对齐
   - 点击该吊灯 → 出现 TransformControls gizmo，OrbitControls 禁用
   - 拖 X 轴移动 → gizmo 只在 XZ 平面
   - 松手 → 位置吸附到 50mm 网格
   - Ctrl+Z → 吊灯回到拖前位置
   - 按 R → gizmo 切旋转模式
   - 按 Delete → 吊灯消失，Ctrl+Z 可恢复
   - Esc → 取消选中，gizmo 消失
   - 拖到空白（未命中）→ toast「请拖到墙、天花或地面」

---

## 5. 不做的事

- **不做**「批量布灯」（沿墙等距 / 矩形阵列 / 房间居中）——方案 §Phase 3 第 1 项，留到后续阶段。
- **不做**「拖放时高亮显示吸附候选点」（体验细节，Phase 1 优先可撤销）。
- **不做**「家具库 + 拖放」——方案 §Phase 2 范围。
- **不做**「灯具库分组/搜索」——8 项平铺够用。
- **不做**「拖拽过程中实时预览光斑位置」（需 transform 中间态，成本较高）。
- **不做**「wall 壁灯沿墙滑动」——P28 简化为 XZ 平移，方案 §Phase 3 再精细。
- **不做**「灯具库面板可折叠/可搜索」——用现有 Panel 组件即可。
- **不新增 npm 依赖**（TransformControls 已在 three 里）。
- **不改** CSS 布局（除新增 `.fixture-library-*` 规则）。
- **不改** `vite.config.ts` / `tsconfig.json` / `eslint.config.js` / `CLAUDE.md`。

---

## 6. 红线

- 只碰以下文件：
  - **新增**：`src/render/mountAxes.ts`、`src/render/snapToGrid.ts`、`src/render/mountFromNormal.ts`、`src/ui/panels/FixtureLibraryPanel.tsx`
  - **新增**：`src/render/__tests__/mountAxes.test.ts`、`src/render/__tests__/snapToGrid.test.ts`、`src/render/__tests__/mountFromNormal.test.ts`、`src/ui/__tests__/fixtureLibraryPanel.test.tsx`
  - **修改**：`src/scene/sceneEngine.ts`（追加 TransformControls 相关字段与方法，**不改**既有 API）
  - **修改**：`src/App.tsx`（追加 onDrop / onDragOver / attach 订阅 / setTransformCallback / 键盘钩子传参）
  - **修改**：`src/ui/hooks/useUndoRedoShortcut.ts`（追加 R/E/Q/Escape/Delete 处理）
  - **修改**：`src/ui/panels/FixturePanel.tsx`（追加删除按钮）
  - **修改**：`index.html`（追加 `.fixture-library-*` CSS）
  - **修改**：`src/scene/__tests__/sceneEngineFixture.test.ts`（追加 3 个用例）
- **不改**：`src/store/projectStore.ts`（P27 已定型）、`src/store/commandBus.ts`、`src/store/modelingStore.ts`、`src/core/commandStack.ts`、`src/render/backend.ts`、`src/render/lightBuilder.ts`。
- **不改**既有测试断言（除追加新用例）。
- **不删**既有代码。
- `attachFixture` 的 axis 约束通过 `transformControls.showX / showY / showZ` 实现；不引入自研 transform 层。
- 回退成本：所有新增文件 `git revert <P28-hash>` 后删除即可；sceneEngine/App/FixturePanel 的追加行删掉即可。

---

## 7. 提交

一次 commit，格式：

```
P28: Phase 1 · 灯具库 + 拖放 + TransformControls

- 新增 src/render/mountAxes.ts（mount → TransformControls 轴映射）
- 新增 src/render/snapToGrid.ts（50mm 网格吸附，3D）
- 新增 src/render/mountFromNormal.ts（法线 → mount 推断 + 命中点偏移）
- 新增 src/ui/panels/FixtureLibraryPanel.tsx（8 种灯具库，HTML5 DnD）
- SceneEngine: 追加 TransformControls 挂接/卸载/回调 + 选中高亮 emissive
- App: onDragOver/onDrop → raycast 命中 → addFixture + attachTransform
- useUndoRedoShortcut: 追加 R/E/Q 切模式、Escape 取消、Delete 删除
- FixturePanel: 追加删除按钮
- 新增 4 份测试文件（mountAxes/snapToGrid/mountFromNormal/fixtureLibraryPanel）+ sceneEngineFixture 补 3 用例
- index.html: 追加 .fixture-library-* CSS
```

不 push。

---

## 8. 交付证据

回报时给出：
- `commit_hash`
- `npm run typecheck` 输出
- `npm test` 结果（含测试总数与新增用例数）
- `git show --stat HEAD`
- `TransformControls 从 three/examples/jsm/controls/TransformControls.js 导入成功` 的验证方式（`grep` 或 `npm run build` 成功即证明）
- `deviations`（任何偏离 + 理由）
