/**
 * SceneController 场景过渡测试（P3-M1.6 规格 交付物 3）
 *
 * 验证闭环：applyScene('movie') → tick 推进 → 引擎里灯真的变暗（level 0.15），
 * 结束时 finishTransition 停止推进，store 已落盘终值。
 */

import { describe, expect, it, vi } from 'vitest';
import { SpotLight } from 'three';
import type { Light } from 'three';
import type { RenderBackend, BackendCapabilities } from '../../render/backend.js';
import { SceneEngine } from '../sceneEngine.js';
import { SceneController } from '../sceneController.js';
import { createInitialProject, useProjectStore } from '../../store/projectStore.js';

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

function firstLight(engine: SceneEngine, id: string): Light {
  const group = engine.getScene().getObjectByName(id);
  const light = group?.children.find((c) => c instanceof SpotLight || 'isLight' in c);
  if (!light) throw new Error(`light not found: ${id}`);
  return light as Light;
}

/** store 重置为默认工程，并把工程内灯具同步进引擎（模拟 App 的 store → engine 投影） */
function setup(): { engine: SceneEngine; controller: SceneController; fixtureId: string } {
  useProjectStore.setState({
    project: createInitialProject(),
    selectedFixtureId: null,
    selectedZoneKey: null,
    activeSceneKey: null,
    sceneTransition: null,
  });
  const engine = new SceneEngine(createMockBackend());
  const fixtures = useProjectStore.getState().project.fixtures;
  for (const f of Object.values(fixtures)) engine.addFixture(f);
  const fixtureId = Object.keys(fixtures)[0] ?? '';
  return { engine, controller: new SceneController(engine), fixtureId };
}

describe('SceneController 场景过渡', () => {
  it('applyScene + tick 推进：灯真的变暗到观影级别，结束后停止', () => {
    const { engine, controller, fixtureId } = setup();
    const movieLevel = 0.15;

    controller.applyScene('movie', 0);
    expect(controller.isRunning()).toBe(true);
    expect(useProjectStore.getState().activeSceneKey).toBe('movie');

    controller.tick(0); // ratio 0：起点（全亮）
    expect(engine.getFixtureLevel(fixtureId)).toBeCloseTo(1);

    controller.tick(1000); // 50% of 2000ms：介于起点终点之间
    const mid = engine.getFixtureLevel(fixtureId);
    expect(mid).toBeGreaterThan(movieLevel);
    expect(mid).toBeLessThan(1);

    controller.tick(2000); // 结束：精确落在场景目标
    expect(engine.getFixtureLevel(fixtureId)).toBeCloseTo(movieLevel);
    expect(controller.isRunning()).toBe(false);

    // 结束后再 tick 不再改动
    controller.tick(3000);
    expect(engine.getFixtureLevel(fixtureId)).toBeCloseTo(movieLevel);
  });

  it('过渡期间色温逐帧写入引擎，结束时达到场景色温对应的颜色', () => {
    const { engine, controller, fixtureId } = setup();
    const blueBefore = firstLight(engine, fixtureId).color.b;

    controller.applyScene('daylight', 0); // 5000K，比默认暖光更冷
    controller.tick(1200); // daylight transitionMs = 1200 → 结束

    const blueAfter = firstLight(engine, fixtureId).color.b;
    expect(blueAfter).toBeGreaterThan(blueBefore);
  });

  it('store 侧在 applyScene 时已落盘终值（sceneLevels 尊重锁定）', () => {
    const { controller, fixtureId } = setup();

    controller.applyScene('movie', 0);

    const f = useProjectStore.getState().project.fixtures[fixtureId];
    expect(f?.control.sceneLevels['movie']).toBeCloseTo(0.15);
  });

  it('tick 无过渡时是 no-op', () => {
    const { engine, controller, fixtureId } = setup();
    const before = engine.getFixtureLevel(fixtureId);
    expect(() => controller.tick(100)).not.toThrow();
    expect(engine.getFixtureLevel(fixtureId)).toBe(before);
  });
});
