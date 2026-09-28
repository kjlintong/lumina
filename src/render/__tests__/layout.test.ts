/**
 * P34 · Part B 验收：layout.ts 单元测试（14 用例）
 *
 * 覆盖 grid / perimeter / center / sconce 4 模式 + 退化输入。
 */
import { describe, it, expect } from 'vitest';
import {
  rectangularGrid,
  wallLineSegments,
  perimeterAlongWalls,
  roomCenter,
  DEFAULT_LAYOUT_OPTIONS,
} from '../layout.js';
import type { WallSegment } from '../../core/modeling.js';

function makeWall(a: [number, number], b: [number, number], id = 'w-1'): WallSegment {
  return {
    id,
    a: a as readonly [number, number],
    b: b as readonly [number, number],
    thickness: 0.15,
    height: 2.8,
    confidence: 1,
    provenance: { kind: 'user_edit' },
  };
}

describe('rectangularGrid', () => {
  it('正常 3×3 网格：9 盏，位置在 bounds 内', () => {
    const out = rectangularGrid({ x0: 0, x1: 6, z0: 0, z1: 4 }, 3, 3);
    expect(out.length).toBe(9);
    for (const d of out) {
      expect(d.pos[0]).toBeGreaterThanOrEqual(0);
      expect(d.pos[0]).toBeLessThanOrEqual(6);
      expect(d.pos[2]).toBeGreaterThanOrEqual(0);
      expect(d.pos[2]).toBeLessThanOrEqual(4);
      expect(d.suggestedType).toBe('downlight');
    }
  });

  it('1×1 网格：1 盏，居中于 bounds 中心', () => {
    const out = rectangularGrid({ x0: 0, x1: 6, z0: 0, z1: 4 }, 1, 1);
    expect(out.length).toBe(1);
    expect(out[0]!.pos[0]).toBeCloseTo(3);
    expect(out[0]!.pos[2]).toBeCloseTo(2);
  });

  it('退化输入：cols=0 返回 []', () => {
    expect(rectangularGrid({ x0: 0, x1: 6, z0: 0, z1: 4 }, 0, 3)).toEqual([]);
  });

  it('退化输入：负数 cols 返回 []', () => {
    expect(rectangularGrid({ x0: 0, x1: 6, z0: 0, z1: 4 }, -1, 3)).toEqual([]);
  });

  it('超小 bounds（usableX < 0）返回 []', () => {
    // inset 0.15 * 2 = 0.3m，bounds 只有 0.2m 宽 → 不可用
    expect(rectangularGrid({ x0: 0, x1: 0.2, z0: 0, z1: 4 }, 3, 3)).toEqual([]);
  });

  it('y 值 = ceilingH - offsetFromCeiling', () => {
    const opts = { ...DEFAULT_LAYOUT_OPTIONS, ceilingH: 3.0, offsetFromCeiling: 0.1 };
    const out = rectangularGrid({ x0: 0, x1: 6, z0: 0, z1: 4 }, 1, 1, opts);
    expect(out[0]!.pos[1]).toBeCloseTo(2.9);
  });

  it('行优先顺序稳定（外层 z，内层 x）', () => {
    const out = rectangularGrid({ x0: 0, x1: 6, z0: 0, z1: 4 }, 2, 2);
    expect(out.length).toBe(4);
    // 行优先：(0,0) → (0,1) → (1,0) → (1,1)
    // z: [0.15, 0.15, 3.85, 3.85]
    // x: [0.15, 5.85, 0.15, 5.85]
    expect(out[0]!.pos[2]).toBeLessThan(out[2]!.pos[2]);
    expect(out[0]!.pos[0]).toBeLessThan(out[1]!.pos[0]);
    expect(out[2]!.pos[2]).toBeGreaterThan(out[1]!.pos[2]);
  });

  it('法线朝下 (0, -1, 0)', () => {
    const out = rectangularGrid({ x0: 0, x1: 6, z0: 0, z1: 4 }, 1, 1);
    expect(out[0]!.normal).toEqual([0, -1, 0]);
  });
});

describe('wallLineSegments', () => {
  it('10m 水平墙等分 3 段：3 盏，x 递增，y 在天花下', () => {
    const w = makeWall([0, 0], [10, 0]);
    const out = wallLineSegments(w, 3);
    expect(out.length).toBe(3);
    expect(out[0]!.pos[0]).toBeLessThan(out[1]!.pos[0]);
    expect(out[1]!.pos[0]).toBeLessThan(out[2]!.pos[0]);
    expect(out[0]!.pos[1]).toBeCloseTo(DEFAULT_LAYOUT_OPTIONS.ceilingH - 0.05);
  });

  it('对角墙法线方向正确', () => {
    // 从 (0,0) → (3,4)，方向 (0.6, 0.8)，法线左侧 (0.8, -0.6)
    const w = makeWall([0, 0], [3, 4]);
    const out = wallLineSegments(w, 1);
    expect(out.length).toBe(1);
    const [nx, ny, nz] = out[0]!.normal;
    expect(ny).toBe(0);
    expect(nx).toBeCloseTo(0.8);
    expect(nz).toBeCloseTo(-0.6);
  });

  it('segments=1 边界：返回 1 盏，居中', () => {
    const w = makeWall([0, 0], [10, 0]);
    const out = wallLineSegments(w, 1);
    expect(out.length).toBe(1);
    expect(out[0]!.pos[0]).toBeCloseTo(5);
  });

  it('segments < 1 返回 []', () => {
    expect(wallLineSegments(makeWall([0, 0], [10, 0]), 0)).toEqual([]);
    expect(wallLineSegments(makeWall([0, 0], [10, 0]), -1)).toEqual([]);
  });

  it('太短的墙（< 0.6m）返回 []', () => {
    expect(wallLineSegments(makeWall([0, 0], [0.4, 0]), 3)).toEqual([]);
  });
});

describe('perimeterAlongWalls', () => {
  it('2 段墙 × 3 段：共 6 盏', () => {
    const walls: WallSegment[] = [
      makeWall([0, 0], [10, 0], 'w1'),
      makeWall([10, 0], [10, 10], 'w2'),
    ];
    const out = perimeterAlongWalls(walls, 3);
    expect(out.length).toBe(6);
  });

  it('跳过太短的墙', () => {
    const walls: WallSegment[] = [
      makeWall([0, 0], [0.4, 0], 'short'),
      makeWall([10, 0], [10, 10], 'ok'),
    ];
    const out = perimeterAlongWalls(walls, 3);
    // 只有 w2 会产出 3 盏
    expect(out.length).toBe(3);
  });
});

describe('roomCenter', () => {
  it('4 顶点矩形：返回 1 盏，在矩形中心', () => {
    const vertices: readonly (readonly [number, number])[] = [
      [0, 0],
      [6, 0],
      [6, 4],
      [0, 4],
    ];
    const out = roomCenter(vertices);
    expect(out.length).toBe(1);
    expect(out[0]!.pos[0]).toBeCloseTo(3);
    expect(out[0]!.pos[2]).toBeCloseTo(2);
    expect(out[0]!.suggestedType).toBe('pendant');
  });

  it('退化：顶点 < 3 返回 []', () => {
    expect(roomCenter([[0, 0]] as readonly (readonly [number, number])[])).toEqual([]);
    expect(roomCenter([] as readonly (readonly [number, number])[])).toEqual([]);
  });

  it('法线朝下 (0, -1, 0)', () => {
    const out = roomCenter([[0, 0], [4, 0], [4, 4], [0, 4]] as readonly (readonly [number, number])[]);
    expect(out[0]!.normal).toEqual([0, -1, 0]);
  });
});
