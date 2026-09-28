/**
 * 照度伪彩（P34 Part D §6）—— 在 2D 网格上采样灯具贡献，映射为颜色叠加到 ModelPlan。
 *
 * ── 工程红线（继承 illuminance.ts §6.3 / ADR-15）────────────────────────
 * 本模块产出的 lx 是**相对估算值，不是实测照度**，不可作为验收依据。
 * 颜色映射只是定性可视化：中心亮、四角暗即可，不需要「300 lx」的定量承诺。
 *
 * ── 算法（点光源近似）─────────────────────────────────────────────────
 *   E = I / d²，其中 I = Φ / 4π（Φ 光通量 lm，d 米）
 *   与 `illuminance.fixtureContribution` 完全同一路径，只是把「活动区工作面点」
 *   换成「采样网格点 (x, h, z)」。复用 fixtureContribution 而非重写，
 *   保证两条路径的数值语义一致（beam 边界、IES 归零、最小距离钳制）。
 *
 * ── level 处理 ────────────────────────────────────────────────────────
 *   fixtureContribution 第三参是**距离（米）**，不含 level 因子。
 *   要在不修改原 fixture 的前提下让「level=0.5」表现为亮度减半，
 *   就构造一个临时 Fixture，把 parametric.lumens 按 level 缩放。
 *   IES 分支不受影响（IES 文件自带真实配光曲线，不做 level 缩放）。
 *
 * ── 单位 ──────────────────────────────────────────────────────────────
 *   lx（lux），线性，未做感知压缩。颜色映射时用 Math.pow(t, 0.6) 补偿
 *   真实照度的对数分布，避免低亮度区一大片死黑。
 *
 * ── 为什么走 CPU ──────────────────────────────────────────────────────
 *   采样网格 ≤ 25×25 = 625 点，每点 O(灯具数)；50 盏灯下 625 × 50 = 31250 次
 *   浮点运算，纯 CPU < 1ms，主线程足够。GPU 化的复杂度得不偿失。
 */

import type { Fixture } from '../core/types.js';
import { fixtureContribution } from './illuminance.js';

/** 采样网格配置 */
export interface HeatmapOptions {
  /** 采样范围（世界坐标，米） */
  bounds: { x0: number; x1: number; z0: number; z1: number };
  /** 采样步长（米），默认 0.4 = 客厅 ~7m 内 18×14 网格 */
  step?: number;
  /** 采样高度（米），默认 0.75 = 桌面/坐姿高度 */
  sampleHeight?: number;
  /** 每盏灯的 level（0..1），默认取 control.sceneLevels[activeSceneKey] ?? 1 */
  resolveLevel?: (fixture: Fixture) => number;
  /** 亮度阈值钳制（避免单点爆光），默认 1500 lx */
  clampMaxLx?: number;
}

/** 采样结果 */
export interface HeatmapGrid {
  /** 列数（x 方向） */
  width: number;
  /** 行数（z 方向） */
  height: number;
  /** 每格中心点的世界坐标，索引 = i * height + j */
  cellCenters: readonly [x: number, z: number][];
  /** 每格 lx，索引 = j * width + i（行主序） */
  lx: readonly number[];
  /** 用于颜色映射的最大值（P95 分位，抗离群点） */
  maxLx: number;
}

/** P95 分位：抗离群点。空数组返回 1 避免除零。 */
function p95(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return Math.max(1, sorted[idx] ?? 1);
}

/**
 * 构造「按 level 缩放」的临时 Fixture。
 *
 * Photometric 是二选一联合类型：直接 `{...f, photometric: {...f.photometric, lumens: X}}`
 * 会让 TS 推断 photometric 变成 union（两侧都能匹配 spread），再赋给 Fixture 时报错。
 * 用 isParametric 先 narrow，再在分支里以显式 Fixture 变量承接，避免 union spread 推断。
 * IES 分支原样返回（IES 文件自带真实配光，不做 level 缩放）。
 */
function withScaledLumens(f: Fixture, level: number): Fixture {
  const { photometric } = f;
  if (photometric.ies !== undefined) return f;
  const scaled = {
    ...f,
    photometric: { ...photometric, lumens: photometric.lumens * level },
  };
  return scaled;
}

/**
 * 采样照度网格。
 *
 * 行主序：外循环 j（z 从 z0 到 z1），内循环 i（x 从 x0 到 x1）。
 * 索引：`lx[j * width + i]`；`cellCenters` 同序。
 */
export function luminanceGrid(
  fixtures: Iterable<Fixture>,
  opts: HeatmapOptions,
): HeatmapGrid {
  const step = opts.step ?? 0.4;
  const h = opts.sampleHeight ?? 0.75;
  const clampMax = opts.clampMaxLx ?? 1500;
  const { x0, x1, z0, z1 } = opts.bounds;
  const width = Math.max(1, Math.ceil((x1 - x0) / step));
  const height = Math.max(1, Math.ceil((z1 - z0) / step));
  const centers: [number, number][] = [];
  const lx: number[] = [];
  const list = [...fixtures];
  const resolve = opts.resolveLevel ?? (() => 1);

  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const x = x0 + (i + 0.5) * step;
      const z = z0 + (j + 0.5) * step;
      let acc = 0;
      for (const f of list) {
        const level = resolve(f);
        if (level <= 0) continue;
        const [fx, fy, fz] = f.pos;
        const dx = fx - x;
        const dy = fy - h;
        const dz = fz - z;
        const distance = Math.max(Math.hypot(dx, dy, dz), 0.1);
        // level 通过缩放 parametric.lumens 注入。IES 分支不做缩放。
        const scaled = withScaledLumens(f, level);
        // fixtureContribution 期望 fixture → target 向量；距离已算好直接传。
        acc += fixtureContribution(scaled, [-dx, -dy, -dz], distance);
      }
      centers.push([x, z]);
      lx.push(Math.min(clampMax, acc));
    }
  }

  const maxLx = p95(lx);
  return { width, height, cellCenters: centers, lx, maxLx };
}

/**
 * lx → 颜色（黑 → 深蓝 → 绿 → 黄 → 白）。
 *
 * 色标：
 *   0.00 = #000000  纯黑
 *   0.25 = #1a3a6a  深蓝（暗部）
 *   0.50 = #3aa655  绿（中等）
 *   0.75 = #f0c040  黄（较亮）
 *   1.00 = #ffffff  白（最亮）
 *
 * 感知压缩：`Math.pow(t, 0.6)`（约等于 Gamma 1.67），补偿真实照度的对数分布，
 * 避免低亮度区一大片死黑。测试用 luminanceToColor(maxLx/10, maxLx) 的 R > 25 断言。
 */
export function luminanceToColor(
  lx: number,
  maxLx: number,
): [r: number, g: number, b: number] {
  const raw = maxLx > 0 ? Math.min(1, Math.max(0, lx / maxLx)) : 0;
  const t = Math.pow(raw, 0.6);

  const stops: [number, readonly [number, number, number]][] = [
    [0.0, [0x00, 0x00, 0x00]],
    [0.25, [0x1a, 0x3a, 0x6a]],
    [0.5, [0x3a, 0xa6, 0x55]],
    [0.75, [0xf0, 0xc0, 0x40]],
    [1.0, [0xff, 0xff, 0xff]],
  ];

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (t <= b[0]) {
      const k = (t - a[0]) / (b[0] - a[0]);
      return [
        Math.round(a[1][0] + (b[1][0] - a[1][0]) * k),
        Math.round(a[1][1] + (b[1][1] - a[1][1]) * k),
        Math.round(a[1][2] + (b[1][2] - a[1][2]) * k),
      ];
    }
  }
  const last = stops[stops.length - 1]![1];
  return [last[0], last[1], last[2]];
}

/** RGB 三元组 → CSS rgb() 字符串。 */
export function rgbaToString(rgb: readonly [number, number, number]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}
