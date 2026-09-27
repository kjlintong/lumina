# P14 规格：材质最小包（审查报告 §4 Day 2–3 e）

## 目标（验收标准）

按审查报告 §4 e「材质最小包」把 6 个表面做到位。**核心判据是 roughness/normal 分层**——不是只有标量 roughness 就算达标。当前墙面/天花已达标，橡木地板只有 albedo（缺 normal + roughness 贴图），布艺只有标量 roughness（`makeFabricTexture` 写了没用），玻璃没有 transmission（被一条错误断言挡住）。

验收判据（逐条可测）：
1. 橡木地板：`map` + `normalMap` + `roughnessMap` 三件套同时存在（真实浏览器路径下非 null）；标量 roughness ∈ [0.35, 0.45]；`clearcoat` > 0。
2. 墙面涂料：roughness 0.90 + `normalMap` 存在。
3. 天花：roughness 0.95；颜色对应反射率 ∈ [0.7, 0.9]（EN 12464）。
4. 布艺沙发：roughness 0.95 + `normalMap` 存在（布纹）+ `map`（布纹颜色）。
5. 玻璃：`MeshPhysicalMaterial`，`transmission === 1.0`，`ior === 1.5`，`roughness === 0.05`，`thickness === 0.01`。
6. 混凝土：规格 6 张之一，但**当前场景没有混凝土表面**——不凭空造，见「跳过项」说明。

## 已核实的现状（不要重复勘察）

以下是我逐条 grep + 读源码确认的，直接采信：

| 表面 | 当前 | 差距 |
|---|---|---|
| 橡木地板 | `MeshStandardMaterial`，`map = makeWoodFloorTexture()`，roughness 0.4 | 缺 `normalMap` + `roughnessMap`；缺 clearcoat |
| 墙面 | roughness 0.9 + `normalMap`(normalScale 0.4) | ✅ 已达标 |
| 天花 | roughness 0.95，color 0xe6e6e6 | ✅ 已达标（反射率 0.85 在区间内） |
| 布艺沙发 | `MeshStandardMaterial`，roughness 0.95，无贴图 | `makeFabricTexture` 已存在但**未被调用**；缺 normal |
| 玻璃 | `MeshPhysicalMaterial`，color 0xbfd8ff, roughness 0.05, `transparent:true, opacity:0.12` | 缺 `transmission/ior/thickness` |

### 关键：旧断言 `room.test.ts:87` 是错的，必须推翻

```ts
// 不得用 transmission：它只在 transparent=true 时生效，而旧实现的
// `transmission + transparent:false` 组合会让玻璃退化成纯白不透明面。
expect(mat.transmission ?? 0).toBe(0);
```

**这条断言是错的。** 我读了 `node_modules/three/src/renderers/webgl/WebGLMaterials.js:413-521`（`refreshUniformsPhysical`）和 `WebGLRenderStates.js:60`：transmission 走**独立的 `transmissionRenderTarget`**，渲染器先把场景渲到一个 RT，再让物理材质通过 `transmissionSamplerMap` 采样那个 RT 做折射。这跟 `transparent` 完全无关。P8a 的「死白窗」根因是当时**没有用 transmission，只用了 `opacity: 0.12` 的半透明白色矩形**——那不是 transmission 的副作用，是没用 transmission 的后果。

three 版本已确认：**0.186.0**。字段签名从 `node_modules/three/src/materials/MeshPhysicalMaterial.js` 直接确认存在：`transmission`、`transmissionMap`、`thickness`、`thicknessMap`、`ior`（默认 1.5）、`clearcoat`、`clearcoatRoughness`。`MeshStandardMaterial.js` 确认 `normalMap`、`normalScale`（默认 Vector2(1,1)）、`roughnessMap` 存在。

**所以：删掉 `room.test.ts:87` 那条断言，改成断言 `transmission === 1.0`。** 玻璃同时保留 `transparent: true`（无害，且保证 transparent pass 正确排序），但 `opacity` 保持较高（0.85–1.0）——传 `opacity: 0.12` 配合 `transmission: 1.0` 会让折射结果被 0.12 的 alpha 再压淡一遍。

## 交付物

### 1. `src/render/materials.ts` — 新增木地板 normal / roughness 生成

沿用现有架构（纯函数可测 + canvas 薄壳 + jsdom 返回 null）：

**新增纯函数 `woodFloorNormalColor(u, v, plank)`**：
- 板缝处（`v` 接近 0/1）→ 强凹陷法线偏移（`tx/ty` 大），模拟板缝深度
- 板内 → 沿板长方向（`u`）的细木纹低频起伏，幅度小
- 返回单位法线编码（R/G 偏 128，B 接近 255），与 `wallNormalColor` 同约定

**新增纯函数 `woodFloorRoughnessColor(u, v, plank)`**：
- 板缝处更光滑（颜色暗）；板内略粗，木纹方向微变
- 返回单通道值写入 R/G/B（灰度），**用 `NoColorSpace`**（数据贴图，线性空间）

**新增工厂 `makeWoodFloorNormalTexture(settings)` / `makeWoodFloorRoughnessTexture(settings)`**：
- 复用 `makeWoodFloorTexture` 的 tile/plank 几何（板数、板高 px、板相位偏移算法完全一致），保证三张贴图的板缝位置对齐
- normal 贴图 `NoColorSpace`；roughness 贴图 `NoColorSpace`
- 都 `RepeatWrapping` + 相同 `repeat`

**新增纯函数 `fabricNormalColor(x, y)`**：
- 织物经纬纹的法线化：`sin(x*a) * sin(y*b)` 型织纹，两方向凸起
- 单位法线编码，同 `wallNormalColor` 约定
- 幅度比墙面大一点（布纹比乳胶漆明显），但要保证 `B ∈ [230, 255]`

**新增工厂 `makeFabricNormalTexture(baseColor, resolution)`**：注意法线贴图不吃颜色，去掉 baseColor 参数更干净（与 `makeWallNormalTexture` 一致）

`makeFabricTexture` 已存在，保留不动（布艺的 albedo 用它）。

### 2. `src/render/room.ts` — 木地板三件套 + 玻璃 transmission

**`RoomBuildOptions` 新增**：`floorNormalTexture?: CanvasTexture | null`、`floorRoughnessTexture?: CanvasTexture | null`（与现有 `floorTexture`/`wallNormalTexture` 同模式，供测试注入与 jsdom 兜底）

**木地板材质**：
```ts
floorMaterial.roughness = 0.40;   // 已在区间中值
floorMaterial.clearcoat = 0.15;   // 规格：可选 clearcoat 0.15 → 取 0.15
floorMaterial.clearcoatRoughness = 0.4;
floorMaterial.normalMap = floorNormalTex;
floorMaterial.normalScale = new Vector2(0.6, 0.6);
floorMaterial.roughnessMap = floorRoughnessTex;
```
注意：`MeshStandardMaterial` **不支持** `clearcoat`（那是 `MeshPhysicalMaterial` 的字段）。地板要用 clearcoat 就得把 `floorMaterial` 换成 `MeshPhysicalMaterial`。确认过 three 0.186 里 `MeshPhysicalMaterial extends MeshStandardMaterial`，所以现有用法不破坏。**但注意现有测试可能断言 `floor.material instanceof MeshStandardMaterial`——`MeshPhysicalMaterial` 是其子类，`instanceof` 依然为 true，不会破。**

贴图缺省自动创建（与 `wallNormalTex` 同模式）：
```ts
const floorNormalTex = floorNormalTexture ?? makeWoodFloorNormalTexture();
const floorRoughnessTex = floorRoughnessTexture ?? makeWoodFloorRoughnessTexture();
if (floorNormalTex) { floorMaterial.normalMap = floorNormalTex; ... }
```

**玻璃材质**（`buildNorthWindow` 内）：
```ts
const glassMaterial = new MeshPhysicalMaterial({
  color: 0xffffff,
  metalness: 0.0,
  roughness: 0.05,
  transmission: 1.0,
  ior: 1.5,
  thickness: 0.01,
  transparent: true,
  opacity: 1.0,
});
```
保留 `castShadow = false`、`renderOrder = 999`。删掉旧注释里「不能用 transmission」的错误论断，换成正确的机制说明（transmission 走独立 RT，与 transparent 无关）。

**布艺材质**（`src/render/furniture.ts` 的 `fabric`）：
```ts
const fabricMat = new MeshStandardMaterial({ color: 0x6f7f8f, roughness: 0.95, metalness: 0.0 });
const fabTex = makeFabricTexture(0x6f7f8f);
if (fabTex) fabricMat.map = fabTex;
const fabNormal = makeFabricNormalTexture();
if (fabNormal) { fabricMat.normalMap = fabNormal; fabricMat.normalScale = new Vector2(0.5, 0.5); }
```
注意 `furniture.ts` 里 `fabric` 是 `armchair()` 内创建的、被多处共享——改成创建一次复用（现在已是共享的，确认没有每部分重建）。

### 3. 跳过项：混凝土

规格列了 6 张含混凝土（roughness 0.70 + 微 normal），但**当前场景没有任何混凝土表面**（地面是木地板，墙是乳胶漆，无清水混凝土墙面）。不凭空造一个混凝土几何体来凑数——那是假工作量。**在最终报告里说明这一项因场景无对应表面而跳过**，并在代码里留一句注释标记。

## 测试要求

`src/render/__tests__/materials.test.ts`（纯函数，jsdom 可跑）：
- `woodFloorNormalColor`：`B ∈ [230,255]`；板缝处偏移 > 板中央偏移
- `woodFloorRoughnessColor`：输出 `[0,255]`；板缝处比板中央低（更光滑）
- `fabricNormalColor`：`B ∈ [230,255]`；r/g 围绕 128 波动且幅度 > `wallNormalColor`（布纹比乳胶漆明显）

`src/render/__tests__/room.test.ts`：
- **删掉 line 87 的 `expect(mat.transmission ?? 0).toBe(0)`**，改为 `expect(mat.transmission).toBe(1.0)`、`expect(mat.ior).toBe(1.5)`、`expect(mat.thickness).toBe(0.01)`
- 新增：地板 material 有 `normalMap` 和 `roughnessMap`（jsdom 下 canvas 返回 null，所以这两个断言只能断言「贴图注入后非 null」——用 `buildRoom(5,4,2.8,{ withWindow:true, floorNormalTexture: mockTex, floorRoughnessTexture: mockTex })` 注入假贴图来测接线，不要断言工厂产物）
- 新增：地板 `roughness ∈ [0.35, 0.45]`、`clearcoat === 0.15`

`src/render/__tests__/furniture.test.ts`（若存在）：布艺材质有 `map` 和 `normalMap`（同样用注入方式测接线）

**jsdom 限制提醒**：`canvas.getContext('2d')` 在 jsdom 返回 null，所以 `makeWoodFloorNormalTexture` 等工厂在单测里返回 null。**不要写测试直接调用工厂断言非 null**——那在 jsdom 下必然失败。工厂的健壮性由「返回 null 而非抛错」保证。贴图接线通过向 `buildRoom` 注入 mock `CanvasTexture` 来测。

## 验证

```bash
npm run verify   # typecheck + lint + 456 tests（新增后应更多）
npm run build
```

**视觉验收我无法做**（WSL 只有 SwiftShader，无 NVIDIA ICD），所以下列必须由父级在真实 GPU 上核对：
- 木地板有没有出现板缝高光带（roughnessMap 生效的证据）
- 窗玻璃能看到外面的天空/太阳圆盘折射（transmission 生效的证据）
- 沙发有没有布纹立体感

父级验证手段：`window.__luminaReady` 暴露 engine/backend，可读 `scene.traverse()` 里各 mesh 的 `material.normalMap !== null`、`material.roughnessMap !== null`、`material.transmission`。

## 红线

1. **不要动 `scene.environment` / `initEnvironment` / `environmentIntensity`**（P12 已定版 0.55）
2. **不要动 `lightBuilder.ts` 的 `case 'cone'`**（灯罩几何，非体积光）
3. **不要动 `setLightShaftVisible` / godrays 参数**（P13 已定版）
4. **不要降低墙面 roughness**（0.90 是规格值）
5. **不要给地板加 `transparent: true`**（会导致阴影接收异常 + 排序问题）
6. **保留 `buildRoom` 无窗时的 6 Mesh 结构**（sceneEngine 有断言）
7. **不要造混凝土几何体**（场景无此表面）
8. **不要把新贴图生成放进单测主路径**（jsdom canvas 返回 null）

## 提交

commit message 风格参考 `38b6df4`（中文标题 + 要点列表）。**不要 push**。
