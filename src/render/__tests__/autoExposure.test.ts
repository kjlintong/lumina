import { describe, expect, it, beforeEach } from 'vitest';

import { AutoExposure } from '../autoExposure.js';
import type { ExposureSampler } from '../autoExposure.js';

/** 恒定亮度采样器（线性空间 0-1） */
function constantSampler(luminance: number): ExposureSampler {
  return { getAverageLuminance: () => luminance };
}

describe('AutoExposure — 眼适应自动曝光', () => {
  let exposure: AutoExposure;

  beforeEach(() => {
    exposure = new AutoExposure();
  });

  it('update() 返回值 > 0', () => {
    expect(exposure.update()).toBeGreaterThan(0);
  });

  it('默认曝光为 1.0', () => {
    expect(exposure.getExposure()).toBe(1.0);
  });

  it('update() 根据亮度采样调整曝光（暗场景 → 曝光升高）', () => {
    // sampleInterval=1 让每帧都采样；speed=1 去掉平滑延迟直接到位
    const ae = new AutoExposure({ sampleInterval: 1, speed: 1 });
    ae.setSampler(constantSampler(0.05)); // 暗于目标 0.17
    const value = ae.update();
    // 目标曝光 = 0.17 / 0.05 = 3.4 > 1
    expect(value).toBeGreaterThan(1.0);
    expect(value).toBeCloseTo(3.4, 3);
  });

  it('update() 根据亮度采样调整曝光（亮场景 → 曝光降低）', () => {
    const ae = new AutoExposure({ sampleInterval: 1, speed: 1 });
    ae.setSampler(constantSampler(0.8)); // 亮于目标
    expect(ae.update()).toBeLessThan(1.0);
  });

  it('targetLuminance 配置改变行为：目标越亮，同亮度下曝光越高', () => {
    const dark = 0.1;
    const low = new AutoExposure({ sampleInterval: 1, speed: 1, targetLuminance: 0.1 });
    const high = new AutoExposure({ sampleInterval: 1, speed: 1, targetLuminance: 0.4 });
    low.setSampler(constantSampler(dark));
    high.setSampler(constantSampler(dark));
    expect(high.update()).toBeGreaterThan(low.update());
  });

  it('曝光被夹在 [minExposure, maxExposure]', () => {
    const ae = new AutoExposure({ sampleInterval: 1, speed: 1, minExposure: 0.5, maxExposure: 2 });
    ae.setSampler(constantSampler(1e-6)); // 极暗 → 目标曝光巨大 → 应被 max 截断
    expect(ae.update()).toBeLessThanOrEqual(2);
    ae.setSampler(constantSampler(1)); // 极亮 → 目标曝光极小 → 应被 min 截断
    expect(ae.update()).toBeGreaterThanOrEqual(0.5);
  });
});
