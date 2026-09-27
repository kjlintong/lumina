/**
 * 从 ModelGeometry 构建 3D 房间组（P23 §4）。
 *
 * 替换 P22 的 rebuildRoom 简化实现（只改宽高），
 * 真正从 walls[] / openings[] / rooms[] / slab 挤出几何体。
 *
 * 坐标系（与 modeling.ts 一致）：
 *   - x：东西向，右为正
 *   - z：南北向，负为北
 *   - y：上为正
 *
 * 世界坐标以米为单位（modeling.ts 铁律 1）。
 */

import * as THREE from 'three';
import type {
  ModelGeometry,
  WallSegment,
  Opening,
} from '../core/modeling.js';
import { modelBounds } from './modelPlanLayout.js';

// ---------------------------------------------------------------------------
// 材质预设（§4 材质参数）
// ---------------------------------------------------------------------------

const FLOOR_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x8b7355,
  roughness: 0.4,
  metalness: 0.0,
});

const WALL_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xf5f5f0,
  roughness: 0.9,
  metalness: 0.0,
});

const CEILING_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.95,
  metalness: 0.0,
});

const DOOR_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x6b4423,
  roughness: 0.6,
  metalness: 0.0,
});

const WINDOW_GLASS_MATERIAL = new THREE.MeshPhysicalMaterial({
  transmission: 1.0,
  ior: 1.5,
  roughness: 0.05,
  thickness: 0.01,
  color: 0xffffff,
  metalness: 0.0,
});

// ---------------------------------------------------------------------------
// 墙体挤出
// ---------------------------------------------------------------------------

/**
 * 单条墙段 → BoxGeometry。
 *
 * 墙体沿 a→b 方向放置，厚度在左侧（从用户视角看墙）。
 * BoxGeometry 的长轴对齐世界 x，所以先放成 (len, h, t) 再旋转。
 */
function buildWallSegment(wall: WallSegment): THREE.Mesh {
  const dx = wall.b[0] - wall.a[0];
  const dz = wall.b[1] - wall.a[1];
  const length = Math.sqrt(dx * dx + dz * dz);
  const angle = Math.atan2(dz, dx);

  const geo = new THREE.BoxGeometry(length, wall.height, wall.thickness);
  const mesh = new THREE.Mesh(geo, WALL_MATERIAL);

  // 位置：段中点，y = height/2
  mesh.position.set(
    (wall.a[0] + wall.b[0]) / 2,
    wall.height / 2,
    (wall.a[1] + wall.b[1]) / 2,
  );
  // 旋转：沿 a→b 方向
  mesh.rotation.y = -angle;

  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// 开口切割
// ---------------------------------------------------------------------------

/**
 * 开口 → 玻璃面或门框。
 *
 * 门：sill = 0，移除一段墙（简化：在开口位置放一个深色门框 Mesh）。
 * 窗：sill > 0，放玻璃面。
 */
function buildOpening(opening: Opening, wall: WallSegment): THREE.Mesh | null {
  if (!wall) return null;

  const wallLen = Math.sqrt(
    (wall.b[0] - wall.a[0]) ** 2 + (wall.b[1] - wall.a[1]) ** 2,
  );
  if (wallLen === 0) return null;

  // 沿墙方向
  const ux = (wall.b[0] - wall.a[0]) / wallLen;
  const uz = (wall.b[1] - wall.a[1]) / wallLen;
  // 法线方向（左侧）
  const nx = -uz;
  const nz = ux;

  // 起点（沿墙 offset 处）
  const startX = wall.a[0] + ux * opening.offset;
  const startZ = wall.a[1] + uz * opening.offset;

  // 中心点
  const midX = startX + (ux * opening.width) / 2;
  const midZ = startZ + (uz * opening.width) / 2;
  // 法线方向中心（墙外侧）
  const cx = midX + (nx * wall.thickness) / 2;
  const cz = midZ + (nz * wall.thickness) / 2;

  if (opening.kind === 'window') {
    // 玻璃面
    const geo = new THREE.PlaneGeometry(opening.width, opening.height);
    const mesh = new THREE.Mesh(geo, WINDOW_GLASS_MATERIAL);
    mesh.position.set(cx, opening.sill + opening.height / 2, cz);
    mesh.rotation.y = -Math.atan2(uz, ux);
    return mesh;
  }

  // 门：深色门框（简化，不做真实切割）
  const geo = new THREE.BoxGeometry(
    opening.width,
    opening.height,
    wall.thickness + 0.02,
  );
  const mesh = new THREE.Mesh(geo, DOOR_MATERIAL);
  mesh.position.set(
    midX + (nx * wall.thickness) / 2,
    opening.height / 2,
    midZ + (nz * wall.thickness) / 2,
  );
  mesh.rotation.y = -Math.atan2(uz, ux);
  return mesh;
}

// ---------------------------------------------------------------------------
// 主构建函数
// ---------------------------------------------------------------------------

/**
 * 从 ModelGeometry 构建完整 3D 房间组。
 *
 * @returns THREE.Group，包含地板、天花、墙体、开口
 * @throws 当 model 为空（walls + rooms 都为空）时返回空 Group
 */
export function buildModelRoom(model: ModelGeometry): THREE.Group {
  const group = new THREE.Group();
  group.name = 'model-room';

  // 空画布检查
  if (model.walls.length === 0 && model.rooms.length === 0) {
    return group;
  }

  const bounds = modelBounds(model);
  if (bounds === null) return group;

  // 1. 地板
  const floorGeo = new THREE.PlaneGeometry(bounds.width, bounds.depth);
  const floor = new THREE.Mesh(floorGeo, FLOOR_MATERIAL);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  group.add(floor);

  // 2. 天花
  const ceilGeo = new THREE.PlaneGeometry(bounds.width, bounds.depth);
  const ceiling = new THREE.Mesh(ceilGeo, CEILING_MATERIAL);
  ceiling.rotation.x = -Math.PI / 2;
  ceiling.position.y = model.slab.ceilingH;
  ceiling.receiveShadow = true;
  group.add(ceiling);

  // 3. 墙体
  const wallMap = new Map<string, WallSegment>();
  for (const w of model.walls) {
    wallMap.set(w.id, w);
    group.add(buildWallSegment(w));
  }

  // 4. 开口
  for (const o of model.openings) {
    const wall = wallMap.get(o.wallId);
    if (wall === undefined) continue;
    const mesh = buildOpening(o, wall);
    if (mesh !== null) group.add(mesh);
  }

  // 5. 房间标签（可选：地面区域着色）
  // 本阶段不做，P24 可加

  return group;
}

// re-export 材质供测试断言
export {
  FLOOR_MATERIAL,
  WALL_MATERIAL,
  CEILING_MATERIAL,
  DOOR_MATERIAL,
  WINDOW_GLASS_MATERIAL,
};
