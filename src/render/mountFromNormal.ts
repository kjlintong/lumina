/**
 * 拖放时根据命中面法线推断安装方式（P28）。
 *
 * TransformControls 拖拽前的初始 mount 由拖放 raycast 结果决定。法线是世界空间，
 * 与灯具当前朝向对齐（例如贴墙安装时法线朝房间内侧）。
 *
 * 阈值 0.7（cos60°）：法线必须明确指向某个方向，模糊的斜角回落到 'wall'。
 *
 * 注意：`DropMount` 是 `MountType` 的子集（不含 'track'）—— 命中面只能是天花 /
 * 墙 / 地面，轨道灯属于用户后续手动调整的类型，不在拖放自动推断范围。
 */

export type DropMount = 'ceiling' | 'recessed' | 'wall' | 'floor' | 'tabletop' | 'suspended';

export function mountFromNormal(normal: readonly [number, number, number]): DropMount {
  const ny = normal[1];
  if (ny > 0.7) return 'ceiling';        // 面向上（吸顶）
  if (ny < -0.7) return 'recessed';      // 面向下（筒灯：灯安装在天花内，光朝下）
  if (Math.abs(ny) < 0.7) return 'wall'; // 侧面朝房间
  return 'suspended';                    // 兜底
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
