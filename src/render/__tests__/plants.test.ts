import { describe, expect, it } from 'vitest';
import type { BoxGeometry, Mesh } from 'three';
import { FOLIAGE_CONES, buildPlanter, buildPlant, foliagePosition, plantHeights } from '../plants.js';

describe('plantHeights（纯函数）', () => {
  it('默认值合理：盆高 0.22、叶丛高 = 0.75 * 0.68', () => {
    expect(plantHeights()).toEqual({ potHeight: 0.22, foliageHeight: 0.75 * 0.68 });
  });

  it('heightScale 缩放叶丛，potHeight 独立', () => {
    const h = plantHeights({ heightScale: 1.0, potHeight: 0.3 });
    expect(h.foliageHeight).toBeCloseTo(0.68, 5);
    expect(h.potHeight).toBe(0.3);
  });

  it('任意 heightScale 都返回正数', () => {
    for (const s of [0.1, 0.5, 1, 2]) {
      expect(plantHeights({ heightScale: s }).foliageHeight).toBeGreaterThan(0);
    }
  });
});

describe('foliagePosition（纯函数）', () => {
  const potHeight = 0.22;
  const foliageHeight = 0.75 * 0.68;
  const coneH = (foliageHeight / FOLIAGE_CONES) * 1.5;

  it('返回 FOLIAGE_CONES 层，每层高度一致 = 1.5 * foliageHeight/N', () => {
    for (let i = 0; i < FOLIAGE_CONES; i++) {
      expect(foliagePosition(i, potHeight, foliageHeight).height).toBeCloseTo(coneH, 5);
    }
  });

  it('圆锥从粗到细：i 越小（越靠下）半径越大', () => {
    const r0 = foliagePosition(0, potHeight, foliageHeight).radius;
    const rLast = foliagePosition(FOLIAGE_CONES - 1, potHeight, foliageHeight).radius;
    expect(r0).toBeGreaterThan(0);
    expect(rLast).toBeLessThan(r0);
  });

  it('圆锥中心 y 随 i 单调递增（i 越大越靠上）', () => {
    const ys: number[] = [];
    for (let i = 0; i < FOLIAGE_CONES; i++) ys.push(foliagePosition(i, potHeight, foliageHeight).y);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]).toBeGreaterThan(ys[i - 1]!);
    }
  });

  it('最底层圆锥底端正好贴住盆口 potHeight', () => {
    const c = foliagePosition(0, potHeight, foliageHeight);
    expect(c.y - c.height / 2).toBeCloseTo(potHeight, 5);
  });

  it('最顶层圆锥顶端 = potHeight + foliageHeight', () => {
    const c = foliagePosition(FOLIAGE_CONES - 1, potHeight, foliageHeight);
    expect(c.y + c.height / 2).toBeCloseTo(potHeight + foliageHeight, 5);
  });

  it('相邻层真正重叠：层高 > 相邻中心间距', () => {
    const c0 = foliagePosition(0, potHeight, foliageHeight);
    const c1 = foliagePosition(1, potHeight, foliageHeight);
    expect(c1.y - c0.y).toBeLessThan(c0.height);
  });

  it('越界的 i 仍返回有限数（不抛错）', () => {
    const c = foliagePosition(-1, potHeight, foliageHeight);
    expect(Number.isFinite(c.y)).toBe(true);
    expect(Number.isFinite(c.radius)).toBe(true);
  });
});

describe('buildPlant（工厂，jsdom 下不崩）', () => {
  it('默认构建出 1 盆 + 5 叶丛 = 6 个子 mesh', () => {
    const g = buildPlant();
    expect(g.name).toBe('plant');
    expect(g.children).toHaveLength(FOLIAGE_CONES + 1);
  });

  it('所有子 mesh 都投影并接收阴影（遮挡上下文红线）', () => {
    const g = buildPlant();
    for (const child of g.children) {
      expect(child.castShadow).toBe(true);
      expect(child.receiveShadow).toBe(true);
    }
  });

  it('不同 seed 产出结构相同的植株（子节点数不变）', () => {
    expect(buildPlant({ seed: 1 }).children.length).toBe(buildPlant({ seed: 999 }).children.length);
  });

  it('heightScale 缩放时叶丛仍为 FOLIAGE_CONES 层', () => {
    const g = buildPlant({ heightScale: 0.5 });
    expect(g.children).toHaveLength(FOLIAGE_CONES + 1);
  });

  it('x/z 写入 group.position（便于放到房间指定角落）', () => {
    const g = buildPlant({ x: -1.5, z: -1.5 });
    expect(g.position.x).toBe(-1.5);
    expect(g.position.z).toBe(-1.5);
    expect(g.position.y).toBe(0);
  });
});

describe('buildPlanter（木箱绿植）', () => {
  it('构建出木箱 + 叶丛球两个 mesh', () => {
    const g = buildPlanter({ x: 1, z: -1.5 });
    expect(g.name).toBe('planter');
    expect(g.children).toHaveLength(2);
    expect(g.position.x).toBe(1);
    expect(g.position.z).toBe(-1.5);
  });

  it('x/z 缺省为 0', () => {
    const g = buildPlanter();
    expect(g.position.x).toBe(0);
    expect(g.position.z).toBe(0);
  });

  it('两个 mesh 都投影并接收阴影', () => {
    const g = buildPlanter();
    for (const child of g.children) {
      expect(child.castShadow).toBe(true);
      expect(child.receiveShadow).toBe(true);
    }
  });

  it('默认 boxSize 时 box 宽度 = 0.5', () => {
    const g = buildPlanter();
    const box = g.children[0] as Mesh;
    expect((box.geometry as BoxGeometry).parameters.width).toBeCloseTo(0.5, 5);
  });
});
