/**
 * 拓扑校验规则引擎（执行规格 §6 范围 8，「规则层，必过」）。
 *
 * §6 范围 8 的 5 条规则：房间闭合、门窗落在墙段内、墙段端点连通、面积与标注
 * 一致、比例尺与单位自洽。
 *
 * **每条规则独立导出，返回定位到具体 id 的违规列表**（§4 红线 2：违规报告
 * 绝不得只返回 boolean，必须定位到 `elementIds`）。
 *
 * 浮点比较一律走 `units.ts` 的 `close()`，禁止 `===` / `toFixed`
 * （`units.ts` 文件头明令，§4 红线 4）。
 *
 * 纯函数，无 DOM / canvas 依赖，jsdom 下可单测。
 */

import type {
  ModelGeometry,
  Opening,
  PlanePoint,
  RoomPolygon,
  WallSegment,
} from './modeling.js';
import { METERS_PER_UNIT, confirmScale } from './scale.js';
import { close } from './units.js';

/** 5 条规则的稳定 id（用于 UI 展示与「只修这一项」入口定位） */
export type TopologyRule =
  | 'room_closed'
  | 'opening_on_wall'
  | 'wall_endpoints_connected'
  | 'area_matches_label'
  | 'scale_self_consistent';

/** 违规报告：定位到具体 id，附带数值证据 */
export interface RuleViolation {
  rule: TopologyRule;
  message: string;
  /** 相关元素 id；单条违规可涉多个元素 */
  elementIds: readonly string[];
  /** 可测的数值证据（例如实际面积 / 期望面积 / 连通缺口米数） */
  detail?: Record<string, number>;
}

export interface TopologyReport {
  violations: readonly RuleViolation[];
  /** 必过规则全部通过（§6「规则层，必过」） */
  passed: boolean;
}

/**
 * 拓扑容差（米）。
 *
 * 取 0.01（1 cm）= 户型可接受的最小端点误差。
 * `units.ts` 的 `close` 默认 eps 是 1e-6（1 微米），太严 —— 户型扫描图上
 * 1 像素的抖动就会超过 1 微米，导致所有端点都被判不连通。
 */
export const TOPOLOGY_EPSILON = 0.01;

/**
 * 面积与标注的相对容差。
 *
 * 取 5%：shoelace 公式对顶点顺序敏感，扫描图上手工描的多边形与标注面积
 * 常有几个百分点的偏差；5% 是一个经验阈值，能区分「基本一致」与「真的错了」。
 * 相对误差而非绝对误差 —— 因为小房间和大房间的绝对偏差不可比。
 */
export const AREA_RELATIVE_TOLERANCE = 0.05;

/** 墙端点连通容差（米）。同 `TOPOLOGY_EPSILON`，单列出来便于策略调整。 */
export const WALL_ENDPOINT_EPSILON = 0.01;

/** 计算墙长（米） */
export function wallLength(wall: WallSegment): number {
  const dx = wall.b[0] - wall.a[0];
  const dz = wall.b[1] - wall.a[1];
  return Math.hypot(dx, dz);
}

/** Shoelace 公式算多边形面积（米²）。顶点无需预先闭合。 */
export function roomArea(room: RoomPolygon): number {
  const n = room.vertices.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const p1 = room.vertices[i];
    const p2 = room.vertices[(i + 1) % n];
    if (p1 === undefined || p2 === undefined) continue; // 防御性跳过
    sum += p1[0] * p2[1] - p2[0] * p1[1];
  }
  return Math.abs(sum) / 2;
}

/** 三点是否共线（退化三角形）。用叉积 + 容差判定。 */
function isCollinear(p: PlanePoint, q: PlanePoint, r: PlanePoint, eps: number): boolean {
  const cross = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return Math.abs(cross) < eps;
}

// ---------------------------------------------------------------------------
// 规则 1：房间多边形闭合（§6 范围 8）
// ---------------------------------------------------------------------------

/** 房间多边形闭合：首尾顶点 `close(a, b, 0.01)` 必须成立。 */
export function checkRoomClosed(rooms: readonly RoomPolygon[]): RuleViolation[] {
  const violations: RuleViolation[] = [];
  for (const room of rooms) {
    if (room.vertices.length < 3) {
      violations.push({
        rule: 'room_closed',
        message: `房间「${room.name}」顶点数不足 3，无法构成多边形`,
        elementIds: [room.id],
        detail: { vertexCount: room.vertices.length },
      });
      continue;
    }
    const first = room.vertices[0];
    const last = room.vertices[room.vertices.length - 1];
    if (first === undefined || last === undefined) {
      // 理论上不可达（上面已检查 length >= 3），显式判违规避免静默跳过
      violations.push({
        rule: 'room_closed',
        message: `房间「${room.name}」顶点数组异常`,
        elementIds: [room.id],
      });
      continue;
    }
    if (
      !close(first[0], last[0], TOPOLOGY_EPSILON) ||
      !close(first[1], last[1], TOPOLOGY_EPSILON)
    ) {
      violations.push({
        rule: 'room_closed',
        message: `房间「${room.name}」首尾顶点未闭合（容差 ${TOPOLOGY_EPSILON} m）`,
        elementIds: [room.id],
        detail: {
          gapX: Math.abs(first[0] - last[0]),
          gapZ: Math.abs(first[1] - last[1]),
        },
      });
      continue;
    }
    // 退化检查：三点共线 = 面积为 0，不是有效房间
    const v1 = room.vertices[1];
    const v2 = room.vertices[2];
    if (v1 === undefined || v2 === undefined) continue; // 防御性跳过
    if (isCollinear(first, v1, v2, TOPOLOGY_EPSILON)) {
      violations.push({
        rule: 'room_closed',
        message: `房间「${room.name}」退化：前三个顶点共线`,
        elementIds: [room.id],
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// 规则 2：门窗落在墙段内（§6 范围 8）
// ---------------------------------------------------------------------------

/** 开口必须挂在存在的墙段上，且 `offset + width ≤ 墙长`。 */
export function checkOpeningOnWall(
  walls: readonly WallSegment[],
  openings: readonly Opening[],
): RuleViolation[] {
  const violations: RuleViolation[] = [];
  const wallMap = new Map(walls.map((w) => [w.id, w]));
  for (const opening of openings) {
    const wall = wallMap.get(opening.wallId);
    if (!wall) {
      violations.push({
        rule: 'opening_on_wall',
        message: `开口「${opening.id}」引用的墙段「${opening.wallId}」不存在（孤儿开口）`,
        elementIds: [opening.id],
      });
      continue;
    }
    const len = wallLength(wall);
    if (opening.offset < 0) {
      violations.push({
        rule: 'opening_on_wall',
        message: `开口「${opening.id}」起点偏移为负（${opening.offset} m）`,
        elementIds: [opening.id, wall.id],
        detail: { offset: opening.offset },
      });
      continue;
    }
    // 用 close() 判定「恰好等于墙长」的边界，避免 === 引入浮点误差
    if (opening.offset + opening.width > len && !close(opening.offset + opening.width, len, 1e-6)) {
      violations.push({
        rule: 'opening_on_wall',
        message: `开口「${opening.id}」超出墙段长度（起点 ${opening.offset} + 宽 ${opening.width} > 墙长 ${len}）`,
        elementIds: [opening.id, wall.id],
        detail: { offset: opening.offset, width: opening.width, wallLength: len },
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// 规则 3：墙段端点连通（§6 范围 8）
// ---------------------------------------------------------------------------

/**
 * 墙段端点连通：对每对墙段，若某端点与另一墙段的端点 `close(..., 0.01)`
 * 则视为连通；统计孤立端点（不被任何 1cm 容差内端点匹配）。
 * 孤立端点数 > 0 → 违规，`elementIds` 列出孤立端点所属墙段。
 */
export function checkWallEndpointsConnected(walls: readonly WallSegment[]): RuleViolation[] {
  if (walls.length < 2) return [];

  const violations: RuleViolation[] = [];
  const endpoints: { wallId: string; p: PlanePoint }[] = [];
  for (const w of walls) {
    endpoints.push({ wallId: w.id, p: w.a });
    endpoints.push({ wallId: w.id, p: w.b });
  }

  // 孤立端点 = 未被任何**其他墙段**的端点（容差内）匹配
  const orphanWallIds = new Set<string>();
  for (const ep of endpoints) {
    let connected = false;
    for (const other of endpoints) {
      if (other.wallId === ep.wallId) continue; // 墙段自己的 a 与 b 不算连通
      if (
        close(ep.p[0], other.p[0], WALL_ENDPOINT_EPSILON) &&
        close(ep.p[1], other.p[1], WALL_ENDPOINT_EPSILON)
      ) {
        connected = true;
        break;
      }
    }
    if (!connected) orphanWallIds.add(ep.wallId);
  }

  if (orphanWallIds.size > 0) {
    const ids = [...orphanWallIds];
    violations.push({
      rule: 'wall_endpoints_connected',
      message: `${ids.length} 条墙段存在孤立端点（容差 ${WALL_ENDPOINT_EPSILON} m）`,
      elementIds: ids,
      detail: { orphanWallCount: ids.length },
    });
  }
  return violations;
}

// ---------------------------------------------------------------------------
// 规则 4：面积与标注一致（§6 范围 8）
// ---------------------------------------------------------------------------

/**
 * 面积与标注一致：shoelace 算面积与 `labeledArea` 比较，相对容差 5%。
 * 未提供 `labeledArea` 的房间跳过（不制造假违规）。
 */
export function checkAreaMatchesLabel(rooms: readonly RoomPolygon[]): RuleViolation[] {
  const violations: RuleViolation[] = [];
  for (const room of rooms) {
    if (room.labeledArea === undefined) continue; // 未标注 → 跳过
    const actual = roomArea(room);
    const labeled = room.labeledArea;
    if (labeled <= 0) continue; // 无效标注 → 跳过（不制造假违规）
    const relErr = Math.abs(actual - labeled) / labeled;
    if (relErr > AREA_RELATIVE_TOLERANCE) {
      violations.push({
        rule: 'area_matches_label',
        message: `房间「${room.name}」实际面积 ${actual.toFixed(3)} m² 与标注 ${labeled} m² 偏差 ${
          relErr * 100
        }% 超过容差 ${AREA_RELATIVE_TOLERANCE * 100}%`,
        elementIds: [room.id],
        detail: { actualArea: actual, labeledArea: labeled, relativeError: relErr },
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// 规则 5：比例尺与单位自洽（§6 范围 8）
// ---------------------------------------------------------------------------

/**
 * 比例尺与单位自洽：`calibration === null` → 违规（§4 红线 5：未标定不得入库使用）；
 * 否则校验 `confirmScale` 通过，且 `toMeters` 落在 `PLAUSIBLE_TO_METERS` 内。
 */
export function checkScaleSelfConsistent(model: ModelGeometry): RuleViolation[] {
  if (model.calibration === null) {
    return [
      {
        rule: 'scale_self_consistent',
        message: '几何未标定比例尺，不得参与面积/误差判定',
        elementIds: [],
      },
    ];
  }
  const cal = model.calibration;
  const violations: RuleViolation[] = [];

  // 复用 confirmScale 的判定（含 realDistance 区间夹逼 + toMeters 数学合法性）
  if (!confirmScale(cal)) {
    violations.push({
      rule: 'scale_self_consistent',
      message: `标定量级异常（realDistance=${cal.realDistance} ${cal.realUnit}，toMeters=${cal.toMeters}），疑似单位混淆`,
      elementIds: [],
      detail: {
        realDistance: cal.realDistance,
        toMeters: cal.toMeters,
      },
    });
  }

  // 单位表合法性检查（防止未来引入新单位时漏改 METERS_PER_UNIT）
  const factor = METERS_PER_UNIT[cal.realUnit];
  if (!Number.isFinite(factor) || factor <= 0) {
    violations.push({
      rule: 'scale_self_consistent',
      message: `单位「${cal.realUnit}」的换算因子非法（factor=${factor}）`,
      elementIds: [],
      detail: { factor },
    });
  }

  return violations;
}

// ---------------------------------------------------------------------------
// 聚合入口
// ---------------------------------------------------------------------------

/**
 * 聚合 5 条规则。每条规则独立可测（§4 必测清单要求），聚合入口只负责组合。
 *
 * `passed === violations.length === 0`（§4 红线 2 的必测项）。
 */
export function checkTopology(model: ModelGeometry): TopologyReport {
  const violations = [
    ...checkRoomClosed(model.rooms),
    ...checkOpeningOnWall(model.walls, model.openings),
    ...checkWallEndpointsConnected(model.walls),
    ...checkAreaMatchesLabel(model.rooms),
    ...checkScaleSelfConsistent(model),
  ];
  return { violations, passed: violations.length === 0 };
}
