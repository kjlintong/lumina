import { describe, it, expect } from 'vitest';
import { SHADE_VISUAL_SCALE } from '../lightBuilder.js';

describe('SHADE_VISUAL_SCALE (P29)', () => {
  it('>= 5.0：确保 disc 直径 0.22m 放大后视觉直径 >= 1.1m', () => {
    expect(SHADE_VISUAL_SCALE).toBeGreaterThanOrEqual(5.0);
  });
  it('disc 视觉直径 >= 1.0m', () => {
    const visual = 0.22 * SHADE_VISUAL_SCALE;
    expect(visual).toBeGreaterThanOrEqual(1.0);
  });
  it('cone/cylinder 视觉直径 >= 0.8m', () => {
    const visual = 0.18 * SHADE_VISUAL_SCALE;
    expect(visual).toBeGreaterThanOrEqual(0.8);
  });
  it('sphere 视觉直径 >= 1.5m（吊灯显眼）', () => {
    const visual = 0.28 * SHADE_VISUAL_SCALE;
    expect(visual).toBeGreaterThanOrEqual(1.5);
  });
});
