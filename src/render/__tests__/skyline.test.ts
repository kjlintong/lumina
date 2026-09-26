import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  BUILDING_COLORS,
  BRIDGE_SPAN,
  BRIDGE_TOWER_H,
  BUILDING_COUNT,
  WATER_COLOR,
  buildingLayout,
  buildSkyline,
  waterDims,
} from '../skyline.js';

/** 窗中心世界坐标（测试用的固定位置，避免每个测试都重建） */
const WIN = new Vector3(1.2, 1.4, -2.25);
/** 窗外法线（北墙朝北） */
const NORMAL = new Vector3(0, 0, -1);

describe('buildingLayout（纯函数）', () => {
  it('同 i 同 seed 两次调用产出完全相同的楼（确定性）', () => {
    for (const i of [0, 5, 13]) {
      const a = buildingLayout(i, 14, 13);
      const b = buildingLayout(i, 14, 13);
      expect(a).toEqual(b);
    }
  });

  it('不同 i 在同一 seed 下产出不同的楼（避免整齐划一）', () => {
    const heights = new Set<number>();
    for (let i = 0; i < 14; i++) heights.add(buildingLayout(i, 14, 13).h);
    expect(heights.size).toBeGreaterThan(5);
  });

  it('不同 seed 产出不同楼群', () => {
    const a = buildingLayout(0, 14, 13);
    const b = buildingLayout(0, 14, 999);
    // 高度几乎不可能相同（连续随机）
    expect(a.h).not.toBe(b.h);
  });

  it('楼宽 / 楼深 / 楼高都在合理区间内', () => {
    for (let i = 0; i < 14; i++) {
      const L = buildingLayout(i, 14, 13);
      expect(L.w).toBeGreaterThan(0.5);
      expect(L.w).toBeLessThan(3);
      expect(L.d).toBeGreaterThan(0.5);
      expect(L.d).toBeLessThan(3);
      expect(L.h).toBeGreaterThan(1);
      expect(L.h).toBeLessThan(12);
    }
  });

  it('楼群横向铺满 [-8, 8] 且不出界', () => {
    const xs = Array.from({ length: 14 }, (_, i) => buildingLayout(i, 14, 13).x);
    expect(Math.min(...xs)).toBeGreaterThan(-9);
    expect(Math.max(...xs)).toBeLessThan(9);
  });

  it('楼越高、窗灯排数越多，且至少 2 排', () => {
    for (let i = 0; i < 14; i++) {
      const L = buildingLayout(i, 14, 13);
      expect(L.windowRows).toBeGreaterThanOrEqual(2);
    }
    // 最矮 vs 最高的对比
    const short = buildingLayout(0, 14, 13);
    const tall = buildingLayout(7, 14, 13);
    expect(tall.windowRows).toBeGreaterThanOrEqual(short.windowRows);
  });

  it('buildingCount=1 时不抛错（边界）', () => {
    const L = buildingLayout(0, 1, 13);
    expect(Number.isFinite(L.x)).toBe(true);
    expect(Number.isFinite(L.h)).toBe(true);
  });

  it('楼颜色取自 BUILDING_COLORS 调色板', () => {
    const color = buildingLayout(3, 14, 13).color;
    expect(BUILDING_COLORS).toContain(color);
  });

  it('BUILDING_COLORS 至少 4 种配色，便于错落', () => {
    expect(BUILDING_COLORS.length).toBeGreaterThanOrEqual(4);
  });
});

describe('水面 / 吊桥常量', () => {
  it('waterDims 返回 [width, height, depth]，单位米', () => {
    const [w, , d] = waterDims();
    expect(w).toBeGreaterThan(0);
    expect(d).toBeGreaterThan(0);
  });

  it('BRIDGE_SPAN / BRIDGE_TOWER_H 为正', () => {
    expect(BRIDGE_SPAN).toBeGreaterThan(0);
    expect(BRIDGE_TOWER_H).toBeGreaterThan(0);
    expect(BRIDGE_TOWER_H).toBeGreaterThan(1);
  });

  it('WATER_COLOR 是合法 hex', () => {
    expect(WATER_COLOR).toBeGreaterThanOrEqual(0x000000);
    expect(WATER_COLOR).toBeLessThanOrEqual(0xffffff);
  });

  it('BUILDING_COUNT 默认值合理（>= 8 栋）', () => {
    expect(BUILDING_COUNT).toBeGreaterThanOrEqual(8);
  });
});

describe('buildSkyline（工厂，jsdom 下不崩）', () => {
  it('默认构建出 buildingCount 栋楼 + 1 水面 + 2 塔 + 1 桥面', () => {
    const g = buildSkyline(WIN, NORMAL);
    expect(g.name).toBe('skyline');
    expect(g.children).toHaveLength(BUILDING_COUNT + 4);
  });

  it('buildingCount 可控', () => {
    const g = buildSkyline(WIN, NORMAL, {
      buildingCount: 5,
    });
    expect(g.children).toHaveLength(5 + 4);
  });

  it('所有 mesh 都不参与阴影（室外远景红线：不参与阴影）', () => {
    const g = buildSkyline(WIN, NORMAL);
    for (const child of g.children) {
      expect(child.castShadow).toBe(false);
      expect(child.receiveShadow).toBe(false);
    }
  });

  it('不同 seed 产出结构相同的城市（children 数一致）', () => {
    const a = buildSkyline(WIN, NORMAL, { seed: 1 });
    const b = buildSkyline(WIN, NORMAL, { seed: 999 });
    expect(a.children.length).toBe(b.children.length);
  });

  it('group.position 跟随 windowWorldPos（与 buildSkyScene 一致）', () => {
    const g = buildSkyline(WIN, NORMAL);
    expect(g.position.x).toBe(1.2);
    expect(g.position.y).toBe(1.4);
    expect(g.position.z).toBe(-2.25);
  });
});
