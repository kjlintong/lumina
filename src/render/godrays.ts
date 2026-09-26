/**
 * P7 — Godrays volumetric light scattering.
 *
 * 经典"光线行进"（Ray Marching）法：从光源向屏幕逐像素投射线段，
 * 在采样处检查深度遮挡，被遮挡处散射光照，逐段累积。
 *
 * 技术要点：
 * - 需要 scene 的 depth texture（通过 renderer.render 到带深度的 RT 获取）
 * - 屏幕空间光线行进（从光位置向相机方向采样）
 * - 散射强度随距离衰减（exponential decay）
 * - 支持可调密度、衰减、质量参数
 *
 * 用法（通过 EffectComposer 的 ShaderPass 集成）：
 * ```ts
 * const pass = new GodraysPass();
 * composer.addPass(pass);
 * pass.setLightScreenPosition(0.5, 0.8);
 * pass.setDensity(0.3);
 * ```
 */
import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export interface GodraysSettings {
  /** 散射密度（0–1，越大越浓） */
  density: number;
  /** 衰减系数（0–10，越大消散越快） */
  decay: number;
  /** 强度权重（0–10） */
  weight: number;
  /** 光晕半径（0–2） */
  screenRadius: number;
  /** 采样数（4–64，越高越精细但越慢） */
  sampleCount: number;
  /** 是否启用 */
  enabled: boolean;
  /**
   * P9b：整体亮度放大倍数。godrays 输出通常 0.05–0.2，远低于 bloom threshold
   * 0.85；乘以 uBoost 后能被 bloom 抓到，光柱才有可见辉光。默认 3.0。
   */
  boost: number;
}

export const DEFAULT_GODRAYS: GodraysSettings = {
  // P9b：0.2 → 0.5。让 godrays 散射量级从「几乎看不见」提到「肉眼可辨」。
  density: 0.5,
  decay: 2.0,
  // P9b：1.0 → 2.0。配合 density 让总散射量级翻倍。
  weight: 2.0,
  screenRadius: 1.0,
  // P9 交付物 3 兜底：24 → 16。godraysRT 已降到半分辨率，sampleCount 再降一档
  // 进一步压低每帧 ray-marching 成本（配合 5-8 FPS → 30+ 的目标）。
  // 注意：下方 godraysShader.uniforms.sampleCount.value 必须同步改同一字面量，
  // 两处各写一份会静默漂移（uniform 初始值与本常量不一致）。
  sampleCount: 16,
  enabled: true,
  // P9b：新字段。见 GodraysSettings.boost 注释。
  boost: 3.0,
};

/** Godrays volumetric light shader */
export const godraysShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    lightPos: { value: new THREE.Vector4(0, 0, 0, 1) },
    density: { value: 0.5 },
    decay: { value: 2.0 },
    weight: { value: 2.0 },
    screenRadius: { value: 1.0 },
    sampleCount: { value: 16 },
    // P9b：整体亮度放大倍数。见 DEFAULT_GODRAYS.boost 注释。
    boost: { value: 3.0 },
  },

  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec4 lightPos;
    uniform float density;
    uniform float decay;
    uniform float weight;
    uniform float screenRadius;
    uniform float sampleCount;
    // P9b：整体亮度放大倍数，让 godrays 输出能被 bloom 抓到。
    uniform float boost;
    varying vec2 vUv;

    void main() {
      // Read scene color
      vec4 color = texture2D(tDiffuse, vUv);

      // Read depth
      float depth = texture2D(tDepth, vUv).r;
      if (depth >= 1.0) {
        gl_FragColor = color;
        return;
      }

      // Light position in screen space (UV)
      vec2 lightScreen = lightPos.xy;

      // Camera position (pixel being rendered)
      vec2 cameraPos = vUv;

      // Ray direction from light to camera
      vec2 dir = cameraPos - lightScreen;
      float dist = length(dir);
      if (dist < 0.001) {
        gl_FragColor = color;
        return;
      }
      dir /= dist;

      float totalLight = 0.0;
      float stepSize = dist / float(sampleCount);

      for (int i = 0; i < 64; i++) {
        if (i >= int(sampleCount)) break;

        float t = float(i) * stepSize;
        vec2 samplePos = lightScreen + dir * t;

        // Boundary check
        if (samplePos.x < 0.0 || samplePos.x > 1.0 || samplePos.y < 0.0 || samplePos.y > 1.0) {
          continue;
        }

        // Sample depth at this position
        float sampleDepth = texture2D(tDepth, samplePos).r;
        if (sampleDepth >= 1.0) continue;

        // Depth difference (occlusion check)
        float depthDiff = depth - sampleDepth;
        if (depthDiff < 0.0) continue;

        // Scattering: depth diff modulated by density and weight
        float scatter = depthDiff * density * weight;

        // Distance falloff (exponential)
        float falloff = exp(-t * decay * 2.0);

        // Screen radius falloff (soft light edge)
        float radiusDist = length((samplePos - lightScreen) / max(screenRadius, 0.01));
        float radiusFalloff = 1.0 - smoothstep(0.3, 1.0, radiusDist);

        totalLight += scatter * falloff * radiusFalloff;
      }

      // P9b：加 uBoost 放大。godrays 输出通常 0.05–0.2，远低于 bloom threshold
      // 0.85；乘以 3.0 后能进 bloom，光柱才有可见辉光。clamp 到 0–1 防溢出。
      float volumetric = clamp(totalLight * boost, 0.0, 1.0);
      gl_FragColor = vec4(color.rgb + volumetric * 0.5, color.a);
    }
  `,
};

/**
 * Godrays shader pass for EffectComposer.
 *
 * 继承 ShaderPass，提供光源位置、深度纹理、参数设置接口。
 */
export class GodraysPass extends ShaderPass {
  private _lightPosition = new THREE.Vector4(0.5, 0.8, 0, 1);
  private _depthTexture: THREE.Texture | null = null;
  private _settings: GodraysSettings;

  constructor() {
    super(godraysShader);
    this._settings = { ...DEFAULT_GODRAYS };
    this._updateUniforms();
  }

  get settings(): GodraysSettings {
    return this._settings;
  }

  get lightPosition(): THREE.Vector4 {
    return this._lightPosition;
  }

  /** 设置光源屏幕空间位置 (UV 0–1) */
  setLightScreenPosition(x: number, y: number): void {
    this._lightPosition.set(x, y, 0, 1);
    this._updateUniforms();
  }

  /** 设置深度纹理 */
  setDepthTexture(texture: THREE.Texture | null): void {
    this._depthTexture = texture;
    this._updateUniforms();
  }

  /** 更新参数 */
  setSettings(partial: Partial<GodraysSettings>): void {
    this._settings = { ...this._settings, ...partial };
    this._updateUniforms();
    this.enabled = this._settings.enabled;
  }

  private _updateUniforms(): void {
    const u = this.uniforms;
    if (u.lightPos) (u.lightPos as { value: THREE.Vector4 }).value = this._lightPosition;
    if (u.density) (u.density as { value: number }).value = this._settings.density;
    if (u.decay) (u.decay as { value: number }).value = this._settings.decay;
    if (u.weight) (u.weight as { value: number }).value = this._settings.weight;
    if (u.screenRadius) (u.screenRadius as { value: number }).value = this._settings.screenRadius;
    if (u.sampleCount) (u.sampleCount as { value: number }).value = this._settings.sampleCount;
    if (u.tDepth) (u.tDepth as { value: THREE.Texture | null }).value = this._depthTexture;
    // P9b：新增。boost 与 GLSL uniform `boost` 同名。
    if (u.boost) (u.boost as { value: number }).value = this._settings.boost;
  }
}
