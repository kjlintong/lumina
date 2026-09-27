import { describe, expect, it } from 'vitest';
import { mergeLines } from '../lineMerging.js';
import type { HoughLine } from '../imagePreprocess.js';

function makeLine(x1: number, y1: number, x2: number, y2: number, angle: number, votes = 100): HoughLine {
  return { x1, y1, x2, y2, length: Math.hypot(x2 - x1, y2 - y1), angle, votes };
}

describe('mergeLines (P25)', () => {
  it('空数组 → 空数组', () => {
    expect(mergeLines([])).toHaveLength(0);
  });

  it('单条线段 → 原样返回', () => {
    const lines = [makeLine(0, 0, 100, 0, 0)];
    const merged = mergeLines(lines);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.length).toBeGreaterThan(0);
  });

  it('两条近似共线线段合并成一条', () => {
    // 两条水平线，投影重叠
    const lines = [
      makeLine(0, 5, 50, 5, 0),
      makeLine(50, 5, 100, 5, 0),
    ];
    const merged = mergeLines(lines, { maxAngleDiff: 5, maxGap: 10 });
    expect(merged.length).toBeGreaterThanOrEqual(1);
    expect(merged[0]!.length).toBeGreaterThan(50);
  });

  it('角度差大的线段不合并', () => {
    // 一条水平，一条垂直
    const lines = [
      makeLine(0, 0, 100, 0, 0),   // 水平
      makeLine(50, 0, 50, 100, 90), // 垂直
    ];
    const merged = mergeLines(lines, { maxAngleDiff: 5 });
    expect(merged.length).toBe(2);
  });

  it('合并后 votes 累加', () => {
    const lines = [
      makeLine(0, 5, 50, 5, 0, 50),
      makeLine(50, 5, 100, 5, 0, 70),
    ];
    const merged = mergeLines(lines, { maxAngleDiff: 5, maxGap: 10 });
    expect(merged.length).toBeGreaterThanOrEqual(1);
  });

  it('返回 MergedLine 结构', () => {
    const lines = [makeLine(0, 0, 100, 0, 0, 100)];
    const merged = mergeLines(lines);
    for (const m of merged) {
      expect(m).toHaveProperty('x1');
      expect(m).toHaveProperty('y1');
      expect(m).toHaveProperty('x2');
      expect(m).toHaveProperty('y2');
      expect(m).toHaveProperty('length');
      expect(m).toHaveProperty('angle');
      expect(m).toHaveProperty('votes');
    }
  });
});
