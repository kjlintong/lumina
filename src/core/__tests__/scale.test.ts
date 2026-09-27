import { describe, expect, it } from 'vitest';

import {
  METERS_PER_UNIT,
  PLAUSIBLE_REAL_DISTANCE_M,
  calibrate,
  confirmScale,
  drawingToMeters,
  metersToDrawing,
} from '../scale.js';
import { IN_PER_M, MM_PER_M } from '../units.js';

describe('比例尺标定（§6 范围 2，P0）', () => {
  describe('METERS_PER_UNIT：5 个单位换算因子', () => {
    it('m = 1', () => {
      expect(METERS_PER_UNIT.m).toBe(1);
    });

    it('mm = 1/1000（与 MM_PER_M 同源）', () => {
      expect(METERS_PER_UNIT.mm).toBeCloseTo(1 / MM_PER_M, 12);
    });

    it('cm = 0.01（100 厘米/米）', () => {
      expect(METERS_PER_UNIT.cm).toBeCloseTo(0.01, 12);
    });

    it('in = 0.0254（与 M_PER_IN 同源，1 英寸 = 25.4 毫米）', () => {
      expect(METERS_PER_UNIT.in).toBeCloseTo(0.0254, 12);
    });

    it('ft = 1/3.2808（1 英尺 = 12 英寸 = 0.3048 米）', () => {
      expect(METERS_PER_UNIT.ft).toBeCloseTo(0.3048, 9);
      // ft 必须是 in 的 12 倍
      expect(METERS_PER_UNIT.ft).toBeCloseTo(METERS_PER_UNIT.in * 12, 9);
    });

    it('ft-in 与 ft 语义相同（都是 1 英尺 = 0.3048 米）', () => {
      expect(METERS_PER_UNIT['ft-in']).toBe(METERS_PER_UNIT.ft);
    });

    it('英寸/毫米混淆防护：1 inch != 1 mm（25.4 倍差异被保留）', () => {
      // 若标定把 in 当 mm，整张户型会缩小 25.4 倍 —— 此测试守护该陷阱
      expect(METERS_PER_UNIT.in).not.toBeCloseTo(METERS_PER_UNIT.mm, 3);
      expect(METERS_PER_UNIT.in / METERS_PER_UNIT.mm).toBeCloseTo(25.4, 9);
      // 与既有 units.test.ts 的守护一致
      expect(METERS_PER_UNIT.in).toBeCloseTo(1 / IN_PER_M, 12);
    });
  });

  describe('calibrate：两点标定数学', () => {
    it('米标定：3 m 墙在 300 px 上 -> toMeters = 0.01', () => {
      const cal = calibrate(300, 3, 'm');
      expect(cal.toMeters).toBeCloseTo(0.01, 12);
      expect(cal.realUnit).toBe('m');
      expect(cal.unitConfirmed).toBe(true);
    });

    it('毫米标定：3000 mm 墙在 300 px 上 -> toMeters = 0.01', () => {
      const cal = calibrate(300, 3000, 'mm');
      expect(cal.toMeters).toBeCloseTo(0.01, 12);
    });

    it('厘米标定：300 cm 墙在 300 px 上 -> toMeters = 0.01', () => {
      const cal = calibrate(300, 300, 'cm');
      expect(cal.toMeters).toBeCloseTo(0.01, 12);
    });

    it('英寸标定：2 m 墙在 300 px 上（用 2/0.0254 得精确英寸数）', () => {
      const inchesFor2m = 2 / 0.0254; // 78.7401574803... 英寸
      const cal = calibrate(300, inchesFor2m, 'in');
      // toMeters = 2 / 300
      expect(cal.toMeters).toBeCloseTo(2 / 300, 9);
    });

    it('英尺标定：9.8425 ft 墙（= 3 m）在 300 px 上', () => {
      const cal = calibrate(300, 9.8425, 'ft');
      expect(cal.toMeters).toBeCloseTo(0.01, 6);
    });

    it('ft-in 标定：与 ft 等价', () => {
      const cal = calibrate(300, 9.8425, 'ft-in');
      expect(cal.toMeters).toBeCloseTo(0.01, 6);
    });

    it('非法输入：measuredOnDrawing = 0 必须抛错（§4 红线 1）', () => {
      expect(() => calibrate(0, 3, 'm')).toThrow();
    });

    it('非法输入：measuredOnDrawing 为负必须抛错', () => {
      expect(() => calibrate(-300, 3, 'm')).toThrow();
    });

    it('非法输入：realDistance = 0 必须抛错', () => {
      expect(() => calibrate(300, 0, 'm')).toThrow();
    });

    it('非法输入：realDistance 为负必须抛错', () => {
      expect(() => calibrate(300, -3, 'm')).toThrow();
    });

    it('非法输入：NaN 必须抛错', () => {
      expect(() => calibrate(Number.NaN, 3, 'm')).toThrow();
      expect(() => calibrate(300, Number.NaN, 'm')).toThrow();
    });

    it('非法输入：Infinity 必须抛错', () => {
      expect(() => calibrate(Number.POSITIVE_INFINITY, 3, 'm')).toThrow();
    });

    it('绝不静默返回可用结果（§4 红线 1 的核心断言）', () => {
      // 0 输入下，toMeters 必须是 0（无意义值），必须抛错而非返回 0
      // 这条测试守护「静默返回」这个具体失败模式
      expect(() => calibrate(0, 3, 'm')).toThrow(/必须为正数/);
      expect(() => calibrate(300, 0, 'm')).toThrow(/必须为正数/);
    });
  });

  describe('drawingToMeters / metersToDrawing：互逆', () => {
    it('米标定的正反向互逆', () => {
      const cal = calibrate(300, 3, 'm');
      const drawing = drawingToMeters(300, cal);
      expect(drawing).toBeCloseTo(3, 9);
      const back = metersToDrawing(drawing, cal);
      expect(back).toBeCloseTo(300, 9);
    });

    it('毫米标定的正反向互逆', () => {
      const cal = calibrate(300, 3000, 'mm');
      const m = drawingToMeters(300, cal);
      expect(m).toBeCloseTo(3, 9);
      expect(metersToDrawing(m, cal)).toBeCloseTo(300, 9);
    });

    it('英寸标定的正反向互逆', () => {
      const inchesFor2m = 2 / 0.0254;
      const cal = calibrate(100, inchesFor2m, 'in');
      const m = drawingToMeters(100, cal);
      expect(m).toBeCloseTo(2, 9);
      expect(metersToDrawing(m, cal)).toBeCloseTo(100, 9);
    });

    it('部分距离：drawingToMeters(150) 是 drawingToMeters(300) 的一半', () => {
      const cal = calibrate(300, 3, 'm');
      expect(drawingToMeters(150, cal)).toBeCloseTo(1.5, 9);
    });
  });

  describe('confirmScale：强制单位确认门禁', () => {
    it('正常标定通过（3 m 墙在 300 px 上）', () => {
      const cal = calibrate(300, 3, 'm');
      expect(confirmScale(cal)).toBe(true);
    });

    it('拦住「英寸当毫米」：标 3 m 但误选 mm -> realDistanceM = 0.003 < 0.01', () => {
      // 用户想标 3 m，但单位选成 mm，实际输入 3
      // 换算成米是 0.003 m，远低于下限 0.01 m -> 拦截
      const cal = calibrate(300, 3, 'mm');
      expect(confirmScale(cal)).toBe(false);
    });

    it('拦住「米标成毫米」导致 realDistance 缩水 1000 倍', () => {
      // 用户标 3 m，误选 mm -> realDistance 换算成米是 0.003 m
      // 0.003 < PLAUSIBLE_REAL_DISTANCE_M.min (0.01) -> 拦截
      const cal = calibrate(300, 3, 'mm');
      expect(cal.realDistance * METERS_PER_UNIT[cal.realUnit]).toBeLessThan(
        PLAUSIBLE_REAL_DISTANCE_M.min,
      );
      expect(confirmScale(cal)).toBe(false);
    });

    it('拦住「毫米标成米」导致 toMeters 放大 1000 倍', () => {
      // 用户想标 3000 mm，误选 m -> realDistance 换算成米是 3000 m
      // 远超 PLAUSIBLE_REAL_DISTANCE_M.max (100) -> 拦截
      const cal = calibrate(300, 3000, 'm');
      expect(confirmScale(cal)).toBe(false);
    });

    it('拦住超大距离：标 500 m 墙（住宅不合理）', () => {
      const cal = calibrate(300, 500, 'm');
      expect(confirmScale(cal)).toBe(false);
      expect(500).toBeGreaterThan(PLAUSIBLE_REAL_DISTANCE_M.max);
    });

    it('拦住极小距离：标 0.005 m（5 mm）墙', () => {
      const cal = calibrate(300, 0.005, 'm');
      expect(confirmScale(cal)).toBe(false);
      expect(0.005).toBeLessThan(PLAUSIBLE_REAL_DISTANCE_M.min);
    });

    it('合理区间内的距离都通过：0.1 m（门宽以下）到 100 m（超大户型）', () => {
      expect(confirmScale(calibrate(300, 0.1, 'm'))).toBe(true);
      expect(confirmScale(calibrate(300, 1, 'm'))).toBe(true);
      expect(confirmScale(calibrate(300, 10, 'm'))).toBe(true);
      expect(confirmScale(calibrate(300, 100, 'm'))).toBe(true);
    });

    it('边界：realDistance 恰好 0.01 m 通过（>= 下限）', () => {
      const cal = calibrate(300, 0.01, 'm');
      expect(confirmScale(cal)).toBe(true);
      expect(0.01).toBe(PLAUSIBLE_REAL_DISTANCE_M.min);
    });

    it('边界：realDistance 恰好 100 m 通过（<= 上限）', () => {
      const cal = calibrate(300, 100, 'm');
      expect(confirmScale(cal)).toBe(true);
      expect(100).toBe(PLAUSIBLE_REAL_DISTANCE_M.max);
    });

    it('unitConfirmed 非 true 时拦截（门禁字段）', () => {
      // 构造一个 unitConfirmed 不为 true 的标定（绕过 calibrate 的类型约束）
      const cal = {
        measuredOnDrawing: 300,
        realDistance: 3,
        realUnit: 'm' as const,
        unitConfirmed: false as unknown as true,
        toMeters: 0.01,
      };
      expect(confirmScale(cal)).toBe(false);
    });

    it('toMeters 非有限正数时拦截（即使 realDistance 合理）', () => {
      // toMeters 的数学合法性是独立判据：即使 realDistance 在合理区间内，
      // toMeters 是 NaN 也必须被拦（防御性：保证 drawingToMeters 不返回 NaN）
      const cal = {
        measuredOnDrawing: 300,
        realDistance: 3,
        realUnit: 'm' as const,
        unitConfirmed: true as const,
        toMeters: Number.NaN,
      };
      expect(confirmScale(cal)).toBe(false);
    });

    it('realDistance 非有限数时拦截', () => {
      const cal = {
        measuredOnDrawing: 300,
        realDistance: Number.NaN,
        realUnit: 'm' as const,
        unitConfirmed: true as const,
        toMeters: 0.01,
      };
      expect(confirmScale(cal)).toBe(false);
    });

    it('toMeters 是正数但不是 NaN/Inf（数学合法性独立判据）', () => {
      const cal = {
        measuredOnDrawing: 300,
        realDistance: 3,
        realUnit: 'm' as const,
        unitConfirmed: true as const,
        toMeters: 0, // 0 不是正数，应被拦
      };
      expect(confirmScale(cal)).toBe(false);
    });

    it('realDistance 在合理区间内、toMeters 数学上自洽 -> 通过', () => {
      // 这条测试确认单区间夹逼的语义：toMeters 是 realDistance 的函数，
      // 只要 realDistance 在合理区间内、toMeters 数学自洽，就应当通过
      const cal = {
        measuredOnDrawing: 300,
        realDistance: 3,
        realUnit: 'm' as const,
        unitConfirmed: true as const,
        toMeters: 0.01, // 3 / 300 = 0.01，数学自洽
      };
      expect(confirmScale(cal)).toBe(true);
    });
  });
});
