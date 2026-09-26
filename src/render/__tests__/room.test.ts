import { describe, expect, it } from 'vitest';
import { Mesh, MeshPhysicalMaterial } from 'three';

import { buildRoom } from '../room.js';

describe('buildRoom — 房间外壳构建', () => {
  it('拒绝非正尺寸（width/depth/height <= 0 抛出）', () => {
    expect(() => buildRoom(0, 4, 2.8)).toThrow();
    expect(() => buildRoom(-1, 4, 2.8)).toThrow();
    expect(() => buildRoom(5, 0, 2.8)).toThrow();
    expect(() => buildRoom(5, -2, 2.8)).toThrow();
    expect(() => buildRoom(5, 4, 0)).toThrow();
    expect(() => buildRoom(5, 4, -0.5)).toThrow();
  });

  it('group 内含 6 个 Mesh（1 地板 + 4 墙 + 1 天花板）', () => {
    const { group } = buildRoom(5, 4, 2.8);
    expect(group.children).toHaveLength(6);
    for (const child of group.children) {
      expect(child).toBeInstanceOf(Mesh);
    }
  });

  it('地板：receiveShadow=true，castShadow=false（最低面，投影零收益且产生 acne）', () => {
    const { floor } = buildRoom(5, 4, 2.8);
    expect(floor.receiveShadow).toBe(true);
    expect(floor.castShadow).toBe(false);
  });

  it('天花板：receiveShadow=true，castShadow=true（否则光泄漏到屋顶以上）', () => {
    const { ceiling } = buildRoom(5, 4, 2.8);
    expect(ceiling.receiveShadow).toBe(true);
    expect(ceiling.castShadow).toBe(true);
  });

  it('墙体：全部 receiveShadow=true，castShadow=true（否则光穿透墙体）', () => {
    const { walls } = buildRoom(5, 4, 2.8);
    expect(walls).toHaveLength(4);
    for (const wall of walls) {
      expect(wall.receiveShadow).toBe(true);
      expect(wall.castShadow).toBe(true);
    }
  });

  it('地板 rotation.x === -PI/2（法线朝上）', () => {
    const { floor } = buildRoom(5, 4, 2.8);
    expect(floor.rotation.x).toBeCloseTo(-Math.PI / 2);
  });

  it('天花板 position.y === height', () => {
    const { ceiling } = buildRoom(5, 4, 2.8);
    expect(ceiling.position.y).toBe(2.8);
  });

  // ---------------------------------------------------------------------------
  // P8a：落地窗（北墙）
  // ---------------------------------------------------------------------------

  it('默认（withWindow 缺省 = false）不建窗：windows / windowFrame 均为空', () => {
    const { windows, windowFrame } = buildRoom(5, 4, 2.8);
    expect(windows).toHaveLength(0);
    expect(windowFrame).toHaveLength(0);
  });

  it('withWindow: false 时不产生玻璃 mesh', () => {
    const { group, windows } = buildRoom(5, 4, 2.8, { withWindow: false });
    expect(windows).toHaveLength(0);
    // 无窗时仍是 6 个 Mesh 直接子节点（1 地板 + 4 墙 + 1 天花板）
    expect(group.children).toHaveLength(6);
    for (const child of group.children) {
      expect(child).toBeInstanceOf(Mesh);
    }
  });

  it('withWindow: true 时产生 ≥1 面玻璃，且玻璃 material 带 transmission', () => {
    const { windows, windowFrame } = buildRoom(5, 4, 2.8, { withWindow: true });
    expect(windows.length).toBeGreaterThanOrEqual(1);
    expect(windowFrame.length).toBeGreaterThanOrEqual(1);
    const glass = windows[0]!;
    expect(glass.material).toBeInstanceOf(MeshPhysicalMaterial);
    expect((glass.material as MeshPhysicalMaterial).transmission).toBeGreaterThan(0);
  });

  it('withWindow: true 时玻璃不投影（否则窗框阴影被整面玻璃吃掉）', () => {
    const { windows, windowFrame } = buildRoom(5, 4, 2.8, { withWindow: true });
    expect(windows[0]!.castShadow).toBe(false);
    for (const bar of windowFrame) {
      expect(bar.castShadow).toBe(true); // 窗框投出窗格阴影
    }
  });

  it('withWindow: true 时房间组仍是 6 个直接子节点（窗体收进 window-north 子组）', () => {
    // sceneEngine 的「房间组 6 子节点」断言依赖此结构：窗体构件（墙体分段 +
    // 窗框 + 玻璃）收进一个子 Group，而不是平铺成十几个直接子节点。
    const { group } = buildRoom(5, 4, 2.8, { withWindow: true });
    expect(group.children).toHaveLength(6);
    expect(group.getObjectByName('window-north')).toBeDefined();
  });
});
