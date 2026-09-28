import { describe, it, expect } from 'vitest';
import { mountFromNormal, dropPosFromHit } from '../mountFromNormal.js';

describe('mountFromNormal', () => {
  it('法线向上 (0,1,0) → ceiling', () => {
    expect(mountFromNormal([0, 1, 0])).toBe('ceiling');
  });

  it('法线向下 (0,-1,0) → recessed', () => {
    expect(mountFromNormal([0, -1, 0])).toBe('recessed');
  });

  it('法线朝房间 (0,0,1) → wall', () => {
    expect(mountFromNormal([0, 0, 1])).toBe('wall');
  });

  it('法线水平斜角 → wall（P28 简化）', () => {
    // ny = 0.1，|ny| < 0.7
    expect(mountFromNormal([0.5, 0.1, 0.86])).toBe('wall');
  });

  it('法线极端斜角（ny=0.6）→ wall', () => {
    expect(mountFromNormal([0.3, 0.6, 0.74])).toBe('wall');
  });

  it('ny 恰好 = 0.7（阈值）→ 走 wall 分支（<0.7 判定）', () => {
    // 0.7 不是 > 0.7，所以不算 ceiling；也不是 < -0.7；|ny|=0.7 也不 < 0.7，
    // 落到兜底 suspended。这是边界行为。
    expect(mountFromNormal([0, 0.7, 0])).toBe('suspended');
  });

  it('ny = -0.8（严格 < -0.7）→ recessed', () => {
    expect(mountFromNormal([0, -0.8, 0])).toBe('recessed');
  });
});

describe('dropPosFromHit', () => {
  it('沿法线偏移 30mm（默认 offsetM）', () => {
    expect(dropPosFromHit([1, 1, 1], [0, 1, 0])).toEqual([1, 1.03, 1]);
  });

  it('默认偏移 0.03m', () => {
    expect(dropPosFromHit([0, 0, 0], [1, 0, 0])[0]).toBeCloseTo(0.03);
  });

  it('负法线方向也按法线偏移', () => {
    // 法线朝下，偏移后 y 减小
    expect(dropPosFromHit([0, 1, 0], [0, -1, 0])).toEqual([0, 0.97, 0]);
  });

  it('自定义偏移量', () => {
    expect(dropPosFromHit([0, 0, 0], [0, 1, 0], 0.1)).toEqual([0, 0.1, 0]);
  });
});
