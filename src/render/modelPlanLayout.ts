/**
 * 建模（户型图导入）布局数学（P22 §3.3）。
 *
 * 与既有 `planLayout.ts`（手绘房间 + 活动区 + 灯具）并列：`planLayout` 处理
 * `LuminaProject.zones` / `fixtures`，本文件处理 `LuminaProject.model`
 * （`ModelGeometry`，P21 数据契约）。
 *
 * 架构与 `planLayout.ts` 一致：布局抽纯函数，组件是薄壳。
 * 无任何 Three.js / DOM 依赖，jsdom 下可直接单测。
 *
 * 坐标系约定（继承 `planLayout.ts`，不得翻转）：
 *   - 世界 x：东西向，右为正
 *   - 世界 z：南北向，**负为北**
 *   - SVG y：向下为正
 *   - 因此 `SVG_y = originY + z * scale`（z 越小 → y 越小 → 图纸顶部 = 北）
 */

import type { ModelGeometry } from '../core/modeling.js';
import type { WallSegment, RoomPolygon, Opening } from '../core/modeling.js';
import { wallLength, roomArea } from '../core/topology.js';
import { close } from '../core/units.js';

// ---------------------------------------------------------------------------
// 视图配置
// ---------------------------------------------------------------------------

/** 平面图视图配置（与 `planLayout.PlanViewConfig` 同构，但不复用其类型） */
export interface ModelPlanViewConfig {
  /** 绘图区宽（SVG 用户单位，通常是 px） */
  width: number;
  /** 绘图区高 */
  height: number;
  /** 像素/米。由 drawWidth 与模型包围盒自动算出 */
  scale?: number;
  /** 左右边距（米，世界坐标外留白） */
  margin?: number;
}

// ---------------------------------------------------------------------------
// 包围盒与房间尺寸
// ---------------------------------------------------------------------------

/**
 * ModelGeometry 的世界包围盒（米）。
 *
 * **中心归零到世界原点**：先把所有顶点整体平移使几何中心落在原点，
 * 再取 max-min。理由：`sceneEngine` 的房间是「中心在原点，x∈±w/2, z∈±d/2」
 * （`sceneEngine.ts:321`），不归零会让 3D 房间整体偏移到墙角。
 * 这是 2D/3D 同源的关键。
 *
 * `walls` 与 `rooms` 都为空时返回 `null`（空画布）。
 */
export function modelBounds(model: ModelGeometry): { width: number; depth: number } | null {
  const points: [number, number][] = [];
  for (const w of model.walls) {
    points.push([w.a[0], w.a[1]], [w.b[0], w.b[1]]);
  }
  for (const r of model.rooms) {
    for (const v of r.vertices) points.push([v[0], v[1]]);
  }
  if (points.length === 0) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { width: maxX - minX, depth: maxZ - minZ };
}

/**
 * 包围盒 + 层高 → 引擎侧房间尺寸。
 *
 * 注意：**不要**复用 `planLayout.RoomDims` 类型 —— 那是 2D 平面图的视图配置
 * （带 SVG px），而 3D 侧 `sceneEngine` 读的是 `SceneEngineConfig.roomWidth /
 * roomDepth`（米）。这里返回引擎侧的形状，避免把两种语义混成一个类型。
 *
 * 空 model（`walls` 和 `rooms` 都空）返回 `null`。
 */
export function modelToRoomDims(
  model: ModelGeometry,
): { width: number; depth: number; height: number } | null {
  const bounds = modelBounds(model);
  if (bounds === null) return null;
  return { width: bounds.width, depth: bounds.depth, height: model.slab.ceilingH };
}

// ---------------------------------------------------------------------------
// 墙段 / 房间 / 开口 → SVG
// ---------------------------------------------------------------------------

/** 墙段 → SVG 端点（复用 `worldToPlan`，不另写一套坐标变换） */
export function wallsToSvg(
  walls: readonly WallSegment[],
  ox: number,
  oy: number,
  scale: number,
): { id: string; x1: number; y1: number; x2: number; y2: number }[] {
  return walls.map((w) => {
    const p1 = worldToPlan(w.a[0], w.a[1], ox, oy, scale);
    const p2 = worldToPlan(w.b[0], w.b[1], ox, oy, scale);
    return { id: w.id, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  });
}

/**
 * 房间多边形 → SVG path 数据 + 中心标签位置。
 *
 * `d` 用 `M ... L ... Z` 语法，首尾重合的顶点不会画成额外线段。
 * `cx` / `cy` 取几何中心（顶点均值），供组件放房间名标签。
 */
export function roomsToPaths(
  rooms: readonly RoomPolygon[],
  ox: number,
  oy: number,
  scale: number,
): { id: string; name: string; d: string; cx: number; cy: number }[] {
  return rooms.map((r) => {
    const pts = r.vertices.map(([x, z]) => worldToPlan(x, z, ox, oy, scale));
    let cxSum = 0;
    let cySum = 0;
    for (const p of pts) {
      cxSum += p.x;
      cySum += p.y;
    }
    const cx = cxSum / pts.length;
    const cy = cySum / pts.length;
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ') + ' Z';
    return { id: r.id, name: r.name, d, cx, cy };
  });
}

/**
 * 开口 → SVG 线段与类型。
 *
 * 沿墙以 `offset` 表示（`modeling.ts:100-101`）：起点 = a + offset * 方向。
 * 返回的线段是开口在墙上的覆盖区间（用于画蓝色窗段 / 门缺口）。
 */
export function openingsToSvg(
  openings: readonly Opening[],
  walls: readonly WallSegment[],
  ox: number,
  oy: number,
  scale: number,
): { id: string; kind: 'door' | 'window'; x1: number; y1: number; x2: number; y2: number }[] {
  const wallMap = new Map(walls.map((w) => [w.id, w]));
  return openings.flatMap((o) => {
    const wall = wallMap.get(o.wallId);
    if (wall === undefined) return [];
    const len = wallLength(wall);
    if (len === 0) return [];
    const dx = wall.b[0] - wall.a[0];
    const dz = wall.b[1] - wall.a[1];
    const ux = dx / len;
    const uz = dz / len;
    const s = Math.min(o.offset, len);
    const e = Math.min(o.offset + o.width, len);
    const a = worldToPlan(wall.a[0] + ux * s, wall.a[1] + uz * s, ox, oy, scale);
    const b = worldToPlan(wall.a[0] + ux * e, wall.a[1] + uz * e, ox, oy, scale);
    return [{ id: o.id, kind: o.kind, x1: a.x, y1: a.y, x2: b.x, y2: b.y }];
  });
}

// ---------------------------------------------------------------------------
// 描墙吸附（范围 4「网格吸附、正交吸附、长度与角度锁定」）
// ---------------------------------------------------------------------------

/** 网格吸附步长（米）。0.1m = 10cm，住宅可施工的最小刻度。 */
export const GRID_SNAP_M = 0.1;

/** 正交吸附的角度阈值（度）。小于该角度吸附到水平或竖直。 */
export const ORTHO_ANGLE_DEG = 15;

/** 网格吸附：把点吸附到最近的 `gridM` 网格交点。 */
export function snapToGrid(
  p: readonly [x: number, z: number],
  gridM: number,
): readonly [number, number] {
  if (gridM <= 0) return p;
  const gx = Math.round(p[0] / gridM) * gridM;
  const gz = Math.round(p[1] / gridM) * gridM;
  return [gx, gz];
}

/**
 * 正交吸附：给「上一顶点」与「当前鼠标点」，若连线与水平/竖直的夹角
 * 小于 ORTHO_ANGLE_DEG 则吸附到该方向。
 *
 * 用角度判定（atan2），不用 `===` 比较坐标（`units.ts` 文件头明令）。
 * 返回一个新的点，不改入参。
 */
export function snapOrtho(
  from: readonly [x: number, z: number],
  to: readonly [x: number, z: number],
): readonly [number, number] {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  if (dx === 0 && dz === 0) return to;
  const angleRad = Math.atan2(Math.abs(dz), Math.abs(dx));
  const angleDeg = (angleRad * 180) / Math.PI;
  if (angleDeg <= ORTHO_ANGLE_DEG) {
    // 接近水平：锁 z
    return [to[0], from[1]];
  }
  if (angleDeg >= 90 - ORTHO_ANGLE_DEG) {
    // 接近竖直：锁 x
    return [from[0], to[1]];
  }
  return to;
}

/**
 * 描墙点 → 世界坐标（SVG 反向变换，用 `worldToPlan` 的逆）。
 * `worldToPlan(x, z) = { x: ox + x*scale, y: oy + z*scale }`
 * 逆：`x = (sx - ox) / scale`, `z = (sy - oy) / scale`。
 */
export function planToWorld(
  sx: number,
  sy: number,
  ox: number,
  oy: number,
  scale: number,
): readonly [number, number] {
  return [(sx - ox) / scale, (sy - oy) / scale];
}

/**
 * 点集首末闭合：若首末 `close(..., 0.01)` 则去掉重复末点，
 * 否则补上首点坐标。
 */
export function closeVertices(
  pts: readonly (readonly [x: number, z: number])[],
): readonly (readonly [x: number, z: number])[] {
  if (pts.length < 3) return pts;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (close(first[0], last[0], 0.01) && close(first[1], last[1], 0.01)) {
    // 已闭合：去掉重复末点
    return pts.slice(0, -1);
  }
  // 未闭合：补上首点坐标
  return [...pts, first];
}

// ---------------------------------------------------------------------------
// 坐标变换（复用 `planLayout.worldToPlan` 的语义，但本文件独立实现以避免
// 循环依赖 —— `planLayout.ts` 不 import 本文件，但为了保持纯函数独立性
// 这里复制同样的公式，测试会验证两者一致）
// ---------------------------------------------------------------------------

/**
 * 世界 (x, z) → SVG (x, y)。z 负（北）在上方。
 * 公式与 `planLayout.worldToPlan` 完全一致。
 */
export function worldToPlan(
  x: number,
  z: number,
  ox: number,
  oy: number,
  scale: number,
): { x: number; y: number } {
  return { x: ox + x * scale, y: oy + z * scale };
}

/**
 * 计算像素/米：让模型包围盒（加边距）刚好铺满绘图区，取宽高方向的较小值。
 * 与 `planLayout.computeScale` 同构。
 */
export function computeModelScale(bounds: { width: number; depth: number }, config: ModelPlanViewConfig): number {
  const margin = config.margin ?? 0.4;
  const worldW = bounds.width + margin * 2;
  const worldD = bounds.depth + margin * 2;
  return Math.min(config.width / worldW, config.height / worldD);
}

/**
 * 计算绘图原点（SVG 坐标）。房间中心在世界原点，因此 origin 就是绘图区中心。
 * 与 `planLayout.planOrigin` 同构。
 */
export function modelPlanOrigin(config: ModelPlanViewConfig): { ox: number; oy: number } {
  return { ox: config.width / 2, oy: config.height / 2 };
}

// ---------------------------------------------------------------------------
// 端点吸附（P33）
// ---------------------------------------------------------------------------

/** 端点吸附候选点（世界坐标，米） */
export interface SnapCandidate {
  x: number;
  z: number;
}

/**
 * 端点吸附半径（米）。
 *
 * 取 0.15：大于 `GRID_SNAP_M`（0.1）保证端点优先于网格；小于 0.3 保证不误吸
 * 到远处顶点（住宅户型最小开间 2.7m，0.15m 半径在正常鼠标操作下已足够宽容）。
 */
export const ENDPOINT_SNAP_RADIUS_M = 0.15;

/**
 * 从候选集中吸附最近端点。
 *
 * 在距离**小于** `radiusM`（严格小于；边界处 `d == radiusM` 不吸附）的候选中
 * 取最近的一个；无候选或全部超出半径返回 null。
 * 等距时取遍历到的**第一个**（用严格 `<` 判定「更近」，保持结果稳定，便于测试）。
 */
export function snapEndpoint(
  p: readonly [x: number, z: number],
  candidates: readonly SnapCandidate[],
  radiusM: number = ENDPOINT_SNAP_RADIUS_M,
): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  let bestDist = radiusM;
  for (const c of candidates) {
    // abs 屏蔽 IEEE 754 -0/+0 假 tie；用 < 而不是 <= 保证等距时取遍历到的第一个
    const d = Math.hypot(Math.abs(c.x - p[0]), Math.abs(c.z - p[1]));
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/**
 * 汇总吸附候选点。
 *
 * 来源：`model.walls` 每个端点（a/b）+ `model.rooms` 每个顶点 +
 * 当前已放置的 `pendingVertices`（**排除最后一个**，因为它就是"上一顶点"，
 * 不该吸附回自己；保留前面的点便于闭合多边形时吸附回首点）。
 *
 * 不去重：候选集通常几十到几百个，去重的复杂度不值得；`snapEndpoint` 取
 * 最近的那个即可，同一点重复出现只是多做几次 hypot。
 */
export function collectSnapCandidates(
  model: ModelGeometry,
  pendingVertices: readonly (readonly [x: number, z: number])[] = [],
): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  for (const w of model.walls) {
    out.push({ x: w.a[0], z: w.a[1] });
    out.push({ x: w.b[0], z: w.b[1] });
  }
  for (const r of model.rooms) {
    for (const v of r.vertices) out.push({ x: v[0], z: v[1] });
  }
  for (let i = 0; i + 1 < pendingVertices.length; i++) {
    const v = pendingVertices[i]!;
    out.push({ x: v[0], z: v[1] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 尺寸标注（P33）
// ---------------------------------------------------------------------------

/** 墙段尺寸标注：SVG 中点偏移 8px 沿墙法线外侧，文本 = `2.40m` */
export interface WallLabel {
  /** SVG 坐标（已含偏移），直接用于 `<text x={x} y={y}>` */
  x: number;
  y: number;
  /** 已格式化的长度文本 */
  text: string;
  /** 文本旋转角（度）；轴对齐墙（水平/竖直）为 0，斜墙沿墙方向 */
  angle: number;
}

/**
 * 墙段 → 标注。
 *
 * 位置：墙 SVG 中点沿法线外侧偏移 8px（避免压墙线）。
 * 角度：轴对齐墙（与水平/竖直夹角 < 15°）保持文本水平；斜墙沿墙方向旋转，
 * 并翻转 180° 保证文本不朝下（`raw > 90 → raw - 180`）。
 */
export function wallLabels(
  walls: readonly WallSegment[],
  ox: number,
  oy: number,
  scale: number,
): WallLabel[] {
  const out: WallLabel[] = [];
  for (const w of walls) {
    const a = worldToPlan(w.a[0], w.a[1], ox, oy, scale);
    const b = worldToPlan(w.b[0], w.b[1], ox, oy, scale);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const svgLen = Math.hypot(dx, dy);
    if (svgLen === 0) continue;
    const ux = dx / svgLen;
    const uy = dy / svgLen;
    // 法线（左侧）；偏移 8px 让文本落在墙线外侧
    const px = -uy * 8;
    const py = ux * 8;
    const raw = (Math.atan2(dy, dx) * 180) / Math.PI;
    let angle = 0;
    if (Math.abs(Math.abs(raw) - 90) > ORTHO_ANGLE_DEG && Math.abs(raw) > ORTHO_ANGLE_DEG) {
      angle = raw > 90 ? raw - 180 : raw;
    }
    out.push({
      x: (a.x + b.x) / 2 + px,
      y: (a.y + b.y) / 2 + py,
      text: `${wallLength(w).toFixed(2)}m`,
      angle,
    });
  }
  return out;
}

/** 房间尺寸标注：SVG 质心，含面积 */
export interface RoomLabel {
  x: number;
  y: number;
  name: string;
  area: number;
  areaText: string;
}

/**
 * 房间 → 标注。
 *
 * 位置取顶点均值（与 `roomsToPaths` 的 `cx`/`cy` 一致）；面积走
 * `topology.roomArea`（shoelace 公式，无需预先闭合）。
 */
export function roomLabels(
  rooms: readonly RoomPolygon[],
  ox: number,
  oy: number,
  scale: number,
): RoomLabel[] {
  return rooms.map((r) => {
    const pts = r.vertices.map(([x, z]) => worldToPlan(x, z, ox, oy, scale));
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p.x;
      cy += p.y;
    }
    const n = pts.length || 1;
    const area = roomArea(r);
    return {
      x: cx / n,
      y: cy / n,
      name: r.name,
      area,
      areaText: `${area.toFixed(2)}㎡`,
    };
  });
}

// re-export roomArea 供调用方使用（避免重复 import）
export { roomArea, wallLength };
