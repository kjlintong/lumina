/**
 * RenderBackend 抽象层（P1 核心；P26a 后单后端）
 *
 * P26a 起锁定 WebGL2 单后端，业务层必须通过本抽象访问渲染器，
 * 不得直接 import WebGLRenderer。
 *
 * 架构依据：docs/00-p0-version-verification.md §2；冻结决策见
 * docs/p26a-phase0-engineering-spec.md §2.1。
 */

import type { Scene, Camera } from 'three';
import type { WebGLRenderer } from 'three';
import { averageLuminanceFromRGBA } from './luminance.js';
import { PostProcessing } from './postProcessing.js';
import type { BloomSettings } from './postProcessing.js';
import type { GodraysSettings } from './godrays.js';

/** 后端类型标识（P26a 后为字面量，保留联合类型以便接口签名兼容） */
export type BackendType = 'webgl2';

/** 渲染后端能力声明 */
export interface BackendCapabilities {
  /** 是否支持 IES 配光（当前恒 false：IES 走 iesParser + spot 纹理近似路径） */
  supportsIES: boolean;
  /** 是否支持 Godrays 体积光（依赖 EffectComposer 后处理链） */
  supportsGodrays: boolean;
  /** 是否支持后处理 EffectComposer（依赖 enablePostProcessing） */
  supportsEffectComposer: boolean;
  /** 色调映射算法 */
  toneMapping: 'ACESFilmic';
  /** 是否支持阴影 */
  supportsShadows: boolean;
}

/** 后端选项 */
export interface BackendOptions {
  /** Canvas 元素 */
  canvas: HTMLCanvasElement;
  /** 设备像素比上限（默认 2，移动端可降） */
  maxPixelRatio?: number;
  /** 初始分辨率 */
  width?: number;
  height?: number;
  /** 是否启用后处理管线（EffectComposer + UnrealBloomPass + OutputPass），默认 true */
  enablePostProcessing?: boolean;
}

/** 后端创建结果 */
export interface BackendResult {
  backend: RenderBackend;
  capabilities: BackendCapabilities;
}

/**
 * 渲染后端接口。
 * 所有业务代码通过此接口与渲染器交互。
 */
export interface RenderBackend {
  readonly type: BackendType;
  readonly canvas: HTMLCanvasElement;
  readonly capabilities: BackendCapabilities;

  /** 获取底层渲染器实例（用于需要访问 Three.js 特定 API 的场景） */
  getRenderer(): WebGLRenderer;

  /** 渲染一帧 */
  render(scene: Scene, camera: Camera): void;

  /** 更新画布大小 */
  resize(width: number, height: number): void;

  /** 设置曝光值（用于眼适应自动曝光） */
  setExposure(value: number): void;

  /** 获取当前曝光值 */
  getExposure(): number;

  /** 设置色调映射曝光（Three.js 原生曝光） */
  setToneMappingExposure(value: number): void;

  /** 获取当前色调映射曝光 */
  getToneMappingExposure(): number;

  /**
   * 采样上一帧渲染的平均亮度（线性空间 0-1），供眼适应自动曝光使用。
   *
   * 仅 WebGL2 路径实现：渲染到 16×16 临时 render target 后
   * `readRenderTargetPixels` 同步回读，`averageLuminanceFromRGBA` 求平均。
   *
   * 引擎构造时检测此方法存在才 `setSampler`；不存在则 autoExposure 自然
   * 不采样，曝光保持初始值 1.0。
   */
  getAverageLuminance?(): number;

  /** 设置阴影使能 */
  setShadows(enabled: boolean): void;

  /** 设置色调映射（当前仅 ACESFilmic） */
  setToneMapping(type: 'ACESFilmic'): void;

  /** 设置 Bloom 后处理参数（依赖 EffectComposer） */
  setBloom?(strength: number, radius: number, threshold: number): void;

  /** 获取当前 Bloom 参数 */
  getBloom?(): BloomSettings | undefined;

  /** 设置 Godrays 体积光参数（依赖 EffectComposer） */
  setGodrays?(partial: Partial<GodraysSettings>): void;

  /** 获取当前 Godrays 参数 */
  getGodrays?(): GodraysSettings | undefined;

  /**
   * 设置 Godrays 光源屏幕位置（UV 0–1）。
   */
  setGodraysLightPosition?(x: number, y: number): void;

  /** 获取当前 Godrays 光源屏幕位置 */
  getGodraysLightPosition?(): { x: number; y: number } | undefined;

  /** 释放后端资源 */
  dispose(): void;
}

/**
 * 创建渲染后端。P26a 起锁定 WebGL2 单后端。
 */
export async function createBackend(options: BackendOptions): Promise<BackendResult> {
  const canvas = options.canvas;
  const width = options.width ?? (canvas.clientWidth || 800);
  const height = options.height ?? (canvas.clientHeight || 600);
  const maxPixelRatio = options.maxPixelRatio ?? 2;

  const {
    WebGLRenderer,
    ACESFilmicToneMapping,
    NoToneMapping,
    PCFSoftShadowMap,
    WebGLRenderTarget,
    HalfFloatType,
  } = await import('three');
  const webglRenderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  webglRenderer.setSize(width, height, false);
  webglRenderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
  webglRenderer.toneMapping = ACESFilmicToneMapping;
  webglRenderer.toneMappingExposure = 1.0;
  webglRenderer.shadowMap.enabled = true;
  webglRenderer.shadowMap.type = PCFSoftShadowMap;

  // 后处理管线（EffectComposer + UnrealBloomPass + OutputPass）
  const enablePost = options.enablePostProcessing ?? true;
  const postProcessing = enablePost
    ? new PostProcessing(webglRenderer, {
        // P9 交付物 4：与 PostProcessing 构造器默认值同步（0.22 / 0.3 / 0.85）。
        // 旧 0.35 / 0.4 配合 1.4m 太阳圆盘把整面窗洞糊白。
        strength: 0.22,
        radius: 0.3,
        threshold: 0.85,
      })
    : null;

  const capabilities: BackendCapabilities = {
    supportsIES: false,
    supportsGodrays: enablePost,
    supportsEffectComposer: enablePost,
    toneMapping: 'ACESFilmic',
    supportsShadows: true,
  };

  // 自动曝光采样：渲染到 16×16 临时 RT 后 readRenderTargetPixels 回读。
  // 16×16 = 256 像素，足够代表全屏平均亮度，单次回读代价可忽略。
  // 不启用深度/模板缓冲（亮度采样不需要，省带宽）。
  //
  // P9 根因 A：RT 用 HalfFloatType（HDR）而不是 UnsignedByteType ——
  // 8-bit 会把暗部 clamp 成 0 字节，且与输出链的色彩空间不一致，
  // 导致 averageLuminanceFromRGBA 恒返回 0、自动曝光整条链路死掉。
  // HalfFloat 保留暗部细节；采样时临时关闭色调映射（见下方 getAverageLuminance），
  // 回读到的是线性 HDR 值，符合本模块注释里「线性空间」的约定。
  const SAMPLE_SIZE = 16;
  const sampleRT = new WebGLRenderTarget(SAMPLE_SIZE, SAMPLE_SIZE, {
    type: HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  const sampleBuffer = new Uint16Array(SAMPLE_SIZE * SAMPLE_SIZE * 4);

  // 缓存最近一次 render 的 scene/camera，供采样时二次渲染到 RT
  let lastScene: Scene | null = null;
  let lastCamera: Camera | null = null;

  const backend: RenderBackend = {
    type: 'webgl2',
    canvas,
    capabilities,
    getRenderer: () => webglRenderer,
    render: (scene: Scene, camera: Camera) => {
      lastScene = scene;
      lastCamera = camera;
      if (postProcessing) {
        postProcessing.render(scene, camera);
      } else {
        webglRenderer.render(scene, camera);
      }
    },
    resize: (w: number, h: number) => {
      webglRenderer.setSize(w, h, false);
      postProcessing?.resize(w, h);
    },
    setExposure: (v: number) => {
      webglRenderer.toneMappingExposure = v;
    },
    getExposure: () => webglRenderer.toneMappingExposure,
    setToneMappingExposure: (v: number) => {
      webglRenderer.toneMappingExposure = v;
    },
    getToneMappingExposure: () => webglRenderer.toneMappingExposure,
    getAverageLuminance: () => {
      if (!lastScene || !lastCamera) return 0;
      // 渲染当前场景到 16×16 RT 后回读。
      // P9 根因 A 关键修复：**采样期间临时关闭色调映射**。
      // 采样 RT 是 HalfFloatType（HDR），我们要的是**线性 HDR 值**，
      // 若 ACES 仍在生效，返回的是已被压亮的显示色，会污染曝光反馈环路。
      // 采样完立即还原，不影响正常渲染与后处理链。
      const prevToneMapping = webglRenderer.toneMapping;
      const prevTarget = webglRenderer.getRenderTarget();
      webglRenderer.toneMapping = NoToneMapping;
      webglRenderer.setRenderTarget(sampleRT);
      webglRenderer.render(lastScene, lastCamera);
      webglRenderer.readRenderTargetPixels(
        sampleRT,
        0,
        0,
        SAMPLE_SIZE,
        SAMPLE_SIZE,
        sampleBuffer,
      );
      webglRenderer.setRenderTarget(prevTarget);
      webglRenderer.toneMapping = prevToneMapping;
      return averageLuminanceFromRGBA(sampleBuffer);
    },
    setShadows: (enabled: boolean) => {
      webglRenderer.shadowMap.enabled = enabled;
    },
    setToneMapping: (_type: 'ACESFilmic') => {
      // 已设置
    },
    setBloom: (strength, radius, threshold) => {
      postProcessing?.setBloom(strength, radius, threshold);
    },
    getBloom: () => postProcessing?.getBloom(),
    setGodrays: (partial) => {
      postProcessing?.setGodrays(partial);
    },
    getGodrays: () => postProcessing?.getGodrays(),
    setGodraysLightPosition: (x, y) => {
      postProcessing?.setGodraysLightPosition(x, y);
    },
    getGodraysLightPosition: () => postProcessing?.getGodraysLightPosition() ?? undefined,
    dispose: () => {
      sampleRT.dispose();
      postProcessing?.dispose();
      webglRenderer.dispose();
    },
  };

  return {
    backend,
    capabilities,
  };
}
