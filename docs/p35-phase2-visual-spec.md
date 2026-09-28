# P35 — Phase 2 · 资产与调色（画面质变）

> 属于 `Lumina项目审查与后续工作方案.md` §二 Phase 2。
> 方案原文：**「资产管线 V1」「GradePass 全局调色层」「程序化家具退役」「验收矩阵」**。
> 前一轮 P34 完成了 Phase 3 主线（批量布灯 + 光源预算 + 场景预设 + 照度伪彩）。
> Phase 2 是产品画面从「白模」到「样板间」的**唯一跃迁路径**——功能已经完整，
> 用户第一眼看到的画面却是程序化方块家具 + 无 HDRI 的死白环境，产品信任度差。

---

## 0. 现状（代码级确认）

| 项 | 现状 | 证据 |
|---|---|---|
| 家具 | `src/render/furniture.ts` 程序化方块 + 圆柱 + 圆锥；沙发 = 3 个 Box，床 = 1 个 Box，餐桌 = 圆柱 + 圆盘 | `src/render/furniture.ts` |
| 植物 | 圆锥体 | `src/render/plants.ts` |
| HDRI | 无；用 `RoomEnvironment + PMREM` 生成 IBL（不是真实场景） | `sceneEngine.initEnvironment()` |
| GLTF | 无 loader 依赖；`package.json` 未装 `three-stdlib` 等 | `package.json` |
| 后期调色 | 只有 Bloom + Godrays；无 GradePass / ColorGrading | `src/render/postProcessing.ts` |
| 场景预设映射 | P34 Part C 已完成，可驱动 GradePass 参数切换 | `src/core/circuitMapping.ts` |
| KTX2 / Draco | 无 | 同上 |

**判断**：Phase 2 的视觉冲击主要来自 3 件事——**HDRI 环境**（画面立刻像样板间）、**GradePass**（参数化后期让每个预设自带调色调色）、**GLTF 家具**（去掉白模味）。三者独立，可以并行推进。

---

## 1. 关键决策（**必须等你回复再派子代理**）

### 决策 1：HDRI / GLTF 资产来源

方案原文明确说：

> 「5 件核心家具（沙发/床/餐桌/椅/柜）+ 3 张 2K HDRI（黄金时刻那张必须有），
> 全部 CC0（Poly Haven / ambientCG / Quaternius / Kenney，可商用无需署名）」

但**我这边的网络环境**已验证：
- ✅ `unpkg.com`（CDN）可访问
- ✅ `github.com` 可访问
- ❌ `dl.polyhaven.org` **超时**
- ❌ `huggingface.co` **超时**
- ❌ `quaternius.com` **超时**
- ❌ `raw.githubusercontent.com` **超时**
- ⚠️ `ambientcg.com` 可访问但具体文件下载未验证
- ⚠️ `cgtrader.com` 返回 200 但 content-length: 0

**三条路径，你选一个**：

- **A. 用 GitHub 上的开源仓库兜底**：three.js 官方仓库本身有大量 GLTF 示例（`three/examples/models/`），HDRI 在 `three/examples/textures/equirectangular/`——这些能拉通，但**都是 1K 分辨率**，且是 three.js 作者的授权示例（不是 CC0 严格意义上），适合演示但不够"真实"。
- **B. 你在 Windows 侧下载到 `public/`**：Poly Haven / ambientCG 官网有下载页，你在自己网络下手动下载 3 张 2K HDR + 5 个 GLTF 放到 `public/assets/hdris/` 和 `public/assets/furniture/`，我这边只做加载管线。这条路径最"正"，符合方案原文的 CC0 要求。
- **C. 先做纯程序化，跳过资产**：GradePass + 场景预设映射做透，HDRI 和 GLTF 留到 Phase 2b。**产品演示画面差**，但至少工程干净。

我推荐 **B**——方案原文就是这个路线，你网络能通；我这边负责写好 loader + KTX2 管线 + 分级加载，等你把文件放好立刻接上。**若你选 A 或 C，我立刻按对应路径写规格。**

### 决策 2：GradePass 参数

方案原文说「色温/对比/饱和/暗角」四个参数按预设切换。我倾向再加两个：

- `vignetteStrength`（0..1）—— 暗角强度
- `whiteBalanceShift`（-1..1，冷↔暖）—— 覆盖色温偏移，与 fixture CCT 解耦

共 **6 个参数**：`temperature / contrast / saturation / vignetteStrength / whiteBalanceShift / luminanceGamma`。写进 SceneDefinition 的 `grade` 字段。

**你 OK 吗？** 如果只要方案里的 4 个，我砍到 4 个（去掉 whiteBalanceShift 和 luminanceGamma）。

---

## 2. 交付物

### Part A — HDRI 管线（等待决策 1）

#### `src/render/hdriLoader.ts`（新增）

```ts
/**
 * HDRI 环境加载（Phase 2 §1）。
 *
 * 三档 HDRI 库：
 *   - 'venice_sunset_2k'   — 黄金时刻（方案 §1 原文要求"必须有"）
 *   - 'quarry_2k'          — 白昼（默认白天场景）
 *   - 'venice_night_2k'    — 夜晚（默认夜间场景）
 *
 * 路径固定 `/assets/hdris/<name>.hdr`；Vite 打包后走 public/ 静态目录。
 *
 * 策略：
 *   1. 首屏加载 'quarry_2k'（默认白天）
 *   2. 太阳高度角 < π/12 时切换到 'venice_sunset_2k'
 *   3. 太阳高度角 < 0 时切换到 'venice_night_2k'
 *   4. PMREMGenerator.fromEquirectangular() 生成立方体贴图缓存
 */
import * as THREE from 'three';

export type HDRIKey = 'venice_sunset_2k' | 'quarry_2k' | 'venice_night_2k';

export const HDRI_LIST: HDRIKey[] = ['venice_sunset_2k', 'quarry_2k', 'venice_night_2k'];

export function getHdriUrl(key: HDRIKey): string {
  return `/assets/hdris/${key}.hdr`;
}

let cache: Partial<Record<HDRIKey, THREE.Texture>> = {};
let pmrem: THREE.PMREMGenerator | null = null;

export function loadHdri(key: HDRIKey, renderer: THREE.WebGLRenderer): Promise<THREE.Texture> {
  if (cache[key]) return Promise.resolve(cache[key]!);
  if (!pmrem) pmrem = new THREE.PMREMGenerator(renderer);
  
  return new Promise((resolve, reject) => {
    const loader = new THREE.RGBELoader();
    loader.load(
      getHdriUrl(key),
      (texture) => {
        const envMap = pmrem!.fromEquirectangular(texture).texture;
        texture.dispose();
        cache[key] = envMap;
        resolve(envMap);
      },
      undefined,
      (err) => reject(err),
    );
  });
}
```

`RGBELoader` 走 `three/addons/loaders/RGBELoader.js`（three 官方自带，无需额外依赖）。

### Part B — GradePass（决策 2 后定稿）

#### `src/render/gradePass.ts`（新增）

```ts
/**
 * 参数化后期调色 Pass（Phase 2 §2）。
 *
 * **参数属于系统，不属于场景**——这是替代"样板间手工调校"的机制。
 * 参数按 SceneDefinition.grade 切换，跨预设平滑插值（与场景动画共享
 * `sceneController.tick` 通道）。
 */
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export interface GradeParams {
  /** 色温偏移（-1 冷 .. 1 暖），默认 0 */
  temperature: number;
  /** 对比度（0..2，1 = 无变化），默认 1 */
  contrast: number;
  /** 饱和度（0..2，1 = 无变化），默认 1 */
  saturation: number;
  /** 暗角强度（0..1），默认 0.15 */
  vignetteStrength: number;
  /** 白平衡偏移（-1 蓝 .. 1 红），默认 0 */
  whiteBalanceShift: number;
  /** 亮度伽玛（0.5..2，1 = 无变化），默认 1 */
  luminanceGamma: number;
}

export const DEFAULT_GRADE: GradeParams = {
  temperature: 0,
  contrast: 1,
  saturation: 1,
  vignetteStrength: 0.15,
  whiteBalanceShift: 0,
  luminanceGamma: 1,
};

/** 4 个预设的 Grade 参数（方案 §Phase 2 §2） */
export const PRESET_GRADE: Record<string, GradeParams> = {
  reception: { temperature: 0.1,  contrast: 1.05, saturation: 1.1,  vignetteStrength: 0.15, whiteBalanceShift: 0.05, luminanceGamma: 1.0 },
  cinema:    { temperature: -0.05, contrast: 1.15, saturation: 0.9,  vignetteStrength: 0.4,  whiteBalanceShift: -0.1, luminanceGamma: 0.9 },
  reading:   { temperature: 0.15, contrast: 1.1,  saturation: 1.05, vignetteStrength: 0.2,  whiteBalanceShift: 0.08, luminanceGamma: 1.0 },
};

// …… shader material + render 实现（略，见规格附录 B）……

export class GradePass extends Pass {
  params: GradeParams = { ...DEFAULT_GRADE };
  // ……
}
```

**注意**：`SceneDefinition` 需要新增可选字段 `grade?: GradeParams`。修改 `src/core/types.ts`：

```ts
export interface SceneDefinition {
  key: string;
  name: string;
  transitionMs: number;
  levels: Record<string, number>;
  cct: Record<string, number>;
  exposure?: number;
  grade?: GradeParams;  // P35 新增
}
```

在 `postProcessing.ts` 的 EffectComposer 链末尾（OutputPass 之后）追加 `GradePass`。

### Part C — GLTF 家具加载（等待决策 1）

#### `src/render/furnitureAssets.ts`（新增）

```ts
/**
 * GLTF 家具资产（Phase 2 §3）。
 *
 * 5 件核心家具（方案 §1 原文）：
 *   - sofa.glb     — 沙发（客厅）
 *   - bed.glb      — 双人床（主卧）
 *   - table.glb    — 餐桌（餐厅）
 *   - chair.glb    — 餐椅
 *   - cabinet.glb  — 柜子
 *
 * 减面到 20k 面以内；贴图 KTX2（未压缩 2K RGBA = 16MB 显存，浏览器崩）。
 * 首屏核心包 ≤8MB。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

export type FurnitureKey = 'sofa' | 'bed' | 'table' | 'chair' | 'cabinet';
export const FURNITURE_LIST: FurnitureKey[] = ['sofa', 'bed', 'table', 'chair', 'cabinet'];

let loader: GLTFLoader | null = null;

function ensureLoader(renderer: THREE.WebGLRenderer): GLTFLoader {
  if (loader) return loader;
  loader = new GLTFLoader();
  
  const draco = new DRACOLoader();
  draco.setDecoderPath('/vendor/draco/');
  loader.setDRACOLoader(draco);
  
  const ktx2 = new KTX2Loader();
  ktx2.detectSupport(renderer);
  loader.setKTX2Loader(ktx2);
  
  return loader;
}

export async function loadFurniture(key: FurnitureKey, renderer: THREE.WebGLRenderer): Promise<THREE.Group> {
  const l = ensureLoader(renderer);
  const gltf = await l.loadAsync(`/assets/furniture/${key}.glb`);
  // 归一化：让包围盒高度 = 1m（家具按真实尺寸），位置由调用方设
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const height = box.max.y - box.min.y;
  const scale = height > 0 ? 1.0 / height : 1;
  gltf.scene.scale.setScalar(scale);
  return gltf.scene;
}
```

**关键**：`GLTFLoader / DRACOLoader / KTX2Loader` 都是 `three/addons/` 下的，three.js 0.186 官方自带，无需额外 npm 依赖。**方案原文说"GLTF 走 Draco"是必要的——GLB 未压缩通常 2-5MB，加 Draco 后能压到 500KB-1MB**。

**降级策略**：如果 `loadFurniture` 抛错（网络失败、文件缺失），fallback 到现有 `furniture.ts` 程序化方块。这在 `App.tsx` 家具加载的地方用 try/catch 包住即可。

### Part D — 家具放置改造

现有 `src/render/furniture.ts` 的 `makeSofa / makeBed / …` 函数**保留**作为 fallback，但主路径改为查 asset cache：

```ts
// 在 sceneEngine.initFurniture() 或 buildDecor() 里
try {
  const sofa = await loadFurniture('sofa', renderer);
  sofa.position.copy(position);
  // 靠墙吸附：包围盒距墙 <80mm 自动贴合 + 对齐墙法向（方案 §3 原文）
  snapToFurnitureWall(sofa, model.walls);
  scene.add(sofa);
} catch (e) {
  console.warn('[furniture] GLTF 加载失败，使用程序化 fallback', e);
  scene.add(makeSofaFallback()); // 现有 furniture.ts
}
```

新增 `snapToFurnitureWall(obj, walls)`：`obj` 的 bounding box 与最近墙的距离 <0.08m 时，把 `obj.position` 贴到墙面 + 用四元数对齐墙法线。

---

## 3. 明确不做（P35 排除项）

- **不做** KTX2 手动转码脚本——依赖 polyhaven 提供 .ktx2 版本或直接用 .hdr / .png。KTX2 是"如果有的话"的优化，不是必需。
- **不做** Draco decoder 内置——用 CDN 或 `/vendor/draco/` 静态目录；DRACO wasm 由 three-stdlib 自带，无需手工处理。
- **不做** 家具减面脚本——依赖 polyhaven 提供的已经是低模。
- **不做** 家具电商化（SKU 采购清单）——`Fixture.source: 'sku'` 字段已有，但不做实际 SKU 数据。
- **不做** 2D/3D 双视图联动——那属于 Phase 3 §3，是 P36。
- **不做** HDRI 手动切换 UI——由太阳高度角自动切换（决策 1 决定后可能需要改）。

## 4. 红线

- `CLAUDE.md` / `vite.config.ts` / `tsconfig.json` / `package.json` / `package-lock.json` 不动
- **不新增 npm 依赖**（three/addons 下已有的直接 import）
- `src/lighting/illuminance.ts` 不改现有函数体
- `src/lighting/heatmap.ts` 不改（P34 已交付）
- `src/core/circuitMapping.ts` 只允许追加 grade 字段映射，不改 presetTarget 逻辑
- `src/render/godrays.ts` 不改
- 现有测试断言不改
- 不 push

## 5. 验证

1. `npm run typecheck` — 0 error
2. `npm run lint` — 本次改动文件 0 error
3. `npm test` — 全绿，测试数 ≥ 912
4. `npm run build` — 通过，仍 2 chunk（GLTFLoader / KTX2Loader 属于 three/addons，走 three-*.js chunk）
5. **手动验收**（真 GPU，Windows 桌面浏览器）：
   - 默认工程加载后 3D 视口出现**真实环境光**（不是死白）
   - 点击"观影"预设 → 画面变暗 + 对比度提升 + 暗角加强
   - 点击"会客"预设 → 色温暖 + 饱和度略高
   - 时间调到 22:00 → 环境光自动切到夜景 HDRI

## 6. 待你回复后启动

- **决策 1**：HDRI / GLTF 资产来源选 A / B / C
- **决策 2**：GradePass 6 参数 or 4 参数

回复后我立刻写详细执行规格 + 派子代理。

---

## 附录 A — 与方案 Phase 2 的映射

| 方案 §Phase 2 | 本次 P35 | 后续 |
|---|---|---|
| 2.1 资产管线 V1：5 家具 + 3 HDRI | Part A + Part C（等决策） | 下一轮可扩展到 10 家具 |
| 2.2 GradePass 全局调色层 | Part B | — |
| 2.3 程序化家具退役 | Part D（GLTF 主路径 + 程序化 fallback） | — |
| 2.4 验收矩阵：5 场景 × 3 时刻 = 15 张 | ❌ 不做，属演示阶段 | 演示前人工拍 |

## 附录 B — GradePass shader 草案

```glsl
// fragment
uniform sampler2D tDiffuse;
uniform float uTemperature;
uniform float uContrast;
uniform float uSaturation;
uniform float uVignette;
uniform float uWhiteBalance;
uniform float uGamma;
varying vec2 vUv;

vec3 applyTemperature(vec3 c, float t) {
  // 简单色温补偿：负偏冷（蓝），正偏暖（红）
  c.r += t * 0.15;
  c.b -= t * 0.15;
  return c;
}

vec3 applyContrast(vec3 c, float k) {
  return clamp((c - 0.5) * k + 0.5, 0.0, 1.0);
}

vec3 applySaturation(vec3 c, float k) {
  float g = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(g), c, k);
}

void main() {
  vec4 tex = texture2D(tDiffuse, vUv);
  vec3 c = tex.rgb;
  c = applyTemperature(c, uTemperature);
  c = applyContrast(c, uContrast);
  c = applySaturation(c, uSaturation);
  // 白平衡偏移（-1 蓝 .. 1 红）
  c = mix(c * vec3(0.85, 0.9, 1.15), c * vec3(1.15, 0.95, 0.85), uWhiteBalance * 0.5 + 0.5);
  c = pow(c, vec3(uGamma));
  // 暗角
  vec2 d = vUv - 0.5;
  float vig = 1.0 - uVignette * dot(d, d) * 4.0;
  c *= clamp(vig, 0.0, 1.0);
  gl_FragColor = vec4(c, tex.a);
}
```

## 附录 C — SceneDefinition.grade 字段

在 `src/core/types.ts`：

```ts
export interface SceneDefinition {
  key: string;
  name: string;
  transitionMs: number;
  levels: Record<string, number>;
  cct: Record<string, number>;
  exposure?: number;
  grade?: GradeParams;  // Phase 2 新增，可选
}
```

在 `src/core/circuitMapping.ts` 的 `presetToSceneDefinition`：

```ts
export function presetToSceneDefinition(
  fixtures: Iterable<Fixture>,
  preset: PresetId,
  transitionMs = 800,
): SceneDefinition {
  // ……原有逻辑……
  return {
    key: preset,
    name: meta.name,
    transitionMs,
    levels,
    cct,
    grade: PRESET_GRADE[preset],  // 新增
  };
}
```

## 附录 D — 场景预设 → GradePass 的动画

`sceneController.tick` 已经在做 `sceneLevels / cct` 的 easeInOut 插值。扩展为同时插值 `grade`：

```ts
// tick 内追加
if (transition.from.grade && transition.to.grade) {
  const target: GradeParams = {};
  for (const key of Object.keys(DEFAULT_GRADE) as (keyof GradeParams)[]) {
    target[key] = lerp(transition.from.grade[key], transition.to.grade[key], ratio);
  }
  this.engine.setGrade(target);
}
```

`SceneEngine.setGrade` 写入 `postProcessing.gradePass.params`。
