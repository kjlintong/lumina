/**
 * 50mm 网格吸附（P28，3D）。
 *
 * 与 P22 的 2D 网格吸附不同：那是 PlanToWorld 的 0.1m 网格。这里 0.05m
 * 是产品体验上更好的粒度（审查方案 §Phase 1 第 4 项明确「50mm 网格吸附」）。
 *
 * 用于拖放落点（App.handleDropFixture）。TransformControls 的拖拽吸附走
 * three.js 自带的 `tc.translationSnap = 0.05`（不重复造轮子）。
 *
 * 吸附策略：`Math.round(v / step) * step`；负值正常四舍五入（round 而非 floor）。
 */

export const FIXTURE_GRID_M = 0.05;

export function snapFixturePos(
  pos: readonly [number, number, number],
  step: number = FIXTURE_GRID_M,
): readonly [number, number, number] {
  const round = (v: number) => Math.round(v / step) * step;
  return [round(pos[0]), round(pos[1]), round(pos[2])];
}

/**
 * 按 mount 类型计算「灯具与安装面接触点」的世界坐标。
 *
 * **normal 约定**：朝房间内（从房间看向表面，法线指向观察者）。
 *   天花 (0,-1,0)  地面 (0,+1,0)  东墙 (-1,0,0)  西墙 (+1,0,0)
 * 公式：pos = point + normal * offset
 *
 * offset：recessed=0（嵌入，灯具顶端与表面平齐），其他 0.03m。
 */
export function surfaceSnap(
  point: readonly [number, number, number],
  normal: readonly [number, number, number],
  mount:
    | 'ceiling'
    | 'recessed'
    | 'suspended'
    | 'wall'
    | 'floor'
    | 'tabletop'
    | 'track',
  offsetM = 0.03,
): readonly [number, number, number] {
  const offset = mount === 'recessed' ? 0 : offsetM;
  return [
    point[0] + normal[0] * offset,
    point[1] + normal[1] * offset,
    point[2] + normal[2] * offset,
  ];
}

/**
 * 把 pos 投影回安装面（TransformControls 拖动结束时贴回）。
 *
 * @param pos 当前 pos（可能被用户拖到任意位置）
 * @param mount 灯具安装类型
 * @param surfaceY 水平安装面的 Y 坐标（ceiling=天花板高，floor/tabletop=桌面/地面高）
 * @param installNormal wall 灯的安装面法线（朝房间内）；非 wall 类忽略
 * @param offsetM 沿法线的偏移，recessed 默认 0，其他 0.03
 * @returns 贴回表面后的 pos
 *
 * 幂等性：对已在表面的 pos，返回值等于输入（拖动多次不漂移）。
 */
export function projectToSurface(
  pos: readonly [number, number, number],
  mount:
    | 'ceiling'
    | 'recessed'
    | 'suspended'
    | 'wall'
    | 'floor'
    | 'tabletop'
    | 'track',
  surfaceY: number,
  installNormal?: readonly [number, number, number],
  offsetM = 0.03,
): readonly [number, number, number] {
  const offset = mount === 'recessed' ? 0 : offsetM;

  if (mount === 'wall') {
    // 墙面：需要 installNormal 才能投影（水平法线，方向取决于哪面墙）。
    // 无记录 → 不投影（回落）。
    if (!installNormal) return pos;
    // wall 灯本来就离墙 offset 米（沿 installNormal 朝房间内方向），
    // 拖动后要把它推回墙面 = 沿 installNormal 反方向平移 offset。
    return [
      pos[0] - installNormal[0] * offset,
      pos[1] - installNormal[1] * offset,
      pos[2] - installNormal[2] * offset,
    ];
  }

  // 水平安装面：保留 x, z，y 强制到 surfaceY。
  // normal 朝房间内：ceiling/recessed/suspended/track 是 (0,-1,0)，
  // floor/tabletop 是 (0,+1,0)。
  const isTop =
    mount === 'ceiling' || mount === 'recessed' || mount === 'suspended' || mount === 'track';
  const normal: readonly [number, number, number] = isTop ? [0, -1, 0] : [0, 1, 0];
  return [pos[0] + normal[0] * offset, surfaceY + normal[1] * offset, pos[2] + normal[2] * offset];
}
