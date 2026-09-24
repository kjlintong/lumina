import { describe, expect, it } from 'vitest';

import { makeFixture } from '../../core/makeFixture.js';
import type { Fixture } from '../../core/types.js';
import {
  ALL_FIXTURES,
  DEFAULT_TRANSITION_MS,
  FIELD_CCT,
  FIELD_LEVELS,
  PRESET_SCENE_KEYS,
  PRESET_SCENES,
  SceneNotFoundError,
  SceneSystem,
  easeInOutQuad,
} from '../sceneSystem.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** 注册 N 盏「白炽基础色温」灯，pos 各不相同（便于断言场景不动位置） */
function makeFixtures(n: number): Fixture[] {
  return Array.from({ length: n }, (_, i) =>
    makeFixture({ type: 'downlight', pos: [i, 2.4, 0], cct: 3000, skuId: `fx-${i}` }),
  );
}

function makeRegistry(fixtures: Fixture[]): Map<string, Fixture> {
  return new Map(fixtures.map((f) => [f.id, f]));
}

function byId(fixtures: Fixture[], id: string): Fixture {
  const f = fixtures.find((x) => x.id === id);
  if (f === undefined) throw new Error(`fixture ${id} not found`);
  return f;
}

/** 锁一个字段（测试用；锁定集合运行时是可变 Set，按测试需要的最小断言） */
function lock(f: Fixture, field: string): Fixture {
  const s = f.lockedFields;
  expect(s.has(field)).toBe(false);
  (s as unknown as Set<string>).add(field);
  return f;
}

/** 取场景表某 key 的值，缺失则报错（noUncheckedIndexedAccess 下 Record 索引是 `| undefined`） */
function reqNum(r: Record<string, number>, key: string): number {
  const v = r[key];
  if (typeof v !== 'number') throw new Error(`no number for "${key}"`);
  return v;
}

/** 取灯光场景表里某场景的亮度 */
function levelOf(f: Fixture, sceneKey: string): number {
  return reqNum(f.control.sceneLevels, sceneKey);
}

/** 场景不动的字段快照（位置 / 姿态 / 形状 / 配光 / 绑定） */
function staticSnapshot(fixtures: Fixture[]): string {
  return JSON.stringify(
    fixtures.map((f) => ({ pos: f.pos, rot: f.rot, shape: f.shape, photometric: f.photometric, binding: f.binding })),
  );
}

// ---------------------------------------------------------------------------
// 内置预设（§6 P5 / ADR-17）
// ---------------------------------------------------------------------------

describe('SceneSystem — 内置 6 场景预设（§6 P5）', () => {
  it('构造器自动装载 6 个内置场景，key / 中文名与预设表一致', () => {
    const system = new SceneSystem();
    expect(system.list()).toEqual(['daylight', 'dinner', 'movie', 'relax', 'reading', 'night']);
    expect(PRESET_SCENE_KEYS).toEqual(system.list());
    const names: Record<string, string> = {
      daylight: '日间',
      dinner: '晚餐',
      movie: '观影',
      relax: '放松',
      reading: '阅读',
      night: '夜间',
    };
    for (const key of PRESET_SCENE_KEYS) {
      expect(system.has(key)).toBe(true);
      expect(system.get(key).name).toBe(names[key]);
    }
  });

  it('has() 对未知 key 返回 false', () => {
    const system = new SceneSystem();
    expect(system.has('party')).toBe(false);
    expect(system.has('')).toBe(false);
  });

  it('预设是语义层：levels / cct 用 ALL_FIXTURES 通配，transitionMs 为正数且可序列化', () => {
    for (const scene of Object.values(PRESET_SCENES)) {
      expect(scene.levels[ALL_FIXTURES]).toBeGreaterThan(0);
      expect(scene.levels[ALL_FIXTURES]).toBeLessThanOrEqual(1);
      expect(scene.cct[ALL_FIXTURES]).toBeGreaterThanOrEqual(1000);
      expect(scene.cct[ALL_FIXTURES]).toBeLessThanOrEqual(40000);
      expect(scene.transitionMs).toBeGreaterThan(0);
      expect(scene.name).not.toBe('');
    }
    // 冷色温日间 / 暖色温夜间：预设语义的最低期望
    expect(reqNum(PRESET_SCENES.daylight.cct, ALL_FIXTURES)).toBeGreaterThan(
      reqNum(PRESET_SCENES.night.cct, ALL_FIXTURES),
    );
  });

  it('get() 每次返回新拷贝，改返回值不污染内部预设表', () => {
    const system = new SceneSystem();
    const a = system.get('movie');
    const b = system.get('movie');

    expect(a).not.toBe(b);
    expect(a.levels).not.toBe(b.levels);
    expect(a.cct).not.toBe(b.cct);
    expect(b).toEqual(PRESET_SCENES.movie);

    // 对返回值做深拷贝再污染，验证预设表未被写入
    const clone = { ...a, levels: { ...a.levels }, cct: { ...a.cct } };
    clone.levels['fx-1'] = 0.99;
    clone.name = '被污染的返回值';

    expect(system.get('movie').levels['fx-1']).toBeUndefined();
    expect(system.get('movie').name).toBe('观影');
  });

  it('get() 对未知 key 抛 SceneNotFoundError', () => {
    const system = new SceneSystem();
    expect(() => system.get('nope')).toThrowError(SceneNotFoundError);
    expect(() => system.apply('nope')).toThrowError('unknown scene: "nope"');
  });
});

// ---------------------------------------------------------------------------
// apply()
// ---------------------------------------------------------------------------

describe('SceneSystem.apply()', () => {
  it('把亮度与色温应用到全部灯具，并返回精确的变更摘要', () => {
    const fixtures = makeFixtures(3);
    const system = new SceneSystem(makeRegistry(fixtures));

    const summary = system.apply('dinner');

    expect(summary.sceneKey).toBe('dinner');
    expect(summary.name).toBe('晚餐');
    expect(summary.transitionMs).toBe(1500);
    expect(Object.keys(summary.levels).sort()).toEqual(['fx-0', 'fx-1', 'fx-2']);
    expect(Object.keys(summary.cct).sort()).toEqual(['fx-0', 'fx-1', 'fx-2']);
    for (const f of fixtures) {
      expect(levelOf(f, 'dinner')).toBe(0.65);
      expect(f.electrical.cct).toBe(2700);
      expect(summary.levels[f.id]).toEqual({ from: 1, to: 0.65 });
      expect(summary.cct[f.id]).toEqual({ from: 3000, to: 2700 });
    }
    expect(summary.skipped).toEqual({ levels: [], cct: [] });
    expect(summary.unchanged).toBe(0);
  });

  it('已一致的字段计入 unchanged，且不重复写入', () => {
    const fixtures = makeFixtures(1);
    const system = new SceneSystem(makeRegistry(fixtures));

    expect(system.apply('dinner').unchanged).toBe(0);
    const second = system.apply('dinner');

    expect(second.levels).toEqual({});
    expect(second.cct).toEqual({});
    expect(second.unchanged).toBe(2); // 亮度 0.65 与色温 2700 都已到位
  });

  it('场景只写亮度与色温，不触碰位置 / 姿态 / 形状 / 配光 / 绑定（§6 P5）', () => {
    const fixtures = makeFixtures(2);
    byId(fixtures, 'fx-1').pos = [9, 1.5, -3];
    byId(fixtures, 'fx-1').rot = { pitch: 0.4, yaw: 1.1 };
    byId(fixtures, 'fx-1').binding = { zoneKey: 'z1', offsets: [[1, 0, 0]], enabled: true };
    const system = new SceneSystem(makeRegistry(fixtures));

    const before = staticSnapshot(fixtures);
    system.apply('night');

    expect(staticSnapshot(fixtures)).toBe(before);
    expect(byId(fixtures, 'fx-1').pos).toEqual([9, 1.5, -3]);
    expect(byId(fixtures, 'fx-1').shape.diameter).toBe(0.18);
  });

  it('亮度只写入 control.sceneLevels[sceneKey]，不覆盖其它场景记录', () => {
    const fixtures = makeFixtures(1);
    const system = new SceneSystem(makeRegistry(fixtures));

    system.apply('dinner');
    system.apply('movie');

    expect(fixtures[0]!.control.sceneLevels).toEqual({ dinner: 0.65, movie: 0.15 });
    expect(system.getActiveSceneKey()).toBe('movie');
  });

  it('尊重调光下限 dimFloor：场景要更暗时截断到 dimFloor', () => {
    const fixtures = makeFixtures(1);
    fixtures[0]!.electrical.dimFloor = 0.2;
    const system = new SceneSystem(makeRegistry(fixtures));

    const summary = system.apply('night');

    expect(levelOf(fixtures[0]!, 'night')).toBe(0.2);
    expect(summary.levels[fixtures[0]!.id]).toEqual({ from: 1, to: 0.2 });
  });

  it('场景未提及的灯具不动：仅按 fixtureId 精确命中', () => {
    const fixtures = makeFixtures(3);
    fixtures[2]!.electrical.cct = 4200;
    fixtures[2]!.control.sceneLevels = { preset: 0.42 };
    const system = new SceneSystem(makeRegistry(fixtures));
    system.create('partial', '局部', { 'fx-0': 0.5, 'fx-1': 0.5 }, { 'fx-0': 2500, 'fx-1': 5500 });

    const summary = system.apply('partial');

    expect(levelOf(fixtures[0]!, 'partial')).toBe(0.5);
    expect(levelOf(fixtures[1]!, 'partial')).toBe(0.5);
    // fx-2 未被提及：亮度表原样保留，色温不变
    expect(fixtures[2]!.control.sceneLevels).toEqual({ preset: 0.42 });
    expect(byId(fixtures, 'fx-2').electrical.cct).toBe(4200);
    expect(byId(fixtures, 'fx-0').electrical.cct).toBe(2500);
    expect(byId(fixtures, 'fx-1').electrical.cct).toBe(5500);
    expect(Object.keys(summary.levels).sort()).toEqual(['fx-0', 'fx-1']);
    expect(Object.keys(summary.cct).sort()).toEqual(['fx-0', 'fx-1']);
    expect(summary.skipped).toEqual({ levels: [], cct: [] });
  });

  it('通配键 ALL_FIXTURES 覆盖注册表内全部灯具', () => {
    const fixtures = makeFixtures(3);
    const system = new SceneSystem(makeRegistry(fixtures));
    system.apply('night');

    for (const f of fixtures) {
      expect(levelOf(f, 'night')).toBe(0.1);
      expect(f.electrical.cct).toBe(2200);
    }
  });
});

// ---------------------------------------------------------------------------
// user-locked 保护（ADR-17）
// ---------------------------------------------------------------------------

describe('SceneSystem — user-locked 字段保护（ADR-17）', () => {
  it('锁定 control.sceneLevels 的灯跳过亮度，色温仍正常写入', () => {
    const fixtures = makeFixtures(2);
    fixtures[1]!.control.sceneLevels = { preset: 0.42 };
    lock(byId(fixtures, 'fx-1'), FIELD_LEVELS);
    const system = new SceneSystem(makeRegistry(fixtures));

    const summary = system.apply('movie');

    expect(levelOf(fixtures[0]!, 'movie')).toBe(0.15);
    // 被锁灯的亮度表保持原样，未写入场景记录
    expect(fixtures[1]!.control.sceneLevels).toEqual({ preset: 0.42 });
    expect(byId(fixtures, 'fx-0').electrical.cct).toBe(3000);
    expect(byId(fixtures, 'fx-1').electrical.cct).toBe(3000);
    expect(summary.levels).toEqual({ 'fx-0': { from: 1, to: 0.15 } });
    expect(summary.cct).toEqual({}); // 目标 3000 == 现状 3000，记入 unchanged 而非 delta
    expect(summary.skipped.levels).toEqual(['fx-1']);
    expect(summary.skipped.cct).toEqual([]);
    expect(summary.unchanged).toBe(2); // 两盏灯的色温都已处于目标值
  });

  it('锁定 electrical.cct 的灯跳过色温，亮度仍正常写入', () => {
    const fixtures = makeFixtures(2);
    lock(byId(fixtures, 'fx-1'), FIELD_CCT);
    const system = new SceneSystem(makeRegistry(fixtures));

    const summary = system.apply('dinner');

    expect(levelOf(fixtures[0]!, 'dinner')).toBe(0.65);
    expect(levelOf(fixtures[1]!, 'dinner')).toBe(0.65);
    expect(byId(fixtures, 'fx-0').electrical.cct).toBe(2700);
    expect(byId(fixtures, 'fx-1').electrical.cct).toBe(3000);
    expect(summary.cct).not.toHaveProperty('fx-1');
    expect(summary.skipped.cct).toEqual(['fx-1']);
    expect(summary.skipped.levels).toEqual([]);
  });

  it('两类字段同时锁定：该灯完全不被场景改动', () => {
    const fixtures = makeFixtures(1);
    const f = fixtures[0]!;
    f.control.sceneLevels = { other: 0.5 };
    lock(f, FIELD_LEVELS);
    lock(f, FIELD_CCT);
    const system = new SceneSystem(makeRegistry(fixtures));

    const summary = system.apply('reading');

    expect(f.control.sceneLevels).toEqual({ other: 0.5 });
    expect(f.electrical.cct).toBe(3000);
    expect(summary.levels).toEqual({});
    expect(summary.cct).toEqual({});
    expect(summary.skipped).toEqual({ levels: ['fx-0'], cct: ['fx-0'] });
  });

  it('只锁 cct 的灯：亮度锁定判断不受影响（互不干扰）', () => {
    const fixtures = makeFixtures(1);
    lock(fixtures[0]!, FIELD_CCT);
    const system = new SceneSystem(makeRegistry(fixtures));
    system.apply('relax');
    expect(levelOf(fixtures[0]!, 'relax')).toBe(0.4);
    expect(fixtures[0]!.lockedFields).toEqual(new Set([FIELD_CCT]));
  });

  it('只锁 sceneLevels 的灯：色温锁定判断不受影响（互不干扰）', () => {
    const fixtures = makeFixtures(1);
    lock(fixtures[0]!, FIELD_LEVELS);
    const system = new SceneSystem(makeRegistry(fixtures));
    system.apply('relax');
    expect(fixtures[0]!.control.sceneLevels).toEqual({});
    expect(fixtures[0]!.electrical.cct).toBe(2400);
    expect(fixtures[0]!.lockedFields).toEqual(new Set([FIELD_LEVELS]));
  });
});

// ---------------------------------------------------------------------------
// applySmooth() 过渡
// ---------------------------------------------------------------------------

describe('SceneSystem.applySmooth()', () => {
  it('返回端点状态供动画插值，且过渡期不写 Fixture', () => {
    const fixtures = makeFixtures(2);
    const system = new SceneSystem(makeRegistry(fixtures));
    const original = staticSnapshot(fixtures);

    const t = system.applySmooth('movie');

    expect(t.sceneKey).toBe('movie');
    expect(t.name).toBe('观影');
    expect(t.durationMs).toBe(2000);
    expect(t.from.levels).toEqual({ 'fx-0': 1, 'fx-1': 1 });
    expect(t.to.levels).toEqual({ 'fx-0': 0.15, 'fx-1': 0.15 });
    expect(t.to.cct).toEqual({ 'fx-0': 3000, 'fx-1': 3000 });
    expect(system.getTransition()).toBe(t);
    expect(fixtures[0]!.control.sceneLevels).toEqual({});
    expect(fixtures[0]!.electrical.cct).toBe(3000);
    expect(staticSnapshot(fixtures)).toBe(original);
    expect(system.getActiveSceneKey()).toBeNull();
  });

  it('sample() 0→1 恰好收敛到端点（easeInOut）', () => {
    const fixtures = makeFixtures(1);
    fixtures[0]!.electrical.cct = 3000;
    const system = new SceneSystem(makeRegistry(fixtures));
    const t = system.applySmooth('night', 1000);

    expect(system.sample(0)).toEqual(t.from);
    const end = system.sample(1);
    expect(end!.levels).toEqual(t.to.levels);
    expect(end!.cct).toEqual(t.to.cct);
    expect(system.sample(-1)!.levels[fixtures[0]!.id]).toBe(1);
    expect(system.sample(2)!.levels[fixtures[0]!.id]).toBe(0.1);
    expect(easeInOutQuad(0.5)).toBeCloseTo(0.5, 10);
  });

  it('sample() 中间态单调过渡（亮度下降、色温下降）', () => {
    const fixtures = makeFixtures(1);
    const system = new SceneSystem(makeRegistry(fixtures));
    system.applySmooth('relax');

    const seq = [0, 0.25, 0.5, 0.75, 1].map((r) => system.sample(r)!);
    const levels = seq.map((s) => s.levels[fixtures[0]!.id]!);
    const ccts = seq.map((s) => s.cct[fixtures[0]!.id]!);
    expect(levels[0]).toBe(1);
    expect(levels[4]!).toBe(0.4);
    expect(ccts[0]).toBe(3000);
    expect(ccts[4]!).toBe(2400);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]!).toBeLessThanOrEqual(levels[i - 1]!);
      expect(ccts[i]!).toBeLessThanOrEqual(ccts[i - 1]!);
    }
  });

  it('durationMs 参数覆盖场景自带 transitionMs；非法值抛 RangeError', () => {
    const system = new SceneSystem(makeRegistry(makeFixtures(1)));
    expect(system.applySmooth('movie', 5000).durationMs).toBe(5000);
    expect(() => system.applySmooth('movie', -1)).toThrowError(RangeError);
    expect(() => system.applySmooth('movie', Number.NaN)).toThrowError(RangeError);
  });

  it('finishTransition() 落盘终点并清除过渡记录；无过渡时返回 null', () => {
    const fixtures = makeFixtures(2);
    const system = new SceneSystem(makeRegistry(fixtures));
    expect(system.finishTransition()).toBeNull(); // 无过渡 → null

    system.applySmooth('dinner');
    const summary = system.finishTransition();

    expect(summary).not.toBeNull();
    expect(summary!.sceneKey).toBe('dinner');
    expect(levelOf(fixtures[0]!, 'dinner')).toBe(0.65);
    expect(fixtures[1]!.electrical.cct).toBe(2700);
    expect(system.getTransition()).toBeNull();
    expect(system.sample(0.5)).toBeNull();
    expect(system.getActiveSceneKey()).toBe('dinner');
    expect(system.finishTransition()).toBeNull(); // 已落盘，重复调用返回 null
  });

  it('过渡尊重 lockedFields 与 dimFloor：to 里不含被锁字段', () => {
    const fixtures = makeFixtures(1);
    fixtures[0]!.electrical.dimFloor = 0.2;
    lock(fixtures[0]!, FIELD_CCT);
    const system = new SceneSystem(makeRegistry(fixtures));

    const t = system.applySmooth('night');

    expect(t.to.levels).toEqual({ 'fx-0': 0.2 });
    expect(t.to.cct).toEqual({});
    expect(Object.keys(t.from.levels)).toEqual(['fx-0']);
    expect(Object.keys(t.from.cct)).toEqual(['fx-0']);
  });

  it('过渡期间删除场景：finishTransition() 不落盘并返回 null', () => {
    const fixtures = makeFixtures(1);
    const system = new SceneSystem(makeRegistry(fixtures));
    system.applySmooth('movie');

    expect(system.remove('movie')).toBe(true);

    expect(system.finishTransition()).toBeNull();
    expect(system.getTransition()).toBeNull();
    expect(fixtures[0]!.control.sceneLevels).toEqual({});
    expect(fixtures[0]!.electrical.cct).toBe(3000);
  });
});

// ---------------------------------------------------------------------------
// create() / remove()
// ---------------------------------------------------------------------------

describe('SceneSystem.create() / remove()', () => {
  it('创建自定义场景后可用 get / has / list / apply 取用', () => {
    const fixtures = makeFixtures(2);
    const system = new SceneSystem(makeRegistry(fixtures));

    const scene = system.create('party', '派对', { [ALL_FIXTURES]: 0.8 }, { [ALL_FIXTURES]: 6000 }, 600);

    expect(system.has('party')).toBe(true);
    expect(system.list()).toHaveLength(7);
    expect(system.list().at(-1)).toBe('party');
    expect(system.get('party')).toEqual(scene);
    expect(scene).toEqual({ key: 'party', name: '派对', transitionMs: 600, levels: { '*': 0.8 }, cct: { '*': 6000 } });

    system.apply('party');
    expect(levelOf(fixtures[0]!, 'party')).toBe(0.8);
    expect(fixtures[0]!.electrical.cct).toBe(6000);
  });

  it('create() 覆盖同名场景；默认 transitionMs = DEFAULT_TRANSITION_MS', () => {
    const system = new SceneSystem();
    expect(system.get('movie').name).toBe('观影');

    system.create('movie', '观影模式', { [ALL_FIXTURES]: 0.3 }, { [ALL_FIXTURES]: 2000 });

    expect(system.get('movie')).toMatchObject({ name: '观影模式', transitionMs: DEFAULT_TRANSITION_MS });
    expect(system.list()).toHaveLength(6); // 覆盖而非新增
  });

  it('create() 截断越界的 levels / cct，拒绝非有限值与非法 sceneKey', () => {
    const system = new SceneSystem();
    const scene = system.create('extreme', '极值', { [ALL_FIXTURES]: 3.5 }, { [ALL_FIXTURES]: 100000 }, 500);

    expect(system.get('extreme').levels[ALL_FIXTURES]).toBe(1);
    expect(system.get('extreme').cct[ALL_FIXTURES]).toBe(40000);
    expect(scene.transitionMs).toBe(500);
    expect(() => system.create('a', 'a', { x: Number.NaN }, {})).toThrowError(RangeError);
    expect(() => system.create('b', 'b', {}, { x: Infinity })).toThrowError(RangeError);
    expect(() => system.create('b', 'b', {}, {}, -1)).toThrowError(RangeError);
    expect(() => system.create('b', 'b', {}, {}, Number.NaN)).toThrowError(RangeError);
    expect(() => system.create('  ', 'blank', {}, {})).toThrowError(TypeError);
  });

  it('remove() 删除场景并清掉指向它的过渡，返回值指示是否命中', () => {
    const fixtures = makeFixtures(1);
    const system = new SceneSystem(makeRegistry(fixtures));
    system.create('party', '派对', { [ALL_FIXTURES]: 0.8 }, { [ALL_FIXTURES]: 6000 });
    system.applySmooth('party');

    expect(system.remove('party')).toBe(true);

    expect(system.has('party')).toBe(false);
    expect(system.list()).toHaveLength(6);
    expect(system.getTransition()).toBeNull();
    expect(system.remove('party')).toBe(false);
    expect(() => system.apply('party')).toThrowError(SceneNotFoundError);
  });

  it('remove() 内置预设后仍保留其原始定义（PRESET_SCENES 不受影响）', () => {
    const system = new SceneSystem();
    expect(system.remove('night')).toBe(true);
    expect(system.has('night')).toBe(false);
    expect(() => system.get('night')).toThrowError(SceneNotFoundError);
    expect(PRESET_SCENES.night.name).toBe('夜间');
    expect(system.get('movie').levels[ALL_FIXTURES]).toBe(0.15);
  });
});

// ---------------------------------------------------------------------------
// getAppliedState()
// ---------------------------------------------------------------------------

describe('SceneSystem.getAppliedState()', () => {
  it('未 apply 时返回默认全亮快照；apply 后返回实况', () => {
    const fixtures = makeFixtures(2);
    fixtures[1]!.electrical.cct = 4500;
    const system = new SceneSystem(makeRegistry(fixtures));

    expect(system.getAppliedState()).toEqual({
      levels: { 'fx-0': 1, 'fx-1': 1 },
      cct: { 'fx-0': 3000, 'fx-1': 4500 },
    });

    system.apply('dinner');
    expect(system.getAppliedState()).toEqual({
      levels: { 'fx-0': 0.65, 'fx-1': 0.65 },
      cct: { 'fx-0': 2700, 'fx-1': 2700 },
    });
  });

  it('快照只覆盖注册表内的灯具，改快照不污染实况（值拷贝）', () => {
    const f = makeFixture({ type: 'downlight', cct: 3000, skuId: 'fx-0' });
    const system = new SceneSystem(makeRegistry([f]));
    system.apply('dinner');

    const before = system.getAppliedState();
    expect(Object.keys(before.levels)).toEqual(['fx-0']);
    expect(Object.keys(before.cct)).toEqual(['fx-0']);
    expect(before.levels['outside']).toBeUndefined();

    // 篡改快照：塞外部门户 + 改值
    before.levels['outside'] = 0.9;
    before.levels['fx-0'] = 0.0001;

    const after = system.getAppliedState();

    expect(Object.keys(after.levels)).toEqual(['fx-0']);
    expect(after.levels['fx-0']).toBe(0.65); // 未被快照污染
    expect(after.levels['outside']).toBeUndefined();
    expect(levelOf(f, 'dinner')).toBe(0.65);
  });

  it('getAppliedState() 只按 activeScene 取亮度：被锁字段的实况不被场景篡改', () => {
    const fixtures = makeFixtures(2);
    lock(fixtures[1]!, FIELD_LEVELS);
    lock(fixtures[1]!, FIELD_CCT);
    const system = new SceneSystem(makeRegistry(fixtures));
    system.apply('movie');

    const state = system.getAppliedState();

    expect(state.levels['fx-0']).toBe(0.15);
    expect(state.levels['fx-1']).toBeUndefined as unknown as number;
    expect(state.cct['fx-0']).toBe(3000);
    expect(state.cct['fx-1']).toBe(3000);
  });
});

// ---------------------------------------------------------------------------
// 注册表动态性
// ---------------------------------------------------------------------------

describe('SceneSystem — 注册表按引用持有', () => {
  it('apply() 后新加入的灯具由下一次 apply() 接管', () => {
    const fixtures = makeFixtures(1);
    const registry = makeRegistry(fixtures);
    const system = new SceneSystem(registry);
    system.apply('night');
    expect(levelOf(fixtures[0]!, 'night')).toBe(0.1);

    const later = makeFixture({ type: 'floor', cct: 3000, skuId: 'fx-late' });
    registry.set(later.id, later);
    system.apply('night');

    expect(levelOf(later, 'night')).toBe(0.1);
    expect(later.electrical.cct).toBe(2200);
  });
});

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

describe('SceneSystem — 错误处理', () => {
  it('SceneNotFoundError 携带 sceneKey 与 name', () => {
    try {
      new SceneSystem().apply('ghost');
      expect.fail('should throw');
    } catch (e) {
      const err = e as SceneNotFoundError;
      expect(err).toBeInstanceOf(SceneNotFoundError);
      expect(err.sceneKey).toBe('ghost');
      expect(err.name).toBe('SceneNotFoundError');
    }
  });

  it('remove() 不存在的场景返回 false，不抛错', () => {
    expect(new SceneSystem().remove('ghost')).toBe(false);
  });
});
