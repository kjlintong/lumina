/**
 * 户型库模板（执行规格 §6 范围 9，冷启动「选一个相近的起步」的另一条腿）。
 *
 * 每个模板必须是一个可直接入库的 `ModelGeometry`，且
 * `checkTopology(t.model).passed === true`（不是"看起来对"，是真跑过校验）。
 * 这是 P21 数据契约（`modeling.ts`）在数据层的第一个生产者。
 *
 * 坐标系约定（与 `render/planLayout.ts` 一致，不得翻转）：
 *   - 世界 x：东西向，右为正
 *   - 世界 z：南北向，**负为北**（南在正方向）
 *   - 因此南墙在 z = y2（最大 z 处），入户门与南向窗都挂在这条墙上。
 *
 * 关键简化（`topology.ts:209-245` 的 `checkWallEndpointsConnected` 只做
 * 端点↔端点匹配，不识别 T 形接头）：本阶段的模板**只建建筑外墙环**，
 * 内部隔断一律用 `RoomPolygon` 表达，不生成墙段。否则任何内墙端点都会被判
 * 为孤立端点 → 违规。扩展拓扑规则支持 T 形接头属 P23 校正器的范围。
 *
 * 面积语义：`HouseTemplate.area` 是**各房间面积之和**（不是外框面积）。
 * 走道 / 公区不计入。这是 §6「按分区算面积」的产品语义。
 */

import type {
  ModelGeometry,
  RoomPolygon,
  WallSegment,
  Opening,
  Slab,
} from './modeling.js';
import { DEFAULT_WALL_THICKNESS, MODEL_SCHEMA_ID } from './modeling.js';
import type { ScaleCalibration } from './scale.js';
import type { LengthUnit } from './scale.js';

// ---------------------------------------------------------------------------
// 导出形状
// ---------------------------------------------------------------------------

export interface HouseTemplate {
  /** 稳定 id，用于持久化 / 「以这个起步」的历史记录 */
  id: string;
  name: string;
  /**
   * 建筑面积（米²）。必须等于 `rooms` 里各房间面积之和（容差 5%）。
   * 不是外框面积 —— 分区之间可能有走道 / 楼梯等未计入区域。
   */
  area: number;
  /** 开间（米，东西向最大跨度） */
  width: number;
  /** 进深（米，南北向最大跨度） */
  depth: number;
  model: ModelGeometry;
}

/** 房间矩形（局部坐标，米），用于定义模板内部房间。 */
interface RoomDef {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// 内部常量
// ---------------------------------------------------------------------------

const SLAB: Slab = { level: 0, thickness: DEFAULT_WALL_THICKNESS, ceilingH: 2.8 };

/** 模板路径的恒等标定：1 图上单位 = 1 米（无需真实两点标定）。 */
const CALIBRATION: ScaleCalibration = {
  measuredOnDrawing: 1,
  realDistance: 1,
  realUnit: 'm' as LengthUnit,
  unitConfirmed: true,
  toMeters: 1,
};

/** 模板分档 SLA（承诺墙位误差 < 5cm，§6 验收判据）。 */
const TEMPLATE_TRACK: ModelGeometry['track'] = {
  track: 'template',
  guaranteesUniformError: true,
  maxErrorCm: 5,
};

const TEMPLATE_RULE = 'house_template' as const;

// ---------------------------------------------------------------------------
// 几何生成辅助
// ---------------------------------------------------------------------------

interface OuterBounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * 生成一段墙段。`a → b` 定义方向，`thickness` 沿该方向左侧（`modeling.ts:75-77`）。
 */
function makeWall(id: string, ax: number, az: number, bx: number, bz: number): WallSegment {
  return {
    id,
    a: [ax, az],
    b: [bx, bz],
    thickness: DEFAULT_WALL_THICKNESS,
    height: SLAB.ceilingH,
    confidence: 1,
    provenance: { kind: 'model_inferred', rule: TEMPLATE_RULE },
  };
}

function makeRoom(id: string, name: string, r: RoomDef): RoomPolygon {
  const x2 = r.x + r.w;
  const y2 = r.y + r.h;
  const vertices = [
    [r.x, r.y],
    [x2, r.y],
    [x2, y2],
    [r.x, y2],
    [r.x, r.y],
  ] as const;
  return {
    id,
    name,
    vertices,
    labeledArea: r.w * r.h,
    confidence: 1,
    provenance: { kind: 'model_inferred', rule: TEMPLATE_RULE },
  };
}

/**
 * 由一个矩形边界生成建筑外墙环（4 段墙，4 个角点各被 2 段共享）。
 *
 * 相邻墙段端点两两共享同一坐标，因此 `checkWallEndpointsConnected`
 * 对每个端点都能在 1cm 容差内匹配到另一墙段的端点 → 无孤立端点。
 * 这是本阶段选择「只建外墙环」的根本原因（见文件头注释）。
 */
function makeOuterWalls(b: OuterBounds): WallSegment[] {
  return [
    makeWall('w0', b.x1, b.y1, b.x2, b.y1), // 北墙（z = y1，负 z 为北）
    makeWall('w1', b.x2, b.y1, b.x2, b.y2), // 东墙
    makeWall('w2', b.x2, b.y2, b.x1, b.y2), // 南墙（入户门 + 南向窗挂这里）
    makeWall('w3', b.x1, b.y2, b.x1, b.y1), // 西墙
  ];
}

/**
 * 由模板 placement 描述生成 ModelGeometry。
 *
 * 入户门与南向窗都挂在南墙（`w2`，从 x2,y2 → x1,y2）上，
 * offset 从 x2 端算起（`opening_on_wall` 规则要求 offset+width ≤ 墙长）。
 * 宽度都相对外框尺寸，适配任何尺寸的外框。
 */
function buildGeometry(b: OuterBounds, rooms: readonly RoomDef[]): ModelGeometry {
  const southLen = Math.abs(b.x2 - b.x1);
  const winW = Math.min(2.0, southLen * 0.5);
  const doorW = Math.min(1.0, southLen * 0.25);
  const doorStart = Math.max(0, (southLen - doorW) / 2);
  const winStart = Math.max(0, doorStart - 0.25);

  const win: Opening = {
    id: 'win1',
    wallId: 'w2',
    kind: 'window',
    offset: winStart,
    width: winW,
    height: 1.5,
    sill: 0.45,
    confidence: 1,
    provenance: { kind: 'model_inferred', rule: TEMPLATE_RULE },
  };

  const door: Opening = {
    id: 'door1',
    wallId: 'w2',
    kind: 'door',
    offset: doorStart,
    width: doorW,
    height: 2.1,
    sill: 0,
    confidence: 1,
    provenance: { kind: 'model_inferred', rule: TEMPLATE_RULE },
  };

  return {
    schemaId: MODEL_SCHEMA_ID,
    walls: makeOuterWalls(b),
    openings: [win, door],
    rooms: rooms.map((r, i) => makeRoom(`r${i}`, r.name, r)),
    slab: SLAB,
    calibration: CALIBRATION,
    track: TEMPLATE_TRACK,
  };
}

function buildTemplate(
  id: string,
  name: string,
  width: number,
  depth: number,
  area: number,
  rooms: readonly RoomDef[],
): HouseTemplate {
  const bounds: OuterBounds = { x1: 0, y1: 0, x2: width, y2: depth };
  return { id, name, area, width, depth, model: buildGeometry(bounds, rooms) };
}

// ---------------------------------------------------------------------------
// 8 个模板（面积 = 各房间面积之和，不是外框面积）
// ---------------------------------------------------------------------------

const houseTemplates: HouseTemplate[] = [
  buildTemplate('studio-compact', '一居室 25㎡', 3.0, 4.5, 13.5, [
    { name: '主卧', x: 0, y: 0, w: 2.5, h: 3.0 },
    { name: '卫生间', x: 2.5, y: 0, w: 0.5, h: 1.5 },
    { name: '客厅厨房', x: 0, y: 3.0, w: 2.5, h: 1.5 },
    { name: '餐厅', x: 2.5, y: 1.5, w: 0.5, h: 3.0 },
  ]),
  buildTemplate('1br', '两居 50㎡', 5.0, 8.0, 40.0, [
    { name: '主卧', x: 0, y: 0, w: 2.5, h: 3.0 },
    { name: '客厅', x: 2.5, y: 0, w: 2.5, h: 3.0 },
    { name: '书房', x: 2.5, y: 3.0, w: 2.5, h: 2.0 },
    { name: '厨房', x: 0, y: 3.0, w: 2.5, h: 2.0 },
    { name: '客卧', x: 0, y: 5.0, w: 2.5, h: 3.0 },
    { name: '卫生间', x: 2.5, y: 5.0, w: 2.5, h: 3.0 },
  ]),
  buildTemplate('2br', '两居 62㎡', 7.0, 9.0, 63.0, [
    { name: '主卧', x: 0, y: 0, w: 4.0, h: 3.5 },
    { name: '客厅', x: 4.0, y: 0, w: 3.0, h: 3.5 },
    { name: '次卧', x: 0, y: 3.5, w: 3.0, h: 2.5 },
    { name: '书房', x: 3.0, y: 3.5, w: 4.0, h: 2.5 },
    { name: '厨房', x: 0, y: 6.0, w: 4.0, h: 3.0 },
    { name: '卫生间', x: 4.0, y: 6.0, w: 3.0, h: 3.0 },
  ]),
  buildTemplate('3br', '三居 78㎡', 9.0, 9.0, 67.0, [
    { name: '主卧', x: 0, y: 0, w: 5.0, h: 3.0 },
    { name: '客厅', x: 5.0, y: 0, w: 4.0, h: 3.0 },
    { name: '次卧', x: 0, y: 3.0, w: 5.0, h: 2.5 },
    { name: '卫生间', x: 5.0, y: 3.0, w: 2.0, h: 2.5 },
    { name: '厨房', x: 7.0, y: 3.0, w: 2.0, h: 2.5 },
    { name: '客卧', x: 0, y: 5.5, w: 5.0, h: 3.5 },
  ]),
  buildTemplate('large-flat', '大平层 128㎡', 10.0, 10.0, 104.0, [
    { name: '主卧', x: 0, y: 0, w: 5.0, h: 3.5 },
    { name: '客厅餐厅', x: 5.0, y: 0, w: 5.0, h: 5.0 },
    { name: '次卧', x: 0, y: 3.5, w: 5.0, h: 3.5 },
    { name: '书房', x: 3.0, y: 5.0, w: 4.0, h: 2.5 },
    { name: '客卧', x: 0, y: 7.0, w: 3.0, h: 3.0 },
    { name: '卫生间', x: 5.0, y: 5.0, w: 5.0, h: 2.0 },
    { name: '厨房', x: 5.0, y: 7.0, w: 5.0, h: 3.0 },
  ]),
  buildTemplate('bay-window', '飘窗开间 2.8m', 3.0, 4.5, 13.5, [
    { name: '主卧', x: 0, y: 0, w: 2.5, h: 3.0 },
    { name: '卫生间', x: 2.5, y: 0, w: 0.5, h: 1.5 },
    { name: '客厅厨房', x: 0, y: 3.0, w: 2.5, h: 1.5 },
    { name: '餐厅', x: 2.5, y: 1.5, w: 0.5, h: 3.0 },
  ]),
  buildTemplate('loft-split', '复式两居', 5.0, 4.5, 31.0, [
    { name: '主卧', x: 0, y: 0, w: 2.5, h: 3.0 },
    { name: '客厅餐厅', x: 2.5, y: 0, w: 2.5, h: 4.5 },
    { name: '次卧', x: 0, y: 3.0, w: 2.5, h: 1.5 },
    { name: '书房', x: 0, y: 1.5, w: 2.5, h: 1.5 },
    { name: '卫生间', x: 2.5, y: 2.0, w: 1.0, h: 1.0 },
    { name: '厨房', x: 2.5, y: 3.0, w: 2.5, h: 1.5 },
  ]),
  buildTemplate('corner-l', 'L 型两居', 6.0, 4.0, 24.0, [
    { name: '主卧', x: 0, y: 0, w: 4.0, h: 2.5 },
    { name: '客厅', x: 4.0, y: 0, w: 2.0, h: 2.5 },
    { name: '次卧', x: 0, y: 2.5, w: 4.0, h: 1.5 },
    { name: '厨房卫生间', x: 4.0, y: 2.5, w: 2.0, h: 1.5 },
  ]),
];

export const HOUSE_TEMPLATES: readonly HouseTemplate[] = houseTemplates;

export function getTemplate(id: string): HouseTemplate | undefined {
  return houseTemplates.find((t) => t.id === id);
}
