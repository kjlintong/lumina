import { describe, it, expect } from 'vitest';
import { surfaceSnap, projectToSurface } from '../snapToGrid.js';

/**
 * P37c：磁吸到安装面的两条纯函数。
 *
 * **normal 语义**（spec §4.2 结论）：`normal` 指向**房间内**（Three.js
 * `hit.face.normal` 的实际语义——用户看到的正面朝向）。所以统一公式：
 *
 *   pos = point - normal * offset
 *
 * - 天花板：normal = (0, +1, 0) → pos.y = 2.8 - 1*0.03 = 2.77 ✓
 * - 地面：normal = (0, -1, 0) → pos.y = 0 - (-1)*0.03 = 0.03 ✓
 * - 墙面（x=3，朝房间外为 +X）：normal = (1, 0, 0) → pos.x = 3.0 - 0.03 = 2.97 ✓
 */

describe('snapToGrid: surfaceSnap (P37c)', () => {
  it('ceiling 灯：pos 在天花板下方 0.03m', () => {
    const p = surfaceSnap([1.0, 2.8, 0.0], [0, 1, 0], 'ceiling');
    expect(p[0]).toBeCloseTo(1.0, 5);
    expect(p[1]).toBeCloseTo(2.77, 5); // 2.8 - 0.03
    expect(p[2]).toBeCloseTo(0.0, 5);
  });

  it('recessed 灯（筒灯）：pos 与天花板平齐（offset=0）', () => {
    const p = surfaceSnap([1.0, 2.8, 0.0], [0, 1, 0], 'recessed');
    expect(p[1]).toBeCloseTo(2.8, 5); // 不偏移
  });

  it('suspended 灯（吊灯）：pos 在天花板下方 0.03m', () => {
    const p = surfaceSnap([1.4, 2.8, -1.0], [0, 1, 0], 'suspended');
    expect(p[1]).toBeCloseTo(2.77, 5);
  });

  it('floor 灯：pos 在地面上方 0.03m（法线 -Y）', () => {
    const p = surfaceSnap([2.0, 0, 1.0], [0, -1, 0], 'floor');
    expect(p[1]).toBeCloseTo(0.03, 5); // 0 - (-1)*0.03 = 0.03
  });

  it('tabletop 灯：pos 在桌面上方 0.03m', () => {
    const p = surfaceSnap([0, 0.75, 0], [0, -1, 0], 'tabletop');
    expect(p[1]).toBeCloseTo(0.78, 5); // 0.75 + 0.03
  });

  it('wall 灯：pos 沿墙外法线偏 0.03m 到房间内', () => {
    // 墙在 x=3，法线朝房间外 = (1, 0, 0)（朝右，即朝墙外）
    // pos = point - normal * offset = 3.0 - 1*0.03 = 2.97（房间内，对）
    const p = surfaceSnap([3.0, 1.5, 0.0], [1, 0, 0], 'wall');
    expect(p[0]).toBeCloseTo(2.97, 5);
  });
});

describe('snapToGrid: projectToSurface (P37c)', () => {
  it('用户把筒灯从天花板拖到半空：贴回天花板（recessed offset=0）', () => {
    const p = projectToSurface([1.4, 2.0, -1.0], 'recessed', 2.8);
    expect(p[0]).toBeCloseTo(1.4, 5);
    expect(p[1]).toBeCloseTo(2.8, 5);
    expect(p[2]).toBeCloseTo(-1.0, 5);
  });

  it('用户把吊灯从天花板拖到半空：贴回天花板下方 0.03m', () => {
    const p = projectToSurface([1.4, 2.0, -1.0], 'suspended', 2.8);
    expect(p[0]).toBeCloseTo(1.4, 5);
    expect(p[1]).toBeCloseTo(2.77, 5); // 2.8 - 0.03
    expect(p[2]).toBeCloseTo(-1.0, 5);
  });

  it('用户把落地灯从地面拖到桌上：贴回地面上方 0.03m', () => {
    const p = projectToSurface([-2.4, 1.4, 1.4], 'floor', 0);
    expect(p[0]).toBeCloseTo(-2.4, 5);
    expect(p[1]).toBeCloseTo(0.03, 5); // 0 + 0.03
    expect(p[2]).toBeCloseTo(1.4, 5);
  });

  it('用户把桌面台灯从桌面拖到地面：贴回桌面上方 0.03m', () => {
    const p = projectToSurface([0, 0, 0], 'tabletop', 0.75);
    expect(p[0]).toBeCloseTo(0, 5);
    expect(p[1]).toBeCloseTo(0.78, 5); // 0.75 + 0.03
    expect(p[2]).toBeCloseTo(0, 5);
  });

  it('wall 灯：不动（暂不处理，P37c-fix 另立项）', () => {
    const pos = [3.0, 1.5, 0.0] as const;
    const p = projectToSurface(pos, 'wall', 2.8);
    // 引用相等（原 pos 原样返回）
    expect(p).toBe(pos);
  });

  it('水平坐标不被改动（只修正 Y）', () => {
    const p = projectToSurface([1.234, 1.5, -0.876], 'ceiling', 2.8);
    expect(p[0]).toBeCloseTo(1.234, 5);
    expect(p[1]).toBeCloseTo(2.77, 5);
    expect(p[2]).toBeCloseTo(-0.876, 5);
  });
});
