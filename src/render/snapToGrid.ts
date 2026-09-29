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
 * P37c：按 mount 类型计算「灯具与安装面接触点」的世界坐标。
 *
 * 取代原 `dropPosFromHit(point, normal, 0.03)` 的统一偏移。原实现不管 mount
 * 类型，一律沿法线偏移 0.03m —— 对 `recessed`（筒灯）是错的（应该平齐），
 * 对 `anchor='top'` 类的灯也对，但对 `anchor='bottom'` 类的灯（floor / tabletop）
 * 也覆盖了不该偏移的量。
 *
 * **normal 语义**（P37c spec §4.2 结论）：法线指向**房间内**。这是 Three.js
 * `hit.face.normal` 的实际语义：用户看到的正面朝向。所以：
 * - 天花板 normal = (0, +1, 0)（朝上=朝房间外，实际是从外看向内的方向）
 * - 地面 normal = (0, -1, 0)（朝下=朝房间外）
 * - 墙面 normal = 水平方向
 *
 * 统一公式：`pos = point - normal * offset`。三种表面都成立：
 * - ceiling：point.y = 2.8, normal = (0,1,0) → pos.y = 2.8 - 1*0.03 = 2.77 ✓
 * - floor：point.y = 0, normal = (0,-1,0) → pos.y = 0 - (-1)*0.03 = 0.03 ✓
 * - wall（x=3，朝房间内为 -X，朝房间外为 +X）：normal = (1,0,0) → pos.x = 3 - 0.03 = 2.97 ✓
 *
 * @param point 表面上的命中点（世界坐标）
 * @param normal 表面法线（世界坐标，归一化，指向房间内）
 * @param mount 灯具安装类型
 * @param offsetM 沿法线的偏移（米），recessed 默认 0，其他 0.03
 * @returns pos 的世界坐标
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
  // recessed = 嵌入式，灯具顶端与表面平齐（不伸出）
  const offset = mount === 'recessed' ? 0 : offsetM;
  return [
    point[0] - normal[0] * offset,
    point[1] - normal[1] * offset,
    point[2] - normal[2] * offset,
  ];
}

/**
 * P37c：把 pos 投影回安装面（用于 TransformControls 拖动结束时「贴回」表面）。
 *
 * 拖动过程中 pos 会脱离表面（用户在 3D 空间自由拖动），拖动结束时调用本
 * 函数把 pos 投影回原安装面。
 *
 * 语义：给一个灯具（含 mount + 当前 pos），计算它「应该贴在哪」：
 *   1. 用 mount 查表面法线方向（ceiling/recessed/suspended: +Y, floor/tabletop: -Y）
 *   2. 把 pos 沿法线方向投影回表面（保留水平坐标，只修正垂直距离）
 *   3. 再套 surfaceSnap 加 offset
 *
 * **注意**：本函数**不处理 wall** —— wall 的法线是水平的，需要面 ID 才能确定
 * 方向（不是 mount 决定的）。wall 类灯具的拖动约束留到 P37c-fix（见 spec §8）。
 * 本函数对 `mount='wall'` 直接返回原 pos（引用相等）。
 *
 * @param pos 当前 pos（可能被用户拖到任意位置）
 * @param mount 灯具安装类型
 * @param surfaceY 安装面的 Y 坐标（ceiling=天花板高，floor=0）；wall 走另一分支
 * @param offsetM 沿法线的偏移（米），recessed 默认 0，其他 0.03
 * @returns 贴回表面后的 pos
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
  offsetM = 0.03,
): readonly [number, number, number] {
  // wall 类暂不处理：返回原 pos（不改动，等 P37c-fix）
  if (mount === 'wall') return pos;

  // ceiling / recessed / suspended：安装面是 y = surfaceY 的平面，法线 (0,+1,0)
  // floor / tabletop：安装面是 y = surfaceY 的平面，法线 (0,-1,0)
  const isTop =
    mount === 'ceiling' || mount === 'recessed' || mount === 'suspended';
  const normal: readonly [number, number, number] = isTop ? [0, 1, 0] : [0, -1, 0];
  // 投影到表面：只保留 x, z，y 强制到 surfaceY
  const onSurface: readonly [number, number, number] = [pos[0], surfaceY, pos[2]];
  return surfaceSnap(onSurface, normal, mount, offsetM);
}
