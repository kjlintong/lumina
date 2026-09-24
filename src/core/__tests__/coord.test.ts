import { describe, expect, it } from 'vitest';

import { localOffsetToWorld, localToWorld, pointInZoneLocal, worldToLocal } from '../coord.js';
import { close } from '../units.js';

describe('coord — 区局部 <-> 世界坐标（ADR-13）', () => {
  it('rotY=0 时局部偏移等于世界增量（无旋转基线）', () => {
    expect(localOffsetToWorld(1, 0.5, -2, 0)).toEqual([1, 0.5, -2]);
  });

  it('rotY=90° 把局部 +x 转到世界 -z（右手系绕 Y 旋转）', () => {
    // 绕 Y 右手系：x' = x·cosθ + z·sinθ,  z' = -x·sinθ + z·cosθ
    // θ=π/2: x'=z, z'=-x。故局部 (1,0,0) -> 世界 (0,0,-1)
    const [wx, , wz] = localOffsetToWorld(1, 0, 0, Math.PI / 2);
    expect(wx).toBeCloseTo(0, 12);
    expect(wz).toBeCloseTo(-1, 12);
  });

  it('旋转 90° 后局部 +z 转到世界 +x', () => {
    const [wx, , wz] = localOffsetToWorld(0, 0, 1, Math.PI / 2);
    expect(wx).toBeCloseTo(1, 12);
    expect(wz).toBeCloseTo(0, 12);
  });

  it('worldToLocal 是 localToWorld 的逆（旋转 37° 往返）', () => {
    const pos: readonly [number, number] = [2, -1];
    const rotY = 0.6435; // ~37°
    const local: readonly [number, number, number] = [0.3, 2.4, -0.5];

    const world = localToWorld(pos, rotY, local);
    const back = worldToLocal(pos, rotY, world);

    expect(back[0]).toBeCloseTo(local[0], 12);
    expect(back[1]).toBeCloseTo(local[1], 12);
    expect(back[2]).toBeCloseTo(local[2], 12);
  });

  it('4 次 90° 旋转 == 单位变换（旋转闭合性）', () => {
    for (const k of [1, 2, 3, 4]) {
      const r = (k * Math.PI) / 2;
      const [x, y, z] = localOffsetToWorld(0.5, 1.1, -0.7, r);
      if (k === 4) {
        expect(close(x, 0.5)).toBe(true);
        expect(close(y, 1.1)).toBe(true);
        expect(close(z, -0.7)).toBe(true);
      }
    }
  });

  it('pointInZoneLocal：旋转后判定一致（未旋转时矩形框内）', () => {
    const pos: readonly [number, number] = [0, 0];
    const size: readonly [number, number] = [2, 1];
    expect(pointInZoneLocal([0.9, 0.4], pos, 0, size)).toBe(true);
    expect(pointInZoneLocal([1.1, 0.4], pos, 0, size)).toBe(false);
    expect(pointInZoneLocal([0.9, 0.6], pos, 0, size)).toBe(false);
  });
});
