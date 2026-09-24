/**
 * 眼适应自动曝光（P1）
 *
 * Three.js r186 无内置自动曝光。本模块实现采样回调接口，
 * 由各后端插自己的回读机制：
 * - WebGL2: readRenderTargetPixels
 * - WebGPU: compute pass / 回读 buffer
 *
 * 算法（docs/00-p0-version-verification.md §7）：
 * 1. 16×16 降采样求平均亮度
 * 2. log2 编码到 RGBA8
 * 3. 每 18 帧回读一次
 * 4. 目标曝光 = 0.17 / 平均亮度
 * 5. 指数平滑过渡
 *
 * 架构依据：工程方案 §5.4
 */

/** 自动曝光采样接口 */
export interface ExposureSampler {
  /** 获取平均亮度（线性空间，0-1） */
  getAverageLuminance(): number;
}

/** 自动曝光配置 */
export interface AutoExposureConfig {
  /** 采样间隔（帧数），默认 18 */
  sampleInterval?: number;
  /** 最大曝光值 */
  maxExposure?: number;
  /** 最小曝光值 */
  minExposure?: number;
  /** 目标亮度（0-1），默认 0.17 */
  targetLuminance?: number;
  /** 平滑速度（0-1，越大越快），默认 0.05 */
  speed?: number;
  /** 是否启用 */
  enabled?: boolean;
}

/** 自动曝光控制器 */
export class AutoExposure {
  private config: Required<AutoExposureConfig>;
  private currentExposure: number;
  private targetExposure: number;
  private frameCount = 0;
  private sampler: ExposureSampler | null = null;

  constructor(config: AutoExposureConfig = {}) {
    this.config = {
      sampleInterval: config.sampleInterval ?? 18,
      maxExposure: config.maxExposure ?? 8,
      minExposure: config.minExposure ?? 0.01,
      targetLuminance: config.targetLuminance ?? 0.17,
      speed: config.speed ?? 0.05,
      enabled: config.enabled ?? true,
    };
    this.currentExposure = 1.0;
    this.targetExposure = 1.0;
  }

  /** 设置亮度采样器 */
  setSampler(sampler: ExposureSampler): void {
    this.sampler = sampler;
  }

  /** 清除采样器 */
  clearSampler(): void {
    this.sampler = null;
  }

  /** 每帧调用，返回当前曝光值 */
  update(): number {
    this.frameCount++;

    if (this.config.enabled && this.sampler && this.frameCount % this.config.sampleInterval === 0) {
      const luminance = this.sampler.getAverageLuminance();
      // 避免除零
      const safeLuminance = Math.max(luminance, 1e-6);
      this.targetExposure = Math.min(
        Math.max(this.config.targetLuminance / safeLuminance, this.config.minExposure),
        this.config.maxExposure,
      );
    }

    // 指数平滑
    const alpha = this.config.speed;
    this.currentExposure = (1 - alpha) * this.currentExposure + alpha * this.targetExposure;

    return this.currentExposure;
  }

  /** 获取当前曝光值 */
  getExposure(): number {
    return this.currentExposure;
  }

  /** 设置曝光值（手动覆盖） */
  setExposure(value: number): void {
    this.currentExposure = Math.min(Math.max(value, this.config.minExposure), this.config.maxExposure);
    this.targetExposure = this.currentExposure;
  }

  /** 重置到默认值 */
  reset(): void {
    this.currentExposure = 1.0;
    this.targetExposure = 1.0;
    this.frameCount = 0;
  }

  /** 获取配置 */
  getConfig(): Readonly<Required<AutoExposureConfig>> {
    return { ...this.config };
  }
}
