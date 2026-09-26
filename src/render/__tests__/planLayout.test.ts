import type { ActivityZone, Fixture } from '../../core/types.js';
import { describe, expect, it } from 'vitest';
import {
  computeScale,
  fixturesToDots,
  planOrigin,
  roomRect,
  windowSegment,
  worldToPlan,
  zonesToRects,
} from '../planLayout.js';

const ROOM = { width: 6, depth: 4.5, height: 2.8 };
const CFG = { width: 220, height: 170 };

describe('computeScale', () => {
  it('返回正数', () => {
    expect(computeScale(ROOM, CFG)).toBeGreaterThan(0);
  });

  it('房间（加边距）铺满绘图区：scale * (room + margin*2) ≤ 绘图区', () => {
    const s = computeScale(ROOM, CFG);
    // 取较小值方向会精确等于绘图区，FP 误差 +1e-13，留 1e-6 容差
    expect(s * (ROOM.width + 0.8)).toBeLessThanOrEqual(CFG.width + 1e-6);
    expect(s * (ROOM.depth + 0.8)).toBeLessThanOrEqual(CFG.height + 1e-6);
  });

  it('取宽高方向的较小值（不会被宽方向撑大）', () => {
    const s = computeScale(ROOM, CFG);
    // 深度方向也受约束
    expect(s).toBeLessThanOrEqual(CFG.height / (ROOM.depth + 0.8));
    expect(s).toBeLessThanOrEqual(CFG.width / (ROOM.width + 0.8));
  });

  it('自定义 margin 生效', () => {
    const s1 = computeScale(ROOM, CFG);
    const s2 = computeScale(ROOM, { ...CFG, margin: 1 });
    expect(s2).toBeLessThan(s1); // 边距更大 → 比例更小
  });
});

describe('planOrigin', () => {
  it('房间中心对应绘图区中心', () => {
    const { ox, oy } = planOrigin(CFG);
    expect(ox).toBe(CFG.width / 2);
    expect(oy).toBe(CFG.height / 2);
  });
});

describe('worldToPlan（坐标变换）', () => {
  const { ox, oy } = planOrigin(CFG);
  const s = computeScale(ROOM, CFG);

  it('世界原点 → 绘图区中心', () => {
    const p = worldToPlan(0, 0, ox, oy, s);
    expect(p.x).toBe(CFG.width / 2);
    expect(p.y).toBe(CFG.height / 2);
  });

  it('正 x（东）→ SVG x 增大；负 x（西）→ SVG x 减小', () => {
    const e = worldToPlan(1, 0, ox, oy, s);
    const w = worldToPlan(-1, 0, ox, oy, s);
    expect(e.x).toBeGreaterThan(ox);
    expect(w.x).toBeLessThan(ox);
  });

  it('负 z（北）→ SVG y 更小（图纸上方）——北墙在图纸顶部', () => {
    const n = worldToPlan(0, -2, ox, oy, s);
    const s2 = worldToPlan(0, 2, ox, oy, s);
    expect(n.y).toBeLessThan(oy);
    expect(s2.y).toBeGreaterThan(oy);
    expect(n.y).toBeLessThan(s2.y); // 北在上、南在下
  });

  it('x/y 对称：|x|=|z|=1 时 |dx|=|dy|=s', () => {
    const e = worldToPlan(1, 0, ox, oy, s);
    const n = worldToPlan(0, -1, ox, oy, s);
    expect(Math.abs(e.x - ox)).toBeCloseTo(Math.abs(n.y - oy), 5);
  });
});

describe('roomRect', () => {
  const { ox, oy } = planOrigin(CFG);
  const s = computeScale(ROOM, CFG);

  it('房间矩形尺寸 = room * scale', () => {
    const r = roomRect(ROOM, ox, oy, s);
    expect(r.w).toBeCloseTo(ROOM.width * s, 5);
    expect(r.h).toBeCloseTo(ROOM.depth * s, 5);
  });

  it('矩形中心 = 绘图区中心（房间在世界原点）', () => {
    const r = roomRect(ROOM, ox, oy, s);
    expect(r.x + r.w / 2).toBeCloseTo(CFG.width / 2, 5);
    expect(r.y + r.h / 2).toBeCloseTo(CFG.height / 2, 5);
  });

  it('矩形在绘图区内（不出界）', () => {
    const r = roomRect(ROOM, ox, oy, s);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(CFG.width);
    expect(r.y + r.h).toBeLessThanOrEqual(CFG.height);
  });
});

describe('windowSegment', () => {
  const { ox, oy } = planOrigin(CFG);
  const s = computeScale(ROOM, CFG);

  it('窗在北墙（图纸顶部）：y 接近 roomRect.y', () => {
    const w = windowSegment(ROOM, ROOM.width * 0.7, ox, oy, s);
    const r = roomRect(ROOM, ox, oy, s);
    expect(w.y).toBeCloseTo(r.y, 5);
  });

  it('窗宽 = windowWidth * scale，居中', () => {
    const winW = ROOM.width * 0.7;
    const w = windowSegment(ROOM, winW, ox, oy, s);
    expect(w.x2 - w.x1).toBeCloseTo(winW * s, 5);
    expect((w.x1 + w.x2) / 2).toBeCloseTo(ox, 5);
  });

  it('窗在房间范围内（不超出外墙）', () => {
    const w = windowSegment(ROOM, ROOM.width * 0.7, ox, oy, s);
    const r = roomRect(ROOM, ox, oy, s);
    expect(w.x1).toBeGreaterThanOrEqual(r.x - 1);
    expect(w.x2).toBeLessThanOrEqual(r.x + r.w + 1);
  });
});

/** 测试用最小 ActivityZone */
function makeZone(key: string, pos: readonly [number, number], size: readonly [number, number], rotY = 0): ActivityZone {
  return {
    key,
    type: 'lounge',
    name: '客厅',
    pos,
    rotY,
    size,
    planeH: 0.45,
    lux: 100,
    cct: 3000,
    need: 'test',
    suggestion: [],
    fixtures: [],
  } as ActivityZone;
}

describe('zonesToRects', () => {
  const { ox, oy } = planOrigin(CFG);
  const s = computeScale(ROOM, CFG);

  it('每个 zone 产出一个矩形', () => {
    const zones: Record<string, ActivityZone> = {
      z1: makeZone('z1', [0, 0], [2, 2]),
      z2: makeZone('z2', [1.5, -1], [1.5, 1.5]),
    };
    const rects = zonesToRects(zones, ox, oy, s);
    expect(rects).toHaveLength(2);
  });

  it('矩形尺寸 = zone.size * scale（无旋转时）', () => {
    const zones: Record<string, ActivityZone> = { z1: makeZone('z1', [0, 0], [2, 1.5]) };
    const [r] = zonesToRects(zones, ox, oy, s);
    expect(r!.w).toBeCloseTo(2 * s, 5);
    expect(r!.h).toBeCloseTo(1.5 * s, 5);
  });

  it('矩形中心 = zone.pos 的投影', () => {
    const pos: readonly [number, number] = [1.2, -0.8];
    const zones: Record<string, ActivityZone> = { z1: makeZone('z1', pos, [1, 1]) };
    const [r] = zonesToRects(zones, ox, oy, s);
    const p = worldToPlan(pos[0], pos[1], ox, oy, s);
    expect(r!.x + r!.w / 2).toBeCloseTo(p.x, 5);
    expect(r!.y + r!.h / 2).toBeCloseTo(p.y, 5);
  });

  it('旋转 90° 时矩形尺寸对调（AABB 外接）', () => {
    const zones: Record<string, ActivityZone> = { z1: makeZone('z1', [0, 0], [2, 1], Math.PI / 2) };
    const [r] = zonesToRects(zones, ox, oy, s);
    // 90° 旋转后 w<->h 互换
    expect(r!.w).toBeCloseTo(1 * s, 5);
    expect(r!.h).toBeCloseTo(2 * s, 5);
  });

  it('标签位置 = 矩形中心', () => {
    const zones: Record<string, ActivityZone> = { z1: makeZone('z1', [0, 0], [2, 1.5]) };
    const [r] = zonesToRects(zones, ox, oy, s);
    expect(r!.labelX).toBeCloseTo(r!.x + r!.w / 2, 5);
    expect(r!.labelY).toBeCloseTo(r!.y + r!.h / 2, 5);
  });
});

/** 测试用最小 Fixture */
function makeFixture(id: string, pos: readonly [number, number, number], type: 'downlight' | 'pendant' | 'floor' | 'table' = 'downlight'): Fixture {
  return {
    id,
    type,
    mount: 'ceiling',
    shape: { form: 'cone', diameter: 0.2, height: 0.3, aperture: 0.2, shade: { transmission: 0.3, roughness: 0.5, metalness: 0, color: '#fff' } },
    pos,
    rot: { pitch: 0, yaw: 0 },
    photometric: { lumens: 500, beamAngle: 60, distribution: 'spot', ies: undefined, iesVerified: false, iesChecksum: undefined },
    electrical: { cct: 3000, cri: 80, watt: 7, dimFloor: 0.1 },
    control: { group: 'g', circuit: 'c', sceneLevels: {} },
    binding: null,
    lockedFields: new Set(),
    source: 'sku',
  };
}

describe('fixturesToDots', () => {
  const { ox, oy } = planOrigin(CFG);
  const s = computeScale(ROOM, CFG);

  it('每个 fixture 产出一个点', () => {
    const fixtures: Record<string, Fixture> = {
      f1: makeFixture('f1', [0, 2.7, 0]),
      f2: makeFixture('f2', [1, 2.7, -1]),
    };
    const dots = fixturesToDots(fixtures, ox, oy, s);
    expect(dots).toHaveLength(2);
  });

  it('点坐标 = fixture.pos 的 (x, z) 投影（y 被忽略）', () => {
    const fixtures: Record<string, Fixture> = { f1: makeFixture('f1', [1.5, 2.7, -0.5]) };
    const [d] = fixturesToDots(fixtures, ox, oy, s);
    const p = worldToPlan(1.5, -0.5, ox, oy, s);
    expect(d!.x).toBeCloseTo(p.x, 5);
    expect(d!.y).toBeCloseTo(p.y, 5);
  });

  it('正 x 灯具在绘图区右半，负 z 灯具在上半', () => {
    const fixtures: Record<string, Fixture> = {
      e: makeFixture('e', [2, 2.7, 0]),
      n: makeFixture('n', [0, 2.7, -1.5]),
    };
    const dots = fixturesToDots(fixtures, ox, oy, s);
    const e = dots.find((d) => d.id === 'e')!;
    const n = dots.find((d) => d.id === 'n')!;
    expect(e.x).toBeGreaterThan(ox);
    expect(n.y).toBeLessThan(oy);
  });
});
