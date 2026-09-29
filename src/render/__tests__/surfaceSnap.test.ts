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

  it('用户把壁灯从东墙拖到半空：沿 -installNormal 平移 offset（P37c-fix §3.2 公式）', () => {
    // installNormal=[-1,0,0]（东墙朝房间内），pos=[3.5, 1.5, 0.5]。
    // 公式：pos - installNormal * offset
    //   x = 3.5 - (-1)*0.03 = 3.53
    // y/z 不变。
    // 注意：spec §4.1 的断言 (3.47) 用的是 `+` 号，与 §3.2 的代码公式 (`-`) 不一致。
    // 任务说明明确采用 `pos - installNormal * offset`（"不是 pos + installNormal * offset"），
    // 因此这里按 `-` 公式测，期望 3.53。
    const p = projectToSurface([3.5, 1.5, 0.5], 'wall', 2.8, [-1, 0, 0]);
    expect(p[1]).toBeCloseTo(1.5, 5);
    expect(p[2]).toBeCloseTo(0.5, 5);
    expect(p[0]).toBeCloseTo(3.53, 5);
  });

  it('西墙壁灯（installNormal=[+1,0,0]）：沿 -installNormal 平移 offset', () => {
    // installNormal=[+1,0,0]（西墙 x=-3，朝房间内），pos=[-3.5, 1.5, -0.3]。
    // 公式：pos - installNormal * offset
    //   x = -3.5 - (+1)*0.03 = -3.53
    //   即向墙外偏 0.03（沿 -normal = -X 方向）。
    const p = projectToSurface([-3.5, 1.5, -0.3], 'wall', 2.8, [1, 0, 0]);
    expect(p[1]).toBeCloseTo(1.5, 5);
    expect(p[2]).toBeCloseTo(-0.3, 5);
    expect(p[0]).toBeCloseTo(-3.53, 5);
  });

  it('wall 无 installNormal（回落）：返回原 pos 引用', () => {
    const pos = [3.0, 1.5, 0.0] as const;
    const p = projectToSurface(pos, 'wall', 2.8, undefined);
    expect(p).toBe(pos);
  });

  it('水平坐标不被改动（只修正 Y）', () => {
    const p = projectToSurface([1.234, 1.5, -0.876], 'ceiling', 2.8);
    expect(p[0]).toBeCloseTo(1.234, 5);
    expect(p[1]).toBeCloseTo(2.77, 5);
    expect(p[2]).toBeCloseTo(-0.876, 5);
  });
});
