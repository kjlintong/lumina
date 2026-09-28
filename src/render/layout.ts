/**
 * 批量布灯几何（P34 · Phase 3 §1）。
 *
 * 4 种摆放模式（审查方案原文）：
 *   - 'grid'     : 矩形阵列（用户给 x/z 范围 + 行列数）
 *   - 'perimeter': 沿墙等距（给定 walls 集合，两端 inset 后等分）
 *   - 'center'   : 房间居中（1 盏，取 `roomArea.centroid`）
 *   - 'sconce'   : 沿墙等距壁灯（同 perimeter，但 y = 壁灯高度、方向朝外）
 *
 * 输出**位置候选**（世界坐标 [x, y, z] + mount + 法线），UI/store 层负责调
 * makeFixture() 造 Fixture 并写回 store。这样便于：
 *   - 复用 `mountFromNormal` 决定 mount 值
 *   - 复用命令栈的"整批一条 Command"模式（P27 已有）
 *   - 在 jsdom 单测里精确断言位置
 *
 * 单位一律米（内部 SI，与 modeling.ts 契约一致）。
 *
 * 纯 TypeScript，无 DOM / canvas 依赖，jsdom 下可直接单测。
 */

import type { WallSegment } from '../core/modeling.js';
import { wallLength } from '../core/topology.js';

export type LayoutMode = 'grid' | 'perimeter' | 'center' | 'sconce';

/** 位置候选 */
export interface FixtureDraft {
  /** 世界坐标（米） */
  pos: readonly [x: number, y: number, z: number];
  /** 安装法线（Y+ = 天花下，Y- = 地面朝上，X/Z ± = 墙面法线） */
  normal: readonly [nx: number, ny: number, nz: number];
  /** 灯具类型建议（UI 可以覆盖） */
  suggestedType: 'downlight' | 'sconce' | 'pendant';
}

/** 布灯参数 */
export interface LayoutOptions {
  mode: LayoutMode;
  /** 灯具距天花（或地面/墙面）的距离，米 */
  offsetFromCeiling?: number;
  /** 层高，米（决定 y 值） */
  ceilingH: number;
  /** 最小间距（防呆） */
  minSpacing?: number;
}

export const DEFAULT_LAYOUT_OPTIONS: Required<LayoutOptions> = {
  mode: 'grid',
  offsetFromCeiling: 0.05,
  ceilingH: 2.8,
  minSpacing: 0.8,
};

/**
 * 矩形阵列（用户给范围 + 行列数）。
 * inset 保证灯不出界：0.15m（约半盏筒灯直径）。
 * 返回按行优先（先 row 后 col）稳定的顺序，测试可断言。
 */
export function rectangularGrid(
  bounds: { x0: number; x1: number; z0: number; z1: number },
  cols: number,
  rows: number,
  opts: LayoutOptions = DEFAULT_LAYOUT_OPTIONS,
): FixtureDraft[] {
  const { x0, x1, z0, z1 } = bounds;
  if (cols < 1 || rows < 1) return [];
  const xSpan = x1 - x0;
  const zSpan = z1 - z0;
  // 端部 inset：留 0.15m（约半盏筒灯直径）
  const inset = 0.15;
  const usableX = xSpan - inset * 2;
  const usableZ = zSpan - inset * 2;
  if (usableX < -1e-6 || usableZ < -1e-6) return [];

  const y = opts.ceilingH - (opts.offsetFromCeiling ?? 0.05);
  const out: FixtureDraft[] = [];
  for (let r = 0; r < rows; r++) {
    const z = rows === 1 ? (z0 + z1) / 2 : z0 + inset + (usableZ * r) / (rows - 1);
    for (let c = 0; c < cols; c++) {
      const x = cols === 1 ? (x0 + x1) / 2 : x0 + inset + (usableX * c) / (cols - 1);
      out.push({
        pos: [x, y, z],
        normal: [0, -1, 0],
        suggestedType: 'downlight',
      });
    }
  }
  return out;
}

/**
 * 沿一条墙等分（perimeter 的原子操作）。
 * 端部 inset 固定 min(0.3m, len*0.1)（防与墙体端面打架）。
 * segments < 1 或 len < 0.6 → 返回 []。
 */
export function wallLineSegments(
  wall: WallSegment,
  segments: number,
  opts: LayoutOptions = DEFAULT_LAYOUT_OPTIONS,
): FixtureDraft[] {
  if (segments < 1) return [];
  const len = wallLength(wall);
  if (len < 0.6) return []; // 太短的墙放不出
  const inset = Math.min(0.3, len * 0.1);
  const usable = len - inset * 2;
  if (usable <= 0) return [];
  const dx = wall.b[0] - wall.a[0];
  const dz = wall.b[1] - wall.a[1];
  const ux = dx / len;
  const uz = dz / len;
  // 墙面法线：左侧，(uz, -ux)（与 wallLabels 的法线约定一致）
  const nx = uz;
  const nz = -ux;

  const out: FixtureDraft[] = [];
  for (let i = 0; i < segments; i++) {
    const t = segments === 1 ? 0.5 : i / (segments - 1);
    const along = inset + usable * t;
    const x = wall.a[0] + ux * along;
    const z = wall.a[1] + uz * along;
    // sconce 高度固定 1.6m（人眼），downlight 走天花
    const y = opts.mode === 'sconce' ? 1.6 : opts.ceilingH - (opts.offsetFromCeiling ?? 0.05);
    out.push({
      pos: [x, y, z],
      normal: [nx, 0, nz],
      suggestedType: opts.mode === 'sconce' ? 'sconce' : 'downlight',
    });
  }
  return out;
}

/**
 * 沿多条墙等分（perimeter 模式）。
 * 每段墙各自按 `segmentsPerWall` 等分；总输出 = 段数 × segmentsPerWall。
 * 太短的墙（< 0.6m）自动跳过。
 */
export function perimeterAlongWalls(
  walls: readonly WallSegment[],
  segmentsPerWall: number,
  opts: LayoutOptions = DEFAULT_LAYOUT_OPTIONS,
): FixtureDraft[] {
  const out: FixtureDraft[] = [];
  for (const w of walls) {
    out.push(...wallLineSegments(w, segmentsPerWall, opts));
  }
  return out;
}

/**
 * 房间居中（1 盏）。
 *
 * 用**顶点均值**作为近似质心——对矩形房间精确；对非凸多边形可能与真实质心
 * 不同，但对室内布灯用途够用（真实质心算法要引入 polygon centroid 库，不值）。
 */
export function roomCenter(
  vertices: readonly (readonly [x: number, z: number])[],
  opts: LayoutOptions = DEFAULT_LAYOUT_OPTIONS,
): FixtureDraft[] {
  if (vertices.length < 3) return [];
  let cx = 0;
  let cz = 0;
  for (const v of vertices) {
    cx += v[0];
    cz += v[1];
  }
  cx /= vertices.length;
  cz /= vertices.length;
  const y = opts.ceilingH - (opts.offsetFromCeiling ?? 0.05);
  return [{ pos: [cx, y, cz], normal: [0, -1, 0], suggestedType: 'pendant' }];
}
