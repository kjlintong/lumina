import { describe, it, expect } from 'vitest';
import { SHADE_VISUAL_SCALE } from '../lightBuilder.js';

describe('SHADE_VISUAL_SCALE (P29→P31)', () => {
  // P29: 6.0（视觉直径 ~1.3m，肉眼清晰可辨但过大压场）
  // P31: 3.0（视觉直径 ~0.66m，配合 P30 独立几何造型清晰可辨）
  it('在 2.5–4.0 合理区间', () => {
    expect(SHADE_VISUAL_SCALE).toBeGreaterThanOrEqual(2.5);
    expect(SHADE_VISUAL_SCALE).toBeLessThanOrEqual(4.0);
  });
  it('disc 视觉直径 0.4–0.9m（真实筒灯 0.2m 的 2–4 倍）', () => {
    const visual = 0.22 * SHADE_VISUAL_SCALE;
    expect(visual).toBeGreaterThanOrEqual(0.4);
    expect(visual).toBeLessThanOrEqual(0.9);
  });
  it('cone/cylinder 视觉直径 0.4–0.9m', () => {
    const visual = 0.18 * SHADE_VISUAL_SCALE;
    expect(visual).toBeGreaterThanOrEqual(0.4);
    expect(visual).toBeLessThanOrEqual(0.9);
  });
  it('sphere 视觉直径 0.5–1.1m（吊灯灯罩合理尺度）', () => {
    const visual = 0.28 * SHADE_VISUAL_SCALE;
    expect(visual).toBeGreaterThanOrEqual(0.5);
    expect(visual).toBeLessThanOrEqual(1.1);
  });
});
