/**
 * 拖放时根据命中面法线推断安装方式（P28 / P37c-fix）。
 *
 * TransformControls 拖拽前的初始 mount 由拖放 raycast 结果决定。法线是世界空间，
 * 与灯具当前朝向对齐（例如贴墙安装时法线朝房间内侧）。
 *
 * **normal 约定**：朝房间内（与 surfaceSnap 一致）。
 *   天花 (0,-1,0)  地面 (0,+1,0)  东墙 (-1,0,0)  西墙 (+1,0,0)
 *
 * 阈值 0.7（cos60°）：法线必须明确指向某个方向，模糊的斜角回落到 'wall'。
 */

export type DropMount =
  | 'ceiling'
  | 'recessed'
  | 'suspended'
  | 'track'
  | 'wall'
  | 'floor'
  | 'tabletop';

/**
 * @param normal 命中面法线（朝房间内）
 * @param opts.fromInside true = 从房间内部点表面（常规），
 *                        false = 从外部（罕用，如相机在天花板上方）。默认 true。
 */
export function mountFromNormal(
  normal: readonly [number, number, number],
  opts: { fromInside?: boolean } = {},
): DropMount {
  const fromInside = opts.fromInside ?? true;
  const ny = normal[1];
  if (Math.abs(ny) < 0.7) return 'wall'; // 水平面

  // |ny| >= 0.7：是天花板或地面。
  // 从房间内部看表面时，法线的 y 分量取反才代表「朝房间内」的方向：
  //   dir = -ny
  //   天花 ny = -1 → dir = +1 > 0.7  → 'ceiling'
  //   地面 ny = +1 → dir = -1 < -0.7 → 'floor'
  // fromInside=false（相机在表面外侧）时不取反。
  const dir = fromInside ? -ny : ny;
  if (dir > 0.7) return 'ceiling';
  if (dir < -0.7) return 'floor';
  return 'suspended'; // 边界模糊
}

/**
 * 拖放命中位置到灯具 pos 的转换：pos = 命中点 + 法线 * 半个灯体偏移。
 * 简化用固定 30mm 偏移（真实灯体半径从 fixture.shape.diameter 派生留后续）。
 */
export function dropPosFromHit(
  point: readonly [number, number, number],
  normal: readonly [number, number, number],
  offsetM = 0.03,
): readonly [number, number, number] {
  return [
    point[0] + normal[0] * offsetM,
    point[1] + normal[1] * offsetM,
    point[2] + normal[2] * offsetM,
  ];
}
