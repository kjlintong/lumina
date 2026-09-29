/**
 * GLTF 家具资产加载（Phase 2 §3，P35；P36 升级为 manifest 驱动 + 分离 .gltf）。
 *
 * 5 件核心家具（方案 §1 原文）：sofa / bed / table / chair / cabinet。
 *
 * 路径解析（P36）：从 `public/assets/furniture/loader-manifest.json` 读
 * `FurnitureKey → gltf` 映射，不再硬编码 `{key}.glb`。Poly Haven 实际下载的是
 * 分离格式（`.gltf + .bin + textures/`），GLTFLoader 会按 .gltf 的 base URL 自动
 * 解析相对路径，无需 KHR 扩展。
 *   - manifest 里**没有**的 key（如 chair/cabinet 404 未下载）→ 直接返回 null 回落。
 *   - manifest 加载失败 → 返回 null，整体回落程序化。
 *
 * **降级**：加载失败返回 null，调用方用现有 furniture.ts 的程序化 fallback。
 * 不新增 npm 依赖——GLTFLoader/DRACOLoader 都在 three/addons。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

export type FurnitureKey = 'sofa' | 'bed' | 'table' | 'chair' | 'cabinet';
export const FURNITURE_LIST: readonly FurnitureKey[] = ['sofa', 'bed', 'table', 'chair', 'cabinet'];

let loader: GLTFLoader | null = null;
/** 缓存：加载成功一次后复用（key → GLTF scene Group） */
const assetCache: Partial<Record<FurnitureKey, THREE.Group>> = {};
/**
 * manifest 单例缓存（P36）。
 * 键：FurnitureKey；值：相对 public/ 的 .gltf 绝对路径
 * （例如 '/assets/furniture/sofa/ArmChair_01_1k.gltf'）。null = 尚未加载。
 */
let manifestCache: Map<string, string> | null = null;

// _renderer 保留签名（P35 曾用于 KTX2 detectSupport；P36 移除 KTX2 后不再使用，
// 但 loadFurniture 公开签名不变，未来若重新接入压缩贴图可恢复）。
function ensureLoader(_renderer: THREE.WebGLRenderer): GLTFLoader {
  if (loader) return loader;
  const l = new GLTFLoader();
  const draco = new DRACOLoader();
  // Draco WASM 由 Vite 走 public/vendor/draco/；文件缺失时 GLTFLoader 会自动
  // 跳过 Draco 压缩（对未压缩 .bin 无副作用），加载失败走 catch 分支降级。
  // P36：移除 KTX2Loader —— Poly Haven 用 JPG/PNG 贴图（images[].mimeType =
  // "image/jpeg"），KTX2 用不上。DRACOLoader 保留：.bin 是标准 binary buffer
  // 非 Draco 压缩，挂在 loader 上无副作用（仅遇 KHR_draco_mesh_compression 才调用）。
  draco.setDecoderPath('/vendor/draco/');
  l.setDRACOLoader(draco);
  loader = l;
  return l;
}

/**
 * 加载 loader-manifest.json，返回 FurnitureKey → .gltf 绝对路径的映射。
 * 失败（404 / 网络 / JSON 解析）返回 null，调用方整体回落程序化。结果缓存单例。
 */
async function loadManifest(): Promise<Map<string, string> | null> {
  if (manifestCache) return manifestCache;
  try {
    const res = await fetch('/assets/furniture/loader-manifest.json');
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, { gltf: string }>;
    const m = new Map<string, string>();
    for (const [k, v] of Object.entries(data)) {
      m.set(k, `/${v.gltf}`); // 前缀 / 保证绝对 URL
    }
    manifestCache = m;
    return m;
  } catch (err) {
    console.warn('[furnitureAssets] manifest 加载失败，回落到程序化家具', err);
    return null;
  }
}

/** 供测试重置缓存（避免跨用例污染 + 释放 GPU 资源） */
export function _resetFurnitureCacheForTest(): void {
  for (const k of Object.keys(assetCache) as FurnitureKey[]) {
    const g = assetCache[k];
    if (g) {
      g.traverse((o) => {
        const m = o as unknown as { geometry?: THREE.BufferGeometry | null; material?: THREE.Material | THREE.Material[] | null };
        m.geometry?.dispose();
        if (Array.isArray(m.material)) m.material.forEach((x) => x.dispose());
        else m.material?.dispose();
      });
    }
    delete assetCache[k];
  }
  // 同步清除 manifest / loader 单例：让测试可以在下一个用例里覆盖 mock
  manifestCache = null;
  loader = null;
}

export async function loadFurniture(
  key: FurnitureKey,
  renderer: THREE.WebGLRenderer,
): Promise<THREE.Group | null> {
  const cached = assetCache[key];
  if (cached) return cached;

  const manifest = await loadManifest();
  const gltfPath = manifest?.get(key);
  if (gltfPath === undefined) return null; // manifest 里没有这个 key → 直接回落

  try {
    const l = ensureLoader(renderer);
    const gltf = await l.loadAsync(gltfPath);
    // 归一化（P36）：polyhaven 家具是真实尺寸（沙发 0.9m 深、床 2m 长），
    // 按 box.max.y 缩放到 1m 会变形。改为**只水平居中 + 贴地**，不改尺寸。
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const center = box.getCenter(new THREE.Vector3());
    gltf.scene.position.x -= center.x; // 水平居中
    gltf.scene.position.z -= center.z;
    gltf.scene.position.y -= box.min.y; // 贴地
    gltf.scene.updateMatrixWorld(true);
    // GLTFLoader 返回的 scene 就是 Group
    assetCache[key] = gltf.scene;
    return gltf.scene;
  } catch (err) {
    console.warn(`[furnitureAssets] ${key} 加载失败，回落到程序化模型`, err);
    return null;
  }
}

/**
 * 靠墙吸附：包围盒最近点距墙 <0.08m 时，贴到墙面 + 对齐墙法线。
 * 简化实现：沿墙的左侧法线方向把 obj 中心移到「距墙 0.05m」处。
 * 用于加载完成的 GLTF 家具，让「沙发/床」等重物贴合墙根。
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
  // 墙左侧法线（绕 Y 轴逆时针 90°）
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
