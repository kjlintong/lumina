import { describe, expect, it } from 'vitest';

import { bindFixture, lockField } from '../binding.js';
import { makeFixture } from '../makeFixture.js';
import { calibrate } from '../scale.js';
import { fromJSON, serializeProject, toJSON } from '../serialize.js';
import { makeZone } from '../zoneTypes.js';
import type { ActivityZone, Fixture, LuminaProject } from '../types.js';
import type { ModelGeometry, Provenance } from '../modeling.js';
import { checkTopology } from '../topology.js';

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

/** 构造一个最小的合法 ModelGeometry（用于 round-trip 测试） */
function makeMinimalModel(): ModelGeometry {
  const prov = { kind: 'user_edit' } as Provenance;
  return {
    schemaId: 'lumina.model/1',
    walls: [
      {
        id: 'w1',
        a: [0, 0],
        b: [3, 0],
        thickness: 0.15,
        height: 2.8,
        confidence: 0.9,
        provenance: prov,
      },
    ],
    openings: [
      {
        id: 'o1',
        wallId: 'w1',
        kind: 'door',
        offset: 0.5,
        width: 0.9,
        height: 2.1,
        sill: 0,
        confidence: 0.9,
        provenance: prov,
      },
    ],
    rooms: [
      {
        id: 'r1',
        name: '客厅',
        vertices: [
          [0, 0],
          [3, 0],
          [3, 2],
          [0, 2],
          [0, 0],
        ],
        labeledArea: 6,
        confidence: 0.9,
        provenance: prov,
      },
    ],
    slab: { level: 0, thickness: 0.15, ceilingH: 2.8 },
    calibration: calibrate(300, 3, 'm'),
    track: { track: 'template', guaranteesUniformError: true, maxErrorCm: 5 },
  };
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

  // -----------------------------------------------------------------
  // P21: model 字段 round-trip（§4 必测清单 6）
  // -----------------------------------------------------------------

  it('model 字段经 JSON 往返后深度相等', () => {
    const p: LuminaProject = {
      schemaVersion: 1,
      name: 't',
      unitSystem: 'metric',
      ceilingH: 2.7,
      zones: {},
      fixtures: {},
      model: makeMinimalModel(),
    };

    const restored = fromJSON(toJSON(p));

    expect(restored.model).toEqual(p.model);
    // schemaId 保持字符串字面量
    expect(restored.model?.schemaId).toBe('lumina.model/1');
    // 关键子结构
    expect(restored.model?.walls[0]?.a).toEqual([0, 0]);
    expect(restored.model?.walls[0]?.b).toEqual([3, 0]);
    expect(restored.model?.rooms[0]?.vertices).toEqual(p.model!.rooms[0]!.vertices);
    // calibration 往返后仍是有效 ScaleCalibration
    expect(restored.model?.calibration?.toMeters).toBeCloseTo(
      p.model!.calibration!.toMeters,
      12,
    );
    // provenance 保持 user_edit
    expect(restored.model?.walls[0]?.provenance).toEqual({ kind: 'user_edit' });
    // track 保持 template 分档
    expect(restored.model?.track).toEqual({
      track: 'template',
      guaranteesUniformError: true,
      maxErrorCm: 5,
    });
    // P22: checkTopology 对往返后的 model 仍 passed
    expect(checkTopology(restored.model!).passed).toBe(true);
  });

  it('未设置 model 字段时，wire 格式不写入 model 键（与现状兼容）', () => {
    const p: LuminaProject = {
      schemaVersion: 1,
      name: 't',
      unitSystem: 'metric',
      ceilingH: 2.7,
      zones: {},
      fixtures: {},
      // 无 model 字段
    };

    const json = toJSON(p);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    // wire 格式不应出现 model 键（条件展开保证）
    expect(parsed).not.toHaveProperty('model');
  });

  it('model 字段在 round-trip 后仍是对象（不是 undefined / null）', () => {
    const p: LuminaProject = {
      schemaVersion: 1,
      name: 't',
      unitSystem: 'metric',
      ceilingH: 2.7,
      zones: {},
      fixtures: {},
      model: makeMinimalModel(),
    };

    const restored = fromJSON(toJSON(p));
    expect(restored.model).toBeDefined();
    expect(restored.model).not.toBeNull();
    expect(typeof restored.model).toBe('object');
  });

  it('model 中 readonly 数组经 JSON 往返后变为可变数组但仍深度相等', () => {
    const p: LuminaProject = {
      schemaVersion: 1,
      name: 't',
      unitSystem: 'metric',
      ceilingH: 2.7,
      zones: {},
      fixtures: {},
      model: makeMinimalModel(),
    };

    const restored = fromJSON(toJSON(p));

    // JSON 不保留 readonly 标记，但深度相等（toEqual 比较值而非类型）
    expect(restored.model?.walls).toEqual(p.model?.walls);
    expect(restored.model?.openings).toEqual(p.model?.openings);
    expect(restored.model?.rooms).toEqual(p.model?.rooms);
  });

  it('既有 round-trip 测试（不含 model）仍然通过 —— 不破坏兼容性', () => {
    // 这条测试与第一条完全一致，但单独列出确认 P21 改动不破坏既有契约
    let p: LuminaProject = {
      schemaVersion: 1,
      name: 't',
      unitSystem: 'metric',
      ceilingH: 2.7,
      zones: { z1: makeZone('dining', [1, 2], { key: 'z1', name: '餐区' }) },
      fixtures: {},
    };
    const f = makeFixture({ type: 'pendant', pos: [1.2, 2.1, 2] });
    p.fixtures[f.id] = f;
    p = bindFixture(p, f.id, 'z1');
    p = lockField(p, f.id, 'electrical.cct');

    const restored = fromJSON(toJSON(p));
    expect(restored).toEqual(p);
    // 不含 model 字段时，restored 也不应有 model 字段
    expect(restored).not.toHaveProperty('model');
  });
});
