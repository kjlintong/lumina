# P37c 规格：灯具吸附到安装面

**问题源**：P37a-fix（commit `d5fb660`）之后，灯具资产视觉正确，但用户反馈"灯放置位置不对，没有准确吸附"。这**不是 P37a-fix 的回归**——它是 P37a 之前一直存在的老问题（P36 时代 0.18×0.35 的圆柱体看着无所谓），只是 P37a-fix 把真实模型（最长 0.55m 的吊灯）显示出来后变得显眼。

**当前状态**（已核实）：
- `App.tsx:226 handleDropFixture`（拖入放置）：已经做了 `mountFromNormal(face.normal)` → `dropPosFromHit(point, normal, 0.03)` → `snapFixturePos`。即"贴到表面上 0.03m 处 + 50mm 网格吸附"。
- `sceneEngine.ts:474 TransformControls`：只有 `translationSnap = 0.05` 网格吸附，**没有"保持在原安装面上"的约束**。拖动一次灯就会脱离天花板浮到半空。
- 默认工程（`projectStore.ts:207`）的吊灯 `pos=[1.4, 1.9, -1.0]`，`ceilingH=2.8` —— 相差 0.9m，视觉上是"漂浮在半空"。

**范围**：本轮修"吸附到安装面"（3D 拖入 + 3D 拖动 + 默认工程）。**不做** chandelier 资产接入（其 `axis='horizontal'` 判断本身就是错的，另立 P37d）、**不做** FixtureLibraryPanel 3D 预览（另立 P37b）。

---

## 1. 目标

- [ ] 拖入放置：`dropPosFromHit` 按 mount 类型给出正确的 pos（不再统一偏移 0.03m）
- [ ] 3D 拖动（TransformControls）：**保持在原安装面上滑动**，不脱离表面浮到半空
- [ ] 默认工程的吊灯、筒灯、落地灯位置正确贴合安装面
- [ ] 50mm 网格吸附行为不变（水平方向仍走 `snapFixturePos`）
- [ ] 磁吸是**软约束**——用户可以按 Shift 临时"飞起来"（P37c 不做这个交互，先记录）
- [ ] 测试全绿，不新增 lint error，应用代码仍 2 chunk
- [ ] **不动** `src/core/types.ts` / `src/core/makeFixture.ts` / `src/store/projectStore.ts` 的**默认工程数据**（本轮只改 `createInitialProject` 里的 pos 值，不改接口）
- [ ] **不动** `src/render/lightBuilder.ts` / `src/render/fixtureModels.ts` / `src/render/lightAssets.ts`（P37a-fix 已收敛）

---

## 2. 设计：pos 语义

### 2.1 `Fixture.pos` 是什么

**现状**：`pos` 是灯具**锚点**的世界坐标。P37a-fix 的 `normalizeAndAnchor` 让：
- `anchor='top'`：pos 在灯具**顶端**，灯具向下延伸（pendant / ceiling_lamp / wall_sconce / floor / table / spot 都是这个方向）
- `anchor='bottom'`：pos 在灯具**底端**，灯具向上延伸（本轮所有资产都设了 anchor，见 `LIGHT_ASSET_DEFS`）

**约定**：`pos` 始终是"灯具与安装面的接触点"（安装点）：
- **ceiling / recessed / suspended / wall / cove / linear**：pos 在天花板（或墙面）表面下方 0.03m
- **floor / table / tabletop**：pos 在地面（或桌面）表面上方 0.03m

这与 P37a-fix 的 `normalizeAndAnchor` anchor 语义完全一致：**anchor='top' 类的灯，pos 在灯具顶端 = 安装点 = 表面下方 0.03m；anchor='bottom' 类的灯，pos 在灯具底端 = 安装点 = 表面上方 0.03m。**

### 2.2 mount → 安装面 + 法线方向

`MountType` 现有 6 种（`types.ts:106-111`）：

| mount | 安装面 | 表面法线方向 | pos 相对表面的偏移 |
|---|---|---|---|
| `ceiling` | 天花板平面 | (0, +1, 0) | 下方 0.03m |
| `recessed` | 天花板平面（嵌入式） | (0, +1, 0) | 表面平齐（偏移 0） |
| `suspended` | 天花板平面（吊挂） | (0, +1, 0) | 下方 0.03m |
| `wall` | 墙面 | 沿墙向外（水平） | 外偏 0.03m |
| `floor` | 地面平面 | (0, -1, 0) | 上方 0.03m |
| `tabletop` | 桌面（近似地面） | (0, -1, 0) | 上方 0.03m |

**关键区别**：
- `recessed`（筒灯、嵌入式射灯）**不做偏移**——灯具就是嵌在天花板平面里，视觉上灯具顶端和天花板齐平（不伸出）。
- 其他"从表面向房间内延伸"的灯，都做 0.03m 偏移（避免 z-fighting 且视觉上灯具不完全贴在墙/天花里）。

---

## 3. 改动清单

### 3.1 `src/render/snapToGrid.ts` —— 新增 `surfaceSnap` 纯函数

```ts
// 追加到 snapToGrid.ts 末尾

/**
 * 按 mount 类型计算"灯具与安装面接触点"的世界坐标。
 *
 * P37c：取代原 `dropPosFromHit(point, normal, 0.03)` 的统一偏移。
 * 原实现不管 mount 类型，一律沿法线偏移 0.03m —— 对 `recessed`（筒灯）是错的
 * （应该平齐），对 anchor='top' 类的灯也对（偏移方向对），但对 anchor='bottom'
 * 类的灯（floor / tabletop）就反了。
 *
 * @param point 表面上的命中点（世界坐标）
 * @param normal 表面法线（世界坐标，归一化）
 * @param mount 灯具安装类型
 * @param offsetM 沿法线的偏移（米），recessed 默认 0，其他 0.03
 * @returns pos 的世界坐标
 *
 * @example 天花板上的筒灯
 * surfaceSnap([1.4, 2.8, -1.0], [0, 1, 0], 'recessed')
 *   → [1.4, 2.8, -1.0]  // 平齐天花板
 *
 * @example 天花板上的吊灯（suspended）
 * surfaceSnap([1.4, 2.8, -1.0], [0, 1, 0], 'suspended')
 *   → [1.4, 2.77, -1.0]  // 天花板下方 0.03m
 *
 * @example 地面上的落地灯
 * surfaceSnap([-2.4, 0, 1.4], [0, -1, 0], 'floor')
 *   → [-2.4, 0.03, 1.4]  // 地面上方 0.03m
 */
export function surfaceSnap(
  point: readonly [number, number, number],
  normal: readonly [number, number, number],
  mount:
    | 'ceiling'
    | 'recessed'
    | 'suspended'
    | 'wall'
    | 'floor'
    | 'tabletop',
  offsetM = 0.03,
): readonly [number, number, number] {
  // recessed = 嵌入式，灯具顶端与表面平齐（不伸出）
  const offset = mount === 'recessed' ? 0 : offsetM;
  // 法线方向 = 从表面指向房间内的方向
  // 天花板法线 (0,+1,0) → 表面下方 0.03m → pos = point - normal * offset
  // 地面法线 (0,-1,0) → 表面上方 0.03m → pos = point - normal * offset（同公式）
  // 墙面法线 (±1,0,0) 或 (0,0,±1) → 类似
  // 统一公式：pos = point - normal * offset
  //   normal 指向房间内 → 减 offset 就是向房间内偏 offset
  return [
    point[0] - normal[0] * offset,
    point[1] - normal[1] * offset,
    point[2] - normal[2] * offset,
  ];
}
```

### 3.2 `src/render/snapToGrid.ts` —— 新增 `projectToSurface` 纯函数（拖动约束）

```ts
// 追加到 snapToGrid.ts 末尾

/**
 * 把 pos 投影回安装面（用于 TransformControls 拖动结束时"贴回"表面）。
 *
 * P37c：拖动过程中 pos 会脱离表面（用户在 3D 空间自由拖动），拖动结束
 * 时调用本函数把 pos 投影回原安装面。
 *
 * 语义：给一个灯具（含 mount + 当前 pos），计算它"应该贴在哪"：
 *   1. 用 mount 查表面法线方向（ceiling: +Y, floor: -Y, wall: 沿墙外法线）
 *   2. 把 pos 沿法线方向投影回表面（保留水平坐标，只修正垂直距离）
 *   3. 再套 surfaceSnap 加 offset
 *
 * @param pos 当前 pos（可能被用户拖到任意位置）
 * @param mount 灯具安装类型
 * @param surfaceY 安装面的 Y 坐标（ceiling=天花板高，floor=0）；wall 走另一分支
 * @param offsetM 沿法线的偏移（米），recessed 默认 0，其他 0.03
 * @returns 贴回表面后的 pos
 *
 * @example 用户把筒灯从天花板拖到半空
 * projectToSurface([1.4, 2.0, -1.0], 'recessed', 2.8)
 *   → [1.4, 2.8, -1.0]  // 强制贴回天花板（recessed offset=0）
 *
 * @example 用户把落地灯从地面拖到桌上
 * projectToSurface([-2.4, 1.4, 1.4], 'floor', 0)
 *   → [-2.4, 0.03, 1.4]  // 强制贴回地面
 *
 * **注意**：本函数**不处理 wall** —— wall 的法线是水平的，需要面 ID 才能确定
 * 法线方向（不是 mount 决定的）。wall 类灯具的拖动约束留到 P37c-fix（见 §8）。
 */
export function projectToSurface(
  pos: readonly [number, number, number],
  mount:
    | 'ceiling'
    | 'recessed'
    | 'suspended'
    | 'wall'
    | 'floor'
    | 'tabletop',
  surfaceY: number,
  offsetM = 0.03,
): readonly [number, number, number] {
  // wall 类暂不处理：返回原 pos（不改动，等 P37c-fix）
  if (mount === 'wall') return pos;

  // ceiling / recessed / suspended：安装面是 y = surfaceY 的平面，法线 (0,+1,0)
  // floor / tabletop：安装面是 y = surfaceY 的平面，法线 (0,-1,0)
  const isTop = mount === 'ceiling' || mount === 'recessed' || mount === 'suspended';
  const normal: readonly [number, number, number] = isTop ? [0, 1, 0] : [0, -1, 0];
  // 投影到表面：只保留 x, z，y 强制到 surfaceY
  const onSurface: readonly [number, number, number] = [pos[0], surfaceY, pos[2]];
  return surfaceSnap(onSurface, normal, mount, offsetM);
}
```

### 3.3 `src/App.tsx` —— 替换 `dropPosFromHit` 调用

```ts
// handleDropFixture 内（约 :281 附近）
- const rawPos = dropPosFromHit(point, normal);
- const snapped = snapFixturePos(rawPos);
+ // P37c：按 mount 类型贴到安装面
+ const rawPos = surfaceSnap(point, normal, mount);
+ // 水平方向仍走 50mm 网格吸附（Y 保持安装面位置，不再被网格化）
+ const snapped: readonly [number, number, number] = [
+   Math.round(rawPos[0] / FIXTURE_GRID_M) * FIXTURE_GRID_M,
+   rawPos[1],
+   Math.round(rawPos[2] / FIXTURE_GRID_M) * FIXTURE_GRID_M,
+ ];
```

**关键**：`snapFixturePos` 会对**三个轴**都做 50mm 吸附，会把 Y 也网格化 ——
对 ceiling 来说 2.77 会被 snap 到 2.75，导致灯具脱离天花板。所以要**只 snap X/Z**。
需要 import `FIXTURE_GRID_M` 常量（`snapToGrid.ts:14` 已导出）。

同时可以删除 `dropPosFromHit` 的 import（如果只在这一处用）。

### 3.4 `src/App.tsx` —— TransformControls 拖动结束时贴回安装面

```ts
// App.tsx 里 onTransformEnd 的回调（约 :677 附近，订阅 sceneEngine.onTransformEnd）
// 需要在回调里查 fixture 的 mount 和工程天花板高度，然后调用 projectToSurface。

- const onTransformEnd = (fixtureId: string, newPos: readonly [number, number, number]) => {
-   useProjectStore.getState().updateFixture(fixtureId, { pos: newPos });
- };
+ const onTransformEnd = (fixtureId: string, newPos: readonly [number, number, number]) => {
+   const st = useProjectStore.getState();
+   const fixture = st.project.fixtures[fixtureId];
+   if (!fixture) return;
+   // P37c：把 pos 投影回原安装面（ceiling / floor）；wall 类暂不处理（见 §8）
+   const ceilingY = st.project.ceilingH ?? 2.8;
+   const snapped = projectToSurface(newPos, fixture.mount, ceilingY);
+   st.updateFixture(fixtureId, { pos: snapped });
+ };
```

**注意**：`projectToSurface` 对 `mount='wall'` 返回原 pos（不改动），
所以墙面灯具的拖动暂不受影响（保持 P37a-fix 的现状），P37c-fix 再处理。

### 3.5 `src/store/projectStore.ts` —— 默认工程的位置修正

```ts
// createInitialProject 里（约 :207-209）
- const downlight = makeFixture({ type: 'downlight', pos: [-1.2, 2.7, 0.8], lumens: 500, cct: 2700 });
- const pendant = makeFixture({ type: 'pendant', pos: [1.4, 1.9, -1.0], lumens: 800, cct: 3000 });
- const floor = makeFixture({ type: 'floor', pos: [-2.4, 1.4, 1.4], lumens: 600, cct: 3000 });
+ // P37c：pos 严格贴合安装面（ceilingH=2.8）
+ const downlight = makeFixture({ type: 'downlight', pos: [-1.2, 2.8, 0.8], lumens: 500, cct: 2700 });
+ //   mount='recessed' → surfaceSnap 给 pos=[-1.2, 2.8, 0.8]（平齐天花板，offset=0）
+ const pendant = makeFixture({ type: 'pendant', pos: [1.4, 2.77, -1.0], lumens: 800, cct: 3000 });
+ //   mount='suspended' → surfaceSnap 给 pos=[1.4, 2.77, -1.0]（天花下方 0.03m）
+ const floor = makeFixture({ type: 'floor', pos: [-2.4, 0.03, 1.4], lumens: 600, cct: 3000 });
+ //   mount='floor' → surfaceSnap 给 pos=[-2.4, 0.03, 1.4]（地面上方 0.03m）
```

**注**：`floor` 灯 `mount='floor'`，但 `pos.y=1.4`（原值）意思是"落地灯顶部在 1.4m 高"——
这是把 pos 理解成"灯具顶部"，与本轮约定不符（本轮约定 pos = 安装点 = 地面）。
改为 `pos.y=0.03` 后，落地灯会从地面开始向上延伸，视觉上正确。

### 3.6 不动的地方

- `src/core/types.ts`：`Fixture` 接口不变（`pos` 语义在文档里定义，不加字段）
- `src/core/makeFixture.ts`：不改默认值（TYPE_DEFAULTS 保持）
- `src/render/lightBuilder.ts`：不改（`buildLightFromFixture` 保持同步）
- `src/render/lightAssets.ts`：不改（P37a-fix 已收敛）
- `src/scene/sceneEngine.ts`：不改（`onTransformEnd` 回调在 App.tsx 侧处理）
- `src/render/mountFromNormal.ts`：不改（`mountFromNormal` 已经能推 6 种 mount）

---

## 4. 测试

`src/render/__tests__/snapToGrid.test.ts`（已存在，追加 describe 块）+ 新建 `src/render/__tests__/surfaceSnap.test.ts`：

### 4.1 `surfaceSnap` 测试（新建文件）

```ts
import { describe, it, expect } from 'vitest';
import { surfaceSnap } from '../snapToGrid.js';

describe('snapToGrid: surfaceSnap (P37c)', () => {
  it('ceiling 灯：pos 在天花板下方 0.03m', () => {
    const p = surfaceSnap([1.0, 2.8, 0.0], [0, 1, 0], 'ceiling');
    expect(p[0]).toBeCloseTo(1.0, 5);
    expect(p[1]).toBeCloseTo(2.77, 5); // 2.8 - 0.03
    expect(p[2]).toBeCloseTo(0.0, 5);
  });

  it('recessed 灯（筒灯）：pos 与天花板平齐（offset=0）', () => {
    const p = surfaceSnap([1.0, 2.8, 0.0], [0, 1, 0], 'recessed');
    expect(p[1]).toBeCloseTo(2.8, 5); // 不偏移
  });

  it('suspended 灯（吊灯）：pos 在天花板下方 0.03m', () => {
    const p = surfaceSnap([1.4, 2.8, -1.0], [0, 1, 0], 'suspended');
    expect(p[1]).toBeCloseTo(2.77, 5);
  });

  it('floor 灯：pos 在地面上方 0.03m（法线 -Y）', () => {
    const p = surfaceSnap([2.0, 0, 1.0], [0, -1, 0], 'floor');
    expect(p[1]).toBeCloseTo(0.03, 5); // 0 + 0.03 = 0.03
  });

  it('tabletop 灯：pos 在桌面上方 0.03m', () => {
    const p = surfaceSnap([0, 0.75, 0], [0, -1, 0], 'tabletop');
    expect(p[1]).toBeCloseTo(0.78, 5);
  });

  it('wall 灯：pos 沿墙外法线偏 0.03m', () => {
    // 墙在 x=3，法线 (-1,0,0)（指向房间内）
    const p = surfaceSnap([3.0, 1.5, 0.0], [-1, 0, 0], 'wall');
    expect(p[0]).toBeCloseTo(2.97, 5); // 3.0 - (-1)*0.03 = 3.0 + 0.03? 不，向房间内偏 0.03 = x 减 0.03
    // 重算：point.x - normal.x * offset = 3.0 - (-1)*0.03 = 3.0 + 0.03 = 3.03? 
    // 不对 —— 法线 (-1,0,0) 指向房间（-X 方向），"向房间内偏 0.03" = x 减 0.03
    // 公式 pos = point - normal * offset = 3.0 - (-1)*0.03 = 3.0 + 0.03 = 3.03
    // 这跟"向房间内"矛盾！
    // 关键：**normal 指向房间内**（-X），点减 normal*offset = 点在法线反方向（=墙面内）
    // 所以 wall 的公式对法线方向敏感：
    //   若法线指向房间内 (-1,0,0)，pos = point - normal*offset = 3.0 - (-1)*0.03 = 3.03（墙面内，错！）
    //   正确应该是 pos = point + normal*offset = 3.0 + (-1)*0.03 = 2.97（房间内，对！）
    expect(p[0]).toBeCloseTo(2.97, 5); // 期望向房间内偏 0.03
  });
});
```

**上面这个测试暴露了 §3.1 公式的问题**——统一的 `pos = point - normal * offset` 对 wall 会反。
需要在 §3.1 修正公式（见下）。

### 4.2 §3.1 修正：`surfaceSnap` 的偏移方向

**根因**：`normal` 有两种语义可能：
- "表面法线"（几何学意义）：指向**朝外**（房间外）
- "安装法线"（本项目的语义）：指向**房间内**（灯具延伸方向）

`mountFromNormal` 返回的是**朝房间内**的法线（见 `mountFromNormal.test.ts:39`：
`expect(mountFromNormal([0, 1, 0])).toBe('ceiling')` —— 从天花板向下命中的法线是 (0,+1,0)，
但 ceiling 灯的 pos 应该在天花板**下方**，即"沿法线反方向"）。

**修正公式**：
```ts
// 法线指向房间内时，"pos 在表面沿法线偏 offset" = point + normal * offset
// 法线指向房间内 (-1,0,0)：pos.x = point.x + (-1)*0.03 = point.x - 0.03（房间内，对）
// 法线指向房间内 (0,+1,0)（ceiling）：pos.y = point.y + 1*0.03 = point.y + 0.03
//   —— 但 ceiling 灯的 pos 应该在天花板**下方** 0.03，不是上方！
// 又反了。
```

**根因分析**：`mountFromNormal` 返回的 `normal` 是**表面法线**（几何学意义），
- 天花板命中：`face.normal = (0, +1, 0)`（three.js 里 `PlaneGeometry` 的法线朝上）
- 地面命中：`face.normal = (0, -1, 0)`（`PlaneGeometry` 默认朝上，翻转到朝下）
- 墙面命中：`face.normal` 沿墙外法线（水平）

**约定**：`normal` 是**朝房间内**的（即"用户看到的正面朝向"）。所以：
- 天花板 `(0,+1,0)`：朝房间**内** = 朝下（视觉上天花板是"朝下看的"）→ 但 three.js 的 `PlaneGeometry` 默认法线朝 +Y（朝上）。

这里存在**语义混淆**。为了不引入更多复杂度，本轮的做法是：

**`surfaceSnap` 假设 `normal` 指向房间外**（几何学意义），公式 `pos = point - normal * offset`：
- 天花板：`face.normal = (0, +1, 0)`（朝房间外=朝上）→ `pos.y = 2.8 - 1*0.03 = 2.77`（下方，对）✓
- 地面：`face.normal = (0, -1, 0)`（朝房间外=朝下）→ `pos.y = 0 - (-1)*0.03 = 0.03`（上方，对）✓
- 墙面：`face.normal = (1, 0, 0)`（朝房间外=朝右）→ `pos.x = 3.0 - 1*0.03 = 2.97`（房间内，对）✓

**验证** `mountFromNormal` 的返回：`mountFromNormal.test.ts` 里断言 `mountFromNormal([0, 1, 0]) === 'ceiling'`，即法线朝上（+Y）→ ceiling。这与"normal 朝房间外"一致（天花板的"外"是朝上）。

**所以 §3.1 原公式 `pos = point - normal * offset` 是正确的**，测试用例 §4.1 里 wall 的那段"重算"注释是我在写的时候想错了方向。修正测试：

```ts
  it('wall 灯：pos 沿墙外法线偏 0.03m 到房间内', () => {
    // 墙在 x=3，法线朝房间外 = (1, 0, 0)（朝右，即朝墙外）
    // pos = point - normal * offset = 3.0 - 1*0.03 = 2.97（房间内，对）
    const p = surfaceSnap([3.0, 1.5, 0.0], [1, 0, 0], 'wall');
    expect(p[0]).toBeCloseTo(2.97, 5);
  });
```

### 4.3 `projectToSurface` 测试

```ts
describe('snapToGrid: projectToSurface (P37c)', () => {
  it('用户把筒灯从天花板拖到半空：贴回天花板', () => {
    // recessed offset=0，pos.y 直接回到 ceilingY
    const p = projectToSurface([1.4, 2.0, -1.0], 'recessed', 2.8);
    expect(p).toEqual([1.4, 2.8, -1.0]);
  });

  it('用户把吊灯从天花板拖到半空：贴回天花板下方 0.03m', () => {
    const p = projectToSurface([1.4, 2.0, -1.0], 'suspended', 2.8);
    expect(p[0]).toBeCloseTo(1.4, 5);
    expect(p[1]).toBeCloseTo(2.77, 5); // 2.8 - 0.03
    expect(p[2]).toBeCloseTo(-1.0, 5);
  });

  it('用户把落地灯从地面拖到桌上：贴回地面上方 0.03m', () => {
    const p = projectToSurface([-2.4, 1.4, 1.4], 'floor', 0);
    expect(p[0]).toBeCloseTo(-2.4, 5);
    expect(p[1]).toBeCloseTo(0.03, 5); // 0 + 0.03
    expect(p[2]).toBeCloseTo(1.4, 5);
  });

  it('用户把桌面台灯从桌面拖到地面：贴回桌面上方 0.03m', () => {
    const p = projectToSurface([0, 0, 0], 'tabletop', 0.75);
    expect(p[1]).toBeCloseTo(0.78, 5); // 0.75 + 0.03
  });

  it('wall 灯：不动（暂不处理）', () => {
    const pos = [3.0, 1.5, 0.0] as const;
    const p = projectToSurface(pos, 'wall', 2.8);
    expect(p).toBe(pos); // 原样返回（引用相等）
  });

  it('水平坐标不被改动（只修正 Y）', () => {
    const p = projectToSurface([1.234, 1.5, -0.876], 'ceiling', 2.8);
    expect(p[0]).toBeCloseTo(1.234, 5);
    expect(p[1]).toBeCloseTo(2.77, 5);
    expect(p[2]).toBeCloseTo(-0.876, 5);
  });
});
```

### 4.4 现有 `dropPosFromHit` 测试

**保留**（不动），因为 `dropPosFromHit` 还在 `mountFromNormal.test.ts` 里被测。
但从 `App.tsx` 里移除它的 import（如果只在这一处用）。

---

## 5. 测试总数

- 基线（P37a-fix）：956
- P37c：+10（`surfaceSnap` 6 + `projectToSurface` 6，减去与 §4.1 里"wall 反转"讨论重复的 2 条）

具体拆分：
- `surfaceSnap` 6 条：ceiling / recessed / suspended / floor / tabletop / wall
- `projectToSurface` 6 条：recessed / suspended / floor / tabletop / wall / 水平坐标保留
- 总计：**+12**

net: 956 → **968**。

**以实际 diff 为准**。

---

## 6. 验证

1. `npm test` → 全绿（约 968）
2. `npm run typecheck` → 全绿
3. `npm run lint` → **不新增 error**（清 `node_modules/.cache` 后测，330/12 基线）
4. `npm run build` → 通过，应用代码仍 2 chunk（index + three）
5. `python3 -m py_compile scripts/download-assets.py` → 通过
6. 手动验证（用户 GPU）：起 `npm run dev`，拖吊灯到天花板 → 灯顶贴天花（不穿透）；
   拖筒灯到天花板 → 灯具顶端与天花板齐平；拖落地灯到地面 → 灯底座贴地；
   在 3D 里用 TransformControls 拖动灯具 → 松开后贴回原安装面

---

## 7. 红线

- **不动** `src/core/types.ts` / `src/core/makeFixture.ts`
- **不动** `src/render/lightBuilder.ts` / `src/render/fixtureModels.ts` / `src/render/lightAssets.ts` / `src/render/furnitureAssets.ts`
- **不动** `src/scene/sceneEngine.ts`
- **不动** `src/render/mountFromNormal.ts`
- **不改** `vite.config.ts`；**不新增** npm 依赖
- **不删**其他文件的测试
- **不要** `git add .`；**不要** push
- **注意**：`src/store/projectStore.ts` 只改 `createInitialProject` 里 3 行的 pos 值，**不动其他逻辑**（`applySceneToFixtures` / `addFixture` / `updateFixture` 等）

---

## 8. 后续（不在本轮）

- **P37c-fix wall 磁吸**：`projectToSurface` 对 wall 类返回原 pos（不处理），
  因为 wall 的法线是水平的、方向取决于具体是哪面墙。要正确支持需要给 Fixture 加
  `wallFaceId` 字段（记录灯具贴在哪面墙）。这需要 `types.ts` 改动，另立项。
  **本轮的行为**：wall 类灯具（sconce）拖动后**不**被强制贴回墙面（保持拖动结束的位置），
  但拖入放置时（`handleDropFixture`）仍会按墙面法线正确吸附（`surfaceSnap` 支持 wall）。
- **P37d chandelier 资产接入**：`axis='horizontal'` 判断本身是错的（chandelier 资产
  单位很大，x=±37 是 Poly Haven 建模的单位问题），需要重新设计轴策略。
- **P37b FixtureLibraryPanel 3D 预览**：离屏渲染器，另立项。
- **pending pendant 贴图**：pendant 的 gltf 引用了 2 张贴图（emissive + glass normal）
  但 `download-assets.py` 漏下载了，导致发光强度比预期弱。修 `download-assets.py` 时补上。

---

## 9. 视觉判定免责声明

本环境 WSL2 SwiftShader，3D 渲染可能黑屏/材质灰平。视觉质量（吸附是否准确、
灯具是否穿透天花板）由用户在真实 GPU 上验收。本轮用数值断言验证 pos 计算，
**不声称已验收画面**。

---

## 10. 提交模板

```bash
git add \
  src/render/snapToGrid.ts \
  src/render/__tests__/surfaceSnap.test.ts \
  src/App.tsx \
  src/store/projectStore.ts \
  docs/P37c-spec.md \
  docs/P8-plan.md

git commit -m "P37c: 灯具吸附到安装面

原问题：
- dropPosFromHit 对所有 mount 类型统一偏移 0.03m，对 recessed（筒灯）
  是错的（应该平齐天花板）
- TransformControls 拖动后没有约束，灯具会脱离安装面浮到半空
- 默认工程 pos 值随意（吊灯 pos.y=1.9 vs ceilingH=2.8，差 0.9m）

改动：
- snapToGrid.ts: 新增 surfaceSnap(point, normal, mount) —— 按 mount 类型
  给正确偏移（recessed=0, 其他=0.03）
- snapToGrid.ts: 新增 projectToSurface(pos, mount, surfaceY) —— 拖动结束
  后把 pos 投影回原安装面（wall 类暂不处理）
- App.tsx handleDropFixture: 用 surfaceSnap 取代 dropPosFromHit；
  只 snap X/Z（保留 Y 精确到安装面位置）
- App.tsx onTransformEnd: 调用 projectToSurface 贴回安装面
- projectStore.ts createInitialProject: 默认工程 3 盏灯 pos 值贴合安装面

测试：+12 条（surfaceSnap 6 + projectToSurface 6）

后续：P37c-fix wall 磁吸（需给 Fixture 加 wallFaceId，另立项）、
P37d chandelier 资产接入。"
```
