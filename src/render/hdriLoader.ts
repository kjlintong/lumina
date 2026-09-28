/**
 * HDRI 环境加载（Phase 2 §1，P35）。
 *
 * Poly Haven CC0 资产，2K equirectangular HDR。
 * 文件路径：/assets/hdris/{key}.hdr（Vite public/ 静态目录）。
 *
 * 三档：
 *   - venice_sunset_2k   — 黄金时刻（方案 §1 原文要求「必须有」）
 *   - quarry_2k          — 白昼
 *   - venice_night_2k    — 夜晚
 *
 * **降级**：若 loadAsync 抛错（文件缺失、网络失败、HDR 解码失败），返回 null。
 * 调用方保留 PMREM(RoomEnvironment) 作为兜底（现有 sceneEngine.initEnvironment
 * 已经用过 RoomEnvironment，视觉无退化）。
 *
 * 不新增 npm 依赖：RGBELoader 在 three/addons/loaders 下已存在。
 * RGBELoader 在 three r186 已弃用（改用 HDRLoader），但仍可用；此处沿用
 * 规格指定的名字，避免与规格脱节。
 */
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

export type HDRIKey = 'venice_sunset_2k' | 'quarry_2k' | 'venice_night_2k';
export const HDRI_LIST: readonly HDRIKey[] = ['venice_sunset_2k', 'quarry_2k', 'venice_night_2k'];

export function getHdriUrl(key: HDRIKey): string {
  return `/assets/hdris/${key}.hdr`;
}

let pmremGen: THREE.PMREMGenerator | null = null;
/** 缓存：加载成功一次后复用（key → envMap texture） */
const cache: Partial<Record<HDRIKey, THREE.Texture>> = {};

/** 供测试重置缓存（避免跨用例污染） */
export function _resetHdriCacheForTest(): void {
  for (const k of Object.keys(cache) as HDRIKey[]) {
    cache[k]?.dispose();
    delete cache[k];
  }
  pmremGen?.dispose();
  pmremGen = null;
}

export async function loadHdri(
  key: HDRIKey,
  renderer: THREE.WebGLRenderer,
): Promise<THREE.Texture | null> {
  const cached = cache[key];
  if (cached) return cached;
  if (!pmremGen) {
    try {
      pmremGen = new THREE.PMREMGenerator(renderer);
    } catch (err) {
      console.warn('[hdriLoader] PMREMGenerator 初始化失败，回落到 RoomEnvironment IBL', err);
      return null;
    }
  }

  try {
    const texture = await new HDRLoader().loadAsync(getHdriUrl(key));
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

/**
 * 按太阳高度角选择 HDRI。
 *   - elevation < 0      → 夜晚（venice_night_2k）
 *   - elevation ∈ [0, π/12) → 日落（venice_sunset_2k）
 *   - 其它              → 白昼（quarry_2k）
 */
export function pickHdriBySunElevation(elevation: number): HDRIKey {
  const PI = Math.PI;
  if (elevation < 0) return 'venice_night_2k';
  if (elevation < PI / 12) return 'venice_sunset_2k';
  return 'quarry_2k';
}
