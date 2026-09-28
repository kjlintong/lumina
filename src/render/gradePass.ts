/**
 * 参数化后期调色 Pass（Phase 2 §2，P35）。
 *
 * 参数属于系统，不属于场景——按 SceneDefinition.grade 切换。
 * 跨预设平滑插值走 sceneController.tick 的 easeInOut 通道（与 levels/cct 同批）。
 *
 * 6 个参数：
 *   - temperature        （-1 冷 .. 1 暖），默认 0
 *   - contrast           （0..2，1 = 无变化），默认 1
 *   - saturation         （0..2，1 = 无变化），默认 1
 *   - vignetteStrength   （0..1），默认 0.15
 *   - whiteBalanceShift  （-1 蓝 .. 1 红），默认 0
 *   - luminanceGamma     （0.5..2，1 = 无变化），默认 1
 *
 * 位置：EffectComposer 链**末尾**（OutputPass 之后）。
 * 与 ShaderPass 不同：OutputPass 之后没有需要渲染到另一张 RT 的下一个 pass，
 * 因此本 Pass 显式处理 renderToScreen——写回 readBuffer 时交给
 * EffectComposer 的 swapBuffers 转到 writeBuffer。
 */
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { GradeParams } from '../core/types.js';

export type { GradeParams };

export const DEFAULT_GRADE: GradeParams = {
  temperature: 0,
  contrast: 1,
  saturation: 1,
  vignetteStrength: 0.15,
  whiteBalanceShift: 0,
  luminanceGamma: 1,
};

/**
 * 场景预设 → 调色参数（P35）。
 *   - reception（会客）：暖调、略加饱和与对比，营造「明亮待客」
 *   - cinema   （观影）：微冷、高对比、深暗角、饱和度下降，压暗背景
 *   - reading  （阅读）：暖色、适度对比、饱和度略提，桌面阅读舒适
 */
export const PRESET_GRADE: Record<'reception' | 'cinema' | 'reading', GradeParams> = {
  reception: {
    temperature: 0.1,
    contrast: 1.05,
    saturation: 1.1,
    vignetteStrength: 0.15,
    whiteBalanceShift: 0.05,
    luminanceGamma: 1.0,
  },
  cinema: {
    temperature: -0.05,
    contrast: 1.15,
    saturation: 0.9,
    vignetteStrength: 0.4,
    whiteBalanceShift: -0.1,
    luminanceGamma: 0.9,
  },
  reading: {
    temperature: 0.15,
    contrast: 1.1,
    saturation: 1.05,
    vignetteStrength: 0.2,
    whiteBalanceShift: 0.08,
    luminanceGamma: 1.0,
  },
};

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uTemperature;
  uniform float uContrast;
  uniform float uSaturation;
  uniform float uVignette;
  uniform float uWhiteBalance;
  uniform float uGamma;
  varying vec2 vUv;

  vec3 applyTemperature(vec3 c, float t) {
    c.r += t * 0.15;
    c.b -= t * 0.15;
    return c;
  }

  vec3 applyContrast(vec3 c, float k) {
    return clamp((c - 0.5) * k + 0.5, 0.0, 1.0);
  }

  vec3 applySaturation(vec3 c, float k) {
    float g = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return mix(vec3(g), c, k);
  }

  void main() {
    vec4 tex = texture2D(tDiffuse, vUv);
    vec3 c = tex.rgb;
    c = applyTemperature(c, uTemperature);
    c = applyContrast(c, uContrast);
    c = applySaturation(c, uSaturation);
    c = mix(c * vec3(0.85, 0.9, 1.15), c * vec3(1.15, 0.95, 0.85), uWhiteBalance * 0.5 + 0.5);
    c = pow(c, vec3(uGamma));
    vec2 d = vUv - 0.5;
    float vig = 1.0 - uVignette * dot(d, d) * 4.0;
    c *= clamp(vig, 0.0, 1.0);
    gl_FragColor = vec4(c, tex.a);
  }
`;

/**
 * 读取 uniform 的 value。
 * ShaderMaterial.uniforms 是索引签名，strict 模式下直接返回 IUniform | undefined；
 * 统一封装一个 setter 简化调用。
 */
function setUniform(material: THREE.ShaderMaterial, key: string, value: number): void {
  const u = material.uniforms[key];
  if (u) u.value = value;
}

export class GradePass extends Pass {
  material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      tDiffuse: { value: null as THREE.Texture | null },
      uTemperature: { value: DEFAULT_GRADE.temperature },
      uContrast: { value: DEFAULT_GRADE.contrast },
      uSaturation: { value: DEFAULT_GRADE.saturation },
      uVignette: { value: DEFAULT_GRADE.vignetteStrength },
      uWhiteBalance: { value: DEFAULT_GRADE.whiteBalanceShift },
      uGamma: { value: DEFAULT_GRADE.luminanceGamma },
    },
  });

  private quad = new FullScreenQuad(this.material);

  params: GradeParams = { ...DEFAULT_GRADE };

  setParams(p: Partial<GradeParams>): void {
    Object.assign(this.params, p);
    setUniform(this.material, 'uTemperature', this.params.temperature);
    setUniform(this.material, 'uContrast', this.params.contrast);
    setUniform(this.material, 'uSaturation', this.params.saturation);
    setUniform(this.material, 'uVignette', this.params.vignetteStrength);
    setUniform(this.material, 'uWhiteBalance', this.params.whiteBalanceShift);
    setUniform(this.material, 'uGamma', this.params.luminanceGamma);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    _writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    _deltaTime: number,
    _maskActive: boolean,
  ): void {
    const tDiffuse = this.material.uniforms.tDiffuse;
    if (tDiffuse) tDiffuse.value = readBuffer.texture;

    if (this.renderToScreen) {
      // 链末：直接渲染到屏幕
      renderer.setRenderTarget(null);
      this.quad.render(renderer);
    } else {
      // 非链末：写回 readBuffer（EffectComposer 会在 pass 结束后 swapBuffers）
      renderer.setRenderTarget(readBuffer);
      this.quad.render(renderer);
    }
  }

  override dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}

/** 用于场景预设之间的 lerp（sceneController.tick 复用） */
export function lerpGrade(a: GradeParams, b: GradeParams, t: number): GradeParams {
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return {
    temperature: lerp(a.temperature, b.temperature),
    contrast: lerp(a.contrast, b.contrast),
    saturation: lerp(a.saturation, b.saturation),
    vignetteStrength: lerp(a.vignetteStrength, b.vignetteStrength),
    whiteBalanceShift: lerp(a.whiteBalanceShift, b.whiteBalanceShift),
    luminanceGamma: lerp(a.luminanceGamma, b.luminanceGamma),
  };
}
