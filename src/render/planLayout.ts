/**
 * 2D 户型图布局数学（P8f）
 *
 * 把世界坐标（x = 东西，z = 南北，y 不参与平面）映射到 SVG 平面坐标，
 * 提取活动区矩形与灯具位置供渲染。纯函数，无任何 Three.js / DOM 依赖，
 * jsdom 下可直接单测。
 *
 * 坐标系约定（与引擎一致）：
 * - 世界 x：东西向，右为正
 * - 世界 z：南北向，**负为北**（北墙在 z = -roomDepth/2，窗在此）
 * - SVG y：向下为正
 * 因此「北在图纸上方」需让 z 越小 → SVG y 越小，即 SVG_y = originY + z * scale。
 * （z = -depth/2 时 SVG_y 偏上，对应图纸顶部——北墙。）
 *
 * 架构（与 materials / plants / skyline 同一思路）：布局抽纯函数，组件是薄壳。
 */

import type { ActivityZone, Fixture } from '../core/types.js';

/** 房间尺寸（米） */
export interface RoomDims {
  width: number;
  depth: number;
  height: number;
}

/** 平面图视图配置 */
export interface PlanViewConfig {
  /** 绘图区宽（SVG 用户单位，通常是 px） */
  width: number;
  /** 绘图区高 */
  height: number;
  /** 像素/米。由 drawWidth 与房间对角线长度自动算出 */
  scale?: number;
  /** 左右边距（米，世界坐标外留白） */
  margin?: number;
}

/** 平面图上一个活动区的渲染描述 */
export interface ZoneRect {
  key: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 标签放置位置（矩形中心） */
  labelX: number;
  labelY: number;
  type: string;
}

/** 平面图上一盏灯的渲染描述 */
export interface FixtureDot {
  id: string;
  type: string;
  x: number;
  y: number;
}

/** 计算像素/米：让房间（加边距）刚好铺满绘图区，取宽高方向的较小值 */
export function computeScale(room: RoomDims, config: PlanViewConfig): number {
  const margin = config.margin ?? 0.4;
  const worldW = room.width + margin * 2;
  const worldD = room.depth + margin * 2;
  return Math.min(config.width / worldW, config.height / worldD);
}

/**
 * 计算绘图原点（SVG 坐标）。房间中心在世界原点，因此 originY 就是 z=0 对应的 y。
 */
export function planOrigin(config: PlanViewConfig): { ox: number; oy: number } {
  return { ox: config.width / 2, oy: config.height / 2 };
}

/** 世界 (x, z) → SVG (x, y)。z 负（北）在上方。 */
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
 * 房间外框矩形（含外墙厚度忽略，简化为边界）。
 */
export function roomRect(
  room: RoomDims,
  ox: number,
  oy: number,
  scale: number,
): { x: number; y: number; w: number; h: number } {
  const halfW = room.width / 2;
  const halfD = room.depth / 2;
  const tl = worldToPlan(-halfW, -halfD, ox, oy, scale); // 左上（北墙左端）
  return {
    x: tl.x,
    y: tl.y,
    w: room.width * scale,
    h: room.depth * scale,
  };
}

/**
 * 窗在平面图上的表示：北墙的一段线（窗在北墙中央，宽 = windowW）。
 * 返回线的两个端点 + 窗宽，供组件画成开口。
 */
export function windowSegment(
  room: RoomDims,
  windowWidth: number,
  ox: number,
  oy: number,
  scale: number,
): { x1: number; y: number; x2: number } {
  const half = windowWidth / 2;
  const northZ = -room.depth / 2;
  const a = worldToPlan(-half, northZ, ox, oy, scale);
  const b = worldToPlan(half, northZ, ox, oy, scale);
  return { x1: a.x, y: a.y, x2: b.x };
}

/**
 * 把活动区表转成平面图矩形数组。
 * 区的 size 是 [宽, 深]，定义在局部坐标系；中心是 zone.pos。
 * 旋转 rotY 时矩形会斜——这里取旋转后的 AABB（外接轴对齐矩形）以保持
 * 平面图的可读性（不做真正旋转多边形，平面图以「看清布局」为目标）。
 */
export function zonesToRects(
  zones: Record<string, ActivityZone>,
  ox: number,
  oy: number,
  scale: number,
): ZoneRect[] {
  const out: ZoneRect[] = [];
  for (const z of Object.values(zones)) {
    const [w, d] = z.size;
    // 旋转后的 AABB 半宽半高
    const c = Math.abs(Math.cos(z.rotY));
    const s = Math.abs(Math.sin(z.rotY));
    const halfW = (w * c + d * s) / 2;
    const halfD = (w * s + d * c) / 2;
    const [px, pz] = z.pos;
    const tl = worldToPlan(px - halfW, pz - halfD, ox, oy, scale);
    const cx = tl.x + (w * c + d * s) * scale / 2;
    const cy = tl.y + (w * s + d * c) * scale / 2;
    out.push({
      key: z.key,
      name: z.name,
      x: tl.x,
      y: tl.y,
      w: (w * c + d * s) * scale,
      h: (w * s + d * c) * scale,
      labelX: cx,
      labelY: cy,
      type: z.type,
    });
  }
  return out;
}

/** 把灯具表转成平面图上的点（取 x, z） */
export function fixturesToDots(
  fixtures: Record<string, Fixture>,
  ox: number,
  oy: number,
  scale: number,
): FixtureDot[] {
  return Object.values(fixtures).map((f) => {
    const p = worldToPlan(f.pos[0], f.pos[2], ox, oy, scale);
    return { id: f.id, type: f.type, x: p.x, y: p.y };
  });
}
