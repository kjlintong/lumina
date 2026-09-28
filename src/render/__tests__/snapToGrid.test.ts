import { describe, it, expect } from 'vitest';
import { snapFixturePos, FIXTURE_GRID_M } from '../snapToGrid.js';

/**
 * 逐位比较：避免浮点噪声（0.15 * 0.05 之类会出现 0.15000000000000002）。
 * 数学语义是「四舍五入到 step 的整数倍」，容差取 step / 1000 足够吸收 6 位小数噪声。
 */
function expectTupleCloseTo(actual: readonly [number, number, number], expected: readonly [number, number, number]): void {
  expect(actual[0]).toBeCloseTo(expected[0], 10);
  expect(actual[1]).toBeCloseTo(expected[1], 10);
  expect(actual[2]).toBeCloseTo(expected[2], 10);
}

describe('snapFixturePos', () => {
  it('0.05m 网格，正值', () => {
    // 0.071 → 0.05；0.123 → 0.10；0.246 → 0.25（Math.round 舍入）
    expectTupleCloseTo(snapFixturePos([0.071, 0.123, 0.246]), [0.05, 0.1, 0.25]);
  });

  it('0.05m 网格，负值', () => {
    // -0.067 → -0.05；-0.134 → -0.15；-0.255 → -0.25
    expectTupleCloseTo(snapFixturePos([-0.067, -0.134, -0.255]), [-0.05, -0.15, -0.25]);
  });

  it('0.05m 网格，边界值不动', () => {
    expectTupleCloseTo(snapFixturePos([0.05, 0.10, 0.15]), [0.05, 0.10, 0.15]);
  });

  it('0.05m 网格，0 保留', () => {
    expect(snapFixturePos([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('自定义 step', () => {
    // step=0.5：1.234→1.0；2.456→2.5；3.789→4.0
    expectTupleCloseTo(snapFixturePos([1.234, 2.456, 3.789], 0.5), [1.0, 2.5, 4.0]);
  });

  it('默认 step = 0.05', () => {
    expect(FIXTURE_GRID_M).toBe(0.05);
  });
});
