import { describe, expect, it } from 'vitest';
import { makeFixture } from '../../core/makeFixture.js';
import {
  luminanceGrid,
  luminanceToColor,
  rgbaToString,
} from '../heatmap.js';

const DEFAULT_BOUNDS = { x0: -3, x1: 3, z0: -3, z1: 3 };

describe('luminanceGrid', () => {
  it('空 fixtures：所有网格点 lx 都为 0，maxLx 落到下限 1（p95 保底）', () => {
    const grid = luminanceGrid([], { bounds: DEFAULT_BOUNDS, step: 0.4 });
    expect(grid.lx.every((v) => v === 0)).toBe(true);
    // p95 空/全 0 时保底 1，避免除零
    expect(grid.maxLx).toBe(1);
  });

  it('网格尺寸：width/height 由 bounds/step 决定，索引与 cellCenters 同序', () => {
    const grid = luminanceGrid([], { bounds: DEFAULT_BOUNDS, step: 0.4 });
    // 6m / 0.4 = 15
    expect(grid.width).toBe(15);
    expect(grid.height).toBe(15);
    expect(grid.lx).toHaveLength(grid.width * grid.height);
    expect(grid.cellCenters).toHaveLength(grid.width * grid.height);
    // 第一个中心点应在 x0 + step/2, z0 + step/2
    const first = grid.cellCenters[0];
    if (!first) throw new Error('first cellCenter undefined');
    expect(first[0]).toBeCloseTo(-3 + 0.2, 5);
    expect(first[1]).toBeCloseTo(-3 + 0.2, 5);
  });

  it('单盏下灯：正下方样本点最高，四个角最暗（近零）', () => {
    const pendant = makeFixture({
      type: 'pendant',
      lumens: 1200,
      pos: [0, 2.4, 0],
      skuId: 'fx-dl',
    });
    const grid = luminanceGrid([pendant], {
      bounds: DEFAULT_BOUNDS,
      step: 0.4,
    });
    // 找峰值
    let maxIdx = 0;
    let maxVal = -Infinity;
    for (let i = 0; i < grid.lx.length; i++) {
      if (grid.lx[i]! > maxVal) {
        maxVal = grid.lx[i]!;
        maxIdx = i;
      }
    }
    expect(maxVal).toBeGreaterThan(0);
    const peak = grid.cellCenters[maxIdx];
    if (!peak) throw new Error('peak cellCenter undefined');
    const [peakX, peakZ] = peak;
    // 峰值应位于下灯正下方附近（step=0.4 内）
    expect(Math.abs(peakX)).toBeLessThan(0.3);
    expect(Math.abs(peakZ)).toBeLessThan(0.3);
    // 四角应远低于峰值（不是精确 5%；点光源随距离倒数平方衰减，
    // 角点到中心距 ≈ 2 倍于中心单元格，理论比 ~1/4，留 30% 边界）
    const corners = [0, grid.width - 1, (grid.height - 1) * grid.width, grid.lx.length - 1];
    for (const idx of corners) {
      const v = grid.lx[idx];
      if (v === undefined) throw new Error(`corner ${idx} undefined`);
      expect(v).toBeLessThan(maxVal * 0.3);
    }
  });

  it('IES 灯具不参与贡献（无解析器，illuminance.fixtureContribution 已归零）', () => {
    const ies = makeFixture({
      type: 'pendant',
      pos: [0, 2.4, 0],
      ies: 'assets/data/prod.ies',
      skuId: 'fx-ies',
    });
    const grid = luminanceGrid([ies], { bounds: DEFAULT_BOUNDS, step: 0.4 });
    expect(grid.lx.every((v) => v === 0)).toBe(true);
  });

  it('resolveLevel 生效：level=0 灯具不贡献，level=0.5 是 level=1 的一半', () => {
    const fx = makeFixture({
      type: 'pendant',
      lumens: 1200,
      pos: [0, 2.4, 0],
      skuId: 'fx-lvl',
    });
    const full = luminanceGrid([fx], {
      bounds: DEFAULT_BOUNDS,
      step: 0.4,
      resolveLevel: () => 1,
    });
    const half = luminanceGrid([fx], {
      bounds: DEFAULT_BOUNDS,
      step: 0.4,
      resolveLevel: () => 0.5,
    });
    // 峰值（正下方）应是 linearity 的一半
    const fullPeak = Math.max(...full.lx);
    const halfPeak = Math.max(...half.lx);
    expect(halfPeak).toBeCloseTo(fullPeak / 2, 5);

    // level = 0 → 完全无贡献
    const zero = luminanceGrid([fx], {
      bounds: DEFAULT_BOUNDS,
      step: 0.4,
      resolveLevel: () => 0,
    });
    expect(zero.lx.every((v) => v === 0)).toBe(true);
  });

  it('clampMaxLx 钳制单点爆光（离 d=MIN_DISTANCE 极近的样本不超阈值）', () => {
    const pendant = makeFixture({
      type: 'pendant',
      lumens: 50000,
      pos: [0, 0.75, 0], // 直接坐在工作面高度，d 会打到 MIN_DISTANCE
      skuId: 'fx-clamp',
    });
    const grid = luminanceGrid([pendant], {
      bounds: { x0: -0.5, x1: 0.5, z0: -0.5, z1: 0.5 },
      step: 0.25,
      clampMaxLx: 1500,
    });
    expect(Math.max(...grid.lx)).toBeLessThanOrEqual(1500);
  });

  it('luminanceToColor 端点精确匹配 stops（0 → 黑，maxLx → 白）', () => {
    const maxLx = 300;
    expect(luminanceToColor(0, maxLx)).toEqual([0, 0, 0]);
    expect(luminanceToColor(maxLx, maxLx)).toEqual([255, 255, 255]);
    // 中点：raw=0.5, t=0.5^0.6≈0.659，落在 [0.5, 0.75] 段
    const mid = luminanceToColor(maxLx * 0.5, maxLx);
    // 应介于绿 (0x3a,0xa6,0x55) 与黄 (0xf0,0xc0,0x40) 之间
    expect(mid[0]).toBeGreaterThanOrEqual(0x3a);
    expect(mid[1]).toBeGreaterThanOrEqual(0xa6);
  });

  it('感知压缩：luminanceToColor(maxLx/10, maxLx) 的 R 通道 > 25（不是死黑）', () => {
    const maxLx = 300;
    const c = luminanceToColor(maxLx / 10, maxLx);
    // raw = 0.1, t = 0.1^0.6 ≈ 0.251；落在 [0, 0.25] 与 [0.25, 0.5] 边界附近，
    // 蓝通道会明显升高，不是纯黑。
    expect(c[0]).toBeGreaterThan(25);
    expect(c[2]).toBeGreaterThan(25);
  });
});

describe('rgbaToString', () => {
  it('输出 CSS rgb() 格式（含空格，符合 spec）', () => {
    expect(rgbaToString([10, 20, 30])).toBe('rgb(10, 20, 30)');
  });
});
