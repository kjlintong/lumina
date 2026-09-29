# P37 — 灯具 GLTF 资产 loader + 接入 3D 场景

> 属于 `Lumina项目审查与后续工作方案.md` §二 Phase 2「资产管线 V1」的
> 灯具半边。P36 收尾时的规格 §4 已把「灯具资产 loader（`lightAssets.ts`）与
> `FixtureLibraryPanel` 接入真实 mesh」立为下一阶段（P37）。P37a 只做 **3D 场景内**
> 的真实资产接入；`FixtureLibraryPanel` 预览（离屏渲染缩略图）留给 P37b。

## 1. 目标

5 件灯具（Poly Haven，CC0）以真实 `.gltf` 模型替换 `fixtureModels.ts` 里对应的
程序化几何体，出现在 3D 场景里；加载失败 / 无资产的类型回落程序化几何（**视觉不
缺失**）。发光逻辑、色温逻辑、选中高亮、拖放、TransformControls、光预算全部
保持现状 —— 一根灯线都不许断。

**判定标准（可勾选）**：

- [ ] 拖入 / 默认工程里的 pendant / table / sconce / downlight 类型灯具在 3D 里
      显示真实模型（不再是圆锥 / 球 / 圆柱程序化几何）
- [ ] 每种有资产类型的灯具都仍有**发光面**（`shade.material.emissive` 可被
      `applyFixtureIntensity` / `applyFixtureCct` 更新，emissive 颜色跟色温走）
- [ ] 加载失败 / manifest 缺失 / 网络不通时，灯具回落程序化几何，不崩溃
- [ ] `Fixture.pos` 仍是光源权威世界坐标（换资产不改光源位置）
- [ ] 拖放新灯（HTML5 DnD + raycast）与 TransformControls 选中后拖拽**照常工作**
- [ ] 光预算代理（`isProxy`）路径也拿到真实资产（降级只是不建 Light，不降级外观）
- [ ] 测试 942 → 954（新增 12 条）全绿；`npm run verify` + `npm run build` 通过

**不做视觉判定**：本开发环境是 WSL2 SwiftShader，模型视觉质量（比例、朝向、
是否穿模）由用户在真实 GPU 上验收。子代理用数值 / DOM 断言验证逻辑，不声称已
验收画面。

## 2. 现状与关键缺口（父代理 grep 核实）

### 2.1 已经存在的基建（**复用，不重写**）

- `src/render/furnitureAssets.ts:91` `loadFurniture(key, renderer)`：manifest 驱动
  的 GLTF 加载范式（`ensureLoader` + `GLTFLoader` + `DRACOLoader` + `assetCache`
  + `loadManifest` + `_resetFurnitureCacheForTest`）。**新文件照抄这个骨架**，
  只改 key 集合与 manifest 路径。
- `src/scene/sceneEngine.ts:1080` `loadZoneAssetAsync(zone, group, fallback, assetKey,
  attempt)`：异步替换的范式 —— 用 `attempt` token 防 stale，加载完成后按
  `this.zoneAssets.get(zone.key).attempt !== attempt` 丢弃过期结果，成功后替换
  fallback 并保留 `savedPos` / `savedRotY`。**灯具照抄这个 token 语义**。
- `src/render/lightBuilder.ts:280` `buildLightFromFixture(f, opts)`：同步入口，
  内含 proxy 分支（`:290`）+ 8 分型光源映射 + 灯罩（`:459` `buildFixtureModel`）。
  **本轮不改 lightBuilder.ts** —— `buildLightFromFixture` 保持同步签名
  （`addFixtureInternal` 是同步调用点），两阶段策略放在 engine 侧（见 §3.3）。
- `src/render/shadeScale.ts:26` `SHADE_VISUAL_SCALE = 3.0`（P31 定版）。
- `src/core/makeFixture.ts:52` `TYPE_DEFAULTS`：每类灯具默认 form/mount/lumens。
  默认 `diameter` 来自 `FORM_DEFAULTS`（`:43-49`）：cone 0.14 / cylinder 0.18 /
  sphere 0.28 / disc 0.22 / line 0.05 / plane 0.7。
- `src/core/types.ts:95` `FixtureType` 8 值；`:196` `Fixture` 接口。
- 资产文件已就位（`ls public/assets/lights/` 实测）：`chandelier/`、`desk_lamp/`、
  `wall_sconce/`、`ceiling_lamp/`、`pendant/` 五个子目录，各自含
  `*.gltf + *.bin + textures/*.jpg`。
- `public/assets/lights/manifest.json` 已存在（`download-assets.py:262` 生成），
  格式：`{ "<name>": { "slug", "gltf": "<basename>.gltf", "files": [...] } }`。

### 2.2 缺口

1. **无 `lightAssets.ts`**：灯具没有 manifest 驱动的 loader。
2. **无灯具 `loader-manifest.json`**：家具目录有手写的 `loader-manifest.json`
   （含 `assets/furniture/<name>/<basename>.gltf` 绝对路径），灯具只有
   `download-assets.py` 生成的 `manifest.json`（gltf 是 basename，不含目录前缀）。
   `furnitureAssets.ts:57` 读的是 `loader-manifest.json`，灯具需要同款文件。
3. **`buildLightFromFixture` 同步**：GLTF 是异步的，需要「先放程序化替身 + 异步
   加载后替换」的双阶段策略（与家具 `loadZoneAssetAsync` 同型）。
4. **`public/vendor/draco/` 不存在**（`ls` 实测）：`furnitureAssets.ts:44` 设的
   decoder 路径 404。Poly Haven 用未压缩 `.bin`，`.gltf` 里无
   `KHR_draco_mesh_compression` 扩展，DRACOLoader 永远不会被调用 —— **无副作用，
   本轮不修**，但规格里必须写清「不要为此报错」。
5. **灯具资产与程序化几何无锚点对应**：程序化几何有明确的 `shadeMesh` 位置
   （例如 `buildPendantModel` 里 `shade.position.y = -0.1 * S`），GLTF 模型的
   发光体在哪个 mesh 不确定。见 §3.3 的锚点策略。

## 3. 交付物

### 3.1 新建 `src/render/lightAssets.ts`

完整代码：

```ts
/**
 * GLTF 灯具资产加载（P37a）。
 *
 * 5 件核心灯具资产（Poly Haven，CC0）：
 *   - pendant  ← polyhaven "hanging_industrial_lamp"
 *   - chandelier ← polyhaven "Chandelier_01"
 *   - desk_lamp ← polyhaven "desk_lamp_arm_01"
 *   - wall_sconce ← polyhaven "industrial_wall_sconce"
 *   - ceiling_lamp ← polyhaven "modern_ceiling_lamp_01"
 *
 * 对应到 FixtureType（src/core/types.ts:95）：
 *   pendant → 'pendant'；chandelier → 'pendant'；desk_lamp → 'table'；
 *   wall_sconce → 'sconce'；ceiling_lamp → 'downlight'。
 *
 * **多资产共享一个 FixtureType 的取舍**：FixtureType 是**物理光源分类**
 * （'pendant' = PointLight 悬挂全向），不是**外观分类**。同一 FixtureType 可以有
 * 多件资产，本阶段用「每个 FixtureType 挑一件代表资产」保持 1:1 映射，避免
 * Fixture 数据模型加 `assetKey` 字段（那会污染 ADR-12 的供给侧契约，需另立项）。
 *
 * 加载失败的降级路径：
 *   manifest 加载失败 / manifest 里没有该 key / .gltf 加载失败
 *     → 返回 null → lightBuilder 保留程序化几何 → 视觉不缺失。
 *
 * 与 furnitureAssets.ts 的关系：骨架一致（loader 单例 / manifest 单例 / cache），
 * 但**不共享** loader 实例 —— 家具与灯具的 GLTF 加载时机不同步，共享会有
 * DRACOLoader WASM 加载的竞争条件（Poly Haven 未压缩 .bin 不会触发，但保守隔离）。
 *
 * 不新增 npm 依赖：GLTFLoader / DRACOLoader 都在 three/addons（与 P36 同款 import）。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import type { Fixture, FixtureType } from '../core/types.js';
import { cctToRGB } from './lightBuilder.js';

/** 有资产的灯具类型 key（与 public/assets/lights/loader-manifest.json 的 key 一致） */
export type LightAssetKey = 'pendant' | 'chandelier' | 'desk_lamp' | 'wall_sconce' | 'ceiling_lamp';

/** 有资产覆盖的 FixtureType 子集 */
export const FIXTURE_TYPES_WITH_ASSETS: readonly FixtureType[] = [
  'pendant', // → 'pendant'（chandelier 共用，见下方 assetKeyForType）
  'table',
  'sconce',
  'downlight',
] as const;

/**
 * FixtureType → 代表资产 key 的映射。
 * 未列出的 FixtureType（'spot' / 'linear' / 'cove' / 'floor'）本轮无资产，
 * 直接回落程序化几何。
 *
 * 'pendant' 同时覆盖 chandelier 的外观：本阶段选 'pendant' 资产作为代表
 * （hanging_industrial_lamp，工业风吊灯），chandelier 资产的接入留给 P37c
 * 立项（需 Fixture 加 `assetKey` 字段或独立的资产选择 UI）。
 */
export const ASSET_KEY_FOR_TYPE: Partial<Record<FixtureType, LightAssetKey>> = {
  pendant: 'pendant',
  table: 'desk_lamp',
  sconce: 'wall_sconce',
  downlight: 'ceiling_lamp',
};

/**
 * 每类资产的视觉尺寸目标（米）+ 锚点策略。
 *
 * `targetSize`：归一化后资产沿主轴向（vertical: Y / horizontal: X）达到 targetSize 米。
 * 归一化见 normalizeAndAnchor()。
 *
 * `anchor`：把资产的哪一端对齐到 group 原点（= fixture.pos = 光源世界坐标）。
 *   - 'top'    → 顶端对齐原点，资产向下延伸
 *   - 'bottom' → 底端对齐原点，资产向上延伸
 *   - 'center' → 中心对齐原点，资产上下对称
 *
 * `lightOffset`：光源（= 发光面 emissive 中心）沿主轴向相对原点的偏移（米）。
 * 正数 = 沿 +轴方向（vertical: +Y 向上；horizontal: +X 向右）；负数 = 反向。
 * 这是**资产内光源的真实位置**，不是启发式：
 *   - pendant 0.84 / 'top' / -0.60：光源在灯罩（资产下方 0.6m），匹配
 *     buildPendantModel（light 在 shade，吊线在上方）。
 *     默认 pos=[0,2.4,0]（makeFixture.ts:92）→ 灯罩在 y=1.8m。
 *   - ceiling_lamp 0.55 / 'top' / -0.27：downlight 光源在灯具中部（嵌入天花
 *     略下）。匹配 buildDownlightModel（light 在 shade，shade 在 trim 下方）。
 *   - wall_sconce 0.40 / 'top' / -0.20：sconce 光源在半柱中部。匹配
 *     buildSconceModel（light 在 shade 中部）。
 *   - desk_lamp 0.75 / 'bottom' / +0.60：table 光源在灯罩（资产上方 0.6m）。
 *     匹配 buildTableModel（light 在 shade，shade 在底座上方）。
 *     默认 pos y≈0.75m（桌面）→ 灯罩在 y=1.35m。
 *   - chandelier 1.00 / 'center' / 0：光源在中心（多臂中心）。
 *
 * **视觉质量由用户在真实 GPU 上验收**（见 §9）。若比例 / 锚点 / 光源偏移不对，
 * P37a-fix 或 P37b 立项调这些常量 —— 改这里一处即可。
 */
export interface LightAssetDef {
  /** 资产目录名（public/assets/lights/<name>/） */
  name: string;
  /** 主轴向：vertical = 沿 Y 归一化；horizontal = 沿 X 归一化 */
  axis: 'vertical' | 'horizontal';
  /** 归一化后主轴向目标尺寸（米） */
  targetSize: number;
  /** 锚点：资产的哪一端对齐 group 原点 */
  anchor: 'top' | 'bottom' | 'center';
  /** 光源（发光面中心）沿主轴向相对原点的偏移（米） */
  lightOffset: number;
}

export const LIGHT_ASSET_DEFS: Record<LightAssetKey, LightAssetDef> = {
  pendant: { name: 'pendant', axis: 'vertical', targetSize: 0.84, anchor: 'top', lightOffset: -0.60 },
  chandelier: { name: 'chandelier', axis: 'horizontal', targetSize: 1.0, anchor: 'center', lightOffset: 0 },
  desk_lamp: { name: 'desk_lamp', axis: 'vertical', targetSize: 0.75, anchor: 'bottom', lightOffset: 0.60 },
  wall_sconce: { name: 'wall_sconce', axis: 'vertical', targetSize: 0.4, anchor: 'top', lightOffset: -0.20 },
  ceiling_lamp: { name: 'ceiling_lamp', axis: 'vertical', targetSize: 0.55, anchor: 'top', lightOffset: -0.27 },
};

/** 判断某 FixtureType 是否有资产可用（纯函数，供单测） */
export function assetKeyForType(type: FixtureType): LightAssetKey | null {
  return ASSET_KEY_FOR_TYPE[type] ?? null;
}

// --- 单例状态 ----------------------------------------------------------------

let loader: GLTFLoader | null = null;
/** 缓存：LightAssetKey → 归一化后的 GLTF scene Group */
const assetCache: Partial<Record<LightAssetKey, THREE.Group>> = {};
/** manifest 单例：LightAssetKey → .gltf 绝对路径 */
let manifestCache: Map<string, string> | null = null;

/**
 * 保证 GLTFLoader 单例。DRACOLoader 挂在 loader 上但 Poly Haven 的 .bin
 * 未压缩（无 KHR_draco_mesh_compression 扩展），DRACOLoader 永远不会被调用。
 * `/vendor/draco/` 目录当前不存在（ls 实测），decoder 路径 404 无副作用
 * （只有真正遇到 Draco 压缩才会 fetch WASM）。
 *
 * 与 furnitureAssets.ensureLoader 保持独立实例：避免跨加载器的 loadingManager
 * 状态污染。
 */
function ensureLoader(_renderer: THREE.WebGLRenderer): GLTFLoader {
  if (loader) return loader;
  const l = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('/vendor/draco/');
  l.setDRACOLoader(draco);
  loader = l;
  return l;
}

/**
 * 加载 public/assets/lights/loader-manifest.json，返回 LightAssetKey → .gltf 绝对路径。
 * 失败返回 null（调用方整体回落程序化）。缓存单例。
 *
 * manifest 格式（与家具 loader-manifest.json 同型）：
 *   { "pendant": { "asset": "pendant", "gltf": "assets/lights/pendant/hanging_industrial_lamp_1k.gltf" }, ... }
 * loader 给每个路径加前缀 `/`，保证是 site 根绝对 URL。
 */
async function loadManifest(): Promise<Map<string, string> | null> {
  if (manifestCache) return manifestCache;
  try {
    const res = await fetch('/assets/lights/loader-manifest.json');
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, { gltf: string }>;
    const m = new Map<string, string>();
    for (const [k, v] of Object.entries(data)) {
      m.set(k, `/${v.gltf}`);
    }
    manifestCache = m;
    return m;
  } catch (err) {
    console.warn('[lightAssets] manifest 加载失败，回落到程序化灯具', err);
    return null;
  }
}

/** 供测试重置缓存（跨用例隔离 + 释放 GPU 资源） */
export function _resetLightAssetCacheForTest(): void {
  for (const k of Object.keys(assetCache) as LightAssetKey[]) {
    const g = assetCache[k];
    if (g) {
      g.traverse((o) => {
        const m = o as unknown as {
          geometry?: THREE.BufferGeometry | null;
          material?: THREE.Material | THREE.Material[] | null;
        };
        m.geometry?.dispose();
        if (Array.isArray(m.material)) m.material.forEach((x) => x.dispose());
        else m.material?.dispose();
      });
    }
    delete assetCache[k];
  }
  manifestCache = null;
  loader = null;
}

/**
 * 归一化 + 锚定：把 GLTF scene 的主轴向缩放到 targetSize 米，并按 `anchor`
 * 把资产的相应端对齐到 group 原点（= fixture.pos = 光源世界坐标）。
 *
 * 语义：调用方（sceneEngine.loadFixtureAssetAsync）把归一化后的 Group 放进
 * fixture 的 group 里，group.position 是 fixture.pos。归一化后 Group 的原点
 * 对应资产的锚点：
 *   - anchor='top'    → 资产顶端在原点，向下延伸（光源在灯具顶部）
 *     pendant / ceiling_lamp / wall_sconce：挂在天花或墙面下方
 *   - anchor='bottom' → 资产底端在原点，向上延伸（光源在灯具底部）
 *     desk_lamp：立在桌面上方
 *   - anchor='center' → 资产中心在原点（光源在灯具中部，全向）
 *     chandelier：多臂吊灯
 *
 * 这个锚点策略让 lightBuilder 只需按 fixture.pos 定位 group，不需要每类资产
 * 写死 offset。
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
  const box = new THREE.Box3().setFromObject(scene);
  if (box.isEmpty()) return scene;

  const size = box.getSize(new THREE.Vector3());
  const primary = axis === 'vertical' ? size.y : size.x;
  if (primary <= 0) return scene;

  const scale = targetSize / primary;

  // 关键假设：**归一化前 scene 是 GLTFLoader 的根 Group，且子节点坐标居中在
  // origin**（Poly Haven 资产均如此），即 box.min / box.max 关于 (0,0,0) 对称。
  // GLTFLoader 返回的 scene.position 恒为 (0,0,0)，所以缩放后主轴向两端的世界
  // 坐标 = box.min * scale, box.max * scale。
  //
  // 若上游改了这个前提（例如 scene 已有非零 position），需改回
  // `box.min * scale - 原 position`。
  scene.scale.setScalar(scale);

  const minX = box.min.x * scale, maxX = box.max.x * scale;
  const minY = box.min.y * scale, maxY = box.max.y * scale;
  const minZ = box.min.z * scale, maxZ = box.max.z * scale;

  if (axis === 'vertical') {
    // 水平方向居中到 origin
    const cx = -(minX + maxX) / 2;
    const cz = -(minZ + maxZ) / 2;
    let cy: number;
    if (anchor === 'top') cy = -maxY;          // 顶端（+maxY）对齐原点
    else if (anchor === 'bottom') cy = -minY;  // 底端（minY）对齐原点
    else cy = -(minY + maxY) / 2;              // center
    scene.position.set(cx, cy, cz);
  } else {
    // 主轴向沿 X
    let cx: number;
    if (anchor === 'top') cx = -maxX;
    else if (anchor === 'bottom') cx = -minX;
    else cx = -(minX + maxX) / 2;
    const cy = -(minY + maxY) / 2;
    const cz = -(minZ + maxZ) / 2;
    scene.position.set(cx, cy, cz);
  }
  scene.updateMatrixWorld(true);
  return scene;
}

/**
 * 加载单个灯具资产并归一化。失败返回 null（调用方回落程序化）。
 *
 * 缓存策略：assetCache 缓存归一化后的 Group。调用方拿到的是**引用**，
 * 不应在场景图里同时挂多个 Group 实例到同一个 Group（three.js 不允许）。
 * 因此调用方必须 `group.clone(true)` 一次再用；clone 会复制 material / geometry
 * 引用（three.js clone 的默认行为），共享 GPU 资源但独立场景图节点，安全。
 */
export async function loadLightAsset(
  key: LightAssetKey,
  renderer: THREE.WebGLRenderer,
): Promise<THREE.Group | null> {
  const cached = assetCache[key];
  if (cached) return cached;

  const manifest = await loadManifest();
  const gltfPath = manifest?.get(key);
  if (gltfPath === undefined) return null;

  try {
    const l = ensureLoader(renderer);
    const gltf = await l.loadAsync(gltfPath);
    const def = LIGHT_ASSET_DEFS[key];
    normalizeAndAnchor(gltf.scene, def.axis, def.targetSize, def.anchor);
    assetCache[key] = gltf.scene;
    return gltf.scene;
  } catch (err) {
    console.warn(`[lightAssets] ${key} 加载失败，回落到程序化灯具`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 发光面（asset 没有天然发光 mesh，需要外挂一个承载色温 / 亮度）
// ---------------------------------------------------------------------------

/**
 * 给 GLTF 资产 Group 挂一个发光面（emissive Mesh），作为新的 `shade` 引用。
 *
 * **放在本文件而不是 lightBuilder.ts 的原因**：sceneEngine 顶部先 import
 * lightBuilder（用于 buildLightFromFixture），后 import lightAssets；若把
 * `attachGlowMesh` / `markNoShadow` 加到 lightBuilder，sceneEngine 需要两处
 * 不同位置的 import，容易踩循环依赖（lightBuilder ↔ sceneEngine 已有耦合）。
 * 本文件只在**调用方向末尾**被 import，新增函数不会引入反向依赖。
 *
 * **为什么需要发光面**：`sceneEngine.applyFixtureIntensity` / `applyFixtureCct`
 * 依赖 `entry.shade.material.emissive` 更新灯罩发光。程序化几何的 shade 是
 * `buildFixtureModel` 里明确构造的发光 Mesh（`makeGlowMaterial`，见
 * fixtureModels.ts:84-92）；GLTF 资产里没有对应的发光 mesh（Poly Haven 模型
 * 的 materials 都是外壳质感），需要外挂一个发光面承载色温 / 亮度。
 *
 * 发光面是 `CircleGeometry`（半径按 targetSize 折算，视觉上不抢戏但能被 bloom
 * 抓到），位置在**资产内的光源处**（由 `lightOffset` 决定沿主轴向的偏移）：
 *   - pendant：lightOffset=-0.60 → 灯罩在资产下方 0.6m（光源在灯罩）
 *   - desk_lamp：lightOffset=+0.60 → 灯罩在资产上方 0.6m（底座在原点）
 *   - ceiling_lamp：lightOffset=-0.27 → 光源在灯具中部（嵌入天花略下）
 *   - wall_sconce：lightOffset=-0.20 → 光源在半柱中部
 *   - chandelier：lightOffset=0 → 光源在中心
 *
 * 朝向（rotation）：
 *   - vertical 轴：面朝 -Y（朝下），匹配大多数垂直向灯具（吊灯 / 筒灯 /
 *     台灯 / 壁灯的主出光方向都是向下照亮工作区）
 *   - horizontal 轴：面朝 -X（朝左，即资产延伸方向的反向）
 *
 * **朝向不是物理精确的**（壁灯主出光方向其实是水平向外，不是向下），但发光面
 * 只是 emissive 视觉标记 + `applyFixtureIntensity` / `applyFixtureCct` 的更新
 * 目标，不需要物理正确。用户真实 GPU 验收时可发现朝向问题（见 §9），P37a-fix
 * 按 mount 细化 rotation 即可。
 *
 * **命名带 `-shade` 后缀是硬约束**：`App.tsx:256` 的拖放命中判定
 * `isFixtureHit` 用 `cur.name.endsWith('-shade')` 跳过灯具内部对象（P29b，
 * 防止新灯被塞进旧灯罩内部）。改这个命名会破坏拖放。
 *
 * **userData.fixtureId**：`findFixtureId`（`App.tsx:186`）走的是祖先 name 匹配，
 * 不依赖 userData；但打这个字段让未来的选中态链路（P36 的 2D/3D 同步）能直接
 * 从命中对象读到 fixtureId，不用往上爬祖先。
 *
 * @param f Fixture 数据（提供 id / electrical.cct）
 * @param assetGroup 归一化后的 GLTF 资产 Group
 * @param def 资产定义（提供 axis / targetSize / lightOffset）
 * @returns 新挂到 assetGroup 上的发光 Mesh
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
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(r, g, b),
    emissive: new THREE.Color(r, g, b),
    emissiveIntensity: 0, // 由 applyFixtureIntensity 按 level 更新
    roughness: 0.4,
    metalness: 0,
  });

  // 发光面尺寸：约资产主轴向的 40%（视觉上不抢戏但足够被 bloom threshold 0.85 抓到）
  const glowR = Math.max(0.02, def.targetSize * 0.2);
  const geo = new THREE.CircleGeometry(glowR, 24);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `${f.id}-shade`;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.fixtureId = f.id;

  if (def.axis === 'vertical') {
    mesh.position.set(0, def.lightOffset, 0);
    mesh.rotation.x = -Math.PI / 2; // 面朝 -Y（朝下）
  } else {
    mesh.position.set(def.lightOffset, 0, 0);
    mesh.rotation.y = Math.PI / 2; // 面朝 -X
  }

  assetGroup.add(mesh);
  return mesh;
}
```

**关键说明**：

- `normalizeAndAnchor` 是**纯函数**（输入 Box3 / Object3D，无副作用外部调用），
  可单测。`loadLightAsset` 涉及网络 + WebGL，不直接单测，靠 `lightAssets.test.ts`
  的 mock 覆盖 manifest 分支 + normalizeAndAnchor 用真实几何验证。
- 归一化后 Group 的原点对应资产的 `anchor`（top / bottom / center），
  光源位置由 `lightOffset` 相对原点表达。**所有比例 / 锚点 / 光源偏移都集中在
  `LIGHT_ASSET_DEFS` 一处**，视觉验收后调常量即可，不需要动 `normalizeAndAnchor`
  或 `attachGlowMesh` 的逻辑。

### 3.2 新建 `public/assets/lights/loader-manifest.json`

由 `scripts/download-assets.py` 生成（见 §3.6）。**同时手写在仓库里保证本轮就有**
（防止子代理漏改脚本导致 manifest 缺失）：

```json
{
  "pendant":      { "asset": "pendant",      "gltf": "assets/lights/pendant/hanging_industrial_lamp_1k.gltf" },
  "chandelier":   { "asset": "chandelier",   "gltf": "assets/lights/chandelier/Chandelier_01_1k.gltf" },
  "desk_lamp":    { "asset": "desk_lamp",    "gltf": "assets/lights/desk_lamp/desk_lamp_arm_01_1k.gltf" },
  "wall_sconce":  { "asset": "wall_sconce",  "gltf": "assets/lights/wall_sconce/industrial_wall_sconce_1k.gltf" },
  "ceiling_lamp": { "asset": "ceiling_lamp", "gltf": "assets/lights/ceiling_lamp/modern_ceiling_lamp_01_1k.gltf" }
}
```

### 3.3 `src/render/lightBuilder.ts` —— **本轮不改**

**结论**：`lightBuilder.ts` 一行不动。

原因：`buildLightFromFixture` 保持**同步签名**（`addFixtureInternal` 是同步调用点，
改成 async 会污染整条 store → engine → UI 链路）。两阶段策略放在 engine 侧：

1. **同步阶段**（现状，不动）：`buildLightFromFixture` 按 `buildFixtureModel` 构建
   程序化几何，返回给 engine。引擎**立刻**有 `shade` 引用可用。
2. **异步阶段**（新增，见 §3.4）：engine 侧 `loadFixtureAssetAsync` 加载 GLTF 资产，
   成功后替换程序化 Group、用 `attachGlowMesh`（见 §3.1，已在 `lightAssets.ts`）
   挂发光面、更新 `entry.shade`。

`attachGlowMesh` 需要 `cctToRGB`，因此它放在 `lightAssets.ts`（后者 import 前者），
**不**放回 `lightBuilder.ts` —— 否则 `sceneEngine` 需要两处不同位置的 import
（顶部已有 `import ... from '../render/lightBuilder.js'`），容易踩循环依赖。

`markNoShadow` 同理，但它是纯遍历工具函数，直接放在 `sceneEngine.ts` 内部作为
**私有函数**（不导出，因为只有 engine 用），避免任何跨文件 import 争议。

### 3.4 修改 `src/scene/sceneEngine.ts`

**目标**：在 `addFixtureInternal` 之后异步加载灯具资产；成功后替换程序化几何 +
挂发光面 + 更新 `entry.shade`。用 attempt token 防 stale（照抄
`loadZoneAssetAsync` 的语义）。

改动：

1. **新增私有字段**（放在 `private transformControls` 附近，`:284` 之后）：

```ts
  /**
   * P37a：灯具 GLTF 资产异步加载的 attempt token。
   * 语义与 `zoneAssets`（`:1080` loadZoneAssetAsync）平行：每次
   * `addFixtureInternal` 调用时该 id 的 attempt 递增；异步完成后 attempt
   * 不匹配就丢弃结果。
   *
   * 只存 attempt 数字（不存 fallback / entry 引用）—— entry 通过
   * `fixtureLights.get(id)` 现查，避免缓存失效。
   */
  private fixtureAssetStates: Map<string, number> = new Map();
```

2. **新增私有辅助函数** `markNoShadow`（模块顶层，放在 `FixtureLightEntry`
   interface 之后，`:144` 附近）。**不导出**：只有 engine 内部用。

```ts
/**
 * P37a：遍历 obj 子树，把所有 Mesh 的 castShadow / receiveShadow 设为 false。
 *
 * GLTF 资产的 Mesh 默认按模型里的标记设（可能为 true），但灯具是**光源的
 * 可视化替身**，让资产投阴影会把自家光源照成黑斑（与 `lightBuilder.ts:466-468`
 * 对程序化灯罩的处理同规）。
 *
 * 私有函数，不导出：只有 sceneEngine 用，避免跨文件循环依赖（lightBuilder
 * 已经 import 到 sceneEngine 顶部，再反向导出工具函数会绕）。
 */
function markNoShadow(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const m = o as THREE.Mesh;
      m.castShadow = false;
      m.receiveShadow = false;
    }
  });
}
```

3. **修改 `addFixtureInternal`**（`:900`）：在 `this.applyFixtureIntensity(fixture.id, level)`
   **之后**追加异步启动（**注意：只传 3 个参数**）：

```ts
    // P37a：启动异步资产加载（若该类型有资产）。加载完成后替换程序化几何。
    // 不阻塞 addFixtureInternal 的同步返回 —— entry.shade 立刻是程序化 shade，
    // applyFixtureIntensity 等能立刻工作；资产到位后 entry.shade 被替换为
    // 资产 Group 里的新 glow Mesh。
    this.loadFixtureAssetAsync(fixture, object, entry);
```

4. **新增私有方法** `loadFixtureAssetAsync`（放在 `loadZoneAssetAsync` 附近，
   `:1080` 之后）：

```ts
  /**
   * P37a：异步加载灯具 GLTF 资产并替换程序化几何。
   *
   * 失败静默（不 log error；lightAssets 内部已 console.warn）。
   * 加载成功后：
   *   1. 从 entry.object 里移除原程序化 Group（`buildFixtureModel` 返回的
   *      group，是 object 里那个 Group 类型子节点；光本身是 Light /
   *      SpotLight / RectAreaLight / PointLight，类型不同）
   *   2. 加载 GLTF 资产，clone(true) 后挂到 entry.object
   *   3. markNoShadow 遍历资产 Mesh 设 castShadow=false / receiveShadow=false
   *   4. attachGlowMesh 挂发光面（带 `-shade` 后缀，见 App.tsx:256 拖放命中判定）
   *   5. 更新 entry.shade
   *   6. 重新调 applyFixtureIntensity 让新 shade 立刻反映当前 level
   *   7. 若灯具当前被选中（TransformControls 挂接），重新 attach
   *
   * **attempt token 防 stale**（照抄 loadZoneAssetAsync 的 3 层检查）：
   * 删除灯具 → 重建同 id 灯具（recalculateBudget:989 触发）的场景下，旧异步
   * 结果到达时 attempt 已不匹配，静默丢弃。
   *
   * **幂等**：若 object 里已经有本次 assetKey 的 Group（例如预算切换前后
   * 两次调用），跳过替换，避免重复 clone。
   *
   * 注意 `curEntry.object !== object` 的判断 —— 预算重建时 entry 会换成新
   * entry（新 object），旧 entry 的异步结果必须丢弃，否则会挂到已废弃的
   * object 上（object 已不在 scene 里，但 entry 还在 map 里直到下一次
   * recalculateBudget 才清理）。
   */
  private loadFixtureAssetAsync(
    fixture: Fixture,
    object: THREE.Object3D,
    entry: FixtureLightEntry,
  ): void {
    const assetKey = assetKeyForType(fixture.type);
    if (!assetKey) return; // 无资产类型（spot / linear / cove / floor）直接走程序化

    const def = LIGHT_ASSET_DEFS[assetKey];
    const attempt = (this.fixtureAssetStates.get(fixture.id) ?? 0) + 1;
    this.fixtureAssetStates.set(fixture.id, attempt);

    void (async () => {
      // 与 loadZoneAssetAsync 同款 renderer 检查
      const renderer = this.backend.type === 'webgl2' ? this.backend.getRenderer() : null;
      if (!renderer) return;

      let asset: THREE.Group | null = null;
      try {
        asset = await loadLightAsset(assetKey, renderer);
      } catch {
        return;
      }
      if (!asset) return; // loadLightAsset 内部已经 console.warn，这里静默返回

      // token 检查（照抄 loadZoneAssetAsync 的 3 层检查）
      if (this.fixtureAssetStates.get(fixture.id) !== attempt) return;
      if (!this.fixtureLights.has(fixture.id)) return;
      const curEntry = this.fixtureLights.get(fixture.id);
      if (!curEntry || curEntry.object !== object) return;

      // 幂等检查：若 object 里已有本 assetKey 的 Group，跳过（预算切换不会重建
      // 同一 fixture 到全新 object，但保险起见）
      const alreadyTagged = object.children.some(
        (c) => c.userData.p37AssetKey === assetKey,
      );
      if (alreadyTagged) return;

      // clone 资产（缓存里的是归一化后的原 Group，不能同时挂到多处；three.js
      // clone(true) 会复制 geometry/material 引用但不共享场景图节点，安全）
      const assetClone = asset.clone(true);
      markNoShadow(assetClone);
      assetClone.userData.p37AssetKey = assetKey;

      // 移除原程序化 group（object.children 里所有 Group 类型子节点；光本身是
      // Light 子类，instanceof THREE.Group 会过滤掉）
      for (const child of [...object.children]) {
        if (child instanceof THREE.Group) {
          object.remove(child);
        }
      }

      // 把 assetClone 放到原程序化 group 的位置（origin，因为 buildLightFromFixture
      // 里 modelGroup.position.set(0, 0, 0)），并沿用 rot
      assetClone.position.set(0, 0, 0);
      assetClone.rotation.set(fixture.rot.pitch, fixture.rot.yaw, 0);
      object.add(assetClone);

      // 挂发光面，更新 entry.shade
      const newShade = attachGlowMesh(fixture, assetClone, def);
      curEntry.shade = newShade;

      // 立刻应用当前 level 让发光面对
      const level = this.fixtureLevels.get(fixture.id) ?? 1;
      this.applyFixtureIntensity(fixture.id, level);

      // 若当前灯具被选中（TransformControls 挂接），重新挂到 gizmo 上
      if (this.attachedFixtureId === fixture.id && this.transformControls) {
        this.transformControls.detach();
        this.transformControls.attach(object);
      }
    })();
  }
```

5. **修改 `removeFixtureInternal`**（`:940`）：清理 `fixtureAssetStates`。
   加在 `this.fixtureLights.delete(fixtureId)` **同一 if 块内**：

```ts
    if (entry) {
      this.scene.remove(entry.object);
      this.fixtureLights.delete(fixtureId);
      this.fixtureLevels.delete(fixtureId);
      this.fixtureAssetStates.delete(fixtureId); // P37a：防残留 attempt
    }
```

6. **新增 import**（文件顶部，紧跟现有 `import { loadFurniture } ...` 那组之后）：

```ts
import { assetKeyForType, loadLightAsset, LIGHT_ASSET_DEFS, attachGlowMesh } from '../render/lightAssets.js';
```

**import 顺序说明**：`sceneEngine.ts` 顶部已有
`import { buildLightFromFixture, cctToRGB, SHADE_EISSIVE_SCALE } from '../render/lightBuilder.js'`
（`:51`）。`lightAssets.ts` import `lightBuilder.ts`（用于 `cctToRGB`），所以
`sceneEngine → lightAssets → lightBuilder` 是**线性**依赖，没有循环。新增 import
放在 `lightBuilder` 那行之后即可。

**`markNoShadow` 不导出**：它是纯遍历工具，只在 `loadFixtureAssetAsync` 里用。
放模块顶层私有函数，不进测试（`attachGlowMesh` 的测试覆盖了「Mesh 的
castShadow=false」的等价语义，见 §3.5）。

### 3.5 新增测试 `src/render/__tests__/lightAssets.test.ts`

**只测纯函数**（`normalizeAndAnchor`、`assetKeyForType`、`attachGlowMesh`）。
`loadLightAsset` 涉及 fetch + GLTFLoader，走 mock 覆盖 manifest 缺失分支。
`markNoShadow` 是 sceneEngine 私有函数（不导出），不进测试。

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import {
  assetKeyForType,
  normalizeAndAnchor,
  LIGHT_ASSET_DEFS,
  loadLightAsset,
  attachGlowMesh,
  _resetLightAssetCacheForTest,
  type LightAssetKey,
} from '../lightAssets.js';
import { makeFixture } from '../../core/makeFixture.js';
import type { FixtureType } from '../../core/types.js';

describe('lightAssets: assetKeyForType (P37)', () => {
  it('有资产的类型映射到对应 key', () => {
    expect(assetKeyForType('pendant')).toBe('pendant');
    expect(assetKeyForType('table')).toBe('desk_lamp');
    expect(assetKeyForType('sconce')).toBe('wall_sconce');
    expect(assetKeyForType('downlight')).toBe('ceiling_lamp');
  });

  it('无资产的类型返回 null', () => {
    for (const t of ['spot', 'linear', 'cove', 'floor'] as FixtureType[]) {
      expect(assetKeyForType(t)).toBeNull();
    }
  });
});

describe('lightAssets: normalizeAndAnchor (P37)', () => {
  it('vertical + anchor=top：顶端对齐原点，资产向下延伸', () => {
    const scene = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    scene.add(box);
    scene.updateMatrixWorld(true);

    normalizeAndAnchor(scene, 'vertical', 0.8, 'top');

    scene.updateMatrixWorld(true);
    const result = new THREE.Box3().setFromObject(scene);
    expect(result.max.y).toBeCloseTo(0, 5);   // 顶端在原点
    expect(result.min.y).toBeCloseTo(-0.8, 5); // 向下延伸 0.8
  });

  it('vertical + anchor=bottom：底端对齐原点，资产向上延伸', () => {
    const scene = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    scene.add(box);
    scene.updateMatrixWorld(true);

    normalizeAndAnchor(scene, 'vertical', 0.8, 'bottom');

    scene.updateMatrixWorld(true);
    const result = new THREE.Box3().setFromObject(scene);
    expect(result.min.y).toBeCloseTo(0, 5);    // 底端在原点
    expect(result.max.y).toBeCloseTo(0.8, 5);   // 向上延伸 0.8
  });

  it('vertical + anchor=center：中心对齐原点', () => {
    const scene = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    scene.add(box);
    scene.updateMatrixWorld(true);

    normalizeAndAnchor(scene, 'vertical', 0.8, 'center');

    scene.updateMatrixWorld(true);
    const result = new THREE.Box3().setFromObject(scene);
    expect(result.min.y).toBeCloseTo(-0.4, 5);
    expect(result.max.y).toBeCloseTo(0.4, 5);
  });

  it('horizontal + anchor=center：左端对齐原点', () => {
    const scene = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    scene.add(box);
    scene.updateMatrixWorld(true);

    normalizeAndAnchor(scene, 'horizontal', 1.2, 'center');

    scene.updateMatrixWorld(true);
    const result = new THREE.Box3().setFromObject(scene);
    expect(result.min.x).toBeCloseTo(-0.6, 5);
    expect(result.max.x).toBeCloseTo(0.6, 5);
  });

  it('空 Box（无子节点）不抛错，原样返回', () => {
    const scene = new THREE.Group();
    const out = normalizeAndAnchor(scene, 'vertical', 1, 'top');
    expect(out).toBe(scene);
  });
});

describe('lightAssets: attachGlowMesh (P37)', () => {
  it('glow mesh 沿主轴向放在 lightOffset 处，带 -shade 后缀', () => {
    const f = makeFixture({ type: 'pendant' });
    const def = LIGHT_ASSET_DEFS.pendant; // anchor=top, lightOffset=-0.60
    const g = new THREE.Group();
    const mesh = attachGlowMesh(f, g, def);
    expect(g.children).toContain(mesh);
    expect(mesh.name).toBe(`${f.id}-shade`);
    expect(mesh.name.endsWith('-shade')).toBe(true); // App.tsx:256 拖放命中判定依赖
    expect(mesh.position.y).toBeCloseTo(-0.60, 5);    // 光源在灯罩（资产下方 0.6m）
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(false);
    expect(mesh.userData.fixtureId).toBe(f.id);
    const mat = mesh.material as THREE.MeshStandardMaterial;
    expect(mat.emissiveIntensity).toBe(0);
  });

  it('desk_lamp (anchor=bottom, lightOffset=+0.60) 光源在资产上方', () => {
    const f = makeFixture({ type: 'table' });
    const def = LIGHT_ASSET_DEFS.desk_lamp;
    const g = new THREE.Group();
    const mesh = attachGlowMesh(f, g, def);
    expect(mesh.position.y).toBeCloseTo(0.60, 5); // 底座在原点，灯罩在上方
  });

  it('glow mesh 材质 emissive 颜色跟 cct', () => {
    const f = makeFixture({ type: 'pendant', cct: 3000 });
    const g = new THREE.Group();
    const mesh = attachGlowMesh(f, g, LIGHT_ASSET_DEFS.pendant);
    const mat = mesh.material as THREE.MeshStandardMaterial;
    // 3000K 偏暖，R > B
    expect(mat.emissive.r).toBeGreaterThan(mat.emissive.b);
    // 同时 color 也跟随（applyFixtureCct 只改 emissive，color 保留初值）
    expect(mat.color.r).toBeGreaterThan(mat.color.b);
  });
});

describe('lightAssets: loadLightAsset manifest 缺失分支 (P37)', () => {
  beforeEach(() => {
    _resetLightAssetCacheForTest();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetLightAssetCacheForTest();
  });

  it('manifest 加载失败返回 null', async () => {
    const fakeRenderer = {} as THREE.WebGLRenderer;
    const r = await loadLightAsset('pendant' as LightAssetKey, fakeRenderer);
    expect(r).toBeNull();
  });
});
```

**测试要求**：新增 12 条（assetKeyForType 2 + normalizeAndAnchor 5 +
attachGlowMesh 3 + manifest 分支 1 + 其余 1）。全绿。不 mock `THREE`
本身（three 是真依赖），只用真实 Box3 / Mesh / Group 验证数学。

### 3.6 修改 `scripts/download-assets.py`

**问题**：当前脚本只写 `public/assets/{furniture,lights}/manifest.json`，而
`furnitureAssets.ts:57` 和新增的 `lightAssets.ts` 读的是 `loader-manifest.json`
（含 site 根绝对路径）。家具是 P36 手工写了 `loader-manifest.json`，灯具
还没这份文件。

**改动**：在 `download_models` 函数末尾（写完 `manifest.json` 后）追加生成
`loader-manifest.json`：

```python
    # P37：额外生成 loader-manifest.json（loader 读的绝对路径版本）
    # 家具目录已有手写的 loader-manifest.json（P36），本脚本重写以保证一致性。
    # 灯具目录 P37 首次引入。
    loader_manifest = {}
    for target_name, slug in slug_map.items():
        sub_dir = dest_dir / target_name
        # 找该子目录下的 .gltf 文件
        gltf_files = list(sub_dir.glob('*.gltf'))
        if gltf_files:
            gltf_name = gltf_files[0].name
            rel_path = str((PUBLIC / category_dir_name / target_name / gltf_name).relative_to(REPO_ROOT / 'public'))
            loader_manifest[target_name] = {
                "asset": target_name,
                "gltf": rel_path,
            }
    loader_manifest_path = dest_dir / "loader-manifest.json"
    loader_manifest_path.write_text(json.dumps(loader_manifest, indent=2, ensure_ascii=False))
    print(f"  [loader-manifest] {loader_manifest_path}")
```

**注意**：`download_models` 当前签名没有 `category_dir_name` 参数。调用点
（`main` 里的 `do_furn` / `do_lights`）需要传 `"furniture"` / `"lights"`。

**验证**：脚本改完不必立刻跑（本轮资产已下载好），但必须能通过
`python3 -m py_compile scripts/download-assets.py`。

**手工写灯具 loader-manifest.json 兜底**：由于脚本修改后本轮不会跑，
子代理必须**同时**在 `public/assets/lights/loader-manifest.json` 手写 §3.2 的
JSON 内容，保证 loader 在 dev / build 时能找到路径。脚本修改是为了下一轮
重下资产时自动生成，不是本轮的依赖。

## 4. 明确不做（P37 范围外）

- **不做** `FixtureLibraryPanel` 里的 3D 缩略图预览（离屏渲染缩略图）—— 那是
  P37b 的活儿（需要离屏 WebGLRenderer 管理，本轮不做）。本轮 3D 场景内的接入
  是核心。
- **不做** chandelier 资产的实际接入（`ASSET_KEY_FOR_TYPE.pendant = 'pendant'`
  而非 `'chandelier'`）—— 需要 Fixture 加 `assetKey` 字段或独立的资产选择 UI，
  那是 P37c 的立项。本轮 `LIGHT_ASSET_DEFS.chandelier` 保留定义但无 FixtureType
  引用它。
- **不做** `spot` / `linear` / `cove` / `floor` 类型的资产（Poly Haven 无对应
  高质量资产）—— 这几类继续用程序化几何。
- **不改** `src/core/types.ts`（不加 `assetKey` 字段到 Fixture）。
- **不改** `src/core/makeFixture.ts`（默认 diameter / mount 不变）。
- **不改** `src/render/fixtureModels.ts`（程序化几何保留，作为降级路径）。
- **不改** `src/scene/sceneEngine.ts` 的 `updateHdri` / `loadZoneAssetAsync` /
  `buildOptsForFixture` / `recalculateBudget` / `resolveLevel` / `applyFixtureIntensity`
  / `applyFixtureCct` —— 这些已有逻辑一行不动。
- **不改** `src/render/lightBudget.ts` / `src/render/iesParser.ts` / `src/render/iesTexture.ts`。
- **不改** `CLAUDE.md` / `vite.config.ts` / `tsconfig.json` / `package.json` /
  `package-lock.json` / `vitest.setup.ts` / `eslint.config.js`。
- **不新增 npm 依赖**（GLTFLoader / DRACOLoader 在 three/addons，已装）。
- **不删** 现有测试（942 条）；新增测试只加不减。
- **不修** `public/vendor/draco/` 缺失问题（Poly Haven 未压缩 .bin，DRACOLoader
  不会实际调用，无副作用）。
- **不跑** `scripts/download-assets.py`（网络请求 + CF 限流，本轮资产已到位）。

## 5. 测试要求

- 新增 `src/render/__tests__/lightAssets.test.ts`，≥ 8 条测试（见 §3.5）。
- 全部测试**只测纯函数**，不 mock WebGLRenderer 内部（只 stub 类型 + fetch）。
- **不**在测试里跑 `npm run dev` 或启动浏览器 —— 视觉验证是用户的活儿。
- **不**在测试里加载真实 .gltf（`loadLightAsset` 只测 manifest 缺失分支）。

## 6. 验证

1. `npm test`（不跑 build，快）→ 942 → **954**（新增 12 条）全绿
2. `npm run verify`（typecheck + lint + tests）→ 全绿
3. `npm run build` → 通过；构建产物**仍然只有 2 个 chunk**（index-*.js + three-*.js，
   CLAUDE.md 明令禁止加第三个 chunk）
4. `python3 -m py_compile scripts/download-assets.py` → 通过
5. `ls public/assets/lights/loader-manifest.json` → 存在
6. `ls public/assets/lights/manifest.json` → 仍存在（原脚本产物，不删）
7. `grep -c "import " src/render/lightBuilder.ts` 与改动前一致（**本轮不改 lightBuilder.ts**）
8. `git status --porcelain` → 干净（除新增 / 修改文件外）

## 7. 红线（不可碰）

- **不动** `src/core/types.ts` / `src/core/makeFixture.ts` / `src/store/projectStore.ts` /
  `src/ui/**` 所有 UI（本轮不接 UI，P37b 才动 `FixtureLibraryPanel`）。
- **不动** `src/render/fixtureModels.ts`（程序化几何是降级路径，必须保留）。
- **不动** `src/render/lightBuilder.ts`（**本轮完全不改** —— `buildLightFromFixture`
  保持同步签名，`attachGlowMesh` 放在 `lightAssets.ts`，`markNoShadow` 是
  sceneEngine 私有函数）。
- **不动** `sceneEngine.applyFixtureIntensity` / `applyFixtureCct` / `resolveLevel` /
  `recalculateBudget` / `buildOptsForFixture` / `updateHdri` / `loadZoneAssetAsync`；
  `addFixtureInternal` 只在末尾**追加**一行 `this.loadFixtureAssetAsync(...)`；
  `removeFixtureInternal` 只在现有 if 块内**追加**一行
  `this.fixtureAssetStates.delete(fixtureId)`。
- **不加**新 npm 依赖；**不改** `vite.config.ts` 的 `manualChunks`。
- **不 push**（本地 commit 即可）。
- **不删**测试。新增测试断言必须真断言（不许 `expect(true).toBe(true)` 占位）。
- **不改测试断言**凑合通过；挂了就修代码。

## 8. 提交

```
git add src/render/lightAssets.ts \
        src/render/__tests__/lightAssets.test.ts \
        src/scene/sceneEngine.ts \
        public/assets/lights/loader-manifest.json \
        scripts/download-assets.py \
        docs/P37-spec.md \
        docs/P8-plan.md

git commit -m "P37a: 灯具 GLTF 资产 loader + 接入 3D 场景

- src/render/lightAssets.ts: 5 件灯具资产的 manifest 驱动 loader
  （照抄 furnitureAssets 骨架，独立 loader 实例）
- normalizeAndAnchor 纯函数：主轴向归一化 + 起点锚定（可单测）
- attachGlowMesh: 给 GLTF 资产挂发光面（带 -shade 后缀，App.tsx:256 拖放命中判定依赖）
- sceneEngine.ts: 追加 fixtureAssetStates (attempt token) + loadFixtureAssetAsync
  + 私有 markNoShadow；加载失败回落程序化几何，视觉不缺失；
  entry.shade 替换为资产里的新 glow Mesh，色温/亮度/选中链路不断
- lightBuilder.ts 本轮不改（buildLightFromFixture 保持同步签名）
- public/assets/lights/loader-manifest.json: 5 条 key → gltf 绝对路径
- scripts/download-assets.py: 追加生成 loader-manifest.json（下一轮下资产自动）
- 测试 942 → 954（新增 12 条），全绿"
```

## 9. 关于视觉判定（免责声明）

P37a 的视觉质量（GLTF 模型与程序化几何的比例 / 朝向 / 穿模情况 / 发光面是否
被资产遮住）必须**由用户在真实 GPU 上验收**。本开发环境 WSL2 SwiftShader：

- 3D 渲染可能黑屏 / 材质灰平（无 IBL 加载）——**不要**因此判定 P37a 失败
- `fixtureLights` 是私有字段，验证走 `engine.getScene()` 遍历（fixture group
  的 `name === fixture.id`，见 `lightBuilder.ts:284` `group.name = f.id`）：
  - 资产 Group 已挂到 object：`scene.children.find(c => c.name === id)?.children
    .some(c => c.userData?.p37AssetKey)`
  - 发光面存在且带 `-shade`：`scene.children.find(c => c.name === id)?.children
    .flat().find(c => c.name?.endsWith('-shade'))`
  - 发光面 emissive 链路（applyFixtureIntensity / applyFixtureCct 消费点）：
    `Object.assign({}, glowMesh.material.emissive, { intensity: glowMesh.material.emissiveIntensity })`
- 用 store 侧读数验证选中态：`useProjectStore.getState().selectedFixtureId`
- 用 DOM 属性查询验证 FloorPlan 高亮（P36 的 2D/3D 同步链路）

视觉截图不作数。用户会在本地跑 dev server 亲眼看画面，若比例不对 / 朝向错，
P37a-fix 或 P37b 立项修。
