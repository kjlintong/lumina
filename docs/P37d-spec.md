# P37d 规格：chandelier 接入系统

**目标**：把 chandelier 从"死资产"接进系统。当前 `LIGHT_ASSET_DEFS.chandelier` 有定义但
`FixtureType` / `TYPE_DEFAULTS` / `ASSET_KEY_FOR_TYPE` / 两处 FIXTURE_TYPE_LABELS /
FixtureLibraryPanel 都不认识 'chandelier'，所以这条资产运行时永远不会被加载。

顺带修正 axis：`LIGHT_ASSET_DEFS.chandelier.axis` 从 `'horizontal'` 改为 `'vertical'`，
`targetSize` 从 1.0 改为 0.8（接近真实 y 跨度 0.7983m，见 §2 实测表）。

## 1. 判定标准

- [ ] `FixtureType` 含 `'chandelier'`
- [ ] `TYPE_DEFAULTS` 含 chandelier 条目（form/mount/lumens/beamAngle）
- [ ] `ASSET_KEY_FOR_TYPE.chandelier === 'chandelier'`
- [ ] `FIXTURE_TYPES_WITH_ASSETS` 含 `'chandelier'`
- [ ] 两处 `FIXTURE_TYPE_LABELS`（projectStore / FixturePanel）含 chandelier
- [ ] `FixtureLibraryPanel` LIBRARY 含 chandelier 条目（含 SVG 图标）
- [ ] `buildFixtureModel` switch 含 `case 'chandelier'`（程序化回落）
- [ ] `LIGHT_ASSET_DEFS.chandelier.axis === 'vertical'`，`targetSize === 0.8`
- [ ] 测试全绿，不新增 lint error，应用代码仍 2 chunk

---

## 2. 实测数据（探针跑真实 GLTF，非估计）

5 个灯具资产的**原始几何**（未归一化，探针在浏览器加载真实 GLTF 得到）：

| asset | 定义 axis | 真实主轴 | 真实 span (x,y,z) | emissive mesh |
|---|---|---|---|---|
| chandelier | horizontal | **z** (0.8155) | (0.7465, 0.7983, 0.8155) | 0/2 |
| pendant | vertical | y (1.3554) | (0.5496, 1.3554, 0.5496) | 1/2 |
| ceiling_lamp | vertical | y (0.9516) | (0.4316, 0.9516, 0.4317) | 1/3 |
| wall_sconce | vertical | y (0.3418) | (0.1503, 0.3418, 0.2516) | 0/2 |
| desk_lamp | vertical | y (0.8926) | (0.2017, 0.8926, 0.6139) | 1/2 |

chandelier 三轴几乎相等（多臂球形对称），y 是垂直方向（悬挂在天花上），所以 axis
应该是 `vertical`，不是 `horizontal`。`targetSize` 取真实 y 跨度 0.7983 附近，定 0.8
（视觉合理，与 pendant 0.45 / desk_lamp 0.55 同量级）。

---

## 3. 改动清单

**9 处**，每处都是"加一行/加一条目"，不改任何现有逻辑。

### 3.1 `src/core/types.ts` —— FixtureType 加 'chandelier'

```ts
export type FixtureType =
  | 'downlight'
  | 'spot'
  | 'pendant'
  | 'linear'
  | 'cove'
  | 'sconce'
  | 'floor'
  | 'table'
  | 'chandelier';  // P37d：吊灯（多臂球形对称，挂天花）
```

### 3.2 `src/core/makeFixture.ts` —— TYPE_DEFAULTS 加 chandelier

```ts
const TYPE_DEFAULTS: Record<FixtureType, { form: ShadeForm; mount: MountType; lumens: number; beamAngle: number }> = {
  downlight: { form: 'disc', mount: 'recessed', lumens: 400, beamAngle: 36 },
  spot: { form: 'cone', mount: 'recessed', lumens: 500, beamAngle: 24 },
  pendant: { form: 'cylinder', mount: 'suspended', lumens: 800, beamAngle: 60 },
  linear: { form: 'line', mount: 'ceiling', lumens: 1600, beamAngle: 90 },
  cove: { form: 'plane', mount: 'ceiling', lumens: 2000, beamAngle: 120 },
  sconce: { form: 'cone', mount: 'wall', lumens: 300, beamAngle: 45 },
  floor: { form: 'cylinder', mount: 'floor', lumens: 600, beamAngle: 60 },
  table: { form: 'cylinder', mount: 'tabletop', lumens: 400, beamAngle: 50 },
  chandelier: { form: 'sphere', mount: 'suspended', lumens: 1200, beamAngle: 100 },  // P37d
};
```

**取值依据**：
- `form: 'sphere'` —— 吊灯呈球形对称（实测 x≈y≈z），'sphere' 是 FORM_DEFAULTS 里
  diameter=height=0.28 的对称几何，最贴 chandelier 的程序化回退形状
- `mount: 'suspended'` —— 吊灯挂天花（与 pendant 一致）
- `lumens: 1200` —— 典型吊灯光通量（pendant 800 的 1.5x）
- `beamAngle: 100` —— 吊灯环境照明宽光束（比 pendant 60 更宽）

### 3.3 `src/render/lightAssets.ts` —— 改 3 处

```ts
// 3.3a LIGHT_ASSET_DEFS.chandelier 改 axis/targetSize/lightOffset/anchor
  chandelier: { name: 'chandelier', axis: 'vertical', targetSize: 0.8, anchor: 'top', lightOffset: -0.4 },

// 3.3b FIXTURE_TYPES_WITH_ASSETS 加 'chandelier'
export const FIXTURE_TYPES_WITH_ASSETS: readonly FixtureType[] = [
  'pendant',
  'table',
  'sconce',
  'downlight',
  'chandelier',  // P37d：吊灯（独立 FixtureType，不再共用 pendant）
] as const;

// 3.3c ASSET_KEY_FOR_TYPE 加映射
export const ASSET_KEY_FOR_TYPE: Partial<Record<FixtureType, LightAssetKey>> = {
  pendant: 'pendant',
  table: 'desk_lamp',
  sconce: 'wall_sconce',
  downlight: 'ceiling_lamp',
  chandelier: 'chandelier',  // P37d
};
```

**anchor 选 'top'**：吊灯顶部是吊点（挂天花），anchor='top' 让归一化后 y 顶端=0，
pos.y 就是天花高度下方 lightOffset 处。`lightOffset: -0.4` 是灯泡重心位置
（实测 y 跨度 0.8，重心在中下 0.4m）。

### 3.4 `src/store/projectStore.ts` —— FIXTURE_TYPE_LABELS 加 chandelier

```ts
const FIXTURE_TYPE_LABELS: Record<FixtureType, string> = {
  downlight: '筒灯',
  spot: '射灯',
  pendant: '吊灯',
  linear: '线性灯',
  cove: '灯带',
  sconce: '壁灯',
  floor: '落地灯',
  table: '台灯',
  chandelier: '吊灯组',  // P37d（区别于 pendant 单头吊灯）
};
```

### 3.5 `src/ui/panels/FixturePanel.tsx` —— FIXTURE_TYPE_LABELS 加 chandelier

```ts
const FIXTURE_TYPE_LABELS: Record<FixtureType, string> = {
  downlight: '筒灯',
  spot: '射灯',
  pendant: '吊灯',
  linear: '线性灯',
  cove: '灯带',
  sconce: '壁灯',
  floor: '落地灯',
  table: '台灯',
  chandelier: '吊灯组',  // P37d
};
```

### 3.6 `src/render/fixtureModels.ts` —— buildFixtureModel 加 case + 新 builder

switch 里 `case 'table'` 后、`default` 前插入：

```ts
    case 'chandelier':  // P37d：程序化回退（资产加载失败时）
      return buildChandelierModel(f.shape.diameter, f.shape.shade);
```

新函数 `buildChandelierModel` 完整实现见 §5.1。放在 `buildTableModel`（fixtureModels.ts:246）
之后、`buildFixtureModel`（fixtureModels.ts:275）之前。

### 3.7 `src/ui/panels/FixtureLibraryPanel.tsx` —— LIBRARY 加 chandelier 条目

在 LIBRARY 数组 `pendant` 条目后插入：

```ts
  {
    type: 'chandelier',
    label: '吊灯组',
    hint: '多臂球形对称',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="4" r="1.5" fill="currentColor" />
        <line x1="12" y1="5.5" x2="12" y2="9" />
        <line x1="12" y1="9" x2="6" y2="14" />
        <line x1="12" y1="9" x2="18" y2="14" />
        <line x1="12" y1="9" x2="12" y2="16" />
        <circle cx="6" cy="15.5" r="2" />
        <circle cx="18" cy="15.5" r="2" />
        <circle cx="12" cy="17.5" r="2" />
      </svg>
    ),
  },
```

**SVG 设计**：顶部吊点 + 中心轴 + 3 条臂 + 3 个灯泡球（多臂对称，区别于 pendant 单头）。

### 3.8 `src/render/lightAssets.ts` 顶部注释 —— 更新映射说明

第 48-58 行注释提到"chandelier 共用 pendant"，现在 chandelier 是独立 FixtureType，
注释要更新（避免误导后续维护者）。

### 3.9 `src/render/lightAssets.ts` —— lightOffset 说明注释

第 108 行 chandelier 定义前的注释更新（axis/targetSize/anchor/lightOffset 全改了）。

---

## 4. 测试

### 4.1 新增：`src/core/__tests__/makeFixture.chandelier.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { makeFixture } from '../makeFixture.js';
import type { Fixture } from '../types.js';

describe('P37d：makeFixture 支持 chandelier', () => {
  it('默认 mount=suspended', () => {
    const f = makeFixture({ type: 'chandelier' });
    expect(f.type).toBe('chandelier');
    expect(f.mount).toBe('suspended');
  });

  it('默认 form=sphere', () => {
    const f = makeFixture({ type: 'chandelier' });
    expect(f.shape.form).toBe('sphere');
  });

  it('默认 photometric.lumens=1200', () => {
    const f = makeFixture({ type: 'chandelier' });
    expect(f.photometric.lumens).toBe(1200);
  });

  it('默认 photometric.beamAngle=100', () => {
    const f = makeFixture({ type: 'chandelier' });
    expect(f.photometric.beamAngle).toBe(100);
  });

  it('opts 可覆盖', () => {
    const f = makeFixture({ type: 'chandelier', lumens: 2000, beamAngle: 120 });
    expect(f.photometric.lumens).toBe(2000);
    expect(f.photometric.beamAngle).toBe(120);
  });
});
```

**+5 条**。

### 4.2 新增：`src/render/__tests__/chandelierAsset.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  LIGHT_ASSET_DEFS,
  ASSET_KEY_FOR_TYPE,
  FIXTURE_TYPES_WITH_ASSETS,
  assetKeyForType,
} from '../lightAssets.js';
import type { FixtureType } from '../../core/types.js';

describe('P37d：chandelier 资产接入', () => {
  it('LIGHT_ASSET_DEFS.chandelier.axis === vertical', () => {
    expect(LIGHT_ASSET_DEFS.chandelier.axis).toBe('vertical');
  });

  it('LIGHT_ASSET_DEFS.chandelier.targetSize === 0.8', () => {
    expect(LIGHT_ASSET_DEFS.chandelier.targetSize).toBeCloseTo(0.8, 5);
  });

  it('LIGHT_ASSET_DEFS.chandelier.anchor === top', () => {
    expect(LIGHT_ASSET_DEFS.chandelier.anchor).toBe('top');
  });

  it('ASSET_KEY_FOR_TYPE.chandelier === chandelier', () => {
    expect(ASSET_KEY_FOR_TYPE.chandelier).toBe('chandelier');
  });

  it('FIXTURE_TYPES_WITH_ASSETS 含 chandelier', () => {
    expect(FIXTURE_TYPES_WITH_ASSETS).toContain('chandelier');
  });

  it('assetKeyForType(chandelier) === chandelier', () => {
    expect(assetKeyForType('chandelier' as FixtureType)).toBe('chandelier');
  });
});
```

**+6 条**。

### 4.3 现有测试可能挂的（需检查）

`src/render/__tests__/lightAssets.test.ts` 如果硬编码了 `FIXTURE_TYPES_WITH_ASSETS`
的长度（如 `expect(...).toHaveLength(4)`），加 'chandelier' 后会挂。需 grep 确认。
若有，改为 5。

### 4.4 总数

- 新增 5 + 6 = 11 条
- 基线 976 → **987**（+11）

---

## 5. 实现细节

### 5.1 buildChandelierModel 实现（§3.6 补充）

fixtureModels.ts 没有 `buildSphereModel`（grep 确认），但有现成的：
- `makeGlowMaterial(mat: ShadeMaterial)` —— 私有函数（fixtureModels.ts:84），返回 emissive 发光材质
- `makeShellMaterial()` —— **export** 的（fixtureModels.ts:55），返回金属外壳材质
- `S = SHADE_VISUAL_SCALE` —— 视觉缩放常量（fixtureModels.ts:37）
- `Group` / `Mesh` / `SphereGeometry` / `CylinderGeometry` —— 都在 fixtureModels.ts 顶部已 import

新函数照 `buildCoveModel`（fixtureModels.ts:189）的范式写（group 装 shell + shade，返回 FixtureModelResult）：

```ts
/** 吊灯组：多臂球形对称（挂天花）。简化为一个大球体（发光体）+ 顶部吊杆。
 *  与资产 chandelier（实测 x≈y≈z 三轴对称）视觉一致。 */
function buildChandelierModel(d: number, mat: ShadeMaterial): FixtureModelResult {
  const group = new Group();
  const r = Math.max(0.1, d / 2) * S;
  // 主发光球体（shade 是发光体，供 sceneEngine 选中高亮时更新 emissive）
  const shadeGeo = new SphereGeometry(r, 24, 16);
  const shade = new Mesh(shadeGeo, makeGlowMaterial(mat));
  group.add(shade);
  // 顶部吊杆（连接天花，黑色金属壳）
  const rodGeo = new CylinderGeometry(0.005, 0.005, 0.1, 8);
  const rod = new Mesh(rodGeo, makeShellMaterial());
  rod.position.y = r + 0.05;
  group.add(rod);
  return { group, shade, type: 'chandelier' };
}
```

- `makeShellMaterial` 是 export 的（同文件内可直接调），`makeGlowMaterial` 是私有的（同文件内可直接调）
- `SphereGeometry(r, 24, 16)` 与 `buildPendantModel`（fixtureModels.ts:150）的参数一致
- `type: 'chandelier'` 是 FixtureModelResult.type 字段（冗余记录，便于调试）
- 新函数放 `buildTableModel`（fixtureModels.ts:246）之后、`buildFixtureModel`（fixtureModels.ts:275）之前

### 5.2 注释更新（§3.8, §3.9）

lightAssets.ts 第 48-58 行原注释：
```
/** 有资产覆盖的 FixtureType 子集 */
export const FIXTURE_TYPES_WITH_ASSETS: readonly FixtureType[] = [
  'pendant', // → 'pendant'（chandelier 共用，见下方 assetKeyForType）
```

chandelier 现在独立，注释改为：
```
/** 有资产覆盖的 FixtureType 子集（P37d：chandelier 独立，不再共用 pendant） */
export const FIXTURE_TYPES_WITH_ASSETS: readonly FixtureType[] = [
  'pendant', // → 'pendant'
```

---

## 6. 验证

1. `npx tsc --noEmit` → 0 error（**关键**：Record<FixtureType, _> 穷尽性会强制
   9 处都加 chandelier，漏一处就编译失败）
2. `npm test` → 全绿（987）
3. `rm -rf node_modules/.cache && npm run lint` → 不新增 error（330/12 基线）
4. `npm run build` → 应用代码 2 chunk
5. `python3 -m py_compile scripts/download-assets.py` → 通过

---

## 7. 红线

- **不动** `src/render/lightBuilder.ts` / `src/render/lightAssets.ts` 的其他函数
  （只改 LIGHT_ASSET_DEFS.chandelier 一条定义 + 两个数组/映射 + 注释）
- **不动** `src/scene/sceneEngine.ts`
- **不动** `src/store/projectStore.ts` 的其他逻辑（只加 FIXTURE_TYPE_LABELS 一行）
- **不动** `src/core/types.ts` 的其他类型（只加 'chandelier' 到 FixtureType）
- **不动** `src/core/makeFixture.ts` 的其他逻辑（只加 TYPE_DEFAULTS 一行）
- **不动** `src/ui/panels/FixturePanel.tsx` 的其他逻辑（只加 FIXTURE_TYPE_LABELS 一行）
- **不改** `vite.config.ts`；**不新增** npm 依赖
- **不要** `git add .`；**不要** push
- 不删测试；新增测试断言必须真断言

**fixtureModels.ts 是允许改的**（加 case + 新函数），与 P37c 阶段不同——
本轮需要程序化回退路径。

---

## 8. 提交模板

```bash
git add \
  src/core/types.ts \
  src/core/makeFixture.ts \
  src/core/__tests__/makeFixture.chandelier.test.ts \
  src/render/lightAssets.ts \
  src/render/fixtureModels.ts \
  src/render/__tests__/chandelierAsset.test.ts \
  src/store/projectStore.ts \
  src/ui/panels/FixturePanel.tsx \
  src/ui/panels/FixtureLibraryPanel.tsx \
  docs/P37d-spec.md \
  docs/P8-plan.md

git commit -m "P37d: chandelier 接入系统

实测发现 chandelier 是死资产：LIGHT_ASSET_DEFS.chandelier 有定义，但
FixtureType / TYPE_DEFAULTS / ASSET_KEY_FOR_TYPE / 两处 FIXTURE_TYPE_LABELS /
FixtureLibraryPanel / buildFixtureModel 都不认识 'chandelier'，所以这条资产
运行时永远不会被加载。

顺带修正 axis：LIGHT_ASSET_DEFS.chandelier.axis 从 'horizontal' 改为
'vertical'（实测真实几何 y 跨度 0.7983m 是主轴，三轴几乎相等但 y 是
垂直悬挂方向），targetSize 从 1.0 改为 0.8（接近真实 y 跨度），
anchor='top'（顶部吊点），lightOffset=-0.4（灯泡重心）。

9 处改动（都是加一条目/一行）：
- types.ts FixtureType：加 'chandelier'
- makeFixture.ts TYPE_DEFAULTS：chandelier { sphere, suspended, 1200lm, 100° }
- lightAssets.ts LIGHT_ASSET_DEFS.chandelier：axis/targetSize/anchor/lightOffset
- lightAssets.ts FIXTURE_TYPES_WITH_ASSETS：加 'chandelier'
- lightAssets.ts ASSET_KEY_FOR_TYPE：加 chandelier:'chandelier'
- projectStore.ts FIXTURE_TYPE_LABELS：chandelier:'吊灯组'
- FixturePanel.tsx FIXTURE_TYPE_LABELS：chandelier:'吊灯组'
- FixtureLibraryPanel.tsx LIBRARY：加 chandelier 条目（SVG 多臂对称图标）
- fixtureModels.ts buildFixtureModel：case 'chandelier' + buildChandelierModel

测试：新增 makeFixture.chandelier.test.ts (5 条) + chandelierAsset.test.ts (6 条)，
基线 976 → 987。

后续：P37b FixtureLibraryPanel 3D 预览。"
```
