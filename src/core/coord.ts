/**
 * 坐标与单位换算。
 *
 * 核心约定：
 * - 世界坐标系：y 向上，x 向东，z 向南（右手系）。与 Three.js 一致。
 * - ActivityZone.pos 是 [x, z]（地面平面定位），区中心默认在 y=0。
 * - FixtureBinding.offsets 定义在**区局部坐标系**（ADR-13）：局部 x 沿区宽方向，
 *   局部 z 沿区深方向，局部 y 向上。
 * - 绕 Y 轴旋转采用标准右手系：正角把 +Z 转向 +X。
 *
 * 这些函数是**纯函数**，不依赖 three（测试可直接在 node 跑）。
 */

/** 区局部坐标偏移 [dx, dy, dz] 在给定 rotY 下旋转到世界坐标增量 [wx, wy, wz] */
export function localOffsetToWorld(
  dx: number,
  dy: number,
  dz: number,
  rotY: number,
): readonly [wx: number, wy: number, wz: number] {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  // 绕 Y 轴右手旋转：x' = x·cosθ + z·sinθ,  z' = -x·sinθ + z·cosθ
  return [dx * c + dz * s, dy, -dx * s + dz * c] as const;
}

/**
 * 区局部坐标 -> 世界坐标（含区中心平移）。
 * 用于「区旋转 90° 后绑定灯具排列方向跟着转」的判定。
 */
export function localToWorld(
  pos: readonly [x: number, z: number],
  rotY: number,
  local: readonly [lx: number, ly: number, lz: number],
): readonly [x: number, y: number, z: number] {
  const [offX, offY, offZ] = localOffsetToWorld(local[0], local[1], local[2], rotY);
  return [pos[0] + offX, offY, pos[1] + offZ] as const;
}

/**
 * 世界坐标 -> 区局部坐标（localToWorld 的逆）。
 * 用途：把已存在的世界坐标灯具「锚定」到区时，反算出局部偏移。
 */
export function worldToLocal(
  pos: readonly [x: number, z: number],
  rotY: number,
  world: readonly [x: number, y: number, z: number],
): readonly [lx: number, ly: number, lz: number] {
  const rx = world[0] - pos[0];
  const rz = world[2] - pos[1];
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  // 逆旋转 = 旋转 -θ：x = x·cosθ - z·sinθ,  z = x·sinθ + z·cosθ
  return [rx * c - rz * s, world[1], rx * s + rz * c] as const;
}

/**
 * 给定世界坐标位置、目标朝向与半尺寸，计算点在区局部平面内的旋转对齐框包围判定。
 * 用于「点是否在某活动区内」（房间归属判定思路，射线法在 modeling 层做，这里是区范围判定）。
 */
export function pointInZoneLocal(
  p: readonly [x: number, z: number],
  pos: readonly [x: number, z: number],
  rotY: number,
  size: readonly [w: number, d: number],
): boolean {
  // 取世界 (x,z) 到区局部
  const rx = p[0] - pos[0];
  const rz = p[1] - pos[1];
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const lx = rx * c - rz * s;
  const lz = rx * s + rz * c;
  return Math.abs(lx) <= size[0] / 2 && Math.abs(lz) <= size[1] / 2;
}
