import { describe, expect, it } from 'vitest';

import {
  FT_PER_M,
  IMPERIAL,
  IN_PER_M,
  METRIC,
  MILLIMETERS,
  M_PER_IN,
  MM_PER_M,
  close,
  getUnit,
} from '../units.js';

describe('单位换算（ADR-08：单位制是数据模型）', () => {
  it('METRIC 1:1 不变', () => {
    expect(METRIC.fromMeters(1.5)).toBe(1.5);
    expect(METRIC.toMeters(1.5)).toBe(1.5);
  });

  it('IMPERIAL 米 <-> 英尺可逆', () => {
    const ft = IMPERIAL.fromMeters(3);
    expect(ft).toBeCloseTo(9.8425, 3);
    expect(IMPERIAL.toMeters(ft)).toBeCloseTo(3, 9);
  });

  it('MILLIMETERS 1m = 1000mm', () => {
    expect(MILLIMETERS.fromMeters(1)).toBe(1000);
    expect(MILLIMETERS.toMeters(1000)).toBe(1);
  });

  it('英寸/英尺/毫米常数之间的恒等关系一致', () => {
    // 1 英尺 = 12 英寸
    expect(FT_PER_M).toBeCloseTo(IN_PER_M / 12, 9);
    // 1 英寸 = 25.4 毫米 -> M_PER_IN * MM_PER_M == 25.4
    expect(M_PER_IN * MM_PER_M).toBeCloseTo(25.4, 9);
    // 往返 1
    expect(M_PER_IN * IN_PER_M).toBeCloseTo(1, 12);
  });

  it('getUnit 按 unitSystem 返回正确转换器', () => {
    expect(getUnit('metric').label).toBe('m');
    expect(getUnit('imperial').label).toBe('ft');
  });

  it('close：浮点比较容差生效，避免坐标等值误判', () => {
    expect(close(0.1 + 0.2, 0.3)).toBe(true);
    expect(close(1, 1.0000000001)).toBe(true);
    expect(close(1, 1.1)).toBe(false);
  });

  it('close：极小容差下相邻浮点可区分', () => {
    expect(close(1.0000001, 1.0000002, 1e-10)).toBe(false);
  });

  it('英寸/毫米混淆防护：1 inch != 1 mm（25.4x 差异被保留）', () => {
    // 若建模误把英寸当毫米，整张户型会缩小 25.4 倍 —— 此测试守护该陷阱
    expect(M_PER_IN).toBeCloseTo(0.0254, 9);
    // 1 英寸 = 25.4 毫米
    expect(M_PER_IN * MM_PER_M).toBeCloseTo(25.4, 9);
  });
});
