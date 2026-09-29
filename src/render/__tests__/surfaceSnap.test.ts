import { describe, it, expect } from 'vitest';
import { surfaceSnap, projectToSurface } from '../snapToGrid.js';

/**
 * P37c-fix：磁吸到安装面的两条纯函数。
 *
 * **normal 约定**（spec §2.1 统一）：`normal` 指向**房间内**（从房间看向表面，
 * 法线指向观察者）。所以：
 * - 天花 normal = (0, -1, 0)  地面 normal = (0, +1, 0)
 * - 东墙 normal = (-1, 0, 0)  西墙 normal = (+1, 0, 0)
 *
 * 统一公式：`pos = point + normal * offset`。
 *
 * - 天花：point.y = 2.8, normal.y = -1 → pos.y = 2.8 + (-1)*0.03 = 2.77 ✓
 * - 地面：point.y = 0, normal.y = +1 → pos.y = 0 + (+1)*0.03 = 0.03 ✓
 * - 东墙：point.x = 3, normal.x = -1 → pos.x = 3 + (-1)*0.03 = 2.97 ✓
 */

describe('snapToGrid: surfaceSnap (P37c-fix)', () => {
  it('ceiling 灯：pos 在天花板下方 0.03m', () => {
    const p = surfaceSnap([1.0, 2.8, 0.0], [0, -1, 0], 'ceiling');
    expect(p[0]).toBeCloseTo(1.0, 5);
    expect(p[1]).toBeCloseTo(2.77, 5); // 2.8 + (-1)*0.03 = 2.77
    expect(p[2]).toBeCloseTo(0.0, 5);
  });

  it('recessed 灯（筒灯）：pos 与天花板平齐（offset=0）', () => {
    const p = surfaceSnap([1.0, 2.8, 0.0], [0, -1, 0], 'recessed');
    expect(p[1]).toBeCloseTo(2.8, 5); // 2.8 + (-1)*0 = 2.8
  });

  it('suspended 灯（吊灯）：pos 在天花板下方 0.03m', () => {
    const p = surfaceSnap([1.4, 2.8, -1.0], [0, -1, 0], 'suspended');
    expect(p[1]).toBeCloseTo(2.77, 5);
  });

  it('floor 灯：pos 在地面上方 0.03m（法线 +Y）', () => {
    const p = surfaceSnap([2.0, 0, 1.0], [0, 1, 0], 'floor');
    expect(p[1]).toBeCloseTo(0.03, 5); // 0 + (+1)*0.03 = 0.03
  });

  it('tabletop 灯：pos 在桌面上方 0.03m', () => {
    const p = surfaceSnap([0, 0.75, 0], [0, 1, 0], 'tabletop');
    expect(p[1]).toBeCloseTo(0.78, 5); // 0.75 + 0.03
  });

  it('wall 灯：pos 沿墙内法线偏 0.03m 到房间内', () => {
    // 东墙 x=3，朝房间内法线 = (-1, 0, 0)
    // pos = point + normal * offset = 3.0 + (-1)*0.03 = 2.97
    const p = surfaceSnap([3.0, 1.5, 0.0], [-1, 0, 0], 'wall');
    expect(p[0]).toBeCloseTo(2.97, 5);
  });
});

describe('snapToGrid: projectToSurface (P37c-fix)', () => {
  it('用户把筒灯从天花板拖到半空：贴回天花板（recessed offset=0）', () => {
    const p = projectToSurface([1.4, 2.0, -1.0], 'recessed', 2.8);
    expect(p[0]).toBeCloseTo(1.4, 5);
    expect(p[1]).toBeCloseTo(2.8, 5); // 2.8 + (-1)*0 = 2.8
    expect(p[2]).toBeCloseTo(-1.0, 5);
  });

  it('用户把吊灯从天花板拖到半空：贴回天花板下方 0.03m', () => {
    const p = projectToSurface([1.4, 2.0, -1.0], 'suspended', 2.8);
    expect(p[0]).toBeCloseTo(1.4, 5);
    expect(p[1]).toBeCloseTo(2.77, 5); // 2.8 + (-1)*0.03 = 2.77
    expect(p[2]).toBeCloseTo(-1.0, 5);
  });

  it('用户把落地灯从地面拖到桌上：贴回地面上方 0.03m', () => {
    const p = projectToSurface([-2.4, 1.4, 1.4], 'floor', 0);
    expect(p[0]).toBeCloseTo(-2.4, 5);
    expect(p[1]).toBeCloseTo(0.03, 5); // 0 + (+1)*0.03 = 0.03
    expect(p[2]).toBeCloseTo(1.4, 5);
  });

  it('用户把桌面台灯从桌面拖到地面：贴回桌面上方 0.03m', () => {
    const p = projectToSurface([0, 0, 0], 'tabletop', 0.75);
    expect(p[0]).toBeCloseTo(0, 5);
    expect(p[1]).toBeCloseTo(0.78, 5); // 0.75 + 0.03
    expect(p[2]).toBeCloseTo(0, 5);
  });

  it('wall 灯：不投影，返回原 pos（仅凭 installNormal 无法恢复墙面世界坐标）', () => {
    // 墙面"表面"是变量（每面墙在不同位置），仅知道法线方向不足以投影。
    // 任何沿法线的加减都会让 pos 每次漂移 ±0.03m，越拖越远，是 bug。
    // 正确行为：保留用户拖动后的位置（y/z 可改高度，离墙距离保持）。
    const pos = [3.5, 1.5, 0.5] as const;
    const p = projectToSurface(pos, 'wall', 2.8);
    expect(p).toBe(pos);
  });

  it('wall 已表面 pos：不投影，保持贴墙位置（幂等）', () => {
    // 已贴墙的壁灯（pos.x=2.97，离东墙 0.03m），拖动后再次投影应回到原位。
    const pos = [2.97, 1.5, 0.0] as const;
    const p = projectToSurface(pos, 'wall', 2.8);
    expect(p).toBe(pos);
    expect(p[0]).toBeCloseTo(2.97, 5);
  });

  it('水平坐标不被改动（只修正 Y）', () => {
    const p = projectToSurface([1.234, 1.5, -0.876], 'ceiling', 2.8);
    expect(p[0]).toBeCloseTo(1.234, 5);
    expect(p[1]).toBeCloseTo(2.77, 5);
    expect(p[2]).toBeCloseTo(-0.876, 5);
  });
});
