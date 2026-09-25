/**
 * projectStore 测试（P3-M1.6 规格 测试要求）
 *
 * 覆盖工程铁律：
 *  - ADR-01：removeZone 不级联删灯（绑定灯保留原位、自动解绑）
 *  - ADR-02：moveFixture 手动移灯自动解绑
 *  - ADR-13：moveZone / rotateZone 绑定灯跟随
 *  - ADR-17：updateFixture 改字段 → 字段路径进 lockedFields；
 *    applyScene 写 sceneLevels 且尊重锁定字段
 *  - changeZoneType 切换工作面高度 / 目标照度 / 推荐色温
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { bindFixture } from '../../core/binding.js';
import type { Fixture, LuminaProject } from '../../core/types.js';
import { createInitialProject, useProjectStore } from '../projectStore.js';

function resetStore(): void {
  useProjectStore.setState({
    project: createInitialProject(),
    selectedFixtureId: null,
    selectedZoneKey: null,
    activeSceneKey: null,
    sceneTransition: null,
  });
}

function project(): LuminaProject {
  return useProjectStore.getState().project;
}

function fixture(id: string): Fixture {
  const f = project().fixtures[id];
  if (!f) throw new Error(`fixture not found: ${id}`);
  return f;
}

/** 造一个「灯具绑定到区」的状态，返回 { zoneKey, fixtureId } */
function setupBoundPair(): { zoneKey: string; fixtureId: string } {
  const s = useProjectStore.getState();
  const zoneKey = s.addZone('dining', [1, 1]);
  const fixtureId = s.addFixture({ type: 'pendant', pos: [1, 1.9, 1] });
  useProjectStore.setState({ project: bindFixture(project(), fixtureId, zoneKey) });
  return { zoneKey, fixtureId };
}

beforeEach(resetStore);

describe('createInitialProject', () => {
  it('默认工程含 2 个活动区 + 3 盏灯', () => {
    const p = createInitialProject();
    expect(Object.keys(p.zones)).toHaveLength(2);
    expect(Object.keys(p.fixtures)).toHaveLength(3);
    expect(p.schemaVersion).toBe(1);
  });

  it('默认工程含一个绑定关系（吊灯 → 用餐区）', () => {
    const p = createInitialProject();
    const bound = Object.values(p.fixtures).find((f) => f.binding !== null);
    expect(bound).toBeDefined();
    const zoneKey = bound?.binding?.zoneKey ?? '';
    const zone = p.zones[zoneKey];
    expect(zone).toBeDefined();
    expect(zone?.fixtures.some((b) => b.fixtureId === bound?.id)).toBe(true);
  });
});

describe('ADR-01：删除活动区不级联删灯', () => {
  it('删区后原绑定灯仍在、坐标不变、已解绑', () => {
    const { zoneKey, fixtureId } = setupBoundPair();
    const posBefore = fixture(fixtureId).pos;

    useProjectStore.getState().removeZone(zoneKey);

    const p = project();
    expect(p.zones[zoneKey]).toBeUndefined();
    const f = p.fixtures[fixtureId];
    expect(f).toBeDefined();
    expect(f?.pos).toEqual(posBefore);
    expect(f?.binding).toBeNull();
  });

  it('删除被选中的区会清除选中态', () => {
    const { zoneKey } = setupBoundPair();
    expect(useProjectStore.getState().selectedZoneKey).toBe(zoneKey);
    useProjectStore.getState().removeZone(zoneKey);
    expect(useProjectStore.getState().selectedZoneKey).toBeNull();
  });

  it('删除不存在的区是 no-op', () => {
    const before = project();
    useProjectStore.getState().removeZone('no-such-zone');
    expect(project()).toBe(before);
  });
});

describe('ADR-02：手动移动灯具自动解绑', () => {
  it('启用绑定的灯被移动后解绑，位置更新，区侧镜像清除', () => {
    const { zoneKey, fixtureId } = setupBoundPair();

    const { autoUnbound } = useProjectStore.getState().moveFixture(fixtureId, [2, 1.9, 2]);

    expect(autoUnbound).toBe(true);
    const f = fixture(fixtureId);
    expect(f.binding).toBeNull();
    expect(f.pos).toEqual([2, 1.9, 2]);
    const zone = project().zones[zoneKey];
    expect(zone?.fixtures.some((b) => b.fixtureId === fixtureId)).toBe(false);
  });

  it('未绑定的灯移动时不报解绑', () => {
    const id = useProjectStore.getState().addFixture({ type: 'downlight', pos: [0, 2.7, 0] });
    const { autoUnbound } = useProjectStore.getState().moveFixture(id, [1, 2.7, 1]);
    expect(autoUnbound).toBe(false);
    expect(fixture(id).pos).toEqual([1, 2.7, 1]);
  });

  it('移动不存在的灯是 no-op', () => {
    const before = project();
    const { autoUnbound } = useProjectStore.getState().moveFixture('no-such-fx', [0, 0, 0]);
    expect(autoUnbound).toBe(false);
    expect(project()).toBe(before);
  });

  it('moveAndLockFixture：解绑 + 锁定 pos（参数面板位置编辑用，ADR-02 + ADR-17）', () => {
    const { fixtureId } = setupBoundPair();

    const { autoUnbound } = useProjectStore.getState().moveAndLockFixture(fixtureId, [2.5, 1.9, 2.5]);

    // ADR-02：自动解绑
    expect(autoUnbound).toBe(true);
    const f = fixture(fixtureId);
    expect(f.binding).toBeNull();
    expect(f.pos).toEqual([2.5, 1.9, 2.5]);
    // ADR-17：手动改过 pos 即锁定
    expect(f.lockedFields.has('pos')).toBe(true);
  });

  it('moveAndLockFixture：未绑定的灯不报解绑，但仍锁定 pos', () => {
    const id = useProjectStore.getState().addFixture({ type: 'downlight', pos: [0, 2.7, 0] });

    const { autoUnbound } = useProjectStore.getState().moveAndLockFixture(id, [1, 2.7, 1]);

    expect(autoUnbound).toBe(false);
    expect(fixture(id).pos).toEqual([1, 2.7, 1]);
    expect(fixture(id).lockedFields.has('pos')).toBe(true);
  });
});

describe('通知：ADR-02 解绑提示', () => {
  it('setNotice 写入文案，传 null 清除', () => {
    expect(useProjectStore.getState().notice).toBeNull();
    useProjectStore.getState().setNotice('该灯已脱离活动区跟随');
    expect(useProjectStore.getState().notice).toBe('该灯已脱离活动区跟随');
    useProjectStore.getState().setNotice(null);
    expect(useProjectStore.getState().notice).toBeNull();
  });
});

describe('ADR-13：区变换时绑定灯跟随', () => {
  it('moveZone 平移区，绑定灯按相同位移跟随', () => {
    const { fixtureId } = setupBoundPair();
    const before = fixture(fixtureId).pos;
    const zoneKey = fixtureBindingZone(fixtureId);

    useProjectStore.getState().moveZone(zoneKey, [0.5, -0.5]);

    const after = fixture(fixtureId).pos;
    expect(after[0]).toBeCloseTo(before[0] + 0.5);
    expect(after[1]).toBeCloseTo(before[1]); // y 不变
    expect(after[2]).toBeCloseTo(before[2] - 0.5);
  });

  it('rotateZone 旋转区，绑定灯按局部偏移重新落位', () => {
    const { zoneKey, fixtureId } = setupBoundPair();
    // 灯具在区中心正上方（局部偏移 [0, 1.9, 0]），旋转 90° 后世界位置不变；
    // 先把灯挪到偏心位置再旋转，验证跟随
    useProjectStore.getState().moveFixture(fixtureId, [1.5, 1.9, 1]); // 自动解绑
    useProjectStore.setState({ project: bindFixture(project(), fixtureId, zoneKey) });

    useProjectStore.getState().rotateZone(zoneKey, Math.PI / 2);

    // 局部偏移 [0.5, 1.9, 0]，绕 Y 转 90°：x' = z·sin + x·cos → 0，z' = -x·sin → -0.5
    const after = fixture(fixtureId).pos;
    expect(after[0]).toBeCloseTo(1); // 区中心 x + 0
    expect(after[2]).toBeCloseTo(0.5); // 区中心 z - 0.5
  });
});

function fixtureBindingZone(fixtureId: string): string {
  const b = fixture(fixtureId).binding;
  if (!b) throw new Error('fixture is not bound');
  return b.zoneKey;
}

describe('ADR-17：updateFixture 手动改 = 锁定', () => {
  it('对象补丁：改 electrical.cct → "electrical.cct" 进 lockedFields，值已应用', () => {
    const id = useProjectStore.getState().addFixture({ type: 'downlight', cct: 4000 });

    useProjectStore.getState().updateFixture(id, { electrical: { cct: 2700 } });

    const f = fixture(id);
    expect(f.electrical.cct).toBe(2700);
    expect(f.lockedFields.has('electrical.cct')).toBe(true);
    // 未触碰的字段不锁
    expect(f.lockedFields.has('pos')).toBe(false);
  });

  it('对象补丁：改 pos（数组叶子）→ "pos" 进 lockedFields', () => {
    const id = useProjectStore.getState().addFixture({ type: 'downlight' });

    useProjectStore.getState().updateFixture(id, { pos: [1, 2.5, 1] });

    const f = fixture(id);
    expect(f.pos).toEqual([1, 2.5, 1]);
    expect(f.lockedFields.has('pos')).toBe(true);
  });

  it('函数补丁：改 watt → "electrical.watt" 进 lockedFields', () => {
    const id = useProjectStore.getState().addFixture({ type: 'downlight', watt: 9 });

    useProjectStore.getState().updateFixture(id, (f) => {
      f.electrical.watt = 12;
    });

    const f = fixture(id);
    expect(f.electrical.watt).toBe(12);
    expect(f.lockedFields.has('electrical.watt')).toBe(true);
  });

  it('patch 不能篡改 id 与 lockedFields', () => {
    const id = useProjectStore.getState().addFixture({ type: 'downlight' });

    useProjectStore.getState().updateFixture(id, { id: 'hacked' });

    expect(fixture(id).id).toBe(id);
    expect(project().fixtures['hacked']).toBeUndefined();
  });

  it('更新不存在的灯是 no-op', () => {
    const before = project();
    useProjectStore.getState().updateFixture('no-such-fx', { pos: [0, 0, 0] });
    expect(project()).toBe(before);
  });
});

describe('changeZoneType：切换需求侧模板', () => {
  it('工作 → 睡眠：工作面高度 / 目标照度 / 推荐色温同步切换', () => {
    const key = useProjectStore.getState().addZone('work', [0, 0]);
    expect(project().zones[key]?.planeH).toBe(0.75);
    expect(project().zones[key]?.lux).toBe(500);
    expect(project().zones[key]?.cct).toBe(4000);

    useProjectStore.getState().changeZoneType(key, 'sleep');

    const zone = project().zones[key];
    expect(zone?.type).toBe('sleep');
    expect(zone?.planeH).toBe(0.6);
    expect(zone?.lux).toBe(50);
    expect(zone?.cct).toBe(2700);
  });

  it('改类型不解绑已绑定灯具', () => {
    const { zoneKey, fixtureId } = setupBoundPair();
    useProjectStore.getState().changeZoneType(zoneKey, 'reading');
    expect(fixture(fixtureId).binding?.zoneKey).toBe(zoneKey);
  });
});

describe('applyScene：写 sceneLevels 且尊重锁定字段（ADR-17）', () => {
  it('应用"观影"：未锁定的灯写入 sceneLevels[movie] 与色温', () => {
    const id = useProjectStore.getState().addFixture({ type: 'downlight', cct: 4000 });

    useProjectStore.getState().applyScene('movie');

    const f = fixture(id);
    expect(f.control.sceneLevels['movie']).toBeCloseTo(0.15);
    expect(f.electrical.cct).toBe(3000); // 观影预设 3000K
    expect(useProjectStore.getState().activeSceneKey).toBe('movie');
    expect(useProjectStore.getState().sceneTransition?.key).toBe('movie');
    expect(useProjectStore.getState().sceneTransition?.durationMs).toBe(2000);
  });

  it('updateFixture 锁过的色温不被场景覆盖，未锁的亮度仍写入', () => {
    const id = useProjectStore.getState().addFixture({ type: 'downlight', cct: 4000 });
    // 用户手动改色温 → 锁定 electrical.cct
    useProjectStore.getState().updateFixture(id, { electrical: { cct: 4500 } });

    useProjectStore.getState().applyScene('night'); // 夜间：0.1 / 2200K

    const f = fixture(id);
    expect(f.electrical.cct).toBe(4500); // 锁定字段未被覆盖
    expect(f.control.sceneLevels['night']).toBeCloseTo(0.1); // 未锁字段正常写入
  });

  it('lockField("control.sceneLevels") 后场景不写该灯亮度', () => {
    const id = useProjectStore.getState().addFixture({ type: 'downlight' });
    useProjectStore.getState().lockField(id, 'control.sceneLevels');

    useProjectStore.getState().applyScene('daylight');

    expect(fixture(id).control.sceneLevels['daylight']).toBeUndefined();
  });

  it('亮度尊重调光下限（dimFloor）', () => {
    const id = useProjectStore.getState().addFixture({ type: 'downlight', dimFloor: 0.2 });

    useProjectStore.getState().applyScene('night'); // 目标 0.1，低于下限

    expect(fixture(id).control.sceneLevels['night']).toBeCloseTo(0.2);
  });

  it('applySceneInstant 写终值但不登记过渡', () => {
    const id = useProjectStore.getState().addFixture({ type: 'downlight' });

    useProjectStore.getState().applySceneInstant('reading');

    expect(fixture(id).control.sceneLevels['reading']).toBeCloseTo(0.95);
    expect(useProjectStore.getState().activeSceneKey).toBe('reading');
    expect(useProjectStore.getState().sceneTransition).toBeNull();
  });

  it('未知场景 key 抛错且不改状态', () => {
    const before = project();
    expect(() => useProjectStore.getState().applyScene('no-such-scene')).toThrow();
    expect(project()).toBe(before);
  });
});

describe('选择与其他 action', () => {
  it('addZone 返回 key 并选中；renameZone 生效', () => {
    const key = useProjectStore.getState().addZone('reading', [0.5, 0.5], '窗边阅读角');
    expect(useProjectStore.getState().selectedZoneKey).toBe(key);
    expect(project().zones[key]?.name).toBe('窗边阅读角');

    useProjectStore.getState().renameZone(key, '阳台阅读角');
    expect(project().zones[key]?.name).toBe('阳台阅读角');
  });

  it('addFixture 返回 id 并选中；removeFixture 清除选中态', () => {
    const id = useProjectStore.getState().addFixture({ type: 'floor', pos: [-2, 1.4, 1] });
    expect(useProjectStore.getState().selectedFixtureId).toBe(id);

    useProjectStore.getState().selectFixture(null);
    expect(useProjectStore.getState().selectedFixtureId).toBeNull();

    useProjectStore.getState().selectFixture(id);
    useProjectStore.getState().removeFixture(id);
    expect(project().fixtures[id]).toBeUndefined();
    expect(useProjectStore.getState().selectedFixtureId).toBeNull();
  });
});
