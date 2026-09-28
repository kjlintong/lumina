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
export const FURNITURE_LIST: readonly FurnitureKey[] = ['sofa', 'bed', 'table', 'chair', 'cabinet'];

let loader: GLTFLoader | null = null;
/** 缓存：加载成功一次后复用（key → GLTF scene Group） */
const assetCache: Partial<Record<FurnitureKey, THREE.Group>> = {};

function ensureLoader(renderer: THREE.WebGLRenderer): GLTFLoader {
  if (loader) return loader;
  const l = new GLTFLoader();
  const draco = new DRACOLoader();
  // Draco WASM 由 Vite 走 public/vendor/draco/；文件缺失时 GLTFLoader 会自动
  // 跳过 Draco 压缩（对未压缩 GLB 无副作用），加载失败走 catch 分支降级。
  draco.setDecoderPath('/vendor/draco/');
  l.setDRACOLoader(draco);
  try {
    const ktx2 = new KTX2Loader();
    ktx2.detectSupport(renderer);
    l.setKTX2Loader(ktx2);
  } catch (err) {
    // KTX2 detectSupport 在极早期（renderer 未 init）可能抛；KTX2 纹理缺失
    // 也不阻塞 GLB 主流程——GLTFLoader 会在无 KTX2Loader 时用 LinearFilter
    // 兜底（对 uncompressed PNG/JPG 贴图无影响）。
    console.warn('[furnitureAssets] KTX2Loader detectSupport 失败，用非压缩贴图兜底', err);
  }
  loader = l;
  return l;
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
  // 同步清除 loader 单例：让测试可以在下一个用例里覆盖 GLTFLoader mock
  loader = null;
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
