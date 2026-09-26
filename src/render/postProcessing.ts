/**
 * 后处理管线（WebGL2 专属，P7）
 *
 * 封装 Three.js EffectComposer，构建标准管线：
 *   RenderPass → GodraysPass（体积光）→ UnrealBloomPass（光晕）→ OutputPass（色调映射）
 *
 * GodraysPass 需要场景深度纹理：
 *   render() 时先渲染场景到带 DepthTexture 的 RT，将深度纹理传递给 GodraysPass，
 *   再由 EffectComposer 正常渲染管线（RenderPass 内部再渲染一次场景到 composer RT）。
 *   多一次场景渲染是体积光的代价，但深度精度与正确性有保障。
 *
 * 自动曝光（P5）与后处理互不干扰：
 *   getAverageLuminance 直接渲染场景到独立 16×16 RT（不经过 composer），
 *   采样线性 HDR 值，符合自动曝光算法预期。
 *
 * 架构依据：
 *   - docs/00-p0-version-verification.md §3（EffectComposer WebGL 专属）
 *   - docs/P3-M1.6-spec.md 红线：业务层不得直接 import three/WebGLRenderer
 */

import type { Camera, WebGLRenderer } from 'three';
import {
  DepthTexture,
  PerspectiveCamera,
  Scene,
  UnsignedShortType,
  Vector2,
  WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { DEFAULT_GODRAYS, GodraysPass } from './godrays.js';
import type { GodraysSettings } from './godrays.js';

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
 * 内部维护 EffectComposer + GodraysPass + 三个 Pass：
 *   RenderPass → GodraysPass → UnrealBloomPass → OutputPass
 */
export class PostProcessing {
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private bloomPass: UnrealBloomPass;
  private outputPass: OutputPass;
  private godraysPass: GodraysPass;
  private godraysRT: WebGLRenderTarget | null;
  private _godraysSettings: GodraysSettings;
  private _renderer: WebGLRenderer;
  /** 最近一次 resize 的尺寸，供 enabled 切换时按需创建深度 RT */
  private _size = { w: 0, h: 0 };

  constructor(
    renderer: WebGLRenderer,
    config: BloomConfig = {},
    godraysConfig: Partial<GodraysSettings> = {},
  ) {
    this._renderer = renderer;
    this._godraysSettings = { ...DEFAULT_GODRAYS, ...godraysConfig };

    this.composer = new EffectComposer(renderer);

    this.renderPass = new RenderPass(new Scene(), new PerspectiveCamera());

    this.godraysPass = new GodraysPass();
    this.godraysPass.enabled = this._godraysSettings.enabled;
    this.godraysPass.setSettings(this._godraysSettings);

    this.bloomPass = new UnrealBloomPass(
      new Vector2(),
      config.strength ?? 0.35,
      config.radius ?? 0.4,
      config.threshold ?? 0.85,
    );

    this.outputPass = new OutputPass();

    // 管线顺序：RenderPass → Godrays → Bloom → Output
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.godraysPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);

    this.godraysRT = null;
  }

  /**
   * 渲染一帧。
   *
   * GodraysPass 启用时：先渲染场景到带深度 RT → 传递深度纹理 → composer.render()。
   * 禁用时：直接 composer.render()，零额外开销。
   */
  render(scene: Scene, camera: Camera): void {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;

    if (this._godraysSettings.enabled && this.godraysRT) {
      const prevRT = this._renderer.getRenderTarget();
      this._renderer.setRenderTarget(this.godraysRT);
      this._renderer.render(scene, camera);
      this._renderer.setRenderTarget(prevRT);

      if (this.godraysRT.depthTexture) {
        this.godraysPass.setDepthTexture(this.godraysRT.depthTexture);
      }
    }

    this.composer.render();
  }

  /** 更新管线分辨率 */
  resize(width: number, height: number): void {
    this._size = { w: width, h: height };
    this.composer.setSize(width, height);

    if (this._godraysSettings.enabled) {
      this._recreateGodraysRT(width, height);
    }
  }

  /** 更新 Bloom 参数 */
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

  /** 设置 Godrays 光源屏幕位置 (UV 0–1) */
  setGodraysLightPosition(x: number, y: number): void {
    this.godraysPass.setLightScreenPosition(x, y);
  }

  /** 获取当前 Godrays 光源屏幕位置 */
  getGodraysLightPosition(): { x: number; y: number } | null {
    const v = this.godraysPass.lightPosition;
    return { x: v.x, y: v.y };
  }

  /** 更新 Godrays 参数 */
  setGodrays(partial: Partial<GodraysSettings>): void {
    this._godraysSettings = { ...this._godraysSettings, ...partial };
    this.godraysPass.setSettings(this._godraysSettings);

    if (partial.enabled !== undefined) {
      if (partial.enabled && this._size.w > 0) {
        // 重新启用：用当前尺寸创建深度 RT（resize 可能尚未到来）
        this._recreateGodraysRT(this._size.w, this._size.h);
      } else if (!partial.enabled) {
        this.godraysRT?.dispose();
        this.godraysRT = null;
        this.godraysPass.setDepthTexture(null);
      }
    }
  }

  /** 获取 Godrays 参数快照 */
  getGodrays(): GodraysSettings {
    return { ...this._godraysSettings };
  }

  /** 创建（或重建）Godrays 深度 RT */
  private _recreateGodraysRT(width: number, height: number): void {
    this.godraysRT?.dispose();
    this.godraysRT = new WebGLRenderTarget(width, height, {
      type: UnsignedShortType,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture: new DepthTexture(width, height, UnsignedShortType),
    });
  }

  /** 释放 GPU 资源 */
  dispose(): void {
    this.godraysRT?.dispose();
    this.godraysRT = null;
    this.composer.dispose();
  }
}
