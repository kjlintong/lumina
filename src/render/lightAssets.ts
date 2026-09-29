/**
 * GLTF 灯具资产加载（P37a + P37a-fix）。
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
 *
 * **P37a-fix（2026-09）**：
 *   1. normalizeAndAnchor 的平移量算法改对 —— 原假设资产顶点关于原点居中，
 *      实际不对称（pendant y=-1.340..0.015、ceiling_lamp y=0.221..1.173 悬空），
 *      现在按 box.max/min 算平移量，anchor 语义正确。
 *   2. 新增 findEmissiveMeshes：找资产自带的 emissive Mesh（bulb/light/globe）。
 *   3. attachGlowMesh 重写：优先复用 emissive 网格，无则回落小圆片。
 *   4. LIGHT_ASSET_DEFS 的 targetSize 用真实几何推算的合理值。
 *      chandelier 保留原值（axis='horizontal' 判断本就错，留到 P37d）。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import type { Fixture, FixtureType } from '../core/types.js';
import { cctToRGB } from './lightBuilder.js';

/** 有资产的灯具类型 key（与 public/assets/lights/loader-manifest.json 的 key 一致） */
export type LightAssetKey = 'pendant' | 'chandelier' | 'desk_lamp' | 'wall_sconce' | 'ceiling_lamp';

/** 有资产覆盖的 FixtureType 子集（P37d：chandelier 独立，不再共用 pendant） */
export const FIXTURE_TYPES_WITH_ASSETS: readonly FixtureType[] = [
  'pendant', // → 'pendant'
  'table',
  'sconce',
  'downlight',
  'chandelier',  // P37d：吊灯（独立 FixtureType，不再共用 pendant）
] as const;

/**
 * FixtureType → 代表资产 key 的映射。
 * 未列出的 FixtureType（'spot' / 'linear' / 'cove' / 'floor'）本轮无资产，
 * 直接回落程序化几何。
 *
 * 'pendant' 同时覆盖 chandelier 的外观：本阶段选 'pendant' 资产作为代表
 * （hanging_industrial_lamp，工业风吊灯），chandelier 资产的接入留给 P37d
 * 立项（需 Fixture 加 `assetKey` 字段或独立的资产选择 UI）。
 */
export const ASSET_KEY_FOR_TYPE: Partial<Record<FixtureType, LightAssetKey>> = {
  pendant: 'pendant',
  table: 'desk_lamp',
  sconce: 'wall_sconce',
  downlight: 'ceiling_lamp',
  chandelier: 'chandelier',  // P37d
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
 * `lightOffset`：**仅回落路径**（无 emissive 网格的资产）使用，
 * 表示光源沿主轴向相对原点的偏移（米）。正数 = 沿 +轴方向；负数 = 反向。
 * emissive mesh 复用分支完全不读这个字段（发光面直接复用资产自带的 bulb）。
 * 见 §3.3 的注释：wall_sconce 是唯一无 emissive 的类型，其他都走 emissive 分支。
 *
 * **targetSize 取值来源**（P37a-fix，见 §3.3）：
 *   - pendant 0.45（真实灯头 h≈0.30m + 吊杆 → 综合视觉重量 0.45）
 *   - ceiling_lamp 0.30（真实 h=0.952，缩到 0.30 视觉合理）
 *   - wall_sconce 0.35（真实 h=0.342 保持）
 *   - desk_lamp 0.55（真实 h=0.893，缩到 0.55 视觉合理）
 *   - chandelier 0.8（P37d 修正：真实 y 跨度 0.7983m，取 0.8）
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
  /** 光源（发光面中心）沿主轴向相对原点的偏移（米），仅回落路径用 */
  lightOffset: number;
}

export const LIGHT_ASSET_DEFS: Record<LightAssetKey, LightAssetDef> = {
  // pendant 真实灯头（不含吊杆）h≈0.30m；targetSize=0.45 兼顾视觉重量和真实感
  pendant:      { name: 'pendant',      axis: 'vertical',   targetSize: 0.45, anchor: 'top',    lightOffset: -0.42 },
  // ceiling_lamp 真实 h=0.952，缩到 0.30 视觉合理
  ceiling_lamp: { name: 'ceiling_lamp', axis: 'vertical',   targetSize: 0.30, anchor: 'top',    lightOffset: -0.13 },
  // wall_sconce 真实 h=0.342 保持，但 wall 类无 emissive mesh → 走回落路径
  wall_sconce:  { name: 'wall_sconce',  axis: 'vertical',   targetSize: 0.35, anchor: 'top',    lightOffset: -0.18 },
  // desk_lamp 真实 h=0.893，缩到 0.55 视觉合理
  desk_lamp:    { name: 'desk_lamp',    axis: 'vertical',   targetSize: 0.55, anchor: 'bottom', lightOffset:  0.43 },
  // chandelier P37d 修正：实测 y 跨度 0.7983m 是主轴（三轴近似相等，y 是垂直悬挂方向），
  // targetSize 取 0.8 与真实几何匹配；anchor='top' 让吊点（顶部）对齐原点，向下延伸；
  // lightOffset=-0.4 是灯泡重心位置（y 跨度 0.8m 的中下）
  chandelier:   { name: 'chandelier',   axis: 'vertical',   targetSize: 0.8,  anchor: 'top',    lightOffset: -0.4 },
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
 *     （本阶段无类型使用 center）
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
  // Three.js 父节点的 matrix = T(scene.position) * S(scene.scale)；
  // 子节点 world = scene.position + scene.scale * asset_local。
  // **scene.position 不被 scene.scale 缩放**（不同于子节点的 local position）。
  // 所以要 anchor 对齐原点：world(anchor) = scene.position + scale * anchor = 0
  //  → scene.position = -scale * anchor（在 world 空间；注意不是 asset 空间）
  //
  // 注意：真实资产顶点不关于原点居中（见 §2 表），所以不能用对称轴心假设。
  // box.max 是资产坐标系的绝对值。
  const ax = anchor === 'top' ? box.max.x : anchor === 'bottom' ? box.min.x : (box.min.x + box.max.x) / 2;
  const ay = anchor === 'top' ? box.max.y : anchor === 'bottom' ? box.min.y : (box.min.y + box.max.y) / 2;
  const az = anchor === 'top' ? box.max.z : anchor === 'bottom' ? box.min.z : (box.min.z + box.max.z) / 2;

  scene.scale.setScalar(scale);
  scene.position.set(-ax * scale, -ay * scale, -az * scale);

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
// 发光面（P37a-fix：优先复用资产 emissive mesh）
// ---------------------------------------------------------------------------

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
    const mesh = o as THREE.Object3D & {
      isMesh?: boolean;
      material?: THREE.Material | THREE.Material[] | null;
    };
    if (!mesh.isMesh) return;
    const rawMats = mesh.material;
    const mats = Array.isArray(rawMats) ? rawMats : rawMats ? [rawMats] : [];
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
  const firstEmissive = emissiveMeshes[0];
  if (emissiveMeshes.length > 0 && firstEmissive) {
    const mesh = firstEmissive;
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
