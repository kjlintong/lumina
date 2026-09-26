/**
 * @vitest-environment jsdom
 *
 * Godrays volumetric light module tests.
 *
 * 测试范围：
 * - shader 代码完整性
 * - GodraysPass 设置更新
 * - DEFAULT_GODRAYS 常量
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_GODRAYS, godraysShader } from '../godrays.js';

// Note: GodraysPass extends ShaderPass which needs WebGL for full constructor.
// We test the shader definition and settings interface only.

describe('DEFAULT_GODRAYS', () => {
  it('has expected defaults', () => {
    expect(DEFAULT_GODRAYS).toEqual({
      density: 0.2,
      decay: 2.0,
      weight: 1.0,
      screenRadius: 1.0,
      sampleCount: 24,
      enabled: true,
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
