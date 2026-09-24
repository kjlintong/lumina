/**
 * 房间几何体构建器（P1）
 *
 * 从尺寸参数生成简单的 3D 房间模型。
 * 用于快速预览和渲染管线测试。
 *
 * 架构依据：工程方案 §4.6
 */

import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';

/** 房间构建结果 */
export interface RoomBuildResult {
  /** 包含所有几何体的 Group */
  group: Group;
  /** 四堵墙 */
  walls: Mesh[];
  /** 地板 */
  floor: Mesh;
  /** 天花板 */
  ceiling: Mesh;
}

/**
 * 构建房间几何体。
 *
 * @param width 房间宽度（x 方向，米）
 * @param depth 房间深度（z 方向，米）
 * @param height 房间高度（y 方向，米）
 * @returns 包含所有房间几何体的构建结果
 */
export function buildRoom(width: number, depth: number, height: number): RoomBuildResult {
  const wallThickness = 0.15;
  const wallMat = new MeshStandardMaterial({
    color: 0xf5f5f0,
    roughness: 0.9,
    metalness: 0.0,
  });
  const floorMat = new MeshStandardMaterial({
    color: 0xd4c4a8,
    roughness: 0.85,
    metalness: 0.0,
  });
  const ceilingMat = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0.0,
  });

  // 地板（xz 平面，y=0）
  const floor = new Mesh(new PlaneGeometry(width, depth), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.castShadow = false;

  // 天花板（xz 平面，y=height）
  const ceiling = new Mesh(new PlaneGeometry(width, depth), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = height;
  ceiling.receiveShadow = true;
  ceiling.castShadow = false;

  // 四堵墙
  // 北墙（z = -depth/2）
  const northWall = new Mesh(new BoxGeometry(width, height, wallThickness), wallMat);
  northWall.position.set(0, height / 2, -depth / 2);
  northWall.receiveShadow = true;
  northWall.castShadow = true;

  // 南墙（z = +depth/2）
  const southWall = new Mesh(new BoxGeometry(width, height, wallThickness), wallMat);
  southWall.position.set(0, height / 2, depth / 2);
  southWall.receiveShadow = true;
  southWall.castShadow = true;

  // 东墙（x = +width/2）
  const eastWall = new Mesh(new BoxGeometry(wallThickness, height, depth), wallMat);
  eastWall.position.set(width / 2, height / 2, 0);
  eastWall.receiveShadow = true;
  eastWall.castShadow = true;

  // 西墙（x = -width/2）
  const westWall = new Mesh(new BoxGeometry(wallThickness, height, depth), wallMat);
  westWall.position.set(-width / 2, height / 2, 0);
  westWall.receiveShadow = true;
  westWall.castShadow = true;

  const walls = [northWall, southWall, eastWall, westWall];

  const group = new Group();
  group.add(floor, ceiling, ...walls);
  group.name = 'room';

  return { group, walls, floor, ceiling };
}
