# P35 执行规格（详细）

> 基于 `p35-phase2-visual-spec.md` 起草，本文件给出可粘的完整代码 + 子代理执行顺序。
> 用户已确认：Poly Haven 在 Windows 侧可访问；WSL2 侧 curl 超时。
> **策略**：loader 用相对路径 `/assets/hdris/*.hdr` + `/assets/furniture/*.glb`；
> 若文件缺失，降级到 `RoomEnvironment` IBL + 程序化家具（现有实现保留作为 fallback）。
> **不阻塞用户**：子代理先把 loader + fallback + GradePass 做完提交；HDRI/GLTF 文件
> 由用户在 Windows 侧手动 curl 下载后放 `public/assets/hdris/` 和 `public/assets/furniture/`。

---

## Part B — GradePass（6 参数）

### B.1 `src/render/gradePass.ts`（新增）

```ts
/**
 * 参数化后期调色 Pass（Phase 2 §2，P35）。
 *
 * 参数属于系统，不属于场景——按 SceneDefinition.grade 切换。
 * 跨预设平滑插值走 sceneController.tick 的 easeInOut 通道（与 levels/cct 同批）。
 *
 * 6 个参数：
 *   - temperature        （-1 冷 .. 1 暖），默认 0
 *   - contrast           （0..2，1 = 无变化），默认 1
 *   - saturation         （0..2，1 = 无变化），默认 1
 *   - vignetteStrength   （0..1），默认 0.15
 *   - whiteBalanceShift  （-1 蓝 .. 1 红），默认 0
 *   - luminanceGamma     （0.5..2，1 = 无变化），默认 1
 */
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export interface GradeParams {
  temperature: number;
  contrast: number;
  saturation: number;
  vignetteStrength: number;
  whiteBalanceShift: number;
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

export const PRESET_GRADE: Record<string, GradeParams> = {
  reception: {
    temperature: 0.1,
    contrast: 1.05,
    saturation: 1.1,
    vignetteStrength: 0.15,
    whiteBalanceShift: 0.05,
    luminanceGamma: 1.0,
  },
  cinema: {
    temperature: -0.05,
    contrast: 1.15,
    saturation: 0.9,
    vignetteStrength: 0.4,
    whiteBalanceShift: -0.1,
    luminanceGamma: 0.9,
  },
  reading: {
    temperature: 0.15,
    contrast: 1.1,
    saturation: 1.05,
    vignetteStrength: 0.2,
    whiteBalanceShift: 0.08,
    luminanceGamma: 1.0,
  },
};

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uTemperature;
  uniform float uContrast;
  uniform float uSaturation;
  uniform float uVignette;
  uniform float uWhiteBalance;
  uniform float uGamma;
  varying vec2 vUv;

  vec3 applyTemperature(vec3 c, float t) {
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
    c = mix(c * vec3(0.85, 0.9, 1.15), c * vec3(1.15, 0.95, 0.85), uWhiteBalance * 0.5 + 0.5);
    c = pow(c, vec3(uGamma));
    vec2 d = vUv - 0.5;
    float vig = 1.0 - uVignette * dot(d, d) * 4.0;
    c *= clamp(vig, 0.0, 1.0);
    gl_FragColor = vec4(c, tex.a);
  }
`;

export class GradePass extends Pass {
  material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      tDiffuse: { value: null as THREE.Texture | null },
      uTemperature: { value: DEFAULT_GRADE.temperature },
      uContrast: { value: DEFAULT_GRADE.contrast },
      uSaturation: { value: DEFAULT_GRADE.saturation },
      uVignette: { value: DEFAULT_GRADE.vignetteStrength },
      uWhiteBalance: { value: DEFAULT_GRADE.whiteBalanceShift },
      uGamma: { value: DEFAULT_GRADE.luminanceGamma },
    },
  });

  private quad = new FullScreenQuad(this.material);

  params: GradeParams = { ...DEFAULT_GRADE };

  setParams(p: Partial<GradeParams>): void {
    Object.assign(this.params, p);
    this.material.uniforms.uTemperature.value = this.params.temperature;
    this.material.uniforms.uContrast.value = this.params.contrast;
    this.material.uniforms.uSaturation.value = this.params.saturation;
    this.material.uniforms.uVignette.value = this.params.vignetteStrength;
    this.material.uniforms.uWhiteBalance.value = this.params.whiteBalanceShift;
    this.material.uniforms.uGamma.value = this.params.luminanceGamma;
  }

  render(
    renderer: THREE.WebGLRenderer,
    readBuffer: THREE.WebGLRenderTarget,
    _writeBuffer: THREE.WebGLRenderTarget,
    _maskActive: boolean,
  ): void {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(readBuffer); // GradePass 是链末，原地写回
    this.quad.render(renderer);
  }

  dispose(): void {
    this.material.dispose();
    this.quad.dispose?.();
  }
}

/** 用于场景预设之间的 lerp（sceneController.tick 复用） */
export function lerpGrade(a: GradeParams, b: GradeParams, t: number): GradeParams {
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return {
    temperature: lerp(a.temperature, b.temperature),
    contrast: lerp(a.contrast, b.contrast),
    saturation: lerp(a.saturation, b.saturation),
    vignetteStrength: lerp(a.vignetteStrength, b.vignetteStrength),
    whiteBalanceShift: lerp(a.whiteBalanceShift, b.whiteBalanceShift),
    luminanceGamma: lerp(a.luminanceGamma, b.luminanceGamma),
  };
}
```

### B.2 `src/render/postProcessing.ts` 集成

- 在 EffectComposer 链末尾（`OutputPass` 之后）追加 `new GradePass()`
- `createComposer` 返回值里加 `gradePass` 字段供 sceneEngine 访问

### B.3 `src/core/types.ts` SceneDefinition 追加

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

### B.4 `src/core/circuitMapping.ts` 追加 grade 映射

`presetToSceneDefinition` 返回时加 `grade: PRESET_GRADE[preset]`。

### B.5 `src/scene/sceneEngine.ts` 追加

```ts
setGrade(params: Partial<GradeParams>): void {
  this.gradePass?.setParams(params);
}

getGrade(): GradeParams {
  return this.gradePass?.params ?? DEFAULT_GRADE;
}
```

`rebuildFromModel` / `rebuildRoom` 不需要重建 GradePass（它无状态）；只在 `initPostProcessing` 里建一次。

### B.6 `src/scene/sceneController.ts` tick 追加 grade 插值

```ts
// 在现有 levels/cct lerp 之后
if (transition.from.grade && transition.to.grade) {
  this.engine.setGrade(lerpGrade(transition.from.grade, transition.to.grade, ratio));
}
```

`SceneSystem.transition.from` 与 `.to` 需扩 `grade?: GradeParams`。从 `presetToSceneDefinition` 已经写入 `project.scenes`，直接读即可。

---

## Part C — HDRI loader（Poly Haven 兜底）

### C.1 `src/render/hdriLoader.ts`（新增）

```ts
/**
 * HDRI 环境加载（Phase 2 §1，P35）。
 *
 * Poly Haven CC0 资产，2K equirectangular HDR。
 * 文件路径：/assets/hdris/{key}.hdr（Vite public/ 静态目录）。
 *
 * 三档：
 *   - venice_sunset_2k   — 黄金时刻（方案 §1 原文要求"必须有"）
 *   - quarry_2k          — 白昼
 *   - venice_night_2k    — 夜晚
 *
 * **降级**：若 loadAsync 抛错（文件缺失），返回 null，调用方保留 PMREM(RoomEnvironment)
 * 作为兜底（现有 sceneEngine.initEnvironment 已经用）。
 */
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

export type HDRIKey = 'venice_sunset_2k' | 'quarry_2k' | 'venice_night_2k';
export const HDRI_LIST: HDRIKey[] = ['venice_sunset_2k', 'quarry_2k', 'venice_night_2k'];

export function getHdriUrl(key: HDRIKey): string {
  return `/assets/hdris/${key}.hdr`;
}

let cache: Partial<Record<HDRIKey, THREE.Texture>> = {};
let pmremGen: THREE.PMREMGenerator | null = null;

export async function loadHdri(
  key: HDRIKey,
  renderer: THREE.WebGLRenderer,
): Promise<THREE.Texture | null> {
  const cached = cache[key];
  if (cached) return cached;
  if (!pmremGen) pmremGen = new THREE.PMREMGenerator(renderer);

  try {
    const texture = await new THREE.RGBELoader().loadAsync(getHdriUrl(key));
    texture.mapping = THREE.EquirectangularReflectionMapping;
    const envMap = pmremGen.fromEquirectangular(texture).texture;
    texture.dispose();
    cache[key] = envMap;
    return envMap;
  } catch (err) {
    console.warn(`[hdriLoader] ${key} 加载失败，回落到 RoomEnvironment IBL`, err);
    return null;
  }
}

/** 按太阳高度角选择 HDRI */
export function pickHdriBySunElevation(elevation: number): HDRIKey {
  const PI = Math.PI;
  if (elevation < 0) return 'venice_night_2k';
  if (elevation < PI / 12) return 'venice_sunset_2k';
  return 'quarry_2k';
}
```

### C.2 `src/scene/sceneEngine.ts` 接入

在 `updateSunPosition` 内追加（太阳高度角变化时触发 HDRI 切换）：

```ts
// 在 updateSunPosition 末尾
private lastHdriKey: HDRIKey | null = null;
private async updateHdri(elevation: number): Promise<void> {
  const key = pickHdriBySunElevation(elevation);
  if (key === this.lastHdriKey) return;
  const tex = await loadHdri(key, this.renderer);
  if (tex) {
    this.scene.environment = tex;
    this.lastHdriKey = key;
  }
}
```

---

## Part D — GLTF furnitureAssets（Poly Haven 兜底）

### D.1 `src/render/furnitureAssets.ts`（新增）

```ts
/**
 * GLTF 家具资产加载（Phase 2 §3，P35）。
 *
 * 5 件核心家具（方案 §1 原文）：
 *   - sofa.glb     — 沙发
 *   - bed.glb      — 双人床
 *   - table.glb    — 餐桌
 *   - chair.glb    — 餐椅
 *   - cabinet.glb  — 柜子
 *
 * 路径：/assets/furniture/{key}.glb
 *
 * **降级**：加载失败返回 null，调用方用现有 furniture.ts 的程序化 fallback。
 * 不新增 npm 依赖——GLTFLoader/DRACOLoader/KTX2Loader 都在 three/addons。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

export type FurnitureKey = 'sofa' | 'bed' | 'table' | 'chair' | 'cabinet';
export const FURNITURE_LIST: FurnitureKey[] = ['sofa', 'bed', 'table', 'chair', 'cabinet'];

let loader: GLTFLoader | null = null;
let assetCache: Partial<Record<FurnitureKey, THREE.Group>> = {};

function ensureLoader(renderer: THREE.WebGLRenderer): GLTFLoader {
  if (loader) return loader;
  const l = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('/vendor/draco/');
  l.setDRACOLoader(draco);
  const ktx2 = new KTX2Loader();
  ktx2.detectSupport(renderer);
  l.setKTX2Loader(ktx2);
  loader = l;
  return l;
}

export async function loadFurniture(
  key: FurnitureKey,
  renderer: THREE.WebGLRenderer,
): Promise<THREE.Group | null> {
  const cached = assetCache[key];
  if (cached) return cached;
  try {
    const l = ensureLoader(renderer);
    const gltf = await l.loadAsync(`/assets/furniture/${key}.glb`);
    // 归一化高度到 1m（家具按真实尺寸放置）
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const h = box.max.y - box.min.y;
    if (h > 1e-3) gltf.scene.scale.setScalar(1 / h);
    gltf.scene.updateMatrixWorld(true);
    assetCache[key] = gltf.scene as unknown as THREE.Group;
    return assetCache[key]!;
  } catch (err) {
    console.warn(`[furnitureAssets] ${key} 加载失败，回落到程序化模型`, err);
    return null;
  }
}

/**
 * 靠墙吸附：包围盒最近点距墙 <0.08m 时，贴到墙面 + 对齐墙法线。
 * 简化实现：沿墙的左侧法线方向把 obj 中心移到"距墙 0.05m"处。
 */
export function snapToWall(
  obj: THREE.Object3D,
  wall: { a: readonly [number, number]; b: readonly [number, number] },
): void {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const center = box.getCenter(new THREE.Vector3());
  // 墙方向
  const wx = wall.b[0] - wall.a[0];
  const wz = wall.b[1] - wall.a[1];
  const wlen = Math.hypot(wx, wz) || 1;
  const wux = wx / wlen, wuz = wz / wlen;
  // 墙左侧法线
  const nx = wuz, nz = -wux;
  // obj 中心到墙的垂直距离
  const dx = center.x - wall.a[0];
  const dz = center.z - wall.a[1];
  const signedDist = dx * nx + dz * nz;
  const threshold = 0.08;
  if (Math.abs(signedDist) < threshold) {
    // 贴到距墙 0.05m
    const targetDist = 0.05;
    const shift = targetDist - signedDist;
    obj.position.x += nx * shift;
    obj.position.z += nz * shift;
    // 对齐墙法线：绕 Y 轴旋转到法线方向
    const targetYaw = Math.atan2(nx, nz);
    obj.rotation.y = targetYaw;
  }
}
```

### D.2 `src/scene/sceneEngine.ts` 家具加载改造

在 `rebuildRoom` / `rebuildFromModel` 内，家具生成处：

```ts
// 现有：const sofa = buildFurniture('sofa'); scene.add(sofa);
// 改为：
const sofa = await loadFurniture('sofa', this.renderer);
if (sofa) {
  sofa.position.copy(targetPos);
  snapToWall(sofa, wallSegment);
  scene.add(sofa);
} else {
  const fb = buildFurniture('sofa'); // 现有程序化
  fb.position.copy(targetPos);
  scene.add(fb);
}
```

`buildDecorPlants` 保留程序化（不做植物资产，Phase 2 不涵盖）。

---

## Part E — 用户手动下载指引（不阻塞子代理）

在规格末尾附一段 curl 命令，用户在 Windows PowerShell 执行：

```powershell
# HDRI（2K）
New-Item -ItemType Directory -Force public\assets\hdris
Invoke-WebRequest -Uri "https://dl.polyhaven.org/file/ph-assets/HDRI/renders/venice_sunset_2k.hdr" -OutFile "public\assets\hdris\venice_sunset_2k.hdr"
Invoke-WebRequest -Uri "https://dl.polyhaven.org/file/ph-assets/HDRI/renders/quarry_2k.hdr" -OutFile "public\assets\hdris\quarry_2k.hdr"
Invoke-WebRequest -Uri "https://dl.polyhaven.org/file/ph-assets/HDRI/renders/venice_night_2k.hdr" -OutFile "public\assets\hdris\venice_night_2k.hdr"

# 家具（GLB 或 GLTF；以 Poly Haven 家具合集为准）
New-Item -ItemType Directory -Force public\assets\furniture
# Poly Haven 目前没有独立家具合集；备选 ambientCG：
# https://ambientcg.com/furniture 或 Quaternius.com
```

---

## 验证

1. `npm run typecheck` — 0 error
2. `npm test` — 全绿，新增测试数：
   - `gradePass.test.ts` — 8 用例（4 参数 lerp、shader uniforms 设置、preset 映射）
   - `hdriLoader.test.ts` — 3 用例（cache 命中、失败降级、pickHdriBySunElevation）
   - `furnitureAssets.test.ts` — 4 用例（cache 命中、失败降级、snapToWall 3 情况）
   - 合计新增 15 用例
3. `npm run build` — 通过，仍 2 chunk
4. **手动验收**（Windows 桌面浏览器）：
   - 打开首页 → 若 HDRI 已下载，3D 视口有环境光反射；否则回落到 RoomEnvironment（视觉无退化）
   - 点击"观影"→ 画面变暗 + 暗角加强 + 白平衡偏冷
   - 点击"会客"→ 色温暖 + 饱和度略高
   - 时间轴拖到 22:00 → 环境光切到 venice_night（若文件存在）

## 红线

- `CLAUDE.md` / `vite.config.ts` / `tsconfig.json` / `package.json` / `package-lock.json` 不动
- **不新增 npm 依赖**（three/addons 下已有的直接 import）
- `src/lighting/illuminance.ts` / `heatmap.ts` 不动
- `src/core/circuitMapping.ts` 只允许追加 grade 字段映射，不改 presetTarget 逻辑
- `src/render/godrays.ts` 不动
- 现有测试断言不改
- 不 push
