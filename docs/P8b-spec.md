# P8b — 体积光与尘埃粒子 实施规格（草稿，待 P8a 落地后校准）

> 交给 Claude Code 执行。先读 `CLAUDE.md`，再读本文件。
> 前置：P8a 必须已完成且 `npm run verify` 全绿、首屏可读。

## 目标

对标参考项目 2「日落收藏家」的核心视觉：**落日穿过落地玻璃窗，在室内空气中形成
可见的体积光束，光柱里有漂浮的尘埃粒子**。这是"画面高级感"的最大来源——
P8a 只能给光斑，给不了光柱。

同时补两个 P8a 做不了的点：**灯具自身可见发光**（灯是个亮点，不是隐形光源）、
**阴影边缘不硬**。

## 已知的可疑点（必须先审计，不要直接叠加）

P7 已经实现了 `src/render/godrays.ts` 的 `GodraysPass`（屏幕空间 ray marching +
深度纹理遮挡），接线在 `src/render/postProcessing.ts`：
`RenderPass → GodraysPass → UnrealBloomPass → OutputPass`。

**但这套东西现在很可能完全看不见**，理由（请逐条验证）：

1. `GodraysPass` 的光源屏幕位置由 `App.tsx` 的 `setFrameCallback` 投影太阳世界坐标得到，
   且**只有 `engine.getSunIntensity() > 0` 且 `ndc.z < 1` 才更新**。太阳在窗外很远时
   `ndc.z` 可能是负数或大于 1，位置永远停在默认值 → 光柱方向错误。
2. `UnrealBloomPass` 的 `threshold = 0.85`。Godrays 叠出的光柱亮度通常远低于 0.85，
   所以即使 godrays 算对了，bloom 也不放大它 → 肉眼几乎不可见。
3. Godrays 采样的是**场景深度**，需要 `godraysRT` 有正确的深度纹理。
   若相机近裁剪面 0.1、远裁剪面 100，深度精度在窗边可能不足。

**第一步：审计。** 在 dev 服务器起来后，把 godrays density 调到 1.0、weight 调到 10、
sampleCount 调到 64，时间设 17:30，截图看有没有光柱。把结论写进本文件
（改成"已验证有效，只需调参"或"已验证无效，需重写"），然后再动手。

如果无效，重写的方向（**不要**从零写 shader，先尝试以下改动）：
- `godraysShader` 改为从**固定屏幕锚点**采样，而不是从太阳 NDC 位置
  （太阳在窗外，投影到屏幕可能不可靠）。锚点取窗在屏幕上的中心区域。
- 让 godrays 强度叠加后**直接进 bloom**：把 bloom threshold 降到 0.5，
  strength 提到 0.8，让光柱被辉光放大。
- 若深度采样方案确实不工作，退一步用**锥形几何 + AdditiveBlending** 假体积光
  （一个从窗外射向地板的 `ConeGeometry`/`PlaneGeometry` 梯度，
  `MeshBasicMaterial` + `transparent` + `AdditiveBlending` + `depthWrite=false`，
  用 vertex alpha 或 texture alpha 做出渐隐）。参考项目 2 大概率就是这么做的——
  假体积光在室内设计这个尺度和视角下足够以假乱真，且零 shader 风险、零深度精度问题。
  **优先方案 B（假体积光锥）**，把 P7 的 godrays 保留为可选开关但不作为视觉主力。

## 交付物

### 交付物 1：尘埃粒子系统 `src/render/dustParticles.ts`（新建）

```ts
export interface DustSettings {
  count?: number;        // 默认 350
  volumeSize?: [number, number, number];  // 粒子分布体积，默认 [5, 2.2, 3.5]
  driftSpeed?: number;   // 默认 0.05
  size?: number;         // 默认 0.018（世界单位，sizeAttenuation 开启）
  opacity?: number;      // 默认 0.45
  color?: number;        // 默认 0xffe6b0（暖白，落日里的尘埃）
  seed?: number;         // 默认 7
}

export function buildDustParticles(settings?: DustSettings): Points
```

- 用 `BufferGeometry` + `Float32BufferAttribute('position')` + `PointsMaterial`。
- `PointsMaterial`：`color`、`size`、`sizeAttenuation: true`、`transparent: true`、
  `opacity`、`blending: AdditiveBlending`、`depthWrite: false`、
  `map` = 一张程序化生成的圆形柔化贴图（`CanvasTexture`，64x64，径向渐变白→透明）。
  **必须**设置 `map`——否则粒子是硬边正方形，一眼假。
  复用 P8a 的 `mulberry32` 做确定性分布。
- `Points` 设置 `frustumCulled = false`（体积小，省掉边界框计算）。
- **不要**自定义 ShaderMaterial——保持 `PointsMaterial`，风险最低。

漂移更新（导出一个函数，由引擎的 `setFrameCallback` 每帧调用）：

```ts
export function updateDustPoints(points: Points, deltaSeconds: number, timeSeconds: number): void
```
- 每个粒子：`y += sin(time * a + phase_i) * driftSpeed * delta`，
  `x/z` 也做小幅正弦漂移。漂移量要小（0.05 m/s 量级），
  看起来是"缓缓浮动"而不是"下雨"。
- 粒子超出 volume 边界时 wrap 回对面（toroidal wrap）。
- **不要**每帧 `new` 对象；直接原地改 `geometry.attributes.position.array`，
  然后 `geometry.attributes.position.needsUpdate = true`。

单测 `src/render/__tests__/dustParticles.test.ts`：
- `buildDustParticles()` 返回 `Points`，`geometry.attributes.position.count === count`。
- `material` 是 `PointsMaterial`，`blending === AdditiveBlending`，`depthWrite === false`，
  `transparent === true`。
- `updateDustPoints` 后 position 数组仍全为有限数（无 NaN），且值都落在 volume 范围内。
- 同 seed 两次 `buildDustParticles` 产出相同 position 数组（确定性）。

### 交付物 2：灯具发光可视化 `src/render/lightBuilder.ts`（修改）

当前灯罩 Mesh 是普通 `MeshStandardMaterial`（只反射光，自己不发光）。
在参考项目里，室内灯具都是**可见的发光体**。改法：

- `shadeMat` 增加 `emissive`：
  ```ts
  const { r, g, b } = cctToRGB(kelvin);
  const shadeMat = new MeshStandardMaterial({
    color: new Color(shade.color),
    roughness: shade.roughness,
    metalness: shade.metalness,
    emissive: new Color(r, g, b),
    emissiveIntensity: <按亮度算>,
  });
  ```
- `emissiveIntensity` 需要一个**当前实际亮度**，但 `buildLightFromFixture` 不知道
  当前 level（level 由 `sceneEngine` 管）。**解法**：在 `LightBuildResult` 里新增
  `shade: Mesh` 字段（把 shadeMesh 暴露出来），然后 `sceneEngine` 在
  `setFixtureLevel` 里同步改 `entry.shade.material.emissiveIntensity`。
- 公式建议：`emissiveIntensity = clamp(level, 0, 1) * 3.0 * (shade.intensity ?? 1)`。
  系数 3.0 是为了让灯罩亮度超过 bloom threshold（0.85），能被辉光抓到。
  注意 `MeshStandardMaterial.emissiveIntensity` 可以大于 1（HDR），配合
  ACESFilmic 不会溢出屏幕。
- 灯具 Mesh 保持 `castShadow = false`（不能把自家光照成黑斑，既有红线）。

`sceneEngine` 需要相应改动：`FixtureLightEntry` 增加 `shade: Mesh | null`，
`setFixtureLevel` 里同步 emissiveIntensity，`setFixtureCct` 里同步 emissive 颜色。

### 交付物 3：假体积光锥（若审计判定 godrays 无效则必须做）

`src/render/volumetricShaft.ts`（新建）：

```ts
export function buildLightShaft(
  windowCenter: Vector3,      // 窗中心世界坐标
  floorTarget: Vector3,       // 光柱落在地板上的目标点
  settings?: { color?: number; opacity?: number; width?: number }
): Mesh
```

- 用 `PlaneGeometry`（或 2 个交叉的 plane 做 3D 感）从窗外射向地板。
- `MeshBasicMaterial`：`color`（暖橙 `0xffc080`）、`transparent: true`、
  `opacity: 0.10~0.20`、`blending: AdditiveBlending`、`depthWrite: false`、
  `side: DoubleSide`。
- **必须有 alpha 渐隐**：用 `CanvasTexture` 做一张从窗边不透明到地板端透明的
  线性渐变贴图，赋给 `material.map`（配合 `blending` 起作用）。
  不做渐隐的硬边光锥一眼就假。
- `toneMapped = true`（让它能被 bloom 影响，形成"发亮的光柱"）。
- 光照度联动：光柱透明度应随太阳强度变化——太阳在地平线下时 `opacity = 0`。
  把 mesh 暴露给 engine，`updateSunPosition()` 里改 `material.opacity`：
  `opacity = baseOpacity * clamp(sin(elevation), 0, 1) * 1.4`。
- **只在日落/日出时段可见**（elevation < π/4）——正午的光柱不自然，
  `elevation >= π/4` 时 opacity 归零。

单测 `src/render/__tests__/volumetricShaft.test.ts`：
- `buildLightShaft` 返回 `Mesh`，material 是 `MeshBasicMaterial`，
  `blending === AdditiveBlending`，`depthWrite === false`。
- 两参数相同位置时不抛错（退化几何防御）。
- 若用 canvas 做渐变贴图，把渐变计算抽成纯函数并单测（同 P8a 的 jsdom 约束）。

## 4. 接线（`src/scene/sceneEngine.ts`）

- 构造时构建 dust particles 与 light shaft，加入 `scene`。
- `setFrameCallback`（App 已有）之外，**引擎自己的 `animate` 循环里**也要更新粒子：
  在 `animate` 中 `updateDustPoints(this.dustPoints, deltaTime, time / 1000)`。
- `dispose()` 清理 particles geometry/material、shaft material/map、godraysRT。
- 新增 `setTimeSpeed` 已有；粒子漂移用**真实 dt**，不随 timeSpeed 缩放
  （粒子是物理漂浮，不是虚拟时间）。

## 5. 验证

```bash
npm run verify && npm run build
```

**然后必须截图目测**（Claude Code 无头，做不了这一步，我会做）。
截图判据：17:30 时画面里**能看到从窗外射入的光柱**、**能看到漂浮的粒子**、
**灯具是可见的亮点**。这三条任一不满足就算未完成，回来改。

## 6. 红线

- 不新增 npm 依赖，不新增图片资源（贴图程序化）。
- 不破坏 P8a 的 310+N 个测试。
- 不用自定义 ShaderMaterial（`PointsMaterial` / `MeshBasicMaterial` 足够）。
- 每帧不 `new` 对象；粒子更新原地改 array。
- 体积光与粒子的开关必须能在 UI 关掉（性能保护）——新增两个 toggle 到 `RenderPanel`。
- **不要动 UI 布局与配色**，那是 P8c。

## 7. 提交

单个 commit：`feat(P8b): dust particles, lamp emissive, volumetric light shaft`
不要 push。
