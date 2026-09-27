import { describe, expect, it } from 'vitest';
import { extractContours, shoelaceArea } from '../contourExtraction.js';
import type { MergedLine } from '../lineMerging.js';

function makeMerged(x1: number, y1: number, x2: number, y2: number): MergedLine {
  return {
    x1, y1, x2, y2,
    length: Math.hypot(x2 - x1, y2 - y1),
    angle: Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI,
    votes: 100,
  };
}

describe('contourExtraction (P25)', () => {
  it('shoelaceArea 正方形 → 正确面积', () => {
    const points: [number, number][] = [
      [0, 0], [10, 0], [10, 10], [0, 10], [0, 0],
    ];
    expect(Math.abs(shoelaceArea(points))).toBeCloseTo(100, 0);
  });

  it('shoelaceArea 三角形 → 正确面积', () => {
    const points: [number, number][] = [
      [0, 0], [10, 0], [0, 10], [0, 0],
    ];
    expect(Math.abs(shoelaceArea(points))).toBeCloseTo(50, 0);
  });

  it('shoelaceArea 逆时针 → 负面积（取绝对值后正确）', () => {
    const points: [number, number][] = [
      [0, 0], [0, 10], [10, 10], [10, 0], [0, 0],
    ];
    expect(Math.abs(shoelaceArea(points))).toBeCloseTo(100, 0);
  });

  it('空数组 → 空数组', () => {
    expect(extractContours([])).toHaveLength(0);
  });

  it('2 条线段 → 空数组（至少需要 3 条）', () => {
    const lines = [
      makeMerged(0, 0, 10, 0),
      makeMerged(10, 0, 10, 10),
    ];
    expect(extractContours(lines)).toHaveLength(0);
  });

  it('3 条线段组成闭合三角形 → 提取出 1 个轮廓', () => {
    const lines = [
      makeMerged(0, 0, 10, 0),   // 底边
      makeMerged(10, 0, 5, 10),  // 右边
      makeMerged(5, 10, 0, 0),   // 左边
    ];
    const contours = extractContours(lines, { maxEndpointDist: 15, minArea: 10 });
    expect(contours.length).toBeGreaterThanOrEqual(1);
    if (contours.length > 0) {
      expect(contours[0]!.isClosed).toBe(true);
      expect(contours[0]!.points.length).toBeGreaterThanOrEqual(3);
      expect(contours[0]!.area).toBeGreaterThan(10);
    }
  });

  it('不闭合的线段 → 无轮廓', () => {
    const lines = [
      makeMerged(0, 0, 10, 0),
      makeMerged(10, 0, 20, 0),
      makeMerged(20, 0, 25, 5),
    ];
    const contours = extractContours(lines, { maxEndpointDist: 2, minArea: 10 });
    // 不闭合，不应有轮廓
    expect(contours.length).toBe(0);
  });

  it('返回 Contour 结构', () => {
    const lines = [
      makeMerged(0, 0, 10, 0),
      makeMerged(10, 0, 5, 10),
      makeMerged(5, 10, 0, 0),
    ];
    const contours = extractContours(lines, { maxEndpointDist: 2, minArea: 10 });
    for (const c of contours) {
      expect(c).toHaveProperty('points');
      expect(c).toHaveProperty('area');
      expect(c).toHaveProperty('isClosed');
    }
  });
});
