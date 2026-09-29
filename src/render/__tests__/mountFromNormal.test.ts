import { describe, it, expect } from 'vitest';
import { mountFromNormal, dropPosFromHit } from '../mountFromNormal.js';

describe('mountFromNormal (P37c-fix)', () => {
  it('法线向下 (0,-1,0)（从下方点天花，PlaneGeometry 翻转后 world normal = -Y）→ ceiling', () => {
    expect(mountFromNormal([0, -1, 0])).toBe('ceiling');
  });

  it('法线向上 (0,1,0)（地面朝上，从房间内部点地板）→ floor（P37c-fix Bug 2 修正）', () => {
    // 旧版：→ recessed（把地面误判为天花板嵌入）。
    // 新版（Bug 2 修复）：从房间内部点地面时，world normal = +Y，正确分类为 floor。
    expect(mountFromNormal([0, 1, 0])).toBe('floor');
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

  it('ny 恰好 = 0.7（阈值）→ 走 suspended 兜底', () => {
    // |ny| = 0.7 不 < 0.7，所以不算 wall；dir = -0.7 不 > 0.7 也不 < -0.7，
    // 落到兜底 suspended。
    expect(mountFromNormal([0, 0.7, 0])).toBe('suspended');
  });

  it('ny = -0.8（严格 < -0.7，从下方点天花）→ ceiling', () => {
    expect(mountFromNormal([0, -0.8, 0])).toBe('ceiling');
  });

  it('fromInside=true：[0,-1,0] → ceiling', () => {
    expect(mountFromNormal([0, -1, 0], { fromInside: true })).toBe('ceiling');
  });

  it('fromInside=true：[0,+1,0] → floor', () => {
    expect(mountFromNormal([0, 1, 0], { fromInside: true })).toBe('floor');
  });

  it('fromInside=false：[0,-1,0] → floor（外部视角反转）', () => {
    // 从表面外侧看点，法线取反后 dir = ny = -1 < -0.7 → floor。
    expect(mountFromNormal([0, -1, 0], { fromInside: false })).toBe('floor');
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
