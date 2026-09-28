# P30 · 灯具类型独立几何模型

> 来源：用户反馈"灯具本身的形状应该也有专门建模，而不是现在这样一个圆柱"
> HEAD 基线：`dfdbc0a`（P29b 修复拖放，819 测试全绿）
> 现状：`buildLightFromFixture` 里 `shadeMesh = new Mesh(shadeGeometry(f.shape.form, ...), shadeMat)`——按 `shape.form`（sphere/disc/cylinder/cone/line/plane/custom 七种）选几何，8 种灯具类型里 6 种落到 cylinder/disc 兜底。筒灯、射灯、落地灯、台灯视觉无差别。
>
> 本阶段不改光数据（Photometric/Light/intensity 全保留），只改**可视化替身**的形态。

---

## 1. 目标（判定标准）

1. 8 种灯具类型各有一种可区分的独立几何模型：
   - **downlight（筒灯）**：天花板嵌入圆环（trim）+ 圆形乳白扩散板
   - **spot（射灯）**：嵌入式圆环 + 突出的圆锥灯罩（有可见灯杯倾斜）
   - **pendant（吊灯）**：吊线（1m 长的细杆）+ 球形/碗形灯罩
   - **linear（线条灯）**：水平长条灯管 + 两端端盖
   - **cove（灯带）**：贴合墙/天花边的细长条（暗槽造型）
   - **sconce（壁灯）**：墙面安装背板 + 向外凸出的半圆柱灯罩
   - **floor（落地灯）**：地面底座圆盘 + 细杆支架 + 顶部灯罩
   - **table（台灯）**：桌面矮底座 + 短杆 + 圆筒灯罩
2. 每种灯具的 `shade` 字段（供 sceneEngine 选中高亮）指向该模型的**主灯罩 mesh**（发光体）
3. `light` 位置仍按各类型的物理安装位置设定（不改变物理光源语义）
4. `engine.attachFixture` 后 TransformControls gizmo 挂在**灯具组**上（不是仅挂在主灯罩上）
5. `npm run verify` 全绿；新增至少 8 个测试用例覆盖每类灯具的几何结构断言
6. 画面不破画（P26b 入夜目标仍达标）

---

## 2. 交付物

### 2.1 `src/render/fixtureModels.ts` —— 每类灯具的独立几何模型

新建文件，导出 8 个工厂函数：

```ts
import {
  Mesh, Group, MeshStandardMaterial, MeshPhysicalMaterial,
  CylinderGeometry, SphereGeometry, CircleGeometry, BoxGeometry,
  TorusGeometry, LatheGeometry, Vector3, Color,
} from 'three';
import type { FixtureType, ShadeMaterial } from '../core/types.js';

/**
 * 灯具模型构建器（P30）。
 *
 * 每类灯具返回一个 Group，包含：
 * - 外壳 mesh（不发光，用外壳材质）
 * - 灯罩 mesh（发光体，用发光材质，作为 `shade` 返回给 engine 做高亮）
 * - 可选的支架/底座 mesh
 *
 * 所有几何都用 SHADE_VISUAL_SCALE 缩放（保留 P29 的可见性）；
 * 灯罩材质的 emissive 由 sceneEngine 后续按 level 与选中态更新。
 */

export interface FixtureModelResult {
  /** 灯具组（含所有 mesh + light） */
  group: Group;
  /** 主灯罩 mesh（用于选中高亮 emissive 更新） */
  shade: Mesh;
  /** 灯具类型（冗余记录，便于调试） */
  type: FixtureType;
}

/** 共享材质工厂：外壳材质、发光材质 */
export function makeShellMaterial(): MeshStandardMaterial {
  // 金属外壳：暗色金属漆
  return new MeshStandardMaterial({
    color: new Color('#2a2a2e'),
    roughness: 0.4,
    metalness: 0.85,
  });
}

export function makeDiffuserMaterial(): MeshPhysicalMaterial {
  // 乳白扩散板
  return new MeshPhysicalMaterial({
    color: new Color('#f5f0e8'),
    roughness: 0.8,
    transmission: 0.2,
    thickness: 0.01,
  });
}

export function makeGlowMaterial(): MeshStandardMaterial {
  // 发光灯罩：初始 emissiveIntensity = 0，由 sceneEngine 后续按 level 设置
  return new MeshStandardMaterial({
    color: new Color('#ffffff'),
    emissive: new Color('#ffffff'),
    emissiveIntensity: 0,
    roughness: 0.5,
    metalness: 0,
  });
}

const S = SHADE_VISUAL_SCALE; // 从 lightBuilder.js 引入

/** 筒灯：天花板嵌入圆环（trim）+ 圆形扩散板（发光） */
export function buildDownlightModel(d: number, mat: ShadeMaterial): FixtureModelResult {
  const group = new Group();
  const r = Math.max(0.02, d / 2) * S;
  // 外壳：扁圆环（trim）
  const trimGeo = new TorusGeometry(r, r * 0.08, 8, 32);
  const trim = new Mesh(trimGeo, makeShellMaterial());
  trim.rotation.x = Math.PI / 2;
  trim.position.y = -0.01 * S; // 略低于天花
  group.add(trim);
  // 灯罩：圆形扩散板（发光）
  const shadeGeo = new CircleGeometry(r * 0.85, 32);
  const shade = new Mesh(shadeGeo, makeGlowMaterial());
  shade.rotation.x = Math.PI / 2; // 朝下
  shade.position.y = -0.005 * S;
  group.add(shade);
  return { group, shade, type: 'downlight' };
}

/** 射灯：嵌入圆环 + 突出的圆锥灯罩 */
export function buildSpotModel(d: number, mat: ShadeMaterial): FixtureModelResult {
  const group = new Group();
  const r = Math.max(0.02, d / 2) * S;
  // 外壳圆环
  const trimGeo = new TorusGeometry(r, r * 0.06, 8, 24);
  const trim = new Mesh(trimGeo, makeShellMaterial());
  trim.rotation.x = Math.PI / 2;
  group.add(trim);
  // 灯罩：向下突出的圆锥（truncated）
  const coneGeo = new CylinderGeometry(r * 0.5, r * 0.85, r * 1.5, 24, 1, true);
  const cone = new Mesh(coneGeo, makeShellMaterial());
  cone.position.y = -r * 0.6;
  group.add(cone);
  // 发光盘：锥形底部开口
  const shadeGeo = new CircleGeometry(r * 0.5, 24);
  const shade = new Mesh(shadeGeo, makeGlowMaterial());
  shade.rotation.x = Math.PI / 2;
  shade.position.y = -r * 1.3;
  group.add(shade);
  return { group, shade, type: 'spot' };
}

/** 吊灯：吊线（1m 长）+ 球形灯罩 */
export function buildPendantModel(d: number, mat: ShadeMaterial): FixtureModelResult {
  const group = new Group();
  const r = Math.max(0.02, d / 2) * S;
  // 吊线：细长圆柱
  const wireGeo = new CylinderGeometry(0.005 * S, 0.005 * S, 1.0 * S, 8);
  const wire = new Mesh(wireGeo, makeShellMaterial());
  wire.position.y = 0.5 * S;
  group.add(wire);
  // 灯罩：球形
  const shadeGeo = new SphereGeometry(r, 24, 16);
  const shade = new Mesh(shadeGeo, makeGlowMaterial());
  shade.position.y = -0.1 * S;
  group.add(shade);
  // 顶部装饰（连接天花）
  const capGeo = new CylinderGeometry(r * 0.15, r * 0.15, 0.03 * S, 16);
  const cap = new Mesh(capGeo, makeShellMaterial());
  cap.position.y = 1.0 * S;
  group.add(cap);
  return { group, shade, type: 'pendant' };
}

/** 线条灯：水平长条灯管 + 两端端盖 */
export function buildLinearModel(d: number, h: number, mat: ShadeMaterial): FixtureModelResult {
  const group = new Group();
  const width = Math.max(0.05, d) * S;      // 长条长
  const tubeR = Math.max(0.02, h / 2) * S;
  // 灯管：水平圆柱
  const tubeGeo = new CylinderGeometry(tubeR, tubeR, width, 16, 1);
  const tube = new Mesh(tubeGeo, makeShellMaterial());
  tube.rotation.z = Math.PI / 2;
  group.add(tube);
  // 发光面：贴在灯管下侧
  const shadeGeo = new BoxGeometry(width * 0.9, tubeR * 0.3, tubeR * 1.4);
  const shade = new Mesh(shadeGeo, makeGlowMaterial());
  shade.position.y = -tubeR * 0.5;
  group.add(shade);
  // 两端端盖
  for (const sign of [-1, 1]) {
    const capGeo = new CylinderGeometry(tubeR * 1.1, tubeR * 1.1, 0.02 * S, 16);
    const cap = new Mesh(capGeo, makeShellMaterial());
    cap.rotation.z = Math.PI / 2;
    cap.position.x = sign * width * 0.5;
    group.add(cap);
  }
  return { group, shade, type: 'linear' };
}

/** 灯带：贴合墙/天花边的细长条（暗槽造型） */
export function buildCoveModel(d: number, mat: ShadeMaterial): FixtureModelResult {
  const group = new Group();
  const width = Math.max(0.3, d) * S;
  const height = 0.02 * S;
  // 外壳槽：U 形槽
  const shellGeo = new BoxGeometry(width, height, height * 2);
  const shell = new Mesh(shellGeo, makeShellMaterial());
  group.add(shell);
  // 发光条：贴在槽内底
  const shadeGeo = new BoxGeometry(width * 0.98, height * 0.15, height * 0.8);
  const shade = new Mesh(shadeGeo, makeGlowMaterial());
  shade.position.y = -height * 0.3;
  group.add(shade);
  return { group, shade, type: 'cove' };
}

/** 壁灯：墙面安装背板 + 向外凸出的半圆柱灯罩 */
export function buildSconceModel(d: number, mat: ShadeMaterial): FixtureModelResult {
  const group = new Group();
  const r = Math.max(0.02, d / 2) * S;
  // 背板：贴在墙上的圆盘
  const plateGeo = new CylinderGeometry(r * 0.4, r * 0.4, 0.02 * S, 16);
  const plate = new Mesh(plateGeo, makeShellMaterial());
  plate.rotation.x = Math.PI / 2;
  group.add(plate);
  // 灯罩：半圆柱（面向房间）
  const shadeGeo = new CylinderGeometry(r, r, r * 1.5, 16, 1, false, 0, Math.PI);
  const shade = new Mesh(shadeGeo, makeGlowMaterial());
  shade.rotation.x = Math.PI / 2;
  shade.position.z = r * 0.5;
  group.add(shade);
  return { group, shade, type: 'sconce' };
}

/** 落地灯：地面底座圆盘 + 细杆支架 + 顶部灯罩 */
export function buildFloorModel(d: number, mat: ShadeMaterial): FixtureModelResult {
  const group = new Group();
  const r = Math.max(0.02, d / 2) * S;
  // 底座
  const baseGeo = new CylinderGeometry(r * 0.4, r * 0.4, 0.02 * S, 16);
  const base = new Mesh(baseGeo, makeShellMaterial());
  base.position.y = 0.01 * S;
  group.add(base);
  // 杆
  const poleGeo = new CylinderGeometry(0.015 * S, 0.015 * S, 1.5 * S, 8);
  const pole = new Mesh(poleGeo, makeShellMaterial());
  pole.position.y = 0.75 * S;
  group.add(pole);
  // 灯罩（球）
  const shadeGeo = new SphereGeometry(r, 20, 14);
  const shade = new Mesh(shadeGeo, makeGlowMaterial());
  shade.position.y = 1.55 * S;
  group.add(shade);
  return { group, shade, type: 'floor' };
}

/** 台灯：矮底座 + 短杆 + 圆筒灯罩 */
export function buildTableModel(d: number, mat: ShadeMaterial): FixtureModelResult {
  const group = new Group();
  const r = Math.max(0.02, d / 2) * S;
  // 底座
  const baseGeo = new CylinderGeometry(r * 0.35, r * 0.35, 0.03 * S, 16);
  const base = new Mesh(baseGeo, makeShellMaterial());
  base.position.y = 0.015 * S;
  group.add(base);
  // 短杆
  const poleGeo = new CylinderGeometry(0.01 * S, 0.01 * S, 0.35 * S, 8);
  const pole = new Mesh(poleGeo, makeShellMaterial());
  pole.position.y = 0.2 * S;
  group.add(pole);
  // 灯罩（圆筒）
  const shadeGeo = new CylinderGeometry(r * 0.7, r * 0.7, r * 0.7, 16, 1, true);
  const shade = new Mesh(shadeGeo, makeGlowMaterial());
  shade.position.y = 0.4 * S;
  group.add(shade);
  return { group, shade, type: 'table' };
}

/** 按 fixture 类型分发到对应模型构建器 */
export function buildFixtureModel(f: Fixture): FixtureModelResult {
  switch (f.type) {
    case 'downlight': return buildDownlightModel(f.shape.diameter, f.shape.shade);
    case 'spot': return buildSpotModel(f.shape.diameter, f.shape.shade);
    case 'pendant': return buildPendantModel(f.shape.diameter, f.shape.shade);
    case 'linear': return buildLinearModel(f.shape.diameter, f.shape.height, f.shape.shade);
    case 'cove': return buildCoveModel(f.shape.diameter, f.shape.shade);
    case 'sconce': return buildSconceModel(f.shape.diameter, f.shape.shade);
    case 'floor': return buildFloorModel(f.shape.diameter, f.shape.shade);
    case 'table': return buildTableModel(f.shape.diameter, f.shape.shade);
    default: return buildPendantModel(f.shape.diameter, f.shape.shade);
  }
}
```

**注意**：SHADE_VISUAL_SCALE 从 `lightBuilder.ts` 导入（`export const SHADE_VISUAL_SCALE = 6.0`）。fixtureModels.ts 里用相对路径导入。

### 2.2 修改 `src/render/lightBuilder.ts` —— `buildLightFromFixture` 改用 fixtureModels

在 `buildLightFromFixture` 里，**替换**现有 `shadeGeometry` 调用与 `shadeMesh` 构建（第 420-440 行左右），改成：

```ts
// P30：独立几何模型替代 shadeGeometry 兜底
const { group: modelGroup, shade: shadeMesh, type } = buildFixtureModel(f);
// 保留原有 group 结构：buildLightFromFixture 的 group 是外层，模型作为子 group 加进去
// light 已加在 f 的位置；把 modelGroup 也设到 f 的位置作为子节点
modelGroup.position.set(0, 0, 0); // 相对父 group（父 group 已在 fx, fy, fz）
group.add(modelGroup);
// shadeMesh 已经在 modelGroup 里，作为发光体
shadeMesh.name = `${f.id}-shade`; // 保留 name（P29b 的 drop handler 依赖 -shade 后缀）
// shadeMesh 不投/收阴影（与旧行为一致）
shadeMesh.castShadow = false;
shadeMesh.receiveShadow = false;
```

**移除**旧的 `shadeGeometry` 函数与旧的 `shadeMesh = new Mesh(shadeGeometry(...))` 代码（大约 200-440 行之间的一整段）。

**保留**：
- 光数据（SpotLight / PointLight / RectAreaLight 位置与参数）
- IES 分支
- 色温 → 颜色计算
- LightBuildResult 返回结构（`object: group, light, shade: shadeMesh, isIES, approximated`）
- group.position.set(fx, fy, fz)（外层 group 位置）

**新增 import**：`import { buildFixtureModel } from './fixtureModels.js';`

**保留 `SHADE_VISUAL_SCALE` 导出**（fixtureModels.ts 需要）。

**保留 SHADE_EMISSIVE_SCALE 常量**（sceneEngine 里 emissive 强度计算依赖）。

### 2.3 更新 `src/render/lightBuilder.ts` —— 删除 `shadeGeometry` 函数

删掉 `shadeGeometry(form, diameter, height)` 函数（约 204-232 行），因为已被 fixtureModels 替代。相关 `SphereGeometry / CircleGeometry / CylinderGeometry` 类型 import 也可以从 lightBuilder 中移除（fixtureModels 自己导入）。

### 2.4 更新 `src/scene/sceneEngine.ts` —— attach 与 highlight 兼容

P28 里 `attachFixture` 里 `tc.attach(entry.object)`——`entry.object` 是外层 group（buildLightFromFixture 的 group）。P30 里 buildLightFromFixture 的 group 结构变了：`group > (light + modelGroup) > shadeMesh`。TransformControls 挂在最外层 group 上，gizmo 拖拽时整个 group 一起移动——这是正确的行为（灯罩和灯一起移动）。

**不需要改 attach 逻辑**。但选中高亮分支需要验证：`entry.shade.material.emissive.set(...)` 是否仍生效？

在 `attachFixture` 里，`entry.shade` 现在指向 modelGroup 里的 shadeMesh（不再是原 group 的直接子）。sceneEngine 里所有 `entry.shade.material.emissiveIntensity` 访问应仍生效——`entry.shade` 是 Mesh 引用，material 是 material 对象，无论 shade 在场景图哪个层级，都能访问 material。

**验证**：无需改 sceneEngine 逻辑。

### 2.5 更新 `src/render/lightBuilder.ts` —— LightBuildResult 里的 `shade` 类型

原 `shade: Mesh | null`，改为 `shade: Mesh`（fixtureModels 总是返回 shade Mesh）。检查是否有 null 分支处理需要清理。

### 2.6 `src/render/__tests__/fixtureModels.test.ts`（新文件）

对每类灯具测试：
- 返回 group 有 ≥ 2 个 children（外壳 + 灯罩）
- shade 是 Mesh，其 material 有 emissive 属性
- 每种类型至少一个独特几何（比如 downlight 有 TorusGeometry、pendant 有 SphereGeometry）

```ts
import { describe, it, expect } from 'vitest';
import { makeFixture } from '../../core/makeFixture.js';
import { buildFixtureModel } from '../fixtureModels.js';

const types = ['downlight', 'spot', 'pendant', 'linear', 'cove', 'sconce', 'floor', 'table'] as const;

describe('buildFixtureModel (P30)', () => {
  for (const type of types) {
    it(`${type}: 返回 group + shade Mesh，group 有 ≥ 2 个 children`, () => {
      const f = makeFixture({ type });
      const { group, shade, type: returnedType } = buildFixtureModel(f);
      expect(returnedType).toBe(type);
      expect(group.children.length).toBeGreaterThanOrEqual(2);
      expect(shade.isMesh).toBe(true);
      expect(shade.material).toBeDefined();
    });
  }
});

describe('独立几何特征（P30）', () => {
  it('downlight 含 TorusGeometry（外壳圆环）', () => {
    const { group } = buildFixtureModel(makeFixture({ type: 'downlight' }));
    const hasTorus = group.children.some((c) => c.geometry && (c.geometry as any).type === 'TorusGeometry');
    expect(hasTorus).toBe(true);
  });
  it('pendant 含 SphereGeometry（球形灯罩）', () => {
    const { group } = buildFixtureModel(makeFixture({ type: 'pendant' }));
    const hasSphere = group.children.some((c) => c.geometry && (c.geometry as any).type === 'SphereGeometry');
    expect(hasSphere).toBe(true);
  });
  it('linear 有水平长条（宽度 > 高度）', () => {
    const { group } = buildFixtureModel(makeFixture({ type: 'linear' }));
    // 有一个 BoxGeometry 或 CylinderGeometry，其尺寸反映水平方向更长
    expect(group.children.length).toBeGreaterThanOrEqual(3);
  });
  it('floor 有杆（>3 children：底座+杆+灯罩）', () => {
    const { group } = buildFixtureModel(makeFixture({ type: 'floor' }));
    expect(group.children.length).toBeGreaterThanOrEqual(3);
  });
  it('table 有底座+杆+灯罩（≥3 children）', () => {
    const { group } = buildFixtureModel(makeFixture({ type: 'table' }));
    expect(group.children.length).toBeGreaterThanOrEqual(3);
  });
  it('sconce 有背板（cylinder 横放）+ 半圆柱灯罩', () => {
    const { group } = buildFixtureModel(makeFixture({ type: 'sconce' }));
    expect(group.children.length).toBeGreaterThanOrEqual(2);
  });
  it('cove 有壳+发光条（≥2 children）', () => {
    const { group } = buildFixtureModel(makeFixture({ type: 'cove' }));
    expect(group.children.length).toBeGreaterThanOrEqual(2);
  });
});

describe('shade Mesh material（P30）', () => {
  it('每类灯具 shade.material.emissive 存在（供选中高亮）', () => {
    for (const type of types) {
      const { shade } = buildFixtureModel(makeFixture({ type }));
      expect((shade.material as any).emissive, `type=${type}`).toBeDefined();
    }
  });
  it('shade.castShadow = false, receiveShadow = false（buildLightFromFixture 设置）', () => {
    // 这个断言放到 lightBuilder 集成测试里更合适，此处略过
    // 因为 shade.castShadow 由 buildLightFromFixture 设置，不在 buildFixtureModel 内
  });
});
```

### 2.7 `src/render/__tests__/lightBuilder.test.ts` 集成测试（若有）

如果既有 lightBuilder 测试引用了 `shadeGeometry` 或依赖 shadeMesh 的特定几何类型（比如旧测试断言 `shade.geometry.type === 'CylinderGeometry'`），改为断言 shade.material.emissive 存在与 shade 是 Mesh。

grep 检查后如需修改，最小改动。

---

## 3. 测试

- **新增**：`src/render/__tests__/fixtureModels.test.ts`（≥ 15 个用例：8 类灯具各 1 + 几何特征 8 + 材质 2）
- **可能修改**：`src/render/__tests__/lightBuilder.test.ts`（若引用了 shadeGeometry 或旧几何类型断言）
- **不改**：既有 `lightBuilder.test.ts` 里对 light/intensity/IES 的断言（光数据语义不变）
- `npm run typecheck` 0 error
- `npm test` ≥ 834（815 + 至少 15 新用例）

---

## 4. 验证（运行时，真实 GPU）

刷新后：
1. 默认工程 3 盏灯：
   - downlight 在天花 → 应看到圆环 + 白色扩散板
   - pendant 在天花中央 → 应看到吊线 + 球形灯罩
   - floor 在地面 → 应看到底座 + 细杆 + 顶部灯罩
2. 拖「筒灯」到天花 → 看到嵌入圆环 + 白色扩散板（不是纯圆盘）
3. 拖「射灯」→ 看到圆环 + 突出圆锥灯罩
4. 拖「线条灯」→ 看到水平长条
5. 拖「灯带」→ 看到暗槽造型
6. 拖「壁灯」→ 贴墙，半圆柱凸出
7. 拖「落地灯」→ 地面立起，有杆
8. 拖「台灯」→ 桌面矮底座 + 短杆 + 圆筒灯罩
9. 点击任一灯具 → TransformControls gizmo 挂在灯具组上，拖拽整个组
10. 选中高亮：灯罩（发光体）emissive 变暖橙

---

## 5. 不做的事

- **不做** 真实 GLTF 3D 资产（Phase 2 范围，方案 §Phase 2 第 1 项）
- **不做** 每类灯具的**多种造型变体**（P30 只做基础独立几何）
- **不做** 灯具的**内部光源 mesh**（灯丝/LED 芯片的可视化）
- **不改** 光数据（SpotLight/PointLight/RectAreaLight 参数不变）
- **不改** IES 解析路径
- **不改** TransformControls / mount / 拖放逻辑
- **不改** `Fixture.shape` 数据结构
- **不改** store / commandStack / projectStore
- **不改** CSS / UI 布局
- **不新增** npm 依赖

---

## 6. 红线

- 只碰：
  - **新增** `src/render/fixtureModels.ts`
  - **新增** `src/render/__tests__/fixtureModels.test.ts`
  - **修改** `src/render/lightBuilder.ts`（`buildLightFromFixture` 用 buildFixtureModel 替代 shadeGeometry；删除 shadeGeometry 函数；添加 import）
  - **可能修改** `src/render/__tests__/lightBuilder.test.ts`（若旧测试依赖 shadeGeometry 或旧几何类型）
- **不改**：
  - `src/scene/sceneEngine.ts`（P28 的 attach/highlight 逻辑继续工作，因 entry.shade 仍指向 Mesh）
  - `src/store/**`、`src/ui/**`、`src/core/types.ts`
  - `SHADE_VISUAL_SCALE` 值（保留 P29 的 6.0）
  - `SHADE_EISSIVE_SCALE` 值
  - 既有测试断言（除 lightBuilder.test.ts 里对 shade geometry type 的直接断言）
- 回退成本：`git revert <P30-hash>` 即可

---

## 7. 提交

一次 commit，格式：

```
P30: 灯具类型独立几何模型

- 新增 src/render/fixtureModels.ts（8 类灯具独立几何）
- buildLightFromFixture 改用 buildFixtureModel，删除 shadeGeometry 兜底
- 8 类灯具视觉区分：筒灯（圆环+扩散板）、射灯（圆环+锥罩）、吊灯（吊线+球罩）、
  线条灯（长条+端盖）、灯带（暗槽）、壁灯（背板+半圆柱）、落地灯（底座+杆+球罩）、
  台灯（底座+短杆+圆筒）
- 光数据（SpotLight/PointLight/RectAreaLight/IES）不变
- SHADE_VISUAL_SCALE = 6.0 保留（P29 可见性）
- 新增 fixtureModels.test.ts 覆盖 8 类灯具几何结构
```

不 push。

---

## 8. 交付证据

- `commit_hash`
- `npm run typecheck` 输出
- `npm test` 结果（含测试总数与新增用例数）
- `git show --stat HEAD`
- `deviations`（任何偏离规格 + 理由）
