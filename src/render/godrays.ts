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
  /** 采样数（4–128，越高越精细但越慢） */
  sampleCount: number;
  /** 是否启用 */
  enabled: boolean;
  /**
   * P9b：整体亮度放大倍数。godrays 输出通常 0.05–0.2，远低于 bloom threshold
   * 0.85；乘以 uBoost 后能被 bloom 抓到，光柱才有可见辉光。默认 3.0。
   */
  boost: number;
  /**
   * P13：观感曝光乘数（规格 §4 f 的 `exposure 0.40`）。与 boost 分工——
   * boost 决定能否被 bloom 抓到，exposure 决定最终画面明暗。
   */
  exposure: number;
}

export const DEFAULT_GODRAYS: GodraysSettings = {
  // P13（依据 LUMINA 规格 §4 Day 2–3 f）：按规格定版，取代 P9b 的盲调值。
  // density 0.5 → 0.75：散射基准强度。
  density: 0.75,
  // decay 2.0 → 0.96：指数衰减系数。旧值 2.0 让 falloff 在 1.0 半径内就降到
  // exp(-1.96)≈0.14，光柱在窗内就被吃干净；0.96 让光在房间里持续更久。
  decay: 0.96,
  // weight 2.0 → 0.40：深度差的散射权重。
  weight: 0.40,
  screenRadius: 1.0,
  // P9 交付物 3 曾 24 → 16（半分辨率 godraysRT 下压成本）。P13 按规格回到 80。
  // 代价：每像素 80 次深度采样（旧 16 次），约 5×。中端 GPU 可承受；
  // 低端设备可手动调回 16，UI 滑块已暴露此参数。
  // 注意：下方 godraysShader.uniforms.sampleCount.value 必须同步改同一字面量，
  // 两处各写一份会静默漂移（uniform 初始值与本常量不一致）。
  sampleCount: 80,
  enabled: true,
  // P9b：整体亮度放大倍数，让 godrays 输出能被 bloom threshold 0.85 抓到。
  boost: 3.0,
  // P13 新增：规格 §4 f 的 `exposure 0.40`。与 boost 分工——
  // boost 是「能否被 bloom 抓到」的增益，exposure 是画面观感的乘数。
  // 加法式输出（见 shader）：volumetric = totalLight * boost * exposure，
  // 因此 exposure 0.40 会把 P9b 的 3.0×boost 结果压回 1.2×，配合新 decay 收敛。
  exposure: 0.40,
};

/** Godrays volumetric light shader */
export const godraysShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    lightPos: { value: new THREE.Vector4(0, 0, 0, 1) },
    density: { value: 0.75 },
    decay: { value: 0.96 },
    weight: { value: 0.40 },
    screenRadius: { value: 1.0 },
    sampleCount: { value: 80 },
    // P9b：整体亮度放大倍数。见 DEFAULT_GODRAYS.boost 注释。
    boost: { value: 3.0 },
    // P13：观感曝光乘数。见 DEFAULT_GODRAYS.exposure 注释。
    exposure: { value: 0.40 },
    // P13：帧号，供 shader 内做确定性 jitter（每帧相位不同，消除量化条带）。
    // 幅度是 shader 内的编译期常量 JITTER_AMP，故不在此声明 uniform。
    frame: { value: 0 },
  },

  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: `
    varying vec2 vUv;

    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec4 lightPos;
    uniform float density;
    uniform float decay;
    uniform float weight;
    uniform float screenRadius;
    uniform float sampleCount;
    // P9b：整体亮度放大倍数。见 DEFAULT_GODRAYS.boost 注释。
    uniform float boost;
    // P13：观感曝光乘数（规格 §4 f 的 exposure 0.40）。与 boost 分工。
    uniform float exposure;
    // P13：帧号，驱动下方 jitter 的相位。固定采样格点每帧采同一组点，80 个
    // 采样沿径向累积会出现周期性能量团（banding）；每帧相位微扰后能量团在帧
    // 间游移，被时间平均抹平。只传 frame 一个 uniform——幅度是编译期常量。
    uniform float frame;

    // P13：jitter 幅度（编译期常量，屏幕 UV 单位）。半分辨率 godraysRT 下
    // 0.004 UV ≈ 5px，约 stepSize 的一半，足以打破格点又不至于模糊光柱轮廓。
    const float JITTER_AMP = 0.004;

    // 确定性伪随机 [0,1)：同一 (frame, i) 必同值，跨像素稳定、跨帧变化。
    float hash(float n) {
      return fract(sin(n) * 43758.5453123);
    }

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

      // P13：上界 64 → 128，覆盖 sampleCount 80（旧 64 会静默截断成 64 采样）。
      for (int i = 0; i < 128; i++) {
        if (i >= int(sampleCount)) break;

        // P13：jitter（规格要求 80 samples + jitter）。相位随 frame 变化、幅度
        // 为编译期常量 JITTER_AMP。hash 返回 [0,1) 故 (h-0.5)*2 落在 [-0.5,0.5)，
        // 乘 JITTER_AMP 后落在 ±JITTER_AMP 内，单位与 t / screenRadius 同为屏幕 UV。
        // 每帧每采样点偏移都不同 → 打破固定采样格点，消除量化条带（banding）。
        float jitter = JITTER_AMP * (hash(frame * 17.0 + float(i) * 0.731) - 0.5) * 2.0;

        // t + jitter：沿采样方向微扰，打破固定格点。clamp 到 [0, dist] 防越界。
        float t = float(i) * stepSize + jitter;
        if (t < 0.0) t = 0.0;
        if (t > dist) t = dist;
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

      // P13：boost 与 exposure 分工。boost 负责「能否被 bloom 抓到」的增益，
      // exposure（规格 0.40）负责观感明暗。旧实现只有 boost 3.0 一个旋钮，
      // 想压暗就得动 boost，一动就掉出 bloom threshold —— 两个目标互相打架。
      // 加法式输出，clamp 到 0–1 防溢出。
      float volumetric = clamp(totalLight * boost * exposure, 0.0, 1.0);
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
    if (u.exposure) (u.exposure as { value: number }).value = this._settings.exposure;
  }

  /**
   * P13：设置帧号，驱动 shader 内的确定性 jitter。
   * postProcessing.render 每帧调用一次（frame + 1）。frame 不进
   * GodraysSettings（它不是用户可调参数，是逐帧递进值），故单列接口。
   */
  setFrame(frame: number): void {
    const u = this.uniforms;
    if (u.frame) (u.frame as { value: number }).value = frame;
  }
}
