/**
 * @vitest-environment jsdom
 *
 * P35 Part B：GradePass（6 参数）测试。
 *
 * 覆盖：
 * - DEFAULT_GRADE / PRESET_GRADE 数值
 * - GradePass 构造时 uniforms 默认值与 params 同步
 * - setParams 修改 params 与 uniforms
 * - lerpGrade 在 t=0 / t=0.5 / t=1 三处的行为
 * - 3 个 preset 的 grade 数值完整性（reception / cinema / reading）
 *
 * GradePass 构造不依赖真实 WebGL（只 new ShaderMaterial + FullScreenQuad，
 * 二者都是 CPU 侧数据结构，jsdom 可用）。
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GRADE,
  PRESET_GRADE,
  GradePass,
  lerpGrade,
} from '../gradePass.js';
import type { GradeParams } from '../gradePass.js';

function u(p: GradePass, key: string): unknown {
  const v = p.material.uniforms[key];
  expect(v, `uniform ${key} must exist`).toBeDefined();
  return (v as { value: unknown }).value;
}

describe('DEFAULT_GRADE', () => {
  it('数值符合规格', () => {
    expect(DEFAULT_GRADE).toEqual({
      temperature: 0,
      contrast: 1,
      saturation: 1,
      vignetteStrength: 0.15,
      whiteBalanceShift: 0,
      luminanceGamma: 1,
    });
  });
});

describe('GradePass', () => {
  it('构造后 uniforms 值与 DEFAULT_GRADE 同步', () => {
    const p = new GradePass();
    expect(p.params).toEqual(DEFAULT_GRADE);
    expect(u(p, 'uTemperature')).toBe(0);
    expect(u(p, 'uContrast')).toBe(1);
    expect(u(p, 'uSaturation')).toBe(1);
    expect(u(p, 'uVignette')).toBe(0.15);
    expect(u(p, 'uWhiteBalance')).toBe(0);
    expect(u(p, 'uGamma')).toBe(1);
    p.dispose();
  });

  it('setParams 只覆盖传入字段，其它保持', () => {
    const p = new GradePass();
    p.setParams({ temperature: 0.5, contrast: 1.2 });
    expect(p.params.temperature).toBe(0.5);
    expect(p.params.contrast).toBe(1.2);
    // 其它字段保持 DEFAULT_GRADE
    expect(p.params.saturation).toBe(1);
    expect(p.params.vignetteStrength).toBe(0.15);
    expect(p.params.whiteBalanceShift).toBe(0);
    expect(p.params.luminanceGamma).toBe(1);
    // uniforms 也同步
    expect(u(p, 'uTemperature')).toBe(0.5);
    expect(u(p, 'uContrast')).toBe(1.2);
    expect(u(p, 'uVignette')).toBe(0.15);
    p.dispose();
  });

  it('params 是可变引用，直接 mutate 不影响 uniforms（须走 setParams）', () => {
    const p = new GradePass();
    p.params.temperature = 0.7;
    // uniforms 未同步——这是设计约束
    expect(u(p, 'uTemperature')).toBe(0);
    p.setParams({ temperature: 0.7 });
    expect(u(p, 'uTemperature')).toBe(0.7);
    p.dispose();
  });
});

describe('lerpGrade', () => {
  it('t=0 返回 from', () => {
    const a: GradeParams = { ...DEFAULT_GRADE };
    const b: GradeParams = {
      temperature: 0.5,
      contrast: 1.5,
      saturation: 1.5,
      vignetteStrength: 0.5,
      whiteBalanceShift: 0.5,
      luminanceGamma: 1.5,
    };
    const r = lerpGrade(a, b, 0);
    expect(r).toEqual(a);
  });

  it('t=1 返回 to', () => {
    const a: GradeParams = { ...DEFAULT_GRADE };
    const b: GradeParams = {
      temperature: 0.5,
      contrast: 1.5,
      saturation: 1.5,
      vignetteStrength: 0.5,
      whiteBalanceShift: 0.5,
      luminanceGamma: 1.5,
    };
    const r = lerpGrade(a, b, 1);
    expect(r).toEqual(b);
  });

  it('t=0.5 各字段取中点', () => {
    const a: GradeParams = { ...DEFAULT_GRADE };
    const b: GradeParams = {
      temperature: 0.5,
      contrast: 1.5,
      saturation: 1.5,
      vignetteStrength: 0.5,
      whiteBalanceShift: 0.5,
      luminanceGamma: 1.5,
    };
    const r = lerpGrade(a, b, 0.5);
    expect(r.temperature).toBeCloseTo(0.25);
    expect(r.contrast).toBeCloseTo(1.25);
    expect(r.saturation).toBeCloseTo(1.25);
    expect(r.vignetteStrength).toBeCloseTo(0.325);
    expect(r.whiteBalanceShift).toBeCloseTo(0.25);
    expect(r.luminanceGamma).toBeCloseTo(1.25);
  });
});

describe('PRESET_GRADE', () => {
  it('reception：暖调、略加饱和与对比', () => {
    expect(PRESET_GRADE.reception).toEqual({
      temperature: 0.1,
      contrast: 1.05,
      saturation: 1.1,
      vignetteStrength: 0.15,
      whiteBalanceShift: 0.05,
      luminanceGamma: 1.0,
    });
  });

  it('cinema：微冷、高对比、深暗角、饱和度下降', () => {
    expect(PRESET_GRADE.cinema).toEqual({
      temperature: -0.05,
      contrast: 1.15,
      saturation: 0.9,
      vignetteStrength: 0.4,
      whiteBalanceShift: -0.1,
      luminanceGamma: 0.9,
    });
  });

  it('reading：暖色、适度对比、饱和度略提', () => {
    expect(PRESET_GRADE.reading).toEqual({
      temperature: 0.15,
      contrast: 1.1,
      saturation: 1.05,
      vignetteStrength: 0.2,
      whiteBalanceShift: 0.08,
      luminanceGamma: 1.0,
    });
  });
});
