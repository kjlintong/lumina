/**
 * P34 · Part A 验收：computeLightBudget 单元测试（10 用例）
 *
 * 覆盖：
 *   1. 空 fixtures
 *   2. 少于上限（全部 real，不截断）
 *   3. 恰好等于上限
 *   4. 超过上限（截断，其余 proxy）
 *   5. 排序：SpotLight（spot_shadow）优先于 PointLight（point）
 *   6. 排序：PointLight 优先于 RectAreaLight
 *   7. ADR-17：user-locked light.intensity 的灯永远 real，reason='locked'
 *   8. ADR-17：锁定 + 超上限场景下锁定灯保留
 *   9. entries 稳定排序（同权重按 id 升序）
 *  10. realSet / proxySet 与 entries 一致
 */
import { describe, it, expect } from 'vitest';
import { computeLightBudget, MAX_REAL_LIGHTS } from '../lightBudget.js';
import type { Fixture } from '../../core/types.js';
import { makeFixture } from '../../core/makeFixture.js';

function makeFixtureAt(id: string, type: Fixture['type'], opts: { locked?: boolean } = {}): Fixture {
  const f = makeFixture({ type, skuId: id });
  if (opts.locked) f.lockedFields = new Set(['light.intensity']);
  return f;
}

describe('computeLightBudget', () => {
  it('空 fixtures 返回空预算，不截断', () => {
    const r = computeLightBudget([]);
    expect(r.entries).toEqual([]);
    expect(r.realSet.size).toBe(0);
    expect(r.proxySet.size).toBe(0);
    expect(r.truncated).toBe(false);
  });

  it('少于上限：全部 real，不截断', () => {
    const list = [
      makeFixtureAt('fx-1', 'downlight'),
      makeFixtureAt('fx-2', 'pendant'),
      makeFixtureAt('fx-3', 'spot'),
    ];
    const r = computeLightBudget(list);
    expect(r.entries.length).toBe(3);
    expect(r.truncated).toBe(false);
    for (const e of r.entries) expect(e.isReal).toBe(true);
  });

  it('恰好等于上限：全部 real', () => {
    const list: Fixture[] = [];
    for (let i = 0; i < MAX_REAL_LIGHTS; i++) {
      list.push(makeFixtureAt(`fx-${i}`, 'downlight'));
    }
    const r = computeLightBudget(list);
    expect(r.realSet.size).toBe(MAX_REAL_LIGHTS);
    expect(r.proxySet.size).toBe(0);
    expect(r.truncated).toBe(false);
  });

  it('超过上限：前 MAX_REAL_LIGHTS 盏 real，其余 proxy', () => {
    const list: Fixture[] = [];
    const total = MAX_REAL_LIGHTS + 5;
    for (let i = 0; i < total; i++) {
      list.push(makeFixtureAt(`fx-${i}`, 'downlight'));
    }
    const r = computeLightBudget(list);
    expect(r.truncated).toBe(true);
    expect(r.realSet.size).toBe(MAX_REAL_LIGHTS);
    expect(r.proxySet.size).toBe(5);
    expect(r.realSet.size + r.proxySet.size).toBe(total);
  });

  it('排序：SpotLight（spot_shadow）优先于 PointLight（point）', () => {
    const list = [
      makeFixtureAt('fx-point', 'pendant'),
      makeFixtureAt('fx-spot', 'spot'),
      makeFixtureAt('fx-rect', 'linear'),
    ];
    const r = computeLightBudget(list);
    // spot (rank 0) < point (rank 2) < rect (rank 3)
    expect(r.entries[0]?.id).toBe('fx-spot');
    expect(r.entries[1]?.id).toBe('fx-point');
    expect(r.entries[2]?.id).toBe('fx-rect');
  });

  it('排序：PointLight 优先于 RectAreaLight', () => {
    const list = [
      makeFixtureAt('fx-cove', 'cove'),
      makeFixtureAt('fx-floorp', 'floor'),
    ];
    const r = computeLightBudget(list);
    expect(r.entries[0]?.id).toBe('fx-floorp');
    expect(r.entries[1]?.id).toBe('fx-cove');
  });

  it('ADR-17：user-locked light.intensity 的灯永远 real，reason=locked', () => {
    const list = [
      makeFixtureAt('fx-locked', 'pendant', { locked: true }),
      makeFixtureAt('fx-unlocked-1', 'downlight'),
      makeFixtureAt('fx-unlocked-2', 'downlight'),
    ];
    const r = computeLightBudget(list);
    const locked = r.entries.find((e) => e.id === 'fx-locked');
    expect(locked?.isReal).toBe(true);
    expect(locked?.reason).toBe('locked');
  });

  it('ADR-17：超上限场景下锁定灯保留（其余截断）', () => {
    // 12 盏未锁 SpotLight（downlight）+ 1 盏锁定 PointLight（pendant）= 13 盏
    // 排序：锁定 pendant 排第 1（isLocked 优先）；12 盏 SpotLight 按 id 升序占 slot 1-12
    // 前 8 盏 = real（1 锁定 + 7 未锁 SpotLight）；slot 8-12 = proxy（5 盏 SpotLight）
    // 关键断言：锁定 pendant 无论超不超限都保留 real
    const list: Fixture[] = [];
    for (let i = 0; i < 12; i++) list.push(makeFixtureAt(`fx-spot-${i}`, 'downlight'));
    list.push(makeFixtureAt('fx-locked', 'pendant', { locked: true }));

    const r = computeLightBudget(list);
    expect(r.truncated).toBe(true);
    expect(r.realSet.size).toBe(MAX_REAL_LIGHTS);
    expect(r.realSet.has('fx-locked')).toBe(true);
    expect(r.entries.find((e) => e.id === 'fx-locked')?.reason).toBe('locked');
    expect(r.proxySet.size).toBe(13 - MAX_REAL_LIGHTS);
  });

  it('同权重稳定排序（按 id 升序）', () => {
    // 都是 downlight（spot_shadow），无锁定；按 id 升序
    const list = [
      makeFixtureAt('fx-c', 'downlight'),
      makeFixtureAt('fx-a', 'downlight'),
      makeFixtureAt('fx-b', 'downlight'),
    ];
    const r = computeLightBudget(list);
    expect(r.entries.map((e) => e.id)).toEqual(['fx-a', 'fx-b', 'fx-c']);
  });

  it('realSet / proxySet 与 entries 一致', () => {
    const list: Fixture[] = [];
    for (let i = 0; i < 12; i++) list.push(makeFixtureAt(`fx-${i}`, 'downlight'));
    const r = computeLightBudget(list);
    const realFromEntries = new Set(r.entries.filter((e) => e.isReal).map((e) => e.id));
    const proxyFromEntries = new Set(r.entries.filter((e) => !e.isReal).map((e) => e.id));
    expect([...r.realSet].sort()).toEqual([...realFromEntries].sort());
    expect([...r.proxySet].sort()).toEqual([...proxyFromEntries].sort());
  });
});
