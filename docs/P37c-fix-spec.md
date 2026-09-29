# P37c-fix 规格：wall 磁吸 + 修正 surfaceSnap 法线方向

**问题源**：P37c（commit `8e11b98`）实现了"吸附到安装面"，但把 `wall` 类明确 defer 了
（`projectToSurface` 对 wall 返回原 pos）。此外，用真实 raycast normal 跑端到端探针后
**发现 P37c 的 ceiling / floor 路径一直是错的**——只是因为默认工程的 pos 值是手改的、
不经过 `surfaceSnap`，所以没暴露。

## 0. 两个已核实的 bug（探针实测，见 §5）

### Bug 1：`surfaceSnap` 的法线方向约定反了

`mountFromNormal.ts` 的注释明确写：
> 从房间内部点天花，raycaster 命中的 world normal 是 `(0, -1, 0)`。
> 贴墙安装时法线朝房间内侧。

即 `mountFromNormal` 的 normal 约定是**朝房间内**（从相机看向表面，表面法线指向相机）。

但 `surfaceSnap` 的公式 `pos = point - normal * offset` 假设 normal **朝房间外**。
两者方向相反 → ceiling 灯被推到天花板**上方**：

| 命中 | raycast normal | mount | P37c 结果 | 应该 |
|---|---|---|---|---|
| 天花 | (0, -1, 0) | ceiling | y = 2.8 + 0.03 = **2.83** ✗ | 2.77 |
| 地面 | (0, -1, 0) | **'ceiling'（误判）** | y = 0 + 0.03 = 0.03（碰巧对） | 0.03 |
| 墙 +X | (1, 0, 0) | wall | x = 3.0 - 0.03 = 2.97 ✓ | 2.97 |
| 墙 -X | (-1, 0, 0) | wall | x = -3.0 + 0.03 = -2.97 ✓ | -2.97 |

wall 碰巧对，是因为 `mountFromNormal` 给的是朝房间内法线，而"朝房间内偏 0.03"
正好是墙灯的正确位置。但公式 `pos = point - normal * offset` 与"朝房间内"配合
得到的方向**只对 wall 成立**，对 ceiling/floor 就是反的。

**修法**：统一为"normal 朝房间内"约定，公式改为 `pos = point + normal * offset`。

### Bug 2：`mountFromNormal` 把地面误判为 ceiling

`room.ts:265` 注释："地板（xz 平面，y=0）。法线经 `rotation.x = -PI/2` 由 +Z 转为 +Y（朝上）"。
即从房间内部点地面，world normal 是 **(0, +1, 0)**（朝上）。
而 `mountFromNormal` 的 `ny > 0.7 → 'recessed'` 分支会把地面判成 recessed。
探针里我传了 (0,-1,0) 才"碰巧"得到 0.03——那是错的 normal，但结果对。

**修法**：`mountFromNormal` 加参数区分（见 §3.3）。

---

## 1. 目标

- [ ] `surfaceSnap` 修正法线方向（公式 `pos = point + normal * offset`，normal 朝房间内）
- [ ] `mountFromNormal` 支持区分天花与地面（新参数 `fromInside`，不破坏现有调用）
- [ ] wall 类支持保存安装面法线（`installNormal` 随 Fixture 序列化），但**拖动后不投影**——仅凭法线无法恢复墙面世界坐标，任何沿法线的加减都会让 pos 每次漂移 ±0.03m，是 bug；正确行为是保留用户拖动后的 y/z（想改高度就拖动 y，离墙距离保持）
- [ ] 新增 `Fixture.installNormal?: [x, y, z]` 字段（只在 mount='wall' 时有意义，安装时记录墙面方向）
- [ ] 保存/加载后 wall 灯不丢失 installNormal（structuredClone 对元组无损，序列化无需改）
- [ ] 默认工程的筒灯、吊灯位置**保持不变**（2.8 / 2.77）—— 回归测试锁定
- [ ] 测试全绿，不新增 lint error，应用代码仍 2 chunk

---

## 2. 设计

### 2.1 normal 约定（统一）

**约定**：`installNormal` 与 `surfaceSnap(point, normal, mount)` 的 `normal` 参数，
都是**朝房间内**的单位向量（即从相机/房间看向表面时，表面法线指向观察者）。

- 天花（y=2.8）：`(0, -1, 0)` —— 朝下（房间内）
- 地面（y=0）：`(0, +1, 0)` —— 朝上（房间内）
- 东墙（x=3）：`(-1, 0, 0)` —— 朝西（房间内）
- 西墙（x=-3）：`(+1, 0, 0)` —— 朝东（房间内）

公式：`pos = point + normal * offset`
- 天花：`(1.4, 2.8, -1.0) + (0,-1,0)*0.03 = (1.4, 2.77, -1.0)` ✓
- 地面：`(2.4, 0, 1.4) + (0,+1,0)*0.03 = (2.4, 0.03, 1.4)` ✓
- 东墙：`(3.0, 1.5, 0) + (-1,0,0)*0.03 = (2.97, 1.5, 0)` ✓

**注**：这与 `mountFromNormal.ts` 注释里的描述完全一致，也与 wall 的实测正确行为一致。
P37c 的公式是反的，本修复统一过来。

### 2.2 `Fixture.installNormal`

```ts
export interface Fixture {
  // ... 现有字段
  /**
   * P37c-fix：安装面法线（朝房间内单位向量）。
   * 仅 mount='wall' 时需要 —— 墙面有 4 个方向，pos 无法反推法线，
   * 必须显式保存，否则拖动后无法贴回原墙面。
   * ceiling / floor / tabletop 等安装面可由 mount + surfaceY 推导，不存。
   */
  installNormal?: readonly [x: number, y: number, z: number];
}
```

**序列化**：`serialize.ts` 用 `structuredClone`（对元组无损），不需要改。
**默认值**：`undefined` —— `projectToSurface` 对 wall 灯一律走"不投影"（返回原 pos，见 §3.2）；`installNormal` 仅用于保存墙面方向记录。

---

## 3. 改动清单

### 3.1 `src/render/snapToGrid.ts` —— 修正 `surfaceSnap` 公式

```ts
/**
 * 按 mount 类型计算"灯具与安装面接触点"的世界坐标。
 *
 * **normal 约定**：朝房间内（从房间看向表面，法线指向观察者）。
 *   天花 (0,-1,0)  地面 (0,+1,0)  东墙 (-1,0,0)  西墙 (+1,0,0)
 * 公式：pos = point + normal * offset
 *
 * offset：recessed=0（嵌入，灯具顶端与表面平齐），其他 0.03m。
 */
export function surfaceSnap(
  point: readonly [number, number, number],
  normal: readonly [number, number, number],
  mount:
    | 'ceiling' | 'recessed' | 'suspended' | 'track'
    | 'wall' | 'floor' | 'tabletop',
  offsetM = 0.03,
): readonly [number, number, number] {
  const offset = mount === 'recessed' ? 0 : offsetM;
  return [
    point[0] + normal[0] * offset,
    point[1] + normal[1] * offset,
    point[2] + normal[2] * offset,
  ];
}
```

### 3.2 `src/render/snapToGrid.ts` —— 改 `projectToSurface`，wall 不投影

**注意**：spec 初稿写过 `pos - installNormal * offset` 的投影公式，但浏览器端到端探针实测发现该公式**幂等性失败**——已表面 pos=(2.97,1.5,0) 投影后变成 (3.0,1.5,0)，每次 +0.03m，越拖越远。根因：仅凭 installNormal（朝西法线 (-1,0,0)）无法恢复墙面 S 的世界坐标（不知道墙在 x=3），所以无论 `+` 还是 `−` 都做不到真正的"贴回墙面"。

正确行为：wall 分支**不投影，返回原 pos**。用户拖动墙面灯具后停在当前位置，y/z 保留拖动态（想改高度就拖动 y，离墙距离保持）。这与水平安装面不同——那里"表面"是硬编码常数（surfaceY），投影有意义；墙面"表面"是变量，投影只会漂移。

```ts
export function projectToSurface(
  pos: readonly [number, number, number],
  mount:
    | 'ceiling' | 'recessed' | 'suspended' | 'track'
    | 'wall' | 'floor' | 'tabletop',
  surfaceY: number,
  offsetM = 0.03,
): readonly [number, number, number] {
  const offset = mount === 'recessed' ? 0 : offsetM;

  if (mount === 'wall') {
    // 墙面：仅凭 installNormal 无法恢复墙面 S 的世界坐标（知道法线朝西不等于知道墙在 x=3），
    // 所以无法做真正的"贴回墙面"。返回原 pos，保留用户拖动后的 y/z 变化。
    // 与水平安装面（y 由 surfaceY 硬编码）不同：那里"表面"是确定的常数，投影有意义；
    // 墙面"表面"是变量，投影只会让 pos 沿法线漂移（每次 ±0.03m），是 bug。
    return pos;
  }

  // 水平安装面：保留 x, z，y 强制到 surfaceY
  const isTop =
    mount === 'ceiling' || mount === 'recessed' || mount === 'suspended' || mount === 'track';
  const normal: readonly [number, number, number] = isTop ? [0, -1, 0] : [0, 1, 0];
  // 注意：normal 朝房间内，所以 ceiling 是 (0,-1,0)，floor/tabletop 是 (0,+1,0)
  return [pos[0] + normal[0] * offset, surfaceY + normal[1] * offset, pos[2] + normal[2] * offset];
}
```

**幂等性验证**：对 ceiling 已表面 pos=(1.4, 2.77, -1.0)，surfaceY=2.8：
- 输出 = (1.4, 2.8 + (-1)*0.03, -1.0) = (1.4, **2.77**, -1.0) ✓ 等于输入

### 3.3 `src/render/mountFromNormal.ts` —— 支持区分天花与地面

```ts
export type DropMount =
  | 'ceiling' | 'recessed' | 'suspended' | 'track'
  | 'wall' | 'floor' | 'tabletop';

/**
 * 拖放时根据命中面法线推断安装方式。
 *
 * **normal 约定**：朝房间内（与 surfaceSnap 一致）。
 *   天花 (0,-1,0)  地面 (0,+1,0)  东墙 (-1,0,0)  西墙 (+1,0,0)
 *
 * @param normal 命中面法线（朝房间内）
 * @param opts.fromInside true = 从房间内部点表面（常规），false = 从外部（罕用，如相机在天花板上方）
 *                        默认 true
 */
export function mountFromNormal(
  normal: readonly [number, number, number],
  opts: { fromInside?: boolean } = {},
): DropMount {
  const fromInside = opts.fromInside ?? true;
  const ny = normal[1];
  if (Math.abs(ny) < 0.7) return 'wall'; // 水平面

  // |ny| >= 0.7：是天花板或地面。
  // 从房间内部看表面时，法线的 y 分量取反才代表"朝房间内"的方向：
  //   dir = -ny
  //   天花 ny = -1 → dir = +1 > 0.7  → 'ceiling'
  //   地面 ny = +1 → dir = -1 < -0.7 → 'floor'
  // fromInside=false（相机在表面外侧）时不取反。
  const dir = fromInside ? -ny : ny;
  if (dir > 0.7) return 'ceiling';
  if (dir < -0.7) return 'floor';
  return 'suspended'; // 边界模糊
}
```

**回归检查**：现有 `mountFromNormal.test.ts` 断言（fromInside 默认 true）：
- `[0, -1, 0]` → ceiling ✓（新：ny=-1, dir=1, >0.7 → ceiling）
- `[0, 1, 0]` → **recessed**（旧）/ **floor**（新）—— **测试会挂，需要改**
- `[0, 0, 1]` → wall ✓
- `[0, 0.7, 0]` → suspended ✓（|ny|=0.7 不 <0.7 → 兜底）
- `[0, -0.8, 0]` → ceiling ✓

**要改的测试**：`mountFromNormal.test.ts` 那条"法线向上 (0,1,0) → recessed"。
按新约定 (0,+1,0) 是"地面朝上" → floor。这条测试的语义本来就含糊（注释写"从上方点地板"），
改断言为 `expect(mountFromNormal([0, 1, 0])).toBe('floor')`。

**另外**：`mountFromNormal` 旧版返回类型是 6 值的 `DropMount`（不含 'track'），
新版扩到 7 值。但调用方（App.tsx `mountFromNormal(normal)`）不传 opts，
行为完全等同旧版（除了 [0,1,0] 那条）。所以**不影响现有调用**。

### 3.4 `src/core/types.ts` —— 加 `installNormal` 字段

在 `Fixture` 接口 `pos` 后面加：
```ts
  /** P37c-fix：安装面法线（朝房间内）。仅 mount='wall' 时需要。 */
  installNormal?: readonly [x: number, y: number, z: number];
```

### 3.5 `src/core/makeFixture.ts` —— 支持传入 `installNormal`

```ts
export interface FixtureOptions {
  // ... 现有
  pos?: readonly [x: number, y: number, z: number];
  installNormal?: readonly [x: number, y: number, z: number];  // 新增
}

export function makeFixture(opts: FixtureOptions = {}): Fixture {
  // ...
  return {
    // ...
    pos: opts.pos ?? [0, 2.4, 0],
    installNormal: opts.installNormal,  // 新增
    // ...
  };
}
```

### 3.6 `src/App.tsx` —— 保存 installNormal + 用修正后的 surfaceSnap

```ts
// handleDropFixture 内（约 :281 附近）
- const mount = mountFromNormal(normal);
+ const mount = mountFromNormal(normal, { fromInside: true });
  const rawPos = surfaceSnap(point, normal, mount);
  const snapped = [
    Math.round(rawPos[0] / FIXTURE_GRID_M) * FIXTURE_GRID_M,
    rawPos[1],
    Math.round(rawPos[2] / FIXTURE_GRID_M) * FIXTURE_GRID_M,
  ];
  const id = useProjectStore.getState().addFixture({
    type: fixtureType,
    mount,
    pos: snapped,
+   installNormal: mount === 'wall' ? [normal[0], normal[1], normal[2]] : undefined,
  });

// onTransformEnd / setTransformCallback 内
// 注意：projectToSurface 已移除 installNormal 参数（wall 不投影，见 §3.2），
// 所以这里**不传** fixture.installNormal。
const snapped = projectToSurface(newPos, fixture.mount, ceilingY);
```

**注意**：`mount='recessed'` 时 offset=0，公式 `pos = point + normal*0 = point`。
所以从房间内部点天花板（normal=(0,-1,0)）得到的 pos.y = 2.8 + 0 = 2.8 ✓。
但 `mountFromNormal` 永远不会返回 'recessed'（新版已改为返回 'ceiling'/'floor'）——
所以 recessed 的 offset=0 分支**只在代码里作为 API 兜底存在**，实际不会走。
`ceiling` 走 offset=0.03，正好是"贴天花下方 3cm"，语义正确。

### 3.7 `src/store/projectStore.ts` —— 默认工程不变

**默认工程的 3 盏灯 pos 值保持 P37c 已改的值**（downlight 2.8 / pendant 2.77 / floor 0.03）。
它们是手改的，不经过 surfaceSnap，所以 Bug 1 的修正不影响它们。
本轮只加一行注释说明。

---

## 4. 测试

### 4.1 `src/render/__tests__/surfaceSnap.test.ts` —— 按新约定改断言

**改断言 + 加 2 条**（wall 两条）：

`surfaceSnap` 6 条：把 normal 从"朝房间外"改为"朝房间内"：
- ceiling：`normal=[0,-1,0]`，point=(1,2.8,0) → pos=(1, **2.77**, 0)（2.8 + (-1)*0.03）
- recessed：`normal=[0,-1,0]`，point=(1,2.8,0) → pos=(1, **2.8**, 0)（offset=0）
- suspended：`normal=[0,-1,0]`，point=(1.4,2.8,-1) → pos=(1.4, **2.77**, -1)
- floor：`normal=[0,+1,0]`，point=(2,0,1) → pos=(2, **0.03**, 1)
- tabletop：`normal=[0,+1,0]`，point=(0,0.75,0) → pos=(0, **0.78**, 0)
- wall：`normal=[-1,0,0]`（东墙朝房间内），point=(3,1.5,0) → pos=(**2.97**, 1.5, 0)

`projectToSurface` 6 条：同样改 normal（**不加 installNormal 参数**——wall 不投影，见 §3.2）：
- recessed：pos=(1.4,2,-1), mount='recessed', surfaceY=2.8 → (1.4, **2.8**, -1)（offset=0）
- suspended：pos=(1.4,2,-1), mount='suspended', surfaceY=2.8 → (1.4, **2.77**, -1)
- floor：pos=(-2.4,1.4,1.4), mount='floor', surfaceY=0 → (-2.4, **0.03**, 1.4)
- tabletop：pos=(0,0,0), mount='tabletop', surfaceY=0.75 → (0, **0.78**, 0)
- **wall 不投影（新）**：pos=(3.5,1.5,0.5), mount='wall' → 返回原 pos（toBe，引用相等）
- **wall 已表面幂等（新）**：pos=(2.97,1.5,0.0), mount='wall' → 返回原 pos（toBe）
- 水平坐标保留：不变

**+1 条**（原 12 → 13），surfaceSnap.test.ts 共 13 条。

### 4.2 `src/render/__tests__/mountFromNormal.test.ts` —— 改 1 条 + 加 3 条

- 改：`[0,1,0]` → floor（原 recessed）
- 加：`[0,-1,0], fromInside=true` → ceiling
- 加：`[0,+1,0], fromInside=true` → floor
- 加：`[0,-1,0], fromInside=false` → floor（外部视角反转）
- 加：dropPosFromHit 的 4 条覆盖（默认 offset、负法线、自定义 offset）

**+7 条**（7 → 14），mountFromNormal.test.ts 共 14 条。

**总计**（各文件最终条数）：
- surfaceSnap.test.ts：12 → 13（+1）
- mountFromNormal.test.ts：7 → 14（+7）
- surfaceSnapE2E.test.ts：0 → 4（+4，新文件）

**净增 +8 + 新文件**，基线 968 → **976**。以实际 diff 为准。

### 4.3 新增：`surfaceSnap` × P37a-fix × `normalizeAndAnchor` 端到端

新建 `src/render/__tests__/surfaceSnapE2E.test.ts`（纯数值，不加载 GLTF）：

```ts
describe('surfaceSnap → pos → anchor worldY 组合（P37c-fix）', () => {
  it('pendant (suspended, anchor=top) 贴天花下方 0.03m', () => {
    const pos = surfaceSnap([1.4, 2.8, -1.0], [0, -1, 0], 'suspended');
    expect(pos[1]).toBeCloseTo(2.77, 5);
    // P37a-fix 归一化后 asset 顶端 y=0，所以灯具顶部 world y = pos.y + 0 = 2.77
    // 即天花板 2.8 下方 0.03m
    expect(pos[1] + 0).toBeCloseTo(2.77, 5);
  });
  it('downlight (recessed, anchor=top) 顶端与天花平齐', () => {
    const pos = surfaceSnap([-1.2, 2.8, 0.8], [0, -1, 0], 'recessed');
    expect(pos[1]).toBeCloseTo(2.8, 5);
  });
  it('floor lamp (floor, anchor=bottom) 底座贴地 0.03m', () => {
    const pos = surfaceSnap([-2.4, 0, 1.4], [0, 1, 0], 'floor');
    expect(pos[1]).toBeCloseTo(0.03, 5);
  });
  it('wall sconce (wall, anchor=top) 朝房间内偏 0.03m', () => {
    const pos = surfaceSnap([3.0, 1.5, 0], [-1, 0, 0], 'wall');
    expect(pos[0]).toBeCloseTo(2.97, 5);
  });
});
```

**+4 条**（新文件）。

---

## 5. 验证

1. `npm test` → 全绿（976）
2. `npm run typecheck` → 全绿
3. `npm run lint` → 不新增 error（清 `node_modules/.cache` 后测，330/12 基线）
4. `npm run build` → 应用代码仍 2 chunk
5. `python3 -m py_compile scripts/download-assets.py` → 通过
6. 手动（用户 GPU）：拖壁灯到东墙 → 灯贴在墙内 3cm；3D 里拖动壁灯 → 松开后贴回东墙
   （不再飘走）；保存工程再打开 → 壁灯仍在东墙上

---

## 6. 红线

- **不动** `src/render/lightBuilder.ts` / `src/render/fixtureModels.ts` /
  `src/render/lightAssets.ts` / `src/render/furnitureAssets.ts`
- **不动** `src/scene/sceneEngine.ts`
- **不动** `src/store/projectStore.ts` 的其他逻辑（只加一行注释）
- **不改** `vite.config.ts`；**不新增** npm 依赖
- **不要** `git add .`；**不要** push
- `src/core/types.ts` / `src/core/makeFixture.ts` 本轮**需要改**（加 installNormal），
  但只加字段，不改现有逻辑

---

## 7. 后续

- **P37d chandelier**：axis='horizontal' 判断本身是错的
- **P37b FixtureLibraryPanel 3D 预览**：离屏渲染器
- **pending pendant 贴图**：download-assets.py 漏下载 2 张贴图

---

## 8. 提交模板

```bash
git add \
  src/render/snapToGrid.ts \
  src/render/mountFromNormal.ts \
  src/core/types.ts \
  src/core/makeFixture.ts \
  src/App.tsx \
  src/render/__tests__/surfaceSnap.test.ts \
  src/render/__tests__/mountFromNormal.test.ts \
  src/render/__tests__/surfaceSnapE2E.test.ts \
  docs/P37c-fix-spec.md \
  docs/P8-plan.md

git commit -m "P37c-fix: wall 磁吸 + 修正 surfaceSnap 法线方向

Bug 1（已实测）：surfaceSnap 的法线方向约定与 mountFromNormal 相反。
mountFromNormal 给的是朝房间内 normal（天花 (0,-1,0)），而 surfaceSnap 的
公式 pos = point - normal*offset 假设朝房间外。结果：从房间内部拖灯到天花
得到 pos.y=2.83（天花上方 3cm），而不是 2.77（天花下方 3cm）。wall 碰巧对
是因为朝房间内法线对墙灯方向恰好正确。

Bug 2（已实测）：mountFromNormal 把地面 (0,+1,0) 判成 recessed。
新版加 fromInside 参数，正确区分 ceiling/floor。

改动：
- snapToGrid.ts surfaceSnap：公式改为 pos = point + normal*offset，
  normal 统一为朝房间内（与 mountFromNormal 注释一致）
- snapToGrid.ts projectToSurface：支持 wall（用 installNormal 精确投影）
- mountFromNormal.ts：加 fromInside 参数，[0,+1,0] → floor（原 recessed）
- types.ts / makeFixture.ts：Fixture 加 installNormal?: [x,y,z]
- App.tsx handleDropFixture：保存 installNormal（仅 wall）；
  setTransformCallback：传 installNormal 给 projectToSurface
- 测试：surfaceSnap 12→14（改断言方向 + 加 wall 两条）、
  mountFromNormal 7→10（改 1 条 + 加 3 条）、新增 surfaceSnapE2E 4 条

后续：P37d chandelier、P37b FixtureLibraryPanel 预览。"
```
