import { describe, expect, it } from 'vitest';

import { makeFixture } from '../../core/makeFixture.js';
import { makeZone } from '../../core/zoneTypes.js';
import {
  DISCLAIMER,
  MIN_DISTANCE,
  RANGE_FACTOR,
  calculateAllZones,
  calculateZoneIlluminance,
  fixtureContribution,
  formatIlluminance,
  fmtLx,
} from '../illuminance.js';

/** I = Φ / 4π（均匀球面，与实现的点光源近似同口径） */
const cd = (lumens: number): number => lumens / (4 * Math.PI);
/** 点光源照度 E = I / d² */
const pointLx = (lumens: number, d: number): number => cd(lumens) / (d * d);
/** 厨房操作台工作面 0.9m 到 2.4m 天花板的垂直距离 */
const V = 2.4 - 0.9;
/** 侧向偏移：与垂直向下瞄准方向的夹角 θ = atan2(OFF, V) = 53.13° */
const OFF = 2;
/** 灯具 (0, 2.4, OFF) 到工作面点 (0, 0.9, 0) 的距离 d = 2.5m */
const D = Math.hypot(V, OFF);

describe('相对照度估算（§6 点光源近似，红线：非实测照度）', () => {
  it('E = I / d² 且 I = Φ / 4π：吊灯垂直照在正上方工作面上（d = 1.5m）', () => {
    const zone = makeZone('kitchen', [0, 0]); // 工作面 (0, 0.9, 0)
    const fx = makeFixture({ type: 'pendant', lumens: 1200, pos: [0, 2.4, 0], skuId: 'fx-p1' });
    expect(calculateZoneIlluminance(zone, [fx]).total).toBeCloseTo(pointLx(1200, V), 6);
  });

  it('工作面高度 planeH 决定 dy，不是层高', () => {
    const high = makeZone('wardrobe', [0, 0]); // planeH 1.2
    const low = makeZone('work', [0, 0]); // planeH 0.75
    const fx = makeFixture({ type: 'pendant', lumens: 1200, pos: [0, 2.4, 0], skuId: 'fx-p2' });
    expect(calculateZoneIlluminance(low, [fx]).total).toBeCloseTo(pointLx(1200, 2.4 - 0.75), 6);
    expect(calculateZoneIlluminance(high, [fx]).total).toBeCloseTo(pointLx(1200, 1.2), 6);
  });

  it('距离越远越暗，且严格按平方反比（dx、dz 都计入 d²）', () => {
    const zone = makeZone('kitchen', [0, 0]);
    const near = makeFixture({ type: 'pendant', lumens: 1200, pos: [0, 2.4, 0], skuId: 'fx-n' });
    const far = makeFixture({ type: 'pendant', lumens: 1200, pos: [0, 2.4, 4], skuId: 'fx-f' });
    expect(calculateZoneIlluminance(zone, [near]).total).toBeCloseTo(pointLx(1200, V), 6);
    expect(calculateZoneIlluminance(zone, [far]).total).toBeCloseTo(
      pointLx(1200, Math.hypot(V, 4)),
      6,
    );
  });

  it('多盏灯具线性叠加，total 恰等于 perFixture 之和', () => {
    const zone = makeZone('kitchen', [0, 0]);
    const a = makeFixture({ type: 'pendant', lumens: 1000, pos: [0, 2.4, 0], skuId: 'fx-a' });
    const b = makeFixture({ type: 'pendant', lumens: 800, pos: [0, 2.4, 2], skuId: 'fx-b' });
    const r = calculateZoneIlluminance(zone, [a, b]);
    expect(r.perFixture.size).toBe(2);
    expect(r.perFixture.get('fx-a')).toBeCloseTo(pointLx(1000, V), 6);
    expect(r.perFixture.get('fx-b')).toBeCloseTo(pointLx(800, Math.hypot(V, 2)), 6);
    const sum = [...r.perFixture.values()].reduce((s, v) => s + v, 0);
    expect(r.total).toBeCloseTo(sum, 9);
  });

  it('点光源型（吊灯/落地灯/台灯）各向同性：光束角与姿态都不影响结果', () => {
    const zone = makeZone('kitchen', [0, 0]);
    const mk = (id: string, pitch: number, yaw: number, beamAngle: number) =>
      makeFixture({
        type: 'pendant',
        lumens: 1000,
        beamAngle,
        pos: [0, 2.4, 0],
        rot: { pitch, yaw },
        skuId: id,
      });
    const cases: [string, number, number, number][] = [
      ['a', 0, 0, 180],
      ['b', 0, 0, 1],
      ['c', 0.9, 1.3, 90],
    ];
    for (const [id, pitch, yaw, beam] of cases) {
      expect(calculateZoneIlluminance(zone, [mk(id, pitch, yaw, beam)]).total).toBeCloseTo(
        pointLx(1000, V),
        6,
      );
    }
  });

  it('定向灯正对目标时 factor = 1：贡献恰等于纯点光源值', () => {
    // 灯具斜置：pitch 正好等于「灯具→工作面点」的俯角 → θ = 0
    const fx = makeFixture({
      type: 'spot',
      lumens: 1000,
      beamAngle: 24, // 半角仅 12°：仍然命中，说明判定用的是 θ，不是恒等 1
      pos: [0, 2.4, OFF],
      rot: { pitch: Math.atan2(OFF, V), yaw: 0 },
      skuId: 'fx-aim',
    });
    const d = Math.hypot(V, OFF);
    // toZone = fixture → zone：灯具 (0, 2.4, 2)、工作面 (0, 0.9, 0) → (0, -1.5, -2)
    expect(fixtureContribution(fx, [0, -V, -OFF], d)).toBeCloseTo(pointLx(1000, d), 6);
  });

  it('beamAngle 按半角判定：θ = 53.13° 时 120° 全角光束命中，90° 出界', () => {
    const zone = makeZone('kitchen', [0, 0]); // 工作面 (0, 0.9, 0)
    // 灯具 (0, 2.4, 2) 垂直向下瞄准：到工作面点夹角 θ = atan2(2, 1.5) = 53.13°
    const mk = (angle: number, id: string) =>
      makeFixture({ type: 'spot', lumens: 1000, beamAngle: angle, pos: [0, 2.4, OFF], skuId: id });
    expect(calculateZoneIlluminance(zone, [mk(120, 'hit')]).total).toBeCloseTo(pointLx(1000, D), 6);
    expect(calculateZoneIlluminance(zone, [mk(90, 'miss')]).total).toBe(0);
  });

  it('pitch/yaw 共同决定照射方向：水平瞄准打不到台面，带俯角对准则命中', () => {
    const zone = makeZone('kitchen', [0, 0]);
    // 灯具 (OFF, 2.4, 0)，目标在其 -X 方向、下方 1.5m 处
    const mk = (yaw: number, id: string) =>
      makeFixture({
        type: 'spot',
        lumens: 1000,
        beamAngle: 60, // 半角 30°…目标在瞄准轴下方 36.87°，故出界（见下）
        pos: [OFF, 2.4, 0],
        rot: { pitch: Math.PI / 2, yaw },
        skuId: id,
      });
    // 水平瞄准（pitch = π/2）指向的是「灯具高度的地面线」，工作面点在其下方 36.87°
    expect(calculateZoneIlluminance(zone, [mk(-Math.PI / 2, 'aimed')]).total).toBe(0);
    // 真正的「对准」要带俯角：pitch = atan2(水平, 垂直)，θ = 0 → 命中
    const aimed = makeFixture({
      type: 'spot',
      lumens: 1000,
      beamAngle: 60,
      pos: [OFF, 2.4, 0],
      rot: { pitch: Math.atan2(OFF, V), yaw: -Math.PI / 2 },
      skuId: 'on',
    });
    expect(calculateZoneIlluminance(zone, [aimed]).total).toBeCloseTo(pointLx(1000, D), 6);
    expect(calculateZoneIlluminance(zone, [mk(Math.PI / 2, 'back')]).total).toBe(0); // 水平朝 +X
  });

  it('横向瞄准（θ = 90°）贡献为 0，且永不出现负值', () => {
    const zone = makeZone('kitchen', [0, 0]);
    const fx = makeFixture({
      type: 'spot',
      lumens: 1000,
      pos: [0, 2.4, 0],
      rot: { pitch: Math.PI / 2, yaw: 0 }, // 水平朝 -Z，目标在其正下方
      skuId: 'fx-side',
    });
    expect(calculateZoneIlluminance(zone, [fx]).total).toBe(0);
    expect(fixtureContribution(fx, [0, -V, 0], V)).toBe(0);
  });

  it('落在光束外但在范围内的灯具：贡献 0，仍记录在 perFixture 中', () => {
    const zone = makeZone('kitchen', [0, 0]);
    const off = makeFixture({
      type: 'spot',
      lumens: 1000,
      beamAngle: 24,
      pos: [1, 2.4, 0],
      skuId: 'fx-off',
    });
    const r = calculateZoneIlluminance(zone, [off]);
    expect(r.perFixture.get('fx-off')).toBe(0);
    expect(r.total).toBe(0);
  });

  it('超出 3 × 区最大边长的灯具不参与计算（不进入 perFixture）', () => {
    const zone = makeZone('kitchen', [0, 0], { size: [2, 1] }); // range = 3 × 2 = 6
    const inside = makeFixture({
      type: 'pendant',
      lumens: 1000,
      pos: [5.9, 2.4, 0],
      skuId: 'fx-in',
    });
    const outside = makeFixture({
      type: 'pendant',
      lumens: 1000,
      pos: [6.1, 2.4, 0],
      skuId: 'fx-out',
    });
    const r = calculateZoneIlluminance(zone, [inside, outside]);
    expect(RANGE_FACTOR).toBe(3);
    expect(r.perFixture.has('fx-out')).toBe(false);
    expect(r.perFixture.size).toBe(1);
    expect(r.total).toBeCloseTo(r.perFixture.get('fx-in')!, 9);
  });

  it('范围筛除按水平距离判：正上方但很高的灯不会被高度误剔除', () => {
    const zone = makeZone('kitchen', [0, 0]);
    const tall = makeFixture({ type: 'pendant', lumens: 1000, pos: [0, 50, 0], skuId: 'fx-tall' });
    const r = calculateZoneIlluminance(zone, [tall]);
    expect(r.perFixture.has('fx-tall')).toBe(true);
    expect(r.total).toBeCloseTo(pointLx(1000, 50 - 0.9), 6);
  });

  it('范围筛除同时适用于 x 和 z 两个方向', () => {
    const zone = makeZone('kitchen', [0, 0], { size: [2, 1] });
    const alongX = makeFixture({
      type: 'pendant',
      lumens: 1000,
      pos: [6.1, 2.4, 0],
      skuId: 'fx-x',
    });
    const alongZ = makeFixture({
      type: 'pendant',
      lumens: 1000,
      pos: [0, 2.4, -6.1],
      skuId: 'fx-z',
    });
    expect(calculateZoneIlluminance(zone, [alongX, alongZ]).perFixture.size).toBe(0);
  });

  it('灯具与工作面点重合（d = 0）时距离被钳制到 MIN_DISTANCE，结果有限', () => {
    const zone = makeZone('kitchen', [0, 0]); // 工作面点 (0, 0.9, 0)
    const fx = makeFixture({ type: 'pendant', lumens: 1000, pos: [0, 0.9, 0], skuId: 'fx-0' });
    const r = calculateZoneIlluminance(zone, [fx]);
    expect(MIN_DISTANCE).toBeGreaterThan(0);
    expect(r.total).toBeCloseTo(pointLx(1000, MIN_DISTANCE), 6);
    expect(Number.isFinite(r.total)).toBe(true);
  });

  it('target = 0 时 ratio = Infinity，且格式化不产生 NaN', () => {
    const zone = { ...makeZone('kitchen'), lux: 0 };
    const fx = makeFixture({ type: 'pendant', lumens: 1000, pos: [0, 2.4, 0], skuId: 'fx-t0' });
    const r = calculateZoneIlluminance(zone, [fx]);
    expect(r.target).toBe(0);
    expect(r.ratio).toBe(Infinity);
    expect(r.ratio).toBe(r.total / r.target);
    expect(formatIlluminance(r)).not.toContain('NaN');
  });

  it('无灯具：total = 0，perFixture 为空，ratio = 0', () => {
    const r = calculateZoneIlluminance(makeZone('work'), []);
    expect(r.total).toBe(0);
    expect(r.perFixture.size).toBe(0);
    expect(r.target).toBe(500);
    expect(r.ratio).toBe(0);
  });

  it('ratio = total / target，正确反映达成比例', () => {
    const zone = makeZone('work'); // target 500
    const fx = makeFixture({ type: 'pendant', lumens: 6000, pos: [0, 2.4, 0], skuId: 'fx-r' });
    const r = calculateZoneIlluminance(zone, [fx]);
    expect(r.target).toBe(500);
    expect(r.ratio).toBeCloseTo(r.total / 500, 9);
  });

  it('IES 配光无可参数化光强：贡献记 0，且不干扰同批其它灯具', () => {
    const zone = makeZone('kitchen', [0, 0]);
    const ies = makeFixture({
      type: 'downlight',
      ies: 'assets/x.luminaire',
      pos: [0, 2.4, 0],
      skuId: 'fx-ies',
    });
    const pendant = makeFixture({ type: 'pendant', lumens: 1000, pos: [0, 2.4, 0], skuId: 'fx-p' });
    expect(calculateZoneIlluminance(zone, [ies]).total).toBe(0);
    const mixed = calculateZoneIlluminance(zone, [ies, pendant]);
    expect(mixed.perFixture.get('fx-ies')).toBe(0);
    expect(mixed.total).toBeCloseTo(pointLx(1000, V), 6);
  });

  it('结果与传入顺序无关（total 与 perFixture 内容一致）', () => {
    const zone = makeZone('lounge', [0, 0]);
    const fs = [
      makeFixture({ type: 'pendant', lumens: 800, pos: [0, 2.4, 0], skuId: 'a' }),
      makeFixture({ type: 'pendant', lumens: 800, pos: [9, 2.4, 9], skuId: 'b' }), // 超出范围
      makeFixture({ type: 'spot', lumens: 500, beamAngle: 24, pos: [1, 2.4, 1], skuId: 'c' }), // 出界
    ];
    const r1 = calculateZoneIlluminance(zone, fs);
    const r2 = calculateZoneIlluminance(zone, [...fs].reverse());
    expect(r1.total).toBe(r2.total);
    const ent = (m: Map<string, number>): [string, number][] =>
      [...m.entries()].sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0));
    expect(ent(r1.perFixture)).toEqual(ent(r2.perFixture));
    expect(r1.perFixture.has('b')).toBe(false);
  });

  describe('calculateAllZones（多区批量）', () => {
    it('为每个区独立计算，target 取自各自的 zone.lux', () => {
      const zones = {
        work: makeZone('work', [-1, 0], { key: 'work' }),
        dining: makeZone('dining', [1, 0], { key: 'dining' }),
      };
      const fixtures = {
        p: makeFixture({ type: 'pendant', lumens: 1200, pos: [0, 2.4, 0], skuId: 'p' }),
      };
      const out = calculateAllZones(zones, fixtures);
      expect(Object.keys(out).sort()).toEqual(['dining', 'work']);
      expect(out.work!.target).toBe(500);
      expect(out.dining!.target).toBe(150);
      expect(out.work!.total).toBeCloseTo(
        calculateZoneIlluminance(zones.work, [fixtures.p]).total,
        9,
      );
      expect(out.dining!.ratio).toBeCloseTo(out.dining!.total / 150, 9);
    });

    it('各区间互不影响：同一套灯具在不同位置给出不同结果', () => {
      const zones = {
        a: makeZone('kitchen', [-2, 0], { key: 'a' }),
        b: makeZone('kitchen', [1, 0], { key: 'b' }),
      };
      const fixtures = {
        p: makeFixture({ type: 'pendant', lumens: 2000, pos: [0, 2.4, 0], skuId: 'p' }),
      };
      const out = calculateAllZones(zones, fixtures);
      expect(out.a!.total).toBeLessThan(out.b!.total); // p 离 b 更近
      expect(out.a!.ratio).not.toBe(out.b!.ratio);
    });

    it('空输入返回空对象，不抛错；空灯具时各区 total = 0', () => {
      expect(calculateAllZones({}, {})).toEqual({});
      const only = calculateAllZones({ a: makeZone('work', [0, 0], { key: 'a' }) }, {});
      expect(Object.keys(only)).toEqual(['a']);
      expect(only.a!.total).toBe(0);
      expect(only.a!.ratio).toBe(0);
    });
  });

  describe('formatIlluminance（红线：必须带「相对估算，非实测照度」）', () => {
    it('输出包含目标值、估算值、百分比与红线标注', () => {
      const zone = makeZone('kitchen', [0, 0]);
      const fx = makeFixture({ type: 'pendant', lumens: 1000, pos: [0, 2.4, 0], skuId: 'fx-f1' });
      const s = formatIlluminance(calculateZoneIlluminance(zone, [fx]));
      expect(s).toContain('目标 300 lx');
      expect(s).toContain('估算');
      expect(s).toContain('lx (');
      expect(s).toContain('%)');
    });

    it('各种输入组合下都必须包含红线标注，且不产生 NaN / undefined', () => {
      const cases: { total: number; target: number; ratio: number }[] = [
        { total: 0, target: 300, ratio: 0 },
        { total: 245, target: 300, ratio: 245 / 300 },
        { total: 720, target: 300, ratio: 2.4 },
        { total: 1e6, target: 100, ratio: 1e4 },
        { total: 0.0004, target: 500, ratio: 8e-7 },
        { total: 0, target: 0, ratio: Infinity },
      ];
      for (const c of cases) {
        const s = formatIlluminance({ ...c, perFixture: new Map() });
        expect(s, JSON.stringify(c)).toContain(DISCLAIMER);
        expect(s).toContain('相对估算，非实测照度');
        expect(s).not.toContain('NaN');
        expect(s).not.toContain('undefined');
      }
    });

    it('DISCLAIMER 常量即红线文案本身', () => {
      expect(DISCLAIMER).toBe('相对估算，非实测照度');
    });

    it('lx 格式化：大值取整、小值留小数，0 不被抹成 0.00', () => {
      expect(fmtLx(1234.7)).toBe('1235');
      expect(fmtLx(5.34)).toBe('5.3');
      expect(fmtLx(0.4)).toBe('0.40');
      expect(fmtLx(0)).toBe('0');
    });

    it('百分比四舍五入到整数（82%）', () => {
      const s = formatIlluminance({
        total: 245,
        target: 300,
        ratio: 245 / 300,
        perFixture: new Map(),
      });
      expect(s).toContain('82%');
    });

    it('ratio = Infinity 时显示 ∞%，不显示 Infinity%', () => {
      const s = formatIlluminance({ total: 0, target: 0, ratio: Infinity, perFixture: new Map() });
      expect(s).toContain('∞%');
      expect(s).not.toContain('Infinity');
    });
  });
});
