/**
 * @vitest-environment jsdom
 *
 * P16：Bloom 按太阳高度分档（审查报告 §4 Day 4 h）测试。
 *
 * 只覆盖纯函数 bloomForSunIntensity 与三档常量——PostProcessing 类构造
 * 需要真实 WebGL（EffectComposer/WebGLRenderTarget），不在 jsdom 范围内。
 */
import { describe, it, expect } from 'vitest';
import {
  BLOOM_DAY,
  BLOOM_NIGHT,
  BLOOM_SUNSET,
  bloomForSunIntensity,
} from '../postProcessing.js';

describe('bloomForSunIntensity', () => {
  it('日间：sunInt > 0.2 返回 BLOOM_DAY', () => {
    expect(bloomForSunIntensity(1.0)).toBe(BLOOM_DAY);
    expect(bloomForSunIntensity(1.0).strength).toBe(0.25);
  });

  it('日落：0.05 < sunInt <= 0.2 返回 BLOOM_SUNSET', () => {
    expect(bloomForSunIntensity(0.15)).toBe(BLOOM_SUNSET);
    expect(bloomForSunIntensity(0.15).strength).toBe(0.55);
  });

  it('夜间：sunInt <= 0.05 返回 BLOOM_NIGHT', () => {
    expect(bloomForSunIntensity(0)).toBe(BLOOM_NIGHT);
    expect(bloomForSunIntensity(0).threshold).toBe(0.9);
  });

  it('边界值：0.2 归日落档（非严格大于 0.2 才日间）', () => {
    expect(bloomForSunIntensity(0.2)).toBe(BLOOM_SUNSET);
  });

  it('边界值：0.05 归夜间档（非严格大于 0.05 才日落）', () => {
    expect(bloomForSunIntensity(0.05)).toBe(BLOOM_NIGHT);
  });

  it('三档常量数值符合规格', () => {
    expect(BLOOM_DAY).toEqual({ strength: 0.25, radius: 0.7, threshold: 0.85 });
    expect(BLOOM_SUNSET).toEqual({ strength: 0.55, radius: 0.7, threshold: 0.85 });
    expect(BLOOM_NIGHT).toEqual({ strength: 0.45, radius: 0.7, threshold: 0.9 });
  });
});
