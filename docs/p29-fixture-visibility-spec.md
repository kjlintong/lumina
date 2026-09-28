# P29 · 灯具可见性修复

> 来源：用户反馈「添加灯具功能像是在骗人，没有模型实际显示」
> HEAD 基线：`30b6f29`（P28 刚完成，815 测试全绿）
> 根因（两条独立问题）：
>
> 1. **灯罩几何在相机视角下投影过小**：
>    - `disc` 默认直径 0.18m（`src/core/makeFixture.ts:45` `FORM_DEFAULTS.disc.diameter`）
>    - 视觉缩放因子 `SHADE_VISUAL_SCALE = 2.5`（`src/render/lightBuilder.ts:189`）
>    - 缩放后实际视觉直径 0.45m
>    - 相机默认位置 (1.7, 1.55, 1.6)（`src/scene/sceneEngine.ts:339`），距灯具 3-4m
>    - 6 米房间 1080p 屏幕下，0.45m 物体投影约 30-50px，加上 50mm 网格吸附后位置往往在天花深处，肉眼几乎看不见
>
> 2. **`mountFromNormal` 法线判定错误**（`src/render/mountFromNormal.ts`）：
>    - 天花顶面朝上的法线在 raycaster 命中后是 `(0, -1, 0)`（PlaneGeometry 默认法线朝 +Y，但 `room.ts:303` 里 `ceiling.rotation.x = Math.PI / 2` 翻转后 world normal 是 -Y）
>    - 现有代码：`ny < -0.7 → 'recessed'`，导致拖放天花时创建筒灯（`downlight` 类，嵌入天花内的光源，灯罩在天花内部）
>    - `dropPosFromHit` 再把位置向下偏移 30mm（`point.y + normal.y * 0.03 = -0.03`）
>    - 用户从房间下方看不见嵌入在天花内的筒灯
>
> 方案：改法线判定 + 加大灯罩视觉缩放 + 强化选中高亮 + 首次拖入后相机略微下移。

---

## 1. 目标（判定标准）

1. 拖放「筒灯」到天花：灯罩在天花**下方**清晰可见（不是嵌入天花内）；emissive 光晕明显
2. 拖放「吊灯」到天花：灯罩在天花**下方**清晰可见
3. 拖放「壁灯」到墙面：贴墙可见
4. 拖放「落地灯」到地面：立在地面可见
5. 默认工程 3 盏灯（downlight/pendant/floor）视觉比例提升但**不破画**（用户判定）
6. 选中高亮更醒目（emissive 从 0.35 提到 0.6，加一个 outline-like 的 accent ring）
7. `npm run verify` 全绿；测试总数 ≥ 815

---

## 2. 交付物

### 2.1 `src/render/mountFromNormal.ts` —— 修正天花法线判定

修改 `mountFromNormal`：

```ts
export function mountFromNormal(normal: readonly [number, number, number]): DragMount {
  const ny = normal[1];
  // P29 修正：三.js PlaneGeometry 的默认法线朝 +Y，但 room.ts 里天花经
  // `ceiling.rotation.x = Math.PI / 2` 翻转后，法线在世界空间指向**下方** (-Y)。
  // 因此从房间内部点天花，raycaster 命中的 world normal 是 (0, -1, 0)。
  // 旧逻辑把 ny < -0.7 判定为 recessed（嵌入天花），导致灯具被塞到天花内部，
  // 从下方看不见。改为：ny < -0.7 判定为 ceiling（贴天花下表面），
  // 让灯具的 emissive 灯罩在天花下方可见。
  if (ny < -0.7) return 'ceiling';
  if (ny > 0.7) return 'recessed';   // 从上方看地板（罕用）
  if (Math.abs(ny) < 0.7) return 'wall';
  return 'suspended';
}
```

`dropPosFromHit` 保持不变（法线 + 30mm 偏移，让灯罩恰好贴在天花下方）。

### 2.2 `src/render/lightBuilder.ts` —— 提升 `SHADE_VISUAL_SCALE`

修改（约 `src/render/lightBuilder.ts:189`）：

```ts
/** 灯罩可视化放缩因子（P11 视觉修复 → P29 再次放大）。
 * P11：真实直径 0.15-0.25m 在 3-4m 相机距离下投影仅 15-25px，几乎不可见。
 *     初值 2.5×（体积等效 ×15.6）
 * P29：默认工程与拖放创建的灯具实际渲染仍偏小（用户反馈"像骗人，看不见"）。
 *     提升到 6.0×（体积等效 ×216）：
 *     - disc (d=0.18m) → 视觉 1.08m：从 3-4m 相机距离投影到 ~120-160px
 *     - cone/cylinder → 视觉 0.9m：可见的圆锥/圆柱
 *     - sphere → 视觉 1.5m：吊灯显眼
 *     - line (h=1.2m) → 视觉 7.2m：linear 灯是长条，视觉放大合理
 *     - plane (d=0.6m) → 视觉 3.6m：灯带在天花边沿清晰可见
 *
 * 注意：只影响灯罩 Mesh 的几何尺寸；**不影响** Fixture.shape.diameter 字段
 * （`photometric` 与 `intensity` 都用真实数据），也不影响 light 的 position。
 */
export const SHADE_VISUAL_SCALE = 6.0;
```

**同时**修改 `shadeGeometry` 的**最小尺寸约束**（防止太小的灯具放大后仍看不见）：

```ts
function shadeGeometry(form: ShadeForm, diameter: number, height: number): ... {
  // P29：半径与高度都有下限，即使 shape.diameter=0 也不会退化
  const radius = Math.max(0.02, diameter / 2) * SHADE_VISUAL_SCALE;
  const h = Math.max(0.05, height) * SHADE_VISUAL_SCALE;
  // ... 其余不变
}
```

### 2.3 `src/scene/sceneEngine.ts` —— 强化选中高亮

修改 `applyFixtureIntensity` 里选中高亮分支（约 P28 引入的位置）：

```ts
if (fixtureId === this.attachedFixtureId) {
  // P29 强化选中高亮：emissive 从 0.35 提到 0.6，加更醒目的暖橙
  shadeMat.emissive.set('#ff9548');
  shadeMat.emissiveIntensity = 0.6;
} else {
  shadeMat.emissiveIntensity = clamp01(level) * SHADE_EMISSIVE_SCALE;
}
```

**新增 outline 效果（可选，若实施困难可略过）**：不引入 post-processing outline pass，仅靠 emissive 增强即可达到"清晰可见"。

**修改 attachFixture 里选中高亮的立即设置**（同步）：

```ts
if (mat) {
  mat.emissive.set('#ff9548');
  mat.emissiveIntensity = 0.6;
}
```

### 2.4 修改默认灯具的 shape —— 让默认工程 3 盏灯更醒目（可选）

修改 `src/core/makeFixture.ts` 的 `FORM_DEFAULTS`：

```ts
const FORM_DEFAULTS: Record<ShadeForm, { diameter: number; height: number; aperture: number }> = {
  // P29：所有 form 的 diameter/height 适度提升（真实数据），与 SHADE_VISUAL_SCALE=6.0 配合
  // 让默认工程与拖放创建的灯具视觉比例一致
  cone: { diameter: 0.14, height: 0.22, aperture: 0.11 },   // 0.12/0.20 → 0.14/0.22
  cylinder: { diameter: 0.18, height: 0.35, aperture: 0.17 }, // 0.15/0.30 → 0.18/0.35
  sphere: { diameter: 0.28, height: 0.28, aperture: 0.28 },   // 0.25 → 0.28
  disc: { diameter: 0.22, height: 0.05, aperture: 0.20 },     // 0.18/0.04 → 0.22/0.05
  line: { diameter: 0.05, height: 1.4, aperture: 0.05 },      // 0.04/1.2 → 0.05/1.4
  plane: { diameter: 0.7, height: 0.03, aperture: 0.68 },     // 0.60/0.02 → 0.70/0.03
  custom: { diameter: 0.22, height: 0.22, aperture: 0.22 },
};
```

### 2.5 App 层：拖放后**不自动选中**（可选，若影响体验则略过）

P28 里 `store.selectFixture(id)` 立即选中，触发 gizmo。P29 建议**保留**自动选中，让用户拖完立即拖位置——这是 P28 定的正确交互。不改。

### 2.6 `src/render/__tests__/mountFromNormal.test.ts` —— 更新法线断言

现有测试用例（P28 提交）：

```ts
it('法线向上 (0,1,0) → ceiling', () => { expect(mountFromNormal([0, 1, 0])).toBe('ceiling'); });
it('法线向下 (0,-1,0) → recessed', () => { expect(mountFromNormal([0, -1, 0])).toBe('recessed'); });
```

**改为**（P29）：

```ts
it('法线向下 (0,-1,0)（从下方点天花，PlaneGeometry 翻转后 world normal = -Y）→ ceiling', () => {
  expect(mountFromNormal([0, -1, 0])).toBe('ceiling');
});
it('法线向上 (0,1,0)（从上方点地板，罕用）→ recessed', () => {
  expect(mountFromNormal([0, 1, 0])).toBe('recessed');
});
```

### 2.7 新增 `src/render/__tests__/lightBuilderScale.test.ts`（新文件）

```ts
import { describe, it, expect } from 'vitest';
import { SHADE_VISUAL_SCALE } from '../lightBuilder.js';

describe('SHADE_VISUAL_SCALE (P29)', () => {
  it('>= 5.0：确保 disc 直径 0.22m 放大后视觉直径 >= 1.1m，3-4m 相机距离下清晰可见', () => {
    expect(SHADE_VISUAL_SCALE).toBeGreaterThanOrEqual(5.0);
  });
  it('disc 视觉直径 >= 1.0m', () => {
    const visual = 0.22 * SHADE_VISUAL_SCALE;
    expect(visual).toBeGreaterThanOrEqual(1.0);
  });
  it('cone/cylinder 视觉直径 >= 0.8m', () => {
    const visual = 0.18 * SHADE_VISUAL_SCALE;
    expect(visual).toBeGreaterThanOrEqual(0.8);
  });
});
```

---

## 3. 测试

- 修改 `src/render/__tests__/mountFromNormal.test.ts`（法线断言反转）
- 新增 `src/render/__tests__/lightBuilderScale.test.ts`（视觉缩放下限）
- 其余测试**不改断言**（既有测试不涉及 mountFromNormal 的方向语义；`sceneEngineFixture` 也不测 mountFromNormal）
- `npm run typecheck` 0 error
- `npm test` ≥ 818（+3 用例）

---

## 4. 验证（运行时，真实 GPU）

1. `npm run dev` → 打开首页
2. 观察默认工程 3 盏灯：downlight/pendant/floor 的灯罩都更明显
3. 左栏「灯具库」拖「筒灯」到天花 → 灯罩在天花**下方**清晰可见（不是消失）
4. 拖「吊灯」到天花 → 明显可见
5. 拖「壁灯」到墙面 → 贴墙可见
6. 拖「落地灯」到地面 → 立在地上
7. 拖「灯带」到天花边沿 → 长条形可见
8. 点击任一灯具 → 选中高亮暖橙，emissive 明显（0.6 强度）
9. 观察画面**不破画**（P26b 的入夜画面目标仍达标：天花最亮、桌面次亮、墙面洗墙光斑、地面暗部有细节）

---

## 5. 不做的事

- **不做** outline post-processing pass（性能代价高，emissive 增强已够用）
- **不做** 灯具库拖入后**独立高亮 mesh**（会引入额外的视觉对象管理复杂度）
- **不做** 修改 `Fixture.shape.diameter` 的**默认值**以外的字段（不改 makeFixture 的其它逻辑）
- **不新增** npm 依赖
- **不改** CSS / 布局
- **不改** `vite.config.ts` / `tsconfig.json` / `eslint.config.js` / `CLAUDE.md`
- **不改** store / commandStack / commandBus / modelRoomBuilder / room

---

## 6. 红线

- 只碰：
  - `src/render/mountFromNormal.ts`（法线判定反转）
  - `src/render/lightBuilder.ts`（`SHADE_VISUAL_SCALE` + `shadeGeometry` 最小约束）
  - `src/scene/sceneEngine.ts`（选中高亮 emissive 强度 0.35 → 0.6 + 颜色）
  - `src/core/makeFixture.ts`（`FORM_DEFAULTS` 数值提升）
  - `src/render/__tests__/mountFromNormal.test.ts`（法线断言反转）
  - `src/render/__tests__/lightBuilderScale.test.ts`（新增）
- **不改**：`src/render/lightBuilder.ts` 里 `buildLightFromFixture` 函数的**逻辑**（不改 switch 分支、不改 spot/point/rect light 参数、不改 emissive 计算方式）
- **不改** `Fixture.shape` 字段结构（仅改数值）
- **不改** 既有测试断言（除 mountFromNormal 反转的两处）
- 回退成本：`git revert <P29-hash>` 即可，改动集中在 4 个数值与 1 个函数

---

## 7. 提交

一次 commit，格式：

```
P29: 灯具可见性修复

- 修正 mountFromNormal：法线 (0,-1,0) → ceiling（不是 recessed）
  根因：PlaneGeometry 翻转后天花 world normal = -Y，旧逻辑把灯具塞进天花内部
- SHADE_VISUAL_SCALE 从 2.5 提到 6.0：disc 视觉 0.45m → 1.32m
  3-4m 相机距离下投影从 40-50px 提到 120-160px
- FORM_DEFAULTS 数值提升（disc 0.18→0.22、cone/cylinder 0.15/0.12→0.18/0.14 等）
- 选中高亮 emissive 从 0.35 → 0.6，颜色从 #ffb27a → #ff9548
- 新增 lightBuilderScale 测试 + 修正 mountFromNormal 法线断言
```

不 push。

---

## 8. 交付证据

- `commit_hash`
- `npm run typecheck` 输出
- `npm test` 结果（含测试总数与新增用例数）
- `git show --stat HEAD`
- `deviations`
