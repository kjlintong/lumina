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
