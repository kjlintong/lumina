import { describe, expect, it } from 'vitest';

import { bindFixture, lockField } from '../binding.js';
import { makeFixture } from '../makeFixture.js';
import { fromJSON, serializeProject, toJSON } from '../serialize.js';
import { makeZone } from '../zoneTypes.js';
import type { ActivityZone, Fixture, LuminaProject } from '../types.js';

/** 取 Project 中的 Fixture，缺则报错 */
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

describe('序列化 round-trip（任务书 §7）', () => {
  it('完整工程 JSON 往返后深度相等（含绑定关系）', () => {
    let p: LuminaProject = {
      schemaVersion: 1,
      name: '示例户型',
      unitSystem: 'metric',
      ceilingH: 2.7,
      zones: { z1: makeZone('dining', [1, 2], { key: 'z1', name: '餐区' }) },
      fixtures: {},
    };
    const f = makeFixture({ type: 'pendant', pos: [1.2, 2.1, 2], rot: { pitch: 0.1, yaw: 0.3 } });
    p.fixtures[f.id] = f;
    p = bindFixture(p, f.id, 'z1');
    p = lockField(p, f.id, 'electrical.cct');

    const restored = fromJSON(toJSON(p));

    expect(restored).toEqual(p);
  });

  it('lockedFields（Set）经 JSON 往返后仍是 Set 且内容一致', () => {
    let p: LuminaProject = {
      schemaVersion: 1,
      name: 't',
      unitSystem: 'metric',
      ceilingH: 2.7,
      zones: {},
      fixtures: { f1: makeFixture({ type: 'spot', pos: [0, 2.4, 0] }) },
    };
    p = lockField(p, 'f1', 'electrical.cct');
    p = lockField(p, 'f1', 'photometric.beamAngle');

    const restored = fromJSON(toJSON(p));

    const rf = reqFx(restored, 'f1');
    expect(rf.lockedFields instanceof Set).toBe(true);
    expect(rf.lockedFields.has('electrical.cct')).toBe(true);
    expect(rf.lockedFields.has('photometric.beamAngle')).toBe(true);
  });

  it('serialize -> deserialize 不修改原对象（纯函数语义）', () => {
    const p: LuminaProject = {
      schemaVersion: 1,
      name: 't',
      unitSystem: 'metric',
      ceilingH: 2.7,
      zones: { z1: makeZone('sleep', [0, 0], { key: 'z1' }) },
      fixtures: { f1: makeFixture({}) },
    };
    const snapshot = JSON.stringify(p);
    serializeProject(p);
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it('绑定关系在 round-trip 后保持一致（双向引用）', () => {
    let p: LuminaProject = {
      schemaVersion: 1,
      name: 't',
      unitSystem: 'metric',
      ceilingH: 2.7,
      zones: { z1: makeZone('work', [0, 0], { key: 'z1' }) },
      fixtures: { f1: makeFixture({ pos: [0.3, 2.4, -0.2] }) },
    };
    p = bindFixture(p, 'f1', 'z1');
    const restored = fromJSON(toJSON(p));

    expect(reqFx(restored, 'f1').binding).toEqual(reqFx(p, 'f1').binding);
    expect(reqZone(restored, 'z1').fixtures).toEqual(reqZone(p, 'z1').fixtures);
  });
});
