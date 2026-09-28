/**
 * Part C · circuitMapping 单元测试（P34 §7）
 *
 * 覆盖 3 预设 × 8 fixture.type 的目标亮度/色温矩阵，
 * 以及 ADR-17 保护（lockedFields 覆盖时不覆盖）。
 *
 * 用例数（12+）：
 *   1. PRESET_META 完整性
 *   2-3. reception × 8 types
 *   4-5. cinema × 8 types
 *   6-7. reading × 8 types
 *   8.  applyPresetToFixture · ADR-17 · cct 锁定
 *   9.  applyPresetToFixture · ADR-17 · sceneLevels 锁定
 *   10. applyPresetToFixture · 不 mutate 原对象
 *   11. presetToSceneDefinition · qp- 前缀 + transitionMs 默认
 *   12. presetToSceneDefinition · level/cct 值 + CCTValue 中点
 *   13. presetToSceneDefinition · 空 fixture 列表
 */

import { describe, expect, it } from 'vitest';
import {
  PRESET_IDS,
  PRESET_META,
  applyPresetToFixture,
  presetTarget,
  presetToSceneDefinition,
} from '../circuitMapping.js';
import type { PresetId } from '../circuitMapping.js';
import { makeFixture } from '../makeFixture.js';
import type { CCTValue, Fixture, FixtureType } from '../types.js';

const ALL_TYPES: FixtureType[] = [
  'downlight',
  'spot',
  'pendant',
  'linear',
  'cove',
  'sconce',
  'floor',
  'table',
];

/** 测试用的期望目标表（照搬规格 §5.1 presetTarget 逻辑） */
const EXPECTED: Record<PresetId, Record<FixtureType, { level: number; cct: CCTValue }>> = {
  reception: {
    downlight: { level: 1.0, cct: 3500 },
    spot: { level: 1.0, cct: 3500 },
    pendant: { level: 1.0, cct: 3500 },
    linear: { level: 1.0, cct: 3500 },
    cove: { level: 1.0, cct: 3500 },
    sconce: { level: 0.7, cct: 3200 },
    floor: { level: 0.7, cct: 3200 },
    table: { level: 1.0, cct: 3500 },
  },
  cinema: {
    downlight: { level: 0, cct: 2700 },
    spot: { level: 0, cct: 2700 },
    pendant: { level: 0, cct: 2700 },
    linear: { level: 0.3, cct: 2400 },
    cove: { level: 0.3, cct: 2400 },
    sconce: { level: 0.3, cct: 2400 },
    floor: { level: 0.3, cct: 2400 },
    table: { level: 0.3, cct: 2400 },
  },
  reading: {
    downlight: { level: 0.1, cct: 2700 },
    spot: { level: 1.0, cct: 3000 },
    pendant: { level: 0.5, cct: 3000 },
    linear: { level: 0.1, cct: 2700 },
    cove: { level: 0.1, cct: 2700 },
    sconce: { level: 0.1, cct: 2700 },
    floor: { level: 0.1, cct: 2700 },
    table: { level: 1.0, cct: 3000 },
  },
};

function makeFx(
  type: FixtureType,
  opts: { lockCct?: boolean; lockLevels?: PresetId[] } = {},
): Fixture {
  const f = makeFixture({ type });
  if (opts.lockCct || opts.lockLevels) {
    const locked = new Set<string>(f.lockedFields);
    if (opts.lockCct) locked.add('electrical.cct');
    for (const id of opts.lockLevels ?? []) locked.add(`control.sceneLevels.${id}`);
    Object.assign(f, { lockedFields: locked });
  }
  return f;
}

describe('PRESET_META', () => {
  it('3 个预设的元数据齐全（id / name / description）', () => {
    expect(PRESET_IDS).toHaveLength(3);
    for (const id of PRESET_IDS) {
      const meta = PRESET_META[id];
      expect(meta.id).toBe(id);
      expect(meta.name.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
    }
  });
});

describe('presetTarget', () => {
  it('reception: 主灯 100% / 3500K；壁灯与落地灯 70% / 3200K（8 类型全覆盖）', () => {
    for (const type of ALL_TYPES) {
      const got = presetTarget(makeFx(type), 'reception');
      expect(got, `reception:${type}`).toEqual(EXPECTED.reception[type]);
    }
  });

  it('cinema: 筒/射/吊灯 0% / 2700K；其余 30% / 2400K（8 类型全覆盖）', () => {
    for (const type of ALL_TYPES) {
      const got = presetTarget(makeFx(type), 'cinema');
      expect(got, `cinema:${type}`).toEqual(EXPECTED.cinema[type]);
    }
  });

  it('reading: table/spot 100% / pendant 50% / 3000K；其余 10% / 2700K', () => {
    for (const type of ALL_TYPES) {
      const got = presetTarget(makeFx(type), 'reading');
      expect(got, `reading:${type}`).toEqual(EXPECTED.reading[type]);
    }
  });
});

describe('applyPresetToFixture · ADR-17 保护', () => {
  it('fixture.lockedFields 含 electrical.cct 时不改 cct（ADR-17）', () => {
    const f = makeFx('downlight', { lockCct: true });
    const origCct = f.electrical.cct;
    const result = applyPresetToFixture(f, 'reception');
    expect(result.electrical.cct).toBe(origCct);
    expect(result.control.sceneLevels.reception).toBe(EXPECTED.reception.downlight.level);
  });

  it('fixture.lockedFields 含 control.sceneLevels.<presetKey> 时保留旧值', () => {
    const f = makeFx('downlight', { lockLevels: ['reception'] });
    Object.assign(f, {
      control: { ...f.control, sceneLevels: { ...f.control.sceneLevels, reception: 0.42 } },
    });
    const result = applyPresetToFixture(f, 'reception');
    expect(result.control.sceneLevels.reception).toBe(0.42);
    expect(result.electrical.cct).toBe(EXPECTED.reception.downlight.cct);
  });
});

describe('applyPresetToFixture · 不可变性', () => {
  it('返回新 Fixture 且不修改原 fixture.control.sceneLevels / electrical.cct', () => {
    const f = makeFx('spot');
    const beforeLevels = { ...f.control.sceneLevels };
    const beforeCct = f.electrical.cct;
    const result = applyPresetToFixture(f, 'cinema');
    expect(result).not.toBe(f);
    expect(f.control.sceneLevels).toEqual(beforeLevels);
    expect(f.electrical.cct).toBe(beforeCct);
    expect(result.control.sceneLevels.cinema).toBe(0);
    expect(result.electrical.cct).toBe(2700);
  });
});

describe('presetToSceneDefinition', () => {
  it('生成的 SceneDefinition 使用 qp- 前缀的 key，name 与 meta 一致，默认 800ms', () => {
    const fixtures = ALL_TYPES.map((t) => makeFx(t));
    const def = presetToSceneDefinition(fixtures, 'reading');
    expect(def.key).toBe('qp-reading');
    expect(def.name).toBe(PRESET_META.reading.name);
    expect(def.transitionMs).toBe(800);
    expect(Object.keys(def.levels).sort()).toEqual(
      fixtures.map((f) => f.id).sort(),
    );
  });

  it('level / cct 值与 presetTarget 一致；CCTValue 区间取中点', () => {
    const f = makeFx('downlight');
    const def = presetToSceneDefinition([f], 'reception', 500);
    const target = EXPECTED.reception.downlight;
    expect(def.transitionMs).toBe(500);
    expect(def.levels[f.id]).toBe(target.level);
    const expectedCct =
      typeof target.cct === 'number' ? target.cct : (target.cct[0] + target.cct[1]) / 2;
    expect(def.cct[f.id]).toBe(expectedCct);
  });

  it('空 fixture 列表返回空 levels/cct（不抛错）', () => {
    const def = presetToSceneDefinition([], 'reception');
    expect(def.levels).toEqual({});
    expect(def.cct).toEqual({});
  });
});
