/**
 * SceneEngine 灯具更新测试（P3-M1.6 规格 缺口 1 / 缺口 2）
 *
 * 覆盖：
 *  - updateFixture：移除旧 object 重建，场景子节点数不变；重建后重新应用当前 level
 *  - setFixtureLevel：intensity = baseIntensity * clamp(level, 0, 1)
 *  - setFixtureCct：直接改 light.color，不重建光源
 *  - activeSceneKey 设定后，addFixture / updateFixture 按 sceneLevels 恢复亮度
 *
 * 与 sceneEngine.test.ts 一样使用 mock RenderBackend，不依赖真实 WebGL。
 */

import { describe, expect, it, vi } from 'vitest';
import { SpotLight } from 'three';
import type { Light } from 'three';
import type { RenderBackend, BackendCapabilities } from '../../render/backend.js';
import { SceneEngine } from '../sceneEngine.js';
import { makeFixture } from '../../core/makeFixture.js';
import type { Fixture } from '../../core/types.js';

function createMockBackend(): RenderBackend {
  const capabilities: BackendCapabilities = {
    supportsIES: false,
    supportsGodrays: false,
    supportsEffectComposer: true,
    toneMapping: 'ACESFilmic',
    supportsShadows: true,
  };
  const canvas = document.createElement('canvas');
  return {
    type: 'webgl2',
    canvas,
    capabilities,
    getRenderer: vi.fn(),
    render: vi.fn(),
    resize: vi.fn(),
    setExposure: vi.fn(),
    getExposure: vi.fn(() => 1.0),
    setToneMappingExposure: vi.fn(),
    getToneMappingExposure: vi.fn(() => 1.0),
    setShadows: vi.fn(),
    setToneMapping: vi.fn(),
    dispose: vi.fn(),
  };
}

/** lumens 500 → baseIntensity = 500 / 4π */
const LUMENS = 500;
const BASE = LUMENS / (4 * Math.PI);

function makeDownlight(id: string): Fixture {
  const f = makeFixture({ type: 'downlight', pos: [0, 2.7, 0], lumens: LUMENS, beamAngle: 36, cct: 3000 });
  return { ...f, id };
}

/** 取灯具的物理光源（灯罩 Mesh 之外的 SpotLight） */
function getLight(engine: SceneEngine, id: string): Light {
  const group = engine.getScene().getObjectByName(id);
  const light = group?.children.find((c) => c instanceof SpotLight);
  if (!light) throw new Error(`light not found for fixture: ${id}`);
  return light;
}

describe('SceneEngine 灯具更新（P3 缺口 1/2）', () => {
  it('addFixture 记录 baseIntensity，level 默认全亮', () => {
    const engine = new SceneEngine(createMockBackend());
    engine.addFixture(makeDownlight('fx-a'));
    expect(getLight(engine, 'fx-a').intensity).toBeCloseTo(BASE);
    expect(engine.getFixtureLevel('fx-a')).toBe(1);
  });

  it('updateFixture 重建光源：场景子节点数不变，object 引用更换', () => {
    const engine = new SceneEngine(createMockBackend());
    engine.addFixture(makeDownlight('fx-a'));
    const before = engine.getScene().getObjectByName('fx-a');
    const childCount = engine.getScene().children.length;

    const moved = { ...makeDownlight('fx-a'), pos: [1, 2.7, 1] as const };
    engine.updateFixture(moved);

    const after = engine.getScene().getObjectByName('fx-a');
    expect(engine.getScene().children.length).toBe(childCount);
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
  });

  it('updateFixture 不存在的灯 = addFixture', () => {
    const engine = new SceneEngine(createMockBackend());
    const before = engine.getScene().children.length;
    engine.updateFixture(makeDownlight('fx-new'));
    expect(engine.getScene().children.length).toBe(before + 1);
    expect(getLight(engine, 'fx-new').intensity).toBeCloseTo(BASE);
  });

  it('setFixtureLevel：intensity = baseIntensity * level', () => {
    const engine = new SceneEngine(createMockBackend());
    engine.addFixture(makeDownlight('fx-a'));

    engine.setFixtureLevel('fx-a', 0.5);
    expect(getLight(engine, 'fx-a').intensity).toBeCloseTo(BASE * 0.5);
    expect(engine.getFixtureLevel('fx-a')).toBe(0.5);
  });

  it('setFixtureLevel 截断到 [0, 1]', () => {
    const engine = new SceneEngine(createMockBackend());
    engine.addFixture(makeDownlight('fx-a'));

    engine.setFixtureLevel('fx-a', 1.5);
    expect(getLight(engine, 'fx-a').intensity).toBeCloseTo(BASE);
    expect(engine.getFixtureLevel('fx-a')).toBe(1);

    engine.setFixtureLevel('fx-a', -0.5);
    expect(getLight(engine, 'fx-a').intensity).toBe(0);
    expect(engine.getFixtureLevel('fx-a')).toBe(0);
  });

  it('updateFixture 重建后重新应用当前 level（不重置成全亮）', () => {
    const engine = new SceneEngine(createMockBackend());
    engine.addFixture(makeDownlight('fx-a'));
    engine.setFixtureLevel('fx-a', 0.3);

    engine.updateFixture(makeDownlight('fx-a'));

    expect(getLight(engine, 'fx-a').intensity).toBeCloseTo(BASE * 0.3);
    expect(engine.getFixtureLevel('fx-a')).toBe(0.3);
  });

  it('setFixtureCct 直接改 light.color，不重建光源', () => {
    const engine = new SceneEngine(createMockBackend());
    engine.addFixture(makeDownlight('fx-a')); // 3000K
    const lightBefore = getLight(engine, 'fx-a');
    const warmBlue = lightBefore.color.b;

    engine.setFixtureCct('fx-a', 5000);

    const lightAfter = getLight(engine, 'fx-a');
    expect(lightAfter).toBe(lightBefore); // 未重建
    expect(lightAfter.color.b).toBeGreaterThan(warmBlue); // 5000K 更冷，蓝分量更高
  });

  it('removeFixture 清除 level 记录', () => {
    const engine = new SceneEngine(createMockBackend());
    engine.addFixture(makeDownlight('fx-a'));
    engine.removeFixture('fx-a');
    expect(engine.getFixtureLevel('fx-a')).toBeUndefined();
  });

  it('setActiveScene 后 addFixture 按 control.sceneLevels 恢复亮度', () => {
    const engine = new SceneEngine(createMockBackend());
    engine.setActiveScene('movie');
    const f = makeDownlight('fx-a');
    f.control.sceneLevels['movie'] = 0.2;

    engine.addFixture(f);

    expect(getLight(engine, 'fx-a').intensity).toBeCloseTo(BASE * 0.2);
    expect(engine.getFixtureLevel('fx-a')).toBe(0.2);
  });

  it('setActiveScene 后 updateFixture 按最新 sceneLevels 恢复亮度', () => {
    const engine = new SceneEngine(createMockBackend());
    const f = makeDownlight('fx-a');
    engine.addFixture(f);
    engine.setActiveScene('movie');
    f.control.sceneLevels['movie'] = 0.6;

    engine.updateFixture(f);

    expect(getLight(engine, 'fx-a').intensity).toBeCloseTo(BASE * 0.6);
    expect(engine.getFixtureLevel('fx-a')).toBe(0.6);
  });
});
