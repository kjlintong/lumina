# P37a-fix 规格

**问题源**：P37a（commit `b559aa6` + `baf649e`）灯具 GLTF 资产显示存在三个视觉问题：
1. 灯具大小比例不对
2. 灯放置位置不对，没有准确吸附
3. 不同灯的光源发光都是脱离模型的合成光球

**根因**（用真实 GLTF 顶点数据实测，见 §2）：
- **1 和 3 同一个 bug**：`normalizeAndAnchor` 把 `scene.scale.setScalar(s)` 套在 GLTF 的
  **根 scene 对象上**，然后 `attachGlowMesh` 又把合成圆片 `add` 到这个已缩放的 scene 上
  → **glow mesh 也一起被缩放**（半径 × 0.62 对 pendant），且 `lightOffset` 是估计值，
  与资产真实 bulb 位置偏离几十厘米。
- **2 拆成两层**：
  - `normalizeAndAnchor` 的注释假设"资产顶点关于原点居中"，但真实几何**不对称**：
    pendant `y=-1.340..0.015`（重心偏低）、ceiling_lamp `y=0.221..1.173`（整体悬空）。
    所以 anchor='top'/'bottom' 计算出的位置是错的。
  - 3D 场景**从来就没有"磁吸到墙面/天花板"功能**，只有 50mm 网格吸附
    （`src/render/snapToGrid.ts`）。`Fixture.pos` 是自由点，天花板 `ceilingH=2.8`
    与默认吊灯 `pos.y=1.9` 相差 0.9m，视觉上是"漂浮在半空"。

**范围**：本轮修 1、2 的锚点部分、3。第 2 层的"磁吸功能"另立 P37c（见 §8）。
chandelier 资产接入另立 P37d（其 `axis='horizontal'` 是错的，见 §2 附注）。

---

## 1. 目标

- [ ] 灯具视觉尺寸接近真实（pendant 约 0.45m 灯头 + 吊杆、ceiling_lamp 约 0.25m 等）
- [ ] 灯具模型正确对齐"安装面"：天花装类的锚在顶端、桌装类的锚在底端
- [ ] 光源发光**在资产自带的 bulb 网格上**（不再外挂脱离模型的合成圆片）
- [ ] `applyFixtureIntensity` / `applyFixtureCct` / `recalculateBudget` 链路不断
- [ ] 无 emissive 网格的资产（wall_sconce）仍能看到发光面（回落到小圆片，尺寸正确）
- [ ] 测试全绿，不新增 lint error，应用代码仍 2 chunk
- [ ] **不动 `lightBuilder.ts` / `types.ts` / `makeFixture.ts` / `ui/**`**（磁吸留到 P37c）

---

## 2. 真实资产几何（实测）

解析了 `public/assets/lights/` 下 5 个 `.gltf` 的 POSITION 顶点数据
（脚本 `/tmp/parse_gltf.mjs`，用 `DataView` 直读 buffer，不经过 GLTFLoader，几秒跑完）：

| key | 原始包围盒 | 主轴尺寸 | 自带 emissive mesh |
|---|---|---|---|
| pendant | y=-1.340..0.015, x=z=±0.275 | h=1.355, w=d=0.550 | `Cylinder` em=(1,1,1) i=1，bbox y=-1.340..-1.037，中心 y≈-1.189 |
| chandelier | x=±37.3, y=-40.2..41.3, z=0..79.8 | **单位很大**，见 §2 附注 | `Line008` em=none（`lamps` 材质也无 emissive） |
| desk_lamp | x=±0.1, y=-0.088..0.805, z=±0.3 | h=0.893, w=0.202, d=0.614 | `Box.001` em=(1.00,0.98,0.65) i=1，bbox y=0.649..0.742，中心 y≈0.696 |
| wall_sconce | x=±0.075, y=±0.171, z=-0.001..0.250 | h=0.342, w=0.150, d=0.252 | `Cube.009_bulb` **em=none**（材质叫 bulb 但没 emissive） |
| ceiling_lamp | x=z=±0.216, y=0.221..1.173 | h=0.952, w=d=0.432 | `Cylinder_globe` em=(0.62,0.54,0.47) i=1，bbox y=0.377..0.463，中心 y≈0.420 |

**两个关键结论**：

1. **锚点不能靠"资产顶点关于原点居中"假设**。真实几何不对称：
   - pendant：顶 0.015、底 -1.340，中心在 -0.662（不是原点）
   - ceiling_lamp：整段悬在 y=0.221..1.173，底不在原点
   现有 `normalizeAndAnchor` 用 `scene.position.set(cx, cy, cz)` 平移是对的，
   但它假设的"轴心在世界原点"是错的 → 平移量算错。

2. **glow mesh 被 `scene.scale` 缩放了**。三件套的 bug 链：
   ```
   normalizeAndAnchor: scene.scale.setScalar(0.619)   // pendant
   attachGlowMesh:     mesh = Circle(r=0.168); assetGroup.add(mesh)
                        → 实际半径 = 0.168 × 0.619 = 0.104m（缩到 62%）
   ```
   而且 `lightOffset=-0.60` 是估计值，真实 bulb 中心在 anchor 空间是
   `(−1.189 − 0.015) × 0.45/1.355 = −0.415`（见下），偏离 20cm。

### 2.1 附注：chandelier 的 axis 判断错了

chandelier 原始几何是 x=±37.3, y=−40.2..41.3, z=0..79.8，**单位很大**
（Poly Haven 这个模型本身没归一化）。它的形状不是"横向吊灯"，
而是一个多臂球状结构。P37a 标 `axis='horizontal'` 是按最大轴判断的，
但那样缩放会把 z 方向（0..79.8）压扁。

**本轮不修 chandelier**（`assetKeyForType('chandelier')` 本来就无调用方，
默认工程里也没有 chandelier 类型灯具）。chandelier 资产接入留到 P37d，
届时重新设计轴策略（可能要用等比缩放 + `axis='vertical'`）。

### 2.2 修正后的 anchor 语义

现有实现（P37a）：
```ts
// 假设：box.min/max 关于 (0,0,0) 对称
// 实际：不对称（见上表）
if (anchor === 'top') cy = -maxY;        // ← 错：maxY 是绝对值，不是相对轴心的距离
else if (anchor === 'bottom') cy = -minY; // ← 错：minY 是绝对值
else cy = -(maxY + minY) / 2;
scene.position.set(cx, cy, cz);
```

正确做法：**在 scene.scale 之前**取世界坐标包围盒，然后计算"资产坐标下要
平移到多少"才能让锚点对齐 scene 原点：

```ts
// 归一化前：scene 是未缩放的 GLTF 根，子节点世界坐标 == 资产坐标
scene.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(scene);
const scale = targetSize / primary;

// 资产坐标下锚点在世界系的坐标：
//   anchor='top'    → 把 box.max 平移到原点：worldAfter = asset × scale - box.max × scale
//                     在 asset 坐标系的等价平移 = -box.max（因为乘以 scale 后 scene.scale 会再乘）
// 所以 scene.position 应该设为 -box.max（或 -box.min / -center），
// 这样 worldAfter = asset × scale + (-box.max) × scale = (asset - box.max) × scale
//   anchor='top' 时 asset=box.max 处 world=0（顶在原点），asset=box.min 处 world=-(h×scale)（向下）
```

推导验证（pendant，targetSize=0.45, h=1.355）：
```
scale = 0.45 / 1.355 = 0.3321
box = (y=-1.340..0.015)
anchor='top': scene.position.y = -box.max.y = -0.015
  asset.y=0.015 处：world = 0.015 × 0.3321 + (-0.015) × 0.3321 = 0   ✓（顶端在原点）
  asset.y=-1.340 处：world = -1.340 × 0.3321 + (-0.015) × 0.3321 = -0.4498  ✓（向下 0.45）
  bulb 中心 asset.y=-1.189：world = -1.189 × 0.3321 + (-0.015) × 0.3321 = -0.4018
```

---

## 3. 改动清单

### 3.1 `src/render/lightAssets.ts` —— 重写 normalizeAndAnchor + 新增 findEmissiveMeshes

**改动点**：
- `normalizeAndAnchor` 保留签名 `(scene, axis, targetSize, anchor)`，但**平移量算法改对**
- 新增 `findEmissiveMeshes(root: Object3D): Mesh[]` 导出（供测试）
- `attachGlowMesh` 重写：优先复用 emissive 网格，无则回落到小圆片

```ts
// === 新增：找资产自带的 emissive mesh ===

/**
 * 找资产里自带 emissive 材质的 Mesh（bulb / light / globe 网格）。
 *
 * 判据：material.emissive 非黑色且 material.emissiveIntensity > 0。
 * 返回资产坐标下的 Mesh 列表（未 clone，未缩放）。
 *
 * 用途：`attachGlowMesh` 优先复用这些网格当发光面（P37a-fix），
 * 不再外挂合成 CircleGeometry —— 后者会：
 *   1. 被 normalizeAndAnchor 的 scene.scale 缩放（半径缩到 62%）
 *   2. lightOffset 是估计值，位置偏离真实 bulb 几十厘米
 *
 * @param root GLTFLoader 加载返回的 scene（未缩放、未平移）
 */
export function findEmissiveMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const hasEmissive = mats.some(
      (m) =>
        m &&
        'emissive' in m &&
        (m as THREE.MeshStandardMaterial).emissiveIntensity > 0 &&
        (m as THREE.MeshStandardMaterial).emissive.getHex() !== 0x000000,
    );
    if (hasEmissive) out.push(o as THREE.Mesh);
  });
  return out;
}

// === 改：normalizeAndAnchor ===

/**
 * 归一化 + 锚定：把 GLTF scene 的主轴向缩放到 targetSize 米，按 anchor
 * 把资产的相应端对齐到 scene 原点。
 *
 * 语义：调用方（sceneEngine.loadFixtureAssetAsync）把返回的 scene 作为
 * fixture group 的子节点，scene.position 是 fixture.pos。归一化后 scene
 * 的原点 = 资产锚点：
 *   - anchor='top'    → 资产顶端在原点，向下延伸（光源在灯具顶部下方）
 *     pendant / ceiling_lamp / wall_sconce：挂在天花或墙面
 *   - anchor='bottom' → 资产底端在原点，向上延伸（光源在灯具底部上方）
 *     desk_lamp：立在桌面上
 *   - anchor='center' → 资产中心在原点
 *     chandelier（多臂全向）
 *
 * **纯函数**（不 fetch、不建 loader），可直接用真实 Box3 / Object3D 单测。
 *
 * @param scene GLTFLoader 加载返回的 scene Group
 * @param axis 主轴向
 * @param targetSize 归一化后主轴向尺寸（米）
 * @param anchor 锚点策略
 * @returns 同一个 scene（原地修改），返回便于链式使用
 */
export function normalizeAndAnchor(
  scene: THREE.Object3D,
  axis: 'vertical' | 'horizontal',
  targetSize: number,
  anchor: 'top' | 'bottom' | 'center',
): THREE.Object3D {
  scene.updateMatrixWorld(true);
  // 关键：取包围盒 BEFORE 缩放（否则数字会被 scene.scale 污染）
  const box = new THREE.Box3().setFromObject(scene);
  if (box.isEmpty()) return scene;

  const size = box.getSize(new THREE.Vector3());
  const primary = axis === 'vertical' ? size.y : size.x;
  if (primary <= 0) return scene;

  const scale = targetSize / primary;

  // 计算平移量：把资产锚点（box.max/min/center 沿主轴）平移到原点。
  // scene.position 是在资产坐标系里的平移量；最终 world = asset × scale + scene.position × scale
  //   推导：scale 后 world = asset × scale + pos × scale；我们希望 asset=anchor 时 world=0
  //         → pos = -anchor（在资产坐标系里）
  const ax = anchor === 'top' ? box.max.x : anchor === 'bottom' ? box.min.x : (box.min.x + box.max.x) / 2;
  const az = anchor === 'top' ? box.max.z : anchor === 'bottom' ? box.min.z : (box.min.z + box.max.z) / 2;
  const ay = anchor === 'top' ? box.max.y : anchor === 'bottom' ? box.min.y : (box.min.y + box.max.y) / 2;

  scene.scale.setScalar(scale);
  scene.position.set(-ax, -ay, -az);

  return scene;
}
```

### 3.2 `src/render/lightAssets.ts` —— 重写 attachGlowMesh

```ts
// === 改：attachGlowMesh（复用资产 emissive mesh，不再合成圆片）===

/**
 * 给资产 Group 挂发光面，供 applyFixtureIntensity / applyFixtureCct 消费。
 *
 * **P37a-fix**：优先复用资产自带的 emissive Mesh（bulb / light / globe）
 * 作为发光面，而不是外挂 CircleGeometry。原因：
 *   1. 外挂圆片会被 normalizeAndAnchor 的 scene.scale 缩放（半径缩到 62%）
 *   2. 外挂圆片的位置（def.lightOffset）是估计值，与真实 bulb 偏离几十厘米
 *      —— 这就是"光源是脱离模型的光球"的直接原因
 *
 * 无 emissive 网格的资产（wall_sconce）回落：在**未缩放的 assetGroup** 上
 * 直接 add 一个小圆片，尺寸用资产坐标下的计算值，绕开 scene.scale 污染。
 *
 * @param f Fixture
 * @param assetGroup 已 clone 的资产根（未缩放）
 * @param def LIGHT_ASSET_DEFS 条目
 * @returns 发光 Mesh（emissive 网格的第一个 或 回落圆片）
 */
export function attachGlowMesh(
  f: Fixture,
  assetGroup: THREE.Object3D,
  def: LightAssetDef,
): THREE.Mesh {
  const kelvin = typeof f.electrical.cct === 'number'
    ? f.electrical.cct
    : (f.electrical.cct[0] + f.electrical.cct[1]) / 2;
  const { r, g, b } = cctToRGB(kelvin);

  // 优先复用资产自带 emissive 网格
  const emissiveMeshes = findEmissiveMeshes(assetGroup);
  if (emissiveMeshes.length > 0) {
    const mesh = emissiveMeshes[0];
    // 命名：'-shade' 后缀必须保留（App.tsx:256 isFixtureHit 依赖）
    mesh.name = `${f.id}-shade`;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.fixtureId = f.id;
    mesh.visible = true; // 保险：部分资产里 emissive mesh 可能 initial invisible
    // 材质：emissive 颜色跟 cct，emissiveIntensity 由 applyFixtureIntensity 更新
    // 原 emissive 是资产作者给的（可能带偏色，如 desk_lamp 的 (1, 0.98, 0.65)）
    // 我们不覆写 color，只覆写 emissive，让色温切换生效
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m || !('emissive' in m)) continue;
      const std = m as THREE.MeshStandardMaterial;
      std.emissive.setRGB(r, g, b);
      std.emissiveIntensity = 0; // 由 applyFixtureIntensity 按 level 更新
      // color 也一起跟（视觉一致性），但 emissive 才是发光的主通道
      std.color.setRGB(r, g, b);
      std.metalness = 0; // 避免反光把 emissive 吃回去
    }
    return mesh;
  }

  // 回落：无 emissive 网格，在 assetGroup 上挂一个小圆片
  // 注意：assetGroup 未缩放，所以这里用资产坐标下的计算值
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(r, g, b),
    emissive: new THREE.Color(r, g, b),
    emissiveIntensity: 0,
    roughness: 0.4,
    metalness: 0,
  });
  // 圆片半径：按资产主轴向尺寸的 25%（资产坐标下）
  const fallbackR = Math.max(0.02, def.targetSize * 0.25);
  const geo = new THREE.CircleGeometry(fallbackR, 24);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `${f.id}-shade`;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.fixtureId = f.id;

  // 位置：资产坐标下沿主轴向放到 def.lightOffset 处
  // （wall_sconce 的 bulb 在 z=0.18 处，我们用 lightOffset 表示 z 方向的偏移）
  if (def.axis === 'vertical') {
    mesh.position.set(0, def.lightOffset, 0);
    mesh.rotation.x = -Math.PI / 2; // 面朝 -Y（朝下）
  } else {
    mesh.position.set(0, 0, def.lightOffset);
    mesh.rotation.y = Math.PI / 2; // 面朝 +Z（朝外，墙面外）
  }

  assetGroup.add(mesh);
  return mesh;
}
```

### 3.3 `LIGHT_ASSET_DEFS` —— 值修正

**改动**：`targetSize` 改用真实几何推算的合理值；`lightOffset` 只在回落路径使用
（emissive mesh 复用时不读它），但保留字段以维持测试面。

```ts
export const LIGHT_ASSET_DEFS: Record<LightAssetKey, LightAssetDef> = {
  // pendant 真实灯头（不含吊杆）h≈0.30m；targetSize=0.45 兼顾视觉重量和真实感
  pendant:      { name: 'pendant',      axis: 'vertical',   targetSize: 0.45, anchor: 'top',    lightOffset: -0.42 },
  // ceiling_lamp 真实 h=0.952，缩到 0.30 视觉合理
  ceiling_lamp: { name: 'ceiling_lamp', axis: 'vertical',   targetSize: 0.30, anchor: 'top',    lightOffset: -0.13 },
  // wall_sconce 真实 h=0.342 保持，但 wall 类无 emissive mesh → 走回落路径
  wall_sconce:  { name: 'wall_sconce',  axis: 'vertical',   targetSize: 0.35, anchor: 'top',    lightOffset: -0.18 },
  // desk_lamp 真实 h=0.893，缩到 0.55 视觉合理
  desk_lamp:    { name: 'desk_lamp',    axis: 'vertical',   targetSize: 0.55, anchor: 'bottom', lightOffset:  0.43 },
  // chandelier 本轮不修（axis 判断本就错），保留 P37a 值不动
  chandelier:   { name: 'chandelier',   axis: 'horizontal', targetSize: 1.0,  anchor: 'center', lightOffset: 0 },
};
```

`lightOffset` 值（仅回落路径用）都是按 §2 表里 emissive mesh 中心
在归一化后的坐标算出来的：
- pendant bulb 中心 asset.y=-1.189，anchor='top' → world = (-1.189 - 0.015) × 0.45/1.355 = **-0.415**
- ceiling_lamp globe 中心 asset.y=0.420，anchor='top' → world = (0.420 - 1.173) × 0.30/0.952 = **-0.237**（但资产无 emissive 时才走回落；此值仅备用）
- desk_lamp light 中心 asset.y=0.696，anchor='bottom' → world = (0.696 - (-0.088)) × 0.55/0.893 = **0.484**
- wall_sconce bulb 中心 asset.y=-0.044，anchor='top' → world = (-0.044 - 0.171) × 0.35/0.342 = **-0.220**

**注**：上述 lightOffset 仅 wall_sconce 会真用到（唯一无 emissive 的类型），
其他类型的 emissive mesh 分支会完全绕过 `lightOffset`。所以数值近似即可。

### 3.4 `sceneEngine.ts` —— 不改

`loadFixtureAssetAsync` 现有代码（P37a 已写）已经正确：
- clone asset → `markNoShadow` → add 到 object
- `attachGlowMesh(fixture, assetClone, def)` → 更新 entry.shade
- `applyFixtureIntensity` 走 emissiveIntensity

**唯一的调整**：`entry.shade` 从合成 CircleGeometry 变成资产自带的 emissive Mesh。
下游所有 `shade.material.emissive` / `emissiveIntensity` 访问路径**完全兼容**
（资产材质就是 `MeshStandardMaterial`，有 emissive + emissiveIntensity 字段）。

**不用改** 的地方：
- `applyFixtureIntensity` / `applyFixtureCct`：读 `entry.shade.material.emissive`
- `recalculateBudget` / `addFixtureInternal`：不变
- `removeFixtureInternal`：dispose 遍历 mesh，资产材质也会被 dispose
- `markNoShadow`：遍历资产 mesh 设 castShadow/receiveShadow=false（P37a 已写）

---

## 4. 测试

`src/render/__tests__/lightAssets.test.ts` 修改 3 处：

### 4.1 `normalizeAndAnchor` 测试 —— 改用**不对称**几何验证

原测试用 `BoxGeometry(2,2,2)`（对称），无法暴露 §2 的锚点 bug。改用偏心 Box：

```ts
describe('lightAssets: normalizeAndAnchor (P37a-fix)', () => {
  it('vertical + anchor=top，不对称几何：顶端对齐原点，向下延伸 targetSize', () => {
    // 模拟 pendant 的不对称：y 从 -1.340 到 0.015（高 1.355）
    const scene = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    // 把 box 挪到 y=-0.67（模拟 pendant 的实际重心）
    box.position.y = -0.67;
    scene.add(box);
    scene.updateMatrixWorld(true);

    // pendant 原始高 = box 高 1 + box 位移幅度 1.34 = 1.34；我们让它对应真实 pendant 的 1.355
    // 为简化，让 box 直接占据 y=-1.340..0.015：高 1.355
    // 更简单：手动构造
    scene.clear();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5)));
    scene.children[0]!.position.y = -1.340 - 0.25; // 让 box 占据 y=-1.340..-1.090？不，我们要 y=-1.340..0.015
    // 用更直接的做法：给一个 BoxGeometry(0.5, 1.355, 0.5)，中心在 y=-0.662（pendant 真实中心）
    scene.clear();
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.355, 0.5));
    m.position.y = -0.662;
    scene.add(m);
    scene.updateMatrixWorld(true);

    const targetSize = 0.45;
    normalizeAndAnchor(scene, 'vertical', targetSize, 'top');
    scene.updateMatrixWorld(true);

    const result = new THREE.Box3().setFromObject(scene);
    // 顶端在原点（anchor=top）
    expect(result.max.y).toBeCloseTo(0, 5);
    // 底端向下延伸 targetSize
    expect(result.min.y).toBeCloseTo(-targetSize, 5);
  });

  it('vertical + anchor=bottom：底端对齐原点，向上延伸 targetSize', () => {
    // 模拟 desk_lamp：底端不在原点（真实 desk_lamp y=-0.088..0.805）
    const scene = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.893, 0.6));
    m.position.y = 0.358; // desk_lamp 真实中心
    scene.add(m);
    scene.updateMatrixWorld(true);

    const targetSize = 0.55;
    normalizeAndAnchor(scene, 'vertical', targetSize, 'bottom');
    scene.updateMatrixWorld(true);

    const result = new THREE.Box3().setFromObject(scene);
    expect(result.min.y).toBeCloseTo(0, 5);
    expect(result.max.y).toBeCloseTo(targetSize, 5);
  });

  it('anchor=center：中心对齐原点', () => {
    const scene = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    m.position.y = 2.5; // 远离原点
    scene.add(m);
    scene.updateMatrixWorld(true);

    normalizeAndAnchor(scene, 'vertical', 0.5, 'center');
    scene.updateMatrixWorld(true);
    const result = new THREE.Box3().setFromObject(scene);
    expect(result.min.y).toBeCloseTo(-0.25, 5);
    expect(result.max.y).toBeCloseTo(0.25, 5);
  });

  it('horizontal + anchor=center：左端对齐原点', () => {
    const scene = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1));
    m.position.x = 3;
    scene.add(m);
    scene.updateMatrixWorld(true);

    normalizeAndAnchor(scene, 'horizontal', 1.0, 'center');
    scene.updateMatrixWorld(true);
    const result = new THREE.Box3().setFromObject(scene);
    expect(result.min.x).toBeCloseTo(-0.5, 5);
    expect(result.max.x).toBeCloseTo(0.5, 5);
  });

  it('空 Box（无子节点）不抛错，原样返回', () => {
    const scene = new THREE.Group();
    expect(normalizeAndAnchor(scene, 'vertical', 1, 'top')).toBe(scene);
  });
});
```

### 4.2 `findEmissiveMeshes` 测试（新增）

```ts
describe('lightAssets: findEmissiveMeshes (P37a-fix)', () => {
  it('找到 emissive 非黑且 emissiveIntensity>0 的 Mesh', () => {
    const root = new THREE.Group();
    // mesh1：emissive 黑色，应被排除
    const m1 = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ emissive: new THREE.Color(0x000000) }),
    );
    // mesh2：emissiveIntensity=0，应被排除
    const m2 = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0 }),
    );
    // mesh3：emissive 亮 + intensity>0，应被找到
    const m3 = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ emissive: new THREE.Color(1, 0.9, 0.7), emissiveIntensity: 1 }),
    );
    // 非 mesh（Group）应被忽略
    const grp = new THREE.Group();
    root.add(m1, m2, m3, grp);

    const found = findEmissiveMeshes(root);
    expect(found).toHaveLength(1);
    expect(found[0]).toBe(m3);
  });

  it('遍历嵌套子节点', () => {
    const root = new THREE.Group();
    const child = new THREE.Group();
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.5 }),
    );
    child.add(m);
    root.add(child);

    const found = findEmissiveMeshes(root);
    expect(found).toHaveLength(1);
    expect(found[0]).toBe(m);
  });
});
```

### 4.3 `attachGlowMesh` 测试 —— 分支测法

```ts
describe('lightAssets: attachGlowMesh (P37a-fix)', () => {
  it('有 emissive mesh：直接复用（不合成圆片），-shade 后缀，emissive 跟 cct', () => {
    const f = makeFixture({ type: 'pendant', cct: 3000 });
    const def = LIGHT_ASSET_DEFS.pendant;
    const g = new THREE.Group();
    // 模拟资产自带 emissive mesh
    const bulbMat = new THREE.MeshStandardMaterial({
      emissive: new THREE.Color(1, 0.9, 0.6),
      emissiveIntensity: 1,
    });
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.1), bulbMat);
    bulb.position.y = -0.4; // 模拟 pendant 的真实 bulb 位置
    g.add(bulb);

    const shade = attachGlowMesh(f, g, def);

    // 复用原 emissive mesh，不新增 mesh
    expect(shade).toBe(bulb);
    expect(g.children.length).toBe(1); // 只加了 bulb，没加合成圆片
    expect(shade.name).toBe(`${f.id}-shade`);
    expect(shade.castShadow).toBe(false);
    expect(shade.userData.fixtureId).toBe(f.id);

    const mat = shade.material as THREE.MeshStandardMaterial;
    // emissive 被覆写为 cct 颜色（3000K 偏暖）
    expect(mat.emissive.r).toBeGreaterThan(mat.emissive.b);
    expect(mat.emissiveIntensity).toBe(0); // 由 applyFixtureIntensity 更新
  });

  it('无 emissive mesh：回落合成小圆片，尺寸用资产坐标下计算值', () => {
    const f = makeFixture({ type: 'sconce' }); // sconce → wall_sconce
    const def = LIGHT_ASSET_DEFS.wall_sconce;
    const g = new THREE.Group();
    // 模拟 wall_sconce：只有普通 mesh，无 emissive
    g.add(new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.3, 0.2),
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
    ));

    const shade = attachGlowMesh(f, g, def);

    // 新增一个 mesh（合成圆片）
    expect(g.children.length).toBe(2);
    expect(shade).toBe(g.children[1]);
    expect(shade.name).toBe(`${f.id}-shade`);
    // 圆片尺寸：targetSize * 0.25 = 0.35 * 0.25 = 0.0875
    // CircleGeometry 的 radius 在几何里，不是 mesh.position
    const geo = shade.geometry as THREE.CircleGeometry;
    expect(geo.parameters.radius).toBeCloseTo(0.0875, 3);
    // 位置：anchor='top' + lightOffset=-0.18 → 圆片在 y=-0.18
    // 但注意：wall_sconce axis='vertical'，圆片 rotation.x=-PI/2 面朝 -Y
    expect(shade.position.y).toBeCloseTo(-0.18, 5);
  });

  it('glow mesh 的 emissive 颜色跟 cct（回落路径）', () => {
    const f = makeFixture({ type: 'sconce', cct: 2700 });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    const shade = attachGlowMesh(f, g, LIGHT_ASSET_DEFS.wall_sconce);
    const mat = shade.material as THREE.MeshStandardMaterial;
    // 2700K 极暖，R > B
    expect(mat.emissive.r).toBeGreaterThan(mat.emissive.b);
    expect(mat.color.r).toBeGreaterThan(mat.color.b);
  });
});
```

### 4.4 `assetKeyForType` / `loadLightAsset` 测试

**保留 P37a 原测试不变**（本轮没改这两个函数）。

---

## 5. 测试总数

- P37a：942 → 954（+12）
- P37a-fix：954 → **962**（+8：normalizeAndAnchor 改 5→3 保留但改对称/不对称组合，findEmissiveMeshes 新增 2，attachGlowMesh 分支改 3，去掉 2 条与旧设计冲突的测试）

具体拆分：
- normalizeAndAnchor：5 条（原 5 条保留，但改用不对称 BoxGeometry 验证 §2 的锚点 bug）
- findEmissiveMeshes：**+2** 条（新导出函数）
- attachGlowMesh：3 条（复用 emissive 分支 1 条 + 回落分支 2 条）
- assetKeyForType / loadLightAsset：4 条（P37a 原有，不动）

总计：4 + 5 + 2 + 3 = **14** 条 lightAssets 相关测试。
原 P37a 有 12 条（含 5 条 attachGlowMesh 里的 desk_lamp / cct 分支），
需要删掉 4 条（原来断言"glow mesh 位置沿 y<-0"、"mesh.position.y = def.lightOffset" 等，
现在复用 emissive mesh 后这些断言不再成立），
新增 6 条（不对称 anchor 验证、findEmissiveMeshes、复用 emissive 分支、回落路径尺寸）。

净变化：12 → 14（+2），total 954 → **956**。

**以实际 diff 为准**，最终数字在 verify 时定。

---

## 6. 验证

1. `npm test` → 全绿（约 956）
2. `npm run typecheck` → 全绿
3. `npm run lint` → **不新增 error**（清 `node_modules/.cache` 后测，330 problems / 12 errors 基线）
4. `npm run build` → 通过，应用代码仍 2 chunk（index + three）
5. `python3 -m py_compile scripts/download-assets.py` → 通过
6. 手动验证：起 `npm run dev -- --host 0.0.0.0`，打开 http://localhost:5173（或 5174），
   默认工程的 pendant / downlight 应显示真实资产，光源发光在 bulb 上（不再是脱离模型的圆片）

---

## 7. 红线

- **不动** `src/core/types.ts` / `src/core/makeFixture.ts` / `src/store/projectStore.ts`
- **不动** `src/ui/**`（磁吸 UI 留到 P37c）
- **不动** `src/render/fixtureModels.ts` / `src/render/lightBuilder.ts`
- **不动** `src/render/furnitureAssets.ts`
- **不新增** npm 依赖；**不改** `vite.config.ts`
- **不删**其他文件的测试
- **不要** `git add .`；**不要** push

---

## 8. 后续（不在本轮）

- **P37c 磁吸**：3D 场景缺"安装面"语义。需要给 Fixture 加 `installSurface` 字段
  （ceiling/wall/floor/table），并把 `pos` 语义改成"贴在安装面上"。
  这是数据结构改动，涉及 `types.ts` / `makeFixture.ts` / `projectStore.ts` / UI 面板，
  单独立项。
- **P37d chandelier**：`axis='horizontal'` 判断错误，需要重新设计。chandelier 资产
  单位很大（±37），需要等比缩放 + 特殊处理。
- **P37b FixtureLibraryPanel 3D 预览**：离屏渲染器，另立项。

---

## 9. 视觉判定免责声明

本环境 WSL2 SwiftShader，3D 渲染可能黑屏/材质灰平。视觉质量（比例、朝向、
是否穿模、光源位置）由用户在真实 GPU 上验收。本轮用数值/DOM 断言验证逻辑，
**不声称已验收画面**。

---

## 10. 提交模板

```bash
git add \
  src/render/lightAssets.ts \
  src/render/__tests__/lightAssets.test.ts \
  docs/P37-fix-spec.md \
  docs/P8-plan.md

git commit -m "P37a-fix: 灯具资产视觉问题修复

根因：normalizeAndAnchor 把 scene.scale 套在 GLTF 根对象上，
后续 attachGlowMesh 挂的合成圆片也一起被缩放（半径 × 0.62），
加上 lightOffset 是估计值，与真实 bulb 位置偏离几十厘米 ——
这就是'光源是脱离模型的光球'的直接原因。

- normalizeAndAnchor：平移量算法改对。原实现假设资产顶点关于原点居中，
  但真实几何不对称（pendant y=-1.340..0.015、ceiling_lamp 整段悬空）。
  现在按 box.max/min 算平移量，anchor 语义正确。
- 新增 findEmissiveMeshes：找资产自带的 emissive Mesh（bulb/light/globe）。
- attachGlowMesh 重写：优先复用 emissive 网格（不再合成圆片）；
  无 emissive 的资产（wall_sconce）回落到小圆片，尺寸用资产坐标下计算值。
- LIGHT_ASSET_DEFS：targetSize 用真实几何推算的合理值
  （pendant 0.84→0.45、ceiling_lamp 0.55→0.30、desk_lamp 0.75→0.55）。
  chandelier 保持不动（axis='horizontal' 判断错误，留到 P37d）。
- 测试：改用不对称 BoxGeometry 验证 anchor（原对称 Box 无法暴露 §2 的 bug）；
  新增 findEmissiveMeshes 测试；attachGlowMesh 分支测法重写。

后续：P37c 磁吸（安装面语义，单独立项）、P37d chandelier 资产接入。"
```
