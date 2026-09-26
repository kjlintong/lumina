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
  /** 光晕强度（0-2），默认 0.22（P9 从 0.35 收敛：不再把整面窗洞糊白） */
  strength?: number;
  /** 光晕半径（0-1），默认 0.3（P9 从 0.4 收敛） */
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
      // P9 交付物 4：strength 0.35 → 0.22、radius 0.4 → 0.3。
      // 旧值配合 1.4m 太阳圆盘会让 bloom 把整面窗洞糊成白光；
      // 收敛后太阳圆盘与灯罩仍被抓到（threshold 0.85 保留），但不蔓延全屏。
      config.strength ?? 0.22,
      config.radius ?? 0.3,
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
   * P9 性能：godrays 深度走**独立的半分辨率 godraysRT**，不再用 composer RT。
   *
   * 旧实现的问题不是「双渲染」本身，而是 godraysRT 用**全分辨率** +
   * `UnsignedShortType` 渲染一次完整场景（含全部阴影贴图），
   * 叠加 composer 那次渲染，是 5 FPS 的主要来源之一。
   * 现在把 godraysRT 降到半分辨率：深度采样精度对体积光足够，
   * 但渲染代价降到约 1/4。
   *
   * 为什么不用 composer.renderTarget1.depthTexture：标准
   * WebGLRenderTarget 只有 depth buffer（供 Z 测试），没有
   * `depthTexture` 附件；要暴露深度必须显式挂 `DepthTexture`
   * 并处理 MSAA resolve，成本高于半分辨率方案，见交付物 3 兜底选择。
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

  /** 创建（或重建）Godrays 深度 RT。
   *
   * P9 交付物 3 **兜底路径**：RT 与 DepthTexture 都用**半分辨率**
   * （`width/2 × height/2`）。
   *
   * 选这条路的原因：复用 composer RT 深度需要给标准 WebGLRenderTarget 显式挂
   * `depthTexture` 附件并处理 MSAA resolve —— 标准 RT 只有 depth buffer（供 Z
   * 测试），没有可采样的 `depthTexture`。这条改造成本高、坑多（MSAA resolve
   * 时序、pass 顺序耦合），而半分辨率对 godrays 的深度采样精度足够
   * （体积光本身是低频信号），渲染代价降到约 1/4。见规格交付物 3。
   */
  private _recreateGodraysRT(width: number, height: number): void {
    this.godraysRT?.dispose();
    const w = Math.max(1, Math.floor(width / 2));
    const h = Math.max(1, Math.floor(height / 2));
    this.godraysRT = new WebGLRenderTarget(w, h, {
      type: UnsignedShortType,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture: new DepthTexture(w, h, UnsignedShortType),
    });
  }

  /** 释放 GPU 资源 */
  dispose(): void {
    this.godraysRT?.dispose();
    this.godraysRT = null;
    this.composer.dispose();
  }
}
