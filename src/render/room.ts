/**
 * 房间外壳构建（P1 渲染层）
 *
 * 由 (宽, 深, 高) 生成一个封闭房间：
 *  - 地面位于 y = 0
 *  - 四面墙体从地面升到 y = height
 *  - 天花板位于 y = height
 *
 * 坐标系约定（与领域模型 §5 一致）：房间中心位于世界原点，
 * x = 东西，z = 南北，y 向上。
 *
 * 材质选择：地面 / 墙体 / 天花板统一使用浅灰 MeshStandardMaterial
 * （高粗糙度、无金属度，模拟乳胶漆 / 石膏）。用 PBR 材质而非默认的
 * MeshBasicMaterial 是关键 —— MeshBasicMaterial 完全忽略光照，会把
 * PointLight / SpotLight / RectAreaLight 的物理光全部吃掉，场景将
 * 一片死色；只有标准着色器才会产生可读的漫反射响应。
 *
 * 阴影策略（配合 backend.ts 中 renderer.shadowMap.enabled = true）：
 *  - 地面：只 receiveShadow，castShadow = false。
 *    地面在 y = 0，是房间体积内的最低面，任何灯具都在 y > 0，
 *    因此地面物理上不可能遮挡任何光源；投阴影零收益，
 *    反而因自相交近平行产生阴影 acne 伪影。
 *  - 墙体 / 天花板：receiveShadow + castShadow 均为 true。
 *    墙体必须投射阴影 —— 否则天花灯具的光会穿透墙体打到房间外，
 *    房间外的几何体会被错误照亮，整个照度场失真。
 *    天花板同理：墙灯 / 落地灯若不投射到天花板，光会泄漏到屋顶以上。
 *    它们同时接收阴影，才能呈现灯具遮挡与光斑边缘。
 *
 * 使用注意：四面墙 + 天花板构成封闭体积。相机若在房间外将看不到内部；
 * 做室内视角时请从 `group` 中移除朝向相机的面，或把相机放进房间内。
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
 * 由房间尺寸构建房间外壳。
 *
 * @param width  房间宽度（x 方向，米），必须为正
 * @param depth  房间深度（z 方向，米），必须为正
 * @param height 层高（y 方向，米），必须为正
 * @throws 任一尺寸非正数时抛出 —— 零 / 负尺寸的 Plane 与 Box 会产生退化几何，
 *         让光照与阴影静默出错，因此在入口处直接拒绝
 */
export function buildRoom(width: number, depth: number, height: number): RoomBuildResult {
  if (!(width > 0) || !(depth > 0) || !(height > 0)) {
    throw new Error(`buildRoom: 尺寸必须为正数，收到 (width=${width}, depth=${depth}, height=${height})`);
  }

  const wallThickness = 0.15;
  // 地面 / 墙体 / 天花板统一浅灰 MeshStandardMaterial：乳胶漆/石膏观感，
  // 高粗糙度无金属度，让物理光在表面上产生可读的漫反射而非被默认
  // MeshBasicMaterial 的无光照着色吃掉。
  const surfaceColor = 0xe6e6e6;
  const surfaceRoughness = 0.95;
  const surfaceMetalness = 0.0;
  const makeSurfaceMaterial = (): MeshStandardMaterial =>
    new MeshStandardMaterial({
      color: surfaceColor,
      roughness: surfaceRoughness,
      metalness: surfaceMetalness,
    });

  // 地板（xz 平面，y=0）。法线经 rotation.x = -PI/2 由 +Z 转为 +Y（朝上）。
  const floor = new Mesh(new PlaneGeometry(width, depth), makeSurfaceMaterial());
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  // 地面在 y=0，是房间内最低物体，不可能遮挡任何灯具（灯具 y>0），
  // 因此投阴影毫无收益，反而因近平行产生 acne 伪影 → 不投射。
  floor.castShadow = false;

  // 天花板（xz 平面，y=height）。法线经 rotation.x = +PI/2 转为 -Y（朝房间内部），
  // 否则相机会看到其背面。
  const ceiling = new Mesh(new PlaneGeometry(width, depth), makeSurfaceMaterial());
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = height;
  ceiling.receiveShadow = true;
  // 天花板必须投射阴影，否则墙灯/落地灯的光会穿透天花板打到房间外，
  // 整个照度场失真。
  ceiling.castShadow = true;

  // 四堵墙。BoxGeometry 中心 y = height/2，恰好从地面升到天花板。
  // 沿 x 方向的两堵墙共用同一份几何体（几何只读，可安全共享）。

  // 北墙（z = -depth/2）
  const northWall = new Mesh(
    new BoxGeometry(width, height, wallThickness),
    makeSurfaceMaterial(),
  );
  northWall.position.set(0, height / 2, -depth / 2);
  northWall.receiveShadow = true;
  northWall.castShadow = true;

  // 南墙（z = +depth/2）
  const southWall = new Mesh(
    new BoxGeometry(width, height, wallThickness),
    makeSurfaceMaterial(),
  );
  southWall.position.set(0, height / 2, depth / 2);
  southWall.receiveShadow = true;
  southWall.castShadow = true;

  // 东墙（x = +width/2）
  const eastWall = new Mesh(
    new BoxGeometry(wallThickness, height, depth),
    makeSurfaceMaterial(),
  );
  eastWall.position.set(width / 2, height / 2, 0);
  eastWall.receiveShadow = true;
  eastWall.castShadow = true;

  // 西墙（x = -width/2）
  const westWall = new Mesh(
    new BoxGeometry(wallThickness, height, depth),
    makeSurfaceMaterial(),
  );
  westWall.position.set(-width / 2, height / 2, 0);
  westWall.receiveShadow = true;
  westWall.castShadow = true;

  const walls = [northWall, southWall, eastWall, westWall];

  const group = new Group();
  group.add(floor, ceiling, ...walls);
  group.name = 'room';

  return { group, walls, floor, ceiling };
}
