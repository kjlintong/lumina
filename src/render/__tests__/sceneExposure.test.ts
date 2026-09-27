/**
 * 场景预设曝光查表测试（P20，§5 曝光矩阵）。
 *
 * 注：本文件 import sceneSystem（含 three 的间接依赖），沿用 godrays.test.ts
 * 的 `@vitest-environment jsdom` 声明。
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { PRESET_SCENES } from '../../scene/sceneSystem.js';
import { presetExposureBySceneKey } from '../sceneExposure.js';

describe('场景曝光矩阵（P20，§5）', () => {
  it('6 个内置预设全部声明了 exposure', () => {
    for (const scene of Object.values(PRESET_SCENES)) {
      expect(typeof scene.exposure, `${scene.key} 应当声明 exposure`).toBe('number');
    }
  });

  it('§5 矩阵目标值（日间 1.00 / 晚餐 0.80 / 观影 0.65 / 阅读 0.90 / 夜间 0.55）', () => {
    expect(presetExposureBySceneKey('daylight')).toBe(1.0);
    expect(presetExposureBySceneKey('dinner')).toBe(0.8);
    expect(presetExposureBySceneKey('movie')).toBe(0.65);
    expect(presetExposureBySceneKey('reading')).toBe(0.9);
    expect(presetExposureBySceneKey('night')).toBe(0.55);
  });

  it('relax 取 dinner 与 movie 的中间态（§5 无此场景，本规格自行取值）', () => {
    expect(presetExposureBySceneKey('relax')).toBeGreaterThan(0.65);
    expect(presetExposureBySceneKey('relax')).toBeLessThan(0.8);
  });

  it('未知 key 返回 undefined（自定义场景回落太阳分档）', () => {
    expect(presetExposureBySceneKey('does-not-exist')).toBeUndefined();
  });

  it('所有 exposure 在 [0.3, 1.2] 合理区间内（防止误填把画面压死）', () => {
    for (const scene of Object.values(PRESET_SCENES)) {
      expect(scene.exposure).toBeGreaterThanOrEqual(0.3);
      expect(scene.exposure).toBeLessThanOrEqual(1.2);
    }
  });
});
