/**
 * 后处理管线（WebGL2 专属，P7）
 *
 * 封装 Three.js EffectComposer，构建标准 bloom 管线：
 *   RenderPass → UnrealBloomPass → OutputPass
 *
 * 管线说明：
 * - EffectComposer 内部创建 HalfFloatType 渲染目标（HDR 管线），
 *   RenderPass 渲染场景到线性 HDR 缓冲（不应用色调映射）。
 * - UnrealBloomPass 在线性 HDR 空间提取高亮区域并模糊叠加，
 *   实现光晕效果。
 * - OutputPass 在末端应用 ACESFilmic 色调映射 + sRGB 色彩空间转换。
 *
 * 自动曝光（P5）与后处理互不干扰：
 * getAverageLuminance 直接渲染场景到独立 16×16 RT（不经过 composer），
 * 采样线性 HDR 值（非色调映射后值），符合自动曝光算法预期。
 *
 * 架构依据：
 * - docs/00-p0-version-verification.md §3（EffectComposer WebGL 专属）
 * - docs/P3-M1.6-spec.md 红线：业务层不得直接 import three/WebGLRenderer
 *
 * 注意：EffectComposer 硬编码 WebGLRenderTarget，不能与 WebGPURenderer 混用。
 * WebGPU 路径必须使用 TSL 自研 pass（见 GodraysNode 等）。
 */

import type { Camera, WebGLRenderer } from 'three';
import { PerspectiveCamera, Scene, Vector2 } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** Bloom 配置参数 */
export interface BloomConfig {
  /** 光晕强度（0-2），默认 0.35（微妙光晕，不喧宾夺主） */
  strength?: number;
  /** 光晕半径（0-1），默认 0.4（紧凑聚焦） */
  radius?: number;
  /** 亮度阈值（0-1），默认 0.85（仅最亮区域发光） */
  threshold?: number;
}

/** 光晕参数快照（用于 UI 展示与持久化） */
export interface BloomSettings {
  strength: number;
  radius: number;
  threshold: number;
}

/**
 * 后处理管线控制器。
 *
 * 内部维护 EffectComposer + 三个 Pass：
 *   RenderPass（场景渲染）→ UnrealBloomPass（光晕）→ OutputPass（色调映射）
 *
 * 每个渲染帧通过 render(scene, camera) 调用，
 * 场景和相机每帧更新（RenderPass 的属性为可变引用）。
 */
export class PostProcessing {
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private bloomPass: UnrealBloomPass;
  private outputPass: OutputPass;

  /**
   * 创建后处理管线。
   *
   * @param renderer WebGLRenderer 实例（必须是 WebGL2 后端）
   * @param config Bloom 配置（可选，使用默认值）
   */
  constructor(renderer: WebGLRenderer, config: BloomConfig = {}) {
    this.composer = new EffectComposer(renderer);

    // RenderPass 需要 scene/camera 参数（构造时传入占位符，
    // 实际值在 render() 中每帧更新）
    this.renderPass = new RenderPass(new Scene(), new PerspectiveCamera());

    this.bloomPass = new UnrealBloomPass(
      new Vector2(),
      config.strength ?? 0.35,
      config.radius ?? 0.4,
      config.threshold ?? 0.85,
    );

    this.outputPass = new OutputPass();

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);
  }

  /**
   * 渲染一帧（替代 backend.render 中的直接 renderer.render）。
   *
   * @param scene 当前场景
   * @param camera 当前相机
   */
  render(scene: Scene, camera: Camera): void {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.composer.render();
  }

  /**
   * 更新管线分辨率（窗口 resize 时调用）。
   *
   * @param width 逻辑宽度（CSS 像素）
   * @param height 逻辑高度（CSS 像素）
   */
  resize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  /**
   * 更新 Bloom 参数（运行时调节，不重建管线）。
   *
   * @param strength 光晕强度
   * @param radius 光晕半径
   * @param threshold 亮度阈值
   */
  setBloom(strength: number, radius: number, threshold: number): void {
    this.bloomPass.strength = strength;
    this.bloomPass.radius = radius;
    this.bloomPass.threshold = threshold;
  }

  /** 获取当前 Bloom 参数快照 */
  getBloom(): BloomSettings {
    return {
      strength: this.bloomPass.strength,
      radius: this.bloomPass.radius,
      threshold: this.bloomPass.threshold,
    };
  }

  /** 释放 GPU 资源（后处理管线不再使用时调用） */
  dispose(): void {
    this.composer.dispose();
  }
}
