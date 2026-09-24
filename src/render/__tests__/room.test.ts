import { describe, expect, it } from 'vitest';
import { Mesh } from 'three';

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
});
