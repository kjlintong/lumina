/**
 * @vitest-environment jsdom
 *
 * Godrays volumetric light module tests.
 *
 * 测试范围：
 * - DEFAULT_GODRAYS 常量
 * - godraysShader 定义完整性
 * - GodraysPass 设置/位置/深度纹理与 uniform 的同步
 *
 * 注：GodraysPass 继承 ShaderPass，jsdom 下可构造（不依赖真实 WebGL）。
 * PostProcessing 类因构造 EffectComposer/WebGLRenderTarget 需要真实 WebGL，
 * 其深度 RT 生命周期（resize/enabled 切换）不在 jsdom 覆盖范围内。
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  DEFAULT_GODRAYS,
  GodraysPass,
  godraysShader,
} from '../godrays.js';

/** Strict-mode accessor: uniforms index signature returns `Uniform | undefined`. */
function u(p: GodraysPass, key: string): unknown {
  const v = p.uniforms[key];
  expect(v, `uniform ${key} must exist`).toBeDefined();
  return (v as { value: unknown }).value;
}

describe('DEFAULT_GODRAYS', () => {
  it('has expected defaults', () => {
    expect(DEFAULT_GODRAYS).toEqual({
      // P9b：density 0.2 → 0.5、weight 1.0 → 2.0、新增 boost 3.0。
      // 让 godrays 输出量级能被 bloom threshold 0.85 抓到（详见 godrays.ts 注释）。
      density: 0.5,
      decay: 2.0,
      weight: 2.0,
      screenRadius: 1.0,
      sampleCount: 16,
      enabled: true,
      boost: 3.0,
    });
  });
});

describe('godraysShader', () => {
  it('has all required uniforms', () => {
    const uniforms = godraysShader.uniforms;
    expect(uniforms.tDiffuse).toBeDefined();
    expect(uniforms.tDepth).toBeDefined();
    expect(uniforms.lightPos).toBeDefined();
    expect(uniforms.density).toBeDefined();
    expect(uniforms.decay).toBeDefined();
    expect(uniforms.weight).toBeDefined();
    expect(uniforms.screenRadius).toBeDefined();
    expect(uniforms.sampleCount).toBeDefined();
  });

  it('lightPos is a Vector4', () => {
    expect(godraysShader.uniforms.lightPos.value).toBeInstanceOf(THREE.Vector4);
  });

  it('has valid vertex shader', () => {
    expect(godraysShader.vertexShader).toContain('vUv');
    expect(godraysShader.vertexShader).toContain('projectionMatrix');
  });

  it('has valid fragment shader', () => {
    expect(godraysShader.fragmentShader).toContain('tDiffuse');
    expect(godraysShader.fragmentShader).toContain('tDepth');
    expect(godraysShader.fragmentShader).toContain('lightPos');
    expect(godraysShader.fragmentShader).toContain('sampleCount');
    expect(godraysShader.fragmentShader).toContain('for (int i = 0; i < 64; i++)');
    expect(godraysShader.fragmentShader).toContain('exp(');
    expect(godraysShader.fragmentShader).toContain('smoothstep');
  });
});

describe('GodraysPass', () => {
  it('uniforms are initialized from DEFAULT_GODRAYS', () => {
    const p = new GodraysPass();
    expect(p.settings).toEqual(DEFAULT_GODRAYS);
    expect(u(p, 'density')).toBe(DEFAULT_GODRAYS.density);
    expect(u(p, 'decay')).toBe(DEFAULT_GODRAYS.decay);
    expect(u(p, 'weight')).toBe(DEFAULT_GODRAYS.weight);
    expect(u(p, 'sampleCount')).toBe(DEFAULT_GODRAYS.sampleCount);
  });

  it('setSettings syncs uniforms and enabled flag', () => {
    const p = new GodraysPass();
    p.setSettings({ density: 0.5, decay: 5.0, weight: 2.0, sampleCount: 8 });
    expect(p.settings).toEqual({
      density: 0.5,
      decay: 5.0,
      weight: 2.0,
      screenRadius: DEFAULT_GODRAYS.screenRadius,
      sampleCount: 8,
      enabled: DEFAULT_GODRAYS.enabled,
      // P9b：新字段，setSettings 未显式覆盖时保留 DEFAULT_GODRAYS 默认值 3.0。
      boost: DEFAULT_GODRAYS.boost,
    });
    expect(u(p, 'density')).toBe(0.5);
    expect(u(p, 'decay')).toBe(5.0);
    expect(u(p, 'weight')).toBe(2.0);
    expect(u(p, 'sampleCount')).toBe(8);
    // P9b：uBoost uniform 同步默认值
    expect(u(p, 'boost')).toBe(DEFAULT_GODRAYS.boost);
  });

  it('setSettings enabled toggle reflects on pass.enabled', () => {
    const p = new GodraysPass();
    expect(p.enabled).toBe(true);
    p.setSettings({ enabled: false });
    expect(p.enabled).toBe(false);
    p.setSettings({ enabled: true });
    expect(p.enabled).toBe(true);
  });

  it('setLightScreenPosition syncs uniform and lightPosition getter', () => {
    const p = new GodraysPass();
    p.setLightScreenPosition(0.3, 0.7);
    const lp = u(p, 'lightPos') as THREE.Vector4;
    expect(lp.x).toBe(0.3);
    expect(lp.y).toBe(0.7);
    expect(p.lightPosition.x).toBe(0.3);
    expect(p.lightPosition.y).toBe(0.7);
  });

  it('setDepthTexture syncs tDepth uniform and nullifies', () => {
    const p = new GodraysPass();
    const tex = new THREE.Texture();
    p.setDepthTexture(tex);
    expect(u(p, 'tDepth')).toBe(tex);
    p.setDepthTexture(null);
    expect(u(p, 'tDepth')).toBeNull();
  });
});
