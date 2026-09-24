import { describe, expect, it } from 'vitest';

import {
  bindFixture,
  filterLockedPatch,
  lockField,
  moveFixture,
  moveZone,
  removeFixture,
  removeZone,
  rotateZone,
  unbindFixture,
} from '../binding.js';
import { makeFixture } from '../makeFixture.js';
import { makeZone } from '../zoneTypes.js';
import type { ActivityZone, Fixture, FixtureBinding, LuminaProject } from '../types.js';

/** 取 Fixture 世界坐标分量（类型安全，避免 noUncheckedIndexedAccess 的 | undefined） */
function px(f: Fixture, i: 0 | 1 | 2): number {
  const v = f.pos[i];
  if (typeof v !== 'number') throw new Error(`pos[${i}] missing`);
  return v;
}

/** 取 Project 中的 Fixture，缺则报错（测试前提：ID 必定存在） */
function reqFx(p: LuminaProject, id: string): Fixture {
  const f = p.fixtures[id];
  if (!f) throw new Error(`fixture ${id} not found`);
  return f;
}

/** 取 Project 中的 ActivityZone，缺则报错 */
function reqZone(p: LuminaProject, key: string): ActivityZone {
  const z = p.zones[key];
  if (!z) throw new Error(`zone ${key} not found`);
  return z;
}

/** 构造带 1 个活动区 + 1~2 盏灯的测试工程 */
function setup(): { project: LuminaProject; zoneKey: string; fxId: string; fxId2: string } {
  const z = makeZone('dining', [0, 0], { key: 'z1', name: '餐区' });
  const f1 = makeFixture({ type: 'pendant', pos: [1, 2.1, -1], rot: { pitch: 0, yaw: 0 } });
  const f2 = makeFixture({ type: 'downlight', pos: [-1, 2.4, 1] });
  const project: LuminaProject = {
    schemaVersion: 1,
    name: 'test',
    unitSystem: 'metric',
    ceilingH: 2.7,
    zones: { z1: z },
    fixtures: { [f1.id]: f1, [f2.id]: f2 },
  };
  return { project, zoneKey: 'z1', fxId: f1.id, fxId2: f2.id };
}

describe('绑定引擎 — 需求侧 / 供给侧分离（ADR-12/13/17）', () => {
  it('绑定后双侧镜像一致（fixture.binding 与 zone.fixtures 同步）', () => {
    const { project, zoneKey, fxId } = setup();
    const bound = bindFixture(project, fxId, zoneKey);
    expect(reqFx(bound, fxId).binding?.zoneKey).toBe(zoneKey);
    expect(reqFx(bound, fxId).binding?.enabled).toBe(true);
    expect(reqZone(bound, zoneKey).fixtures.some((b) => b.fixtureId === fxId)).toBe(true);
  });

  it('moveZone：启用绑定的灯具跟随平移；解绑的不跟随', () => {
    const { project, zoneKey, fxId, fxId2 } = setup();
    let p = bindFixture(project, fxId, zoneKey);

    const before: readonly [number, number, number] = [...reqFx(p, fxId).pos];
    const fx2Before = [...reqFx(p, fxId2).pos];

    p = moveZone(p, zoneKey, [2, -3]);

    // 绑定灯具跟随
    expect(px(reqFx(p, fxId), 0)).toBeCloseTo(before[0] + 2);
    expect(px(reqFx(p, fxId), 2)).toBeCloseTo(before[2] - 3);
    // y 不变
    expect(px(reqFx(p, fxId), 1)).toBeCloseTo(before[1]);
    // 解绑灯具不动
    expect([...reqFx(p, fxId2).pos]).toEqual(fx2Before);
  });

  it('rotateZone 90°：绑定灯具按局部偏移重新落位，排列方向跟着转（ADR-13 核心判据）', () => {
    const { project, zoneKey, fxId } = setup();
    // 把吊灯放到区局部 (+1.2, 2.1, -0.5)（区在原点 rotY=0，世界=局部）
    project.fixtures[fxId] = makeFixture({ type: 'pendant', pos: [1.2, 2.1, -0.5] });
    let p = bindFixture(project, fxId, zoneKey);
    expect(px(reqFx(p, fxId), 0)).toBeCloseTo(1.2);
    expect(px(reqFx(p, fxId), 2)).toBeCloseTo(-0.5);

    // 区转 90°：局部 (1.2, 2.1, -0.5) 绕 Y 转 90°
    // x' = x·cos + z·sin = 0 + (-0.5)(1) = -0.5
    // z' = -x·sin + z·cos = -1.2 + 0 = -1.2
    p = rotateZone(p, zoneKey, Math.PI / 2);
    expect(px(reqFx(p, fxId), 0)).toBeCloseTo(-0.5, 9);
    expect(px(reqFx(p, fxId), 2)).toBeCloseTo(-1.2, 9);
    // y 不变
    expect(px(reqFx(p, fxId), 1)).toBeCloseTo(2.1, 9);
  });

  it('rotateZone：沿局部 x 轴排列的 2 盏吊灯，区转 90° 后排列方向也跟着转', () => {
    // 两盏吊灯沿餐桌长边（局部 x 轴）排列
    const z = makeZone('dining', [0, 0], { key: 'z1', size: [1.8, 1.0] });
    const a = makeFixture({ type: 'pendant', pos: [-0.6, 2.1, 0] });
    const b = makeFixture({ type: 'pendant', pos: [0.6, 2.1, 0] });
    let p: LuminaProject = {
      schemaVersion: 1,
      name: 't',
      unitSystem: 'metric',
      ceilingH: 2.7,
      zones: { z1: z },
      fixtures: { [a.id]: a, [b.id]: b },
    };
    p = bindFixture(p, a.id, 'z1');
    p = bindFixture(p, b.id, 'z1');
    // 未旋转时：两灯沿世界 x 轴排列
    expect(px(reqFx(p, a.id), 0)).toBeCloseTo(-0.6);
    expect(px(reqFx(p, b.id), 0)).toBeCloseTo(0.6);

    p = rotateZone(p, 'z1', Math.PI / 2);
    // 转 90° 后：局部 x 变世界 -z，两灯沿世界 z 轴排列
    expect(px(reqFx(p, a.id), 0)).toBeCloseTo(0, 9);
    expect(px(reqFx(p, b.id), 0)).toBeCloseTo(0, 9);
    expect(px(reqFx(p, a.id), 2)).toBeCloseTo(0.6, 9);
    expect(px(reqFx(p, b.id), 2)).toBeCloseTo(-0.6, 9);
  });

  it('rotateZone：连续 4 次 90° 后灯具回到原位（旋转闭合）', () => {
    const { project, zoneKey, fxId } = setup();
    let p = bindFixture(project, fxId, zoneKey);
    const origin: readonly [number, number, number] = [...reqFx(p, fxId).pos];

    p = rotateZone(p, zoneKey, Math.PI / 2);
    p = rotateZone(p, zoneKey, Math.PI);
    p = rotateZone(p, zoneKey, (3 * Math.PI) / 2);
    p = rotateZone(p, zoneKey, 2 * Math.PI);

    expect(px(reqFx(p, fxId), 0)).toBeCloseTo(origin[0], 6);
    expect(px(reqFx(p, fxId), 1)).toBeCloseTo(origin[1], 6);
    expect(px(reqFx(p, fxId), 2)).toBeCloseTo(origin[2], 6);
  });

  it('moveFixture（手动拖动）：自动解绑，位置设为新值（§2.2 核心判据）', () => {
    const { project, zoneKey, fxId } = setup();
    const p = bindFixture(project, fxId, zoneKey);

    const { project: moved, autoUnbound } = moveFixture(p, fxId, [3, 2.0, 2]);

    expect(autoUnbound).toBe(true);
    expect(reqFx(moved, fxId).binding).toBeNull();
    // 双侧解除
    expect(reqZone(moved, zoneKey).fixtures.some((b) => b.fixtureId === fxId)).toBe(false);
    // 位置已更新
    expect([...reqFx(moved, fxId).pos]).toEqual([3, 2.0, 2]);
  });

  it('moveFixture（未绑定灯具）：仅改位置，不报解绑', () => {
    const { project, fxId } = setup();
    const { project: moved, autoUnbound } = moveFixture(project, fxId, [3, 2, 2]);
    expect(autoUnbound).toBe(false);
    expect(reqFx(moved, fxId).binding).toBeNull();
  });

  it('unbindFixture：清除双侧记录，保留世界坐标', () => {
    const { project, zoneKey, fxId } = setup();
    const p = bindFixture(project, fxId, zoneKey);
    const posBefore = [...reqFx(p, fxId).pos];

    const p2 = unbindFixture(p, fxId);
    expect(reqFx(p2, fxId).binding).toBeNull();
    expect(reqZone(p2, zoneKey).fixtures).toHaveLength(0);
    expect([...reqFx(p2, fxId).pos]).toEqual(posBefore);
  });

  it('removeZone：删除活动区不级联删除灯具，绑定灯具自动解绑但保留原位（§2.4 核心判据）', () => {
    const { project, zoneKey, fxId } = setup();
    const p = bindFixture(project, fxId, zoneKey);
    const posBefore = [...reqFx(p, fxId).pos];

    const p2 = removeZone(p, zoneKey);

    // 区已删除
    expect(p2.zones[zoneKey]).toBeUndefined();
    // 灯具仍在，坐标不变
    expect(p2.fixtures[fxId]).toBeDefined();
    expect([...reqFx(p2, fxId).pos]).toEqual(posBefore);
    // 绑定已解除
    expect(reqFx(p2, fxId).binding).toBeNull();
  });

  it('removeFixture：清除双侧绑定记录，不影响区', () => {
    const { project, zoneKey, fxId } = setup();
    const p = bindFixture(project, fxId, zoneKey);
    const p2 = removeFixture(p, fxId);
    expect(p2.fixtures[fxId]).toBeUndefined();
    expect(reqZone(p2, zoneKey).fixtures).toHaveLength(0);
  });

  it('user-locked 字段不被自动布灯覆盖（ADR-17 核心判据）', () => {
    const f = makeFixture({ type: 'downlight' });
    const locked = lockField(
      {
        schemaVersion: 1,
        name: 't',
        unitSystem: 'metric',
        ceilingH: 2.7,
        zones: {},
        fixtures: { [f.id]: f },
      },
      f.id,
      'electrical.cct',
    );
    const lockedFixture = reqFx(locked, f.id);

    // 自动逻辑想改 cct（被锁）和 beamAngle（未锁）
    const patch = { 'electrical.cct': 5000, 'photometric.beamAngle': 30 };
    const filtered = filterLockedPatch(lockedFixture, patch);

    expect('electrical.cct' in filtered).toBe(false);
    expect(filtered['photometric.beamAngle']).toBe(30);
  });

  it('lockField 多次锁定不同字段，互不覆盖', () => {
    const f = makeFixture({});
    let p: LuminaProject = {
      schemaVersion: 1,
      name: 't',
      unitSystem: 'metric',
      ceilingH: 2.7,
      zones: {},
      fixtures: { [f.id]: f },
    };
    p = lockField(p, f.id, 'electrical.cct');
    p = lockField(p, f.id, 'photometric.beamAngle');
    const ff = reqFx(p, f.id);
    expect(ff.lockedFields.has('electrical.cct')).toBe(true);
    expect(ff.lockedFields.has('photometric.beamAngle')).toBe(true);
  });
});

describe('Fixture 与 ActivityZone 是独立实体', () => {
  it('ActivityZone 不持有 Fixture 本体，仅持 FixtureBinding 引用', () => {
    const z = makeZone('dining', [0, 0]);
    expect(Array.isArray(z.fixtures)).toBe(true);
    const b: FixtureBinding = { fixtureId: 'x', offsets: [], enabled: false };
    expect('lumens' in (b as unknown as Record<string, unknown>)).toBe(false);
  });

  it('删除区不影响其它区的绑定', () => {
    const z1 = makeZone('dining', [0, 0], { key: 'z1' });
    const z2 = makeZone('sleep', [3, 3], { key: 'z2' });
    const f1 = makeFixture({ type: 'pendant', pos: [1, 2.1, 0] });
    const f2 = makeFixture({ type: 'sconce', pos: [3, 1.5, 3] });
    let p: LuminaProject = {
      schemaVersion: 1,
      name: 't',
      unitSystem: 'metric',
      ceilingH: 2.7,
      zones: { z1, z2 },
      fixtures: { [f1.id]: f1, [f2.id]: f2 },
    };
    p = bindFixture(p, f1.id, 'z1');
    p = bindFixture(p, f2.id, 'z2');

    p = removeZone(p, 'z1');

    // f1 的绑定已解除
    expect(reqFx(p, f1.id).binding).toBeNull();
    // z2 的绑定完好
    expect(reqFx(p, f2.id).binding?.zoneKey).toBe('z2');
    expect(reqZone(p, 'z2').fixtures.some((b) => b.fixtureId === f2.id)).toBe(true);
  });
});
