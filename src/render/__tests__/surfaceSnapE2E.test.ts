import { describe, it, expect } from 'vitest';
import { surfaceSnap } from '../snapToGrid.js';

/**
 * surfaceSnap → pos → anchor worldY 端到端（P37c-fix）。
 *
 * 目的：锁定 P37c-fix 修正后各安装类型的"贴面位置"，防止未来回归。
 * 纯数值测试，不加载 GLTF 资产（P37a-fix 归一化后 asset 顶端 y=0，
 * 所以 worldY = pos.y + anchorOffset，anchor='top' 时 offset=0）。
 */

describe('surfaceSnap → pos → anchor worldY 组合（P37c-fix）', () => {
  it('pendant (suspended, anchor=top) 贴天花下方 0.03m', () => {
    const pos = surfaceSnap([1.4, 2.8, -1.0], [0, -1, 0], 'suspended');
    expect(pos[1]).toBeCloseTo(2.77, 5);
    // P37a-fix 归一化后 asset 顶端 y=0，灯具顶部 world y = pos.y + 0 = 2.77
    // 即天花板 2.8 下方 0.03m
    expect(pos[1] + 0).toBeCloseTo(2.77, 5);
  });

  it('downlight (recessed, anchor=top) 顶端与天花平齐', () => {
    const pos = surfaceSnap([-1.2, 2.8, 0.8], [0, -1, 0], 'recessed');
    expect(pos[1]).toBeCloseTo(2.8, 5);
  });

  it('floor lamp (floor, anchor=bottom) 底座贴地 0.03m', () => {
    const pos = surfaceSnap([-2.4, 0, 1.4], [0, 1, 0], 'floor');
    expect(pos[1]).toBeCloseTo(0.03, 5);
  });

  it('wall sconce (wall, anchor=top) 朝房间内偏 0.03m', () => {
    const pos = surfaceSnap([3.0, 1.5, 0], [-1, 0, 0], 'wall');
    expect(pos[0]).toBeCloseTo(2.97, 5);
  });
});
