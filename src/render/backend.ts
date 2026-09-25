/**
 * RenderBackend 抽象层（P1 核心）
 *
 * Three.js r186 把 WebGPURenderer 拆到 'three/webgpu' 独立 entry，
 * 主 'three' 入口不导出。业务层必须通过本抽象访问渲染器，
 * 不得直接 import WebGPURenderer 或 WebGLRenderer。
 *
 * 架构依据：docs/00-p0-version-verification.md §2
 */

import type { Scene, Camera } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { WebGLRenderer } from 'three';
import { averageLuminanceFromRGBA } from './luminance.js';

/** 后端类型标识 */
export type BackendType = 'webgpu' | 'webgl2';

/** 渲染后端能力声明 */
export interface BackendCapabilities {
  /** 是否支持 IES 配光（WebGPU: true，WebGL2: false → 近似路径） */
  supportsIES: boolean;
  /** 是否支持 GodraysNode 体积光（仅 WebGPU TSL 路径） */
  supportsGodrays: boolean;
  /** 是否支持后处理 EffectComposer（仅 WebGL2） */
  supportsEffectComposer: boolean;
  /** 色调映射算法 */
  toneMapping: 'ACESFilmic';
  /** 是否支持阴影 */
  supportsShadows: boolean;
}

/** 后端选项 */
export interface BackendOptions {
  /** 强制使用指定后端（测试用），默认自动检测 */
  forceBackend?: BackendType;
  /** Canvas 元素 */
  canvas: HTMLCanvasElement;
  /** 设备像素比上限（默认 2，移动端可降） */
  maxPixelRatio?: number;
  /** 初始分辨率 */
  width?: number;
  height?: number;
}

/** 后端创建结果 */
export interface BackendResult {
  backend: RenderBackend;
  capabilities: BackendCapabilities;
  /** 降级原因（用户可见）。无降级时为 undefined */
  degradationReason?: string;
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
  getRenderer(): WebGLRenderer | WebGPURenderer;

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
   * 仅 WebGL2 后端实现：渲染到 16×16 临时 render target 后
   * `readRenderTargetPixels` 同步回读，`averageLuminanceFromRGBA` 求平均。
   *
   * WebGPU 后端**不实现**（返回 undefined）——WebGPU 的 `renderer.render` 是
   * 异步的（返回 Promise），且回读需要 `requestAdapter`+`requestDevice` 的
   * buffer copy + `mapAsync`，与 engine 当前的同步 render 调用模型冲突。
   * 此阶段 WebGPU 走固定曝光（恒 1.0），后续单独接入（见 P5 规格文档）。
   *
   * 引擎构造时检测此方法存在才 `setSampler`；不存在则 autoExposure 自然
   * 不采样，曝光保持初始值 1.0。
   */
  getAverageLuminance?(): number;

  /** 设置阴影使能 */
  setShadows(enabled: boolean): void;

  /** 设置色调映射（当前仅 ACESFilmic） */
  setToneMapping(type: 'ACESFilmic'): void;

  /** 释放后端资源 */
  dispose(): void;
}

/**
 * 运行时 WebGPU 支持检测。
 */
export async function detectWebGPU(): Promise<{ available: boolean; reason?: string }> {
  // navigator.gpu 可能不存在（Firefox、旧版 Safari、Node 环境）
  const nav = navigator as Navigator & {
    gpu?: { requestAdapter: () => Promise<unknown> };
  };
  if (typeof nav === 'undefined' || !nav.gpu) {
    return { available: false, reason: 'WebGPU 不可用（浏览器不支持 navigator.gpu）' };
  }
  try {
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) {
      return { available: false, reason: '未找到 WebGPU 图形适配器' };
    }
    return { available: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { available: false, reason: `WebGPU 适配器请求失败：${msg}` };
  }
}

/**
 * 创建渲染后端。
 *
 * 自动检测逻辑：
 * 1. 如果 forceBackend 指定，直接使用
 * 2. 否则检测 WebGPU 支持
 * 3. WebGPU 可用 → WebGPU 后端
 * 4. WebGPU 不可用 → WebGL2 后端，附带降级原因
 */
export async function createBackend(options: BackendOptions): Promise<BackendResult> {
  const canvas = options.canvas;
  const width = options.width ?? (canvas.clientWidth || 800);
  const height = options.height ?? (canvas.clientHeight || 600);
  const maxPixelRatio = options.maxPixelRatio ?? 2;

  let targetBackend: BackendType;
  let degradationReason: string | undefined;

  if (options.forceBackend) {
    targetBackend = options.forceBackend;
  } else {
    const gpu = await detectWebGPU();
    if (gpu.available) {
      targetBackend = 'webgpu';
    } else {
      targetBackend = 'webgl2';
      degradationReason = gpu.reason;
    }
  }

  if (targetBackend === 'webgpu') {
    try {
      const { WebGPURenderer } = await import('three/webgpu');
      const renderer = new WebGPURenderer({
        canvas,
        antialias: true,
        alpha: false,
      });
      await renderer.init();

      const capabilities: BackendCapabilities = {
        supportsIES: true,
        supportsGodrays: true,
        supportsEffectComposer: false,
        toneMapping: 'ACESFilmic',
        supportsShadows: true,
      };

      const backend: RenderBackend = {
        type: 'webgpu',
        canvas,
        capabilities,
        getRenderer: () => renderer,
        render: (scene: Scene, camera: Camera) => {
          renderer.render(scene, camera);
        },
        resize: (w: number, h: number) => {
          renderer.setSize(w, h, false);
        },
        setExposure: (v: number) => {
          renderer.toneMappingExposure = v;
        },
        getExposure: () => renderer.toneMappingExposure,
        setToneMappingExposure: (v: number) => {
          renderer.toneMappingExposure = v;
        },
        getToneMappingExposure: () => renderer.toneMappingExposure,
        setShadows: (enabled: boolean) => {
          renderer.shadowMap.enabled = enabled;
        },
        setToneMapping: (_type: 'ACESFilmic') => {
          // ACESFilmic 在 WebGPU 路径中由 pipeline 内部管理
        },
        dispose: () => {
          void renderer.dispose();
        },
      };

      return { backend, capabilities };
    } catch (err) {
      // WebGPU 创建失败，降级到 WebGL2
      const msg = err instanceof Error ? err.message : String(err);
      degradationReason = `WebGPU 初始化失败：${msg}，降级到 WebGL2`;
      targetBackend = 'webgl2';
    }
  }

  // WebGL2 兜底路径
  const {
    WebGLRenderer,
    ACESFilmicToneMapping,
    PCFSoftShadowMap,
    WebGLRenderTarget,
    UnsignedByteType,
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

  const capabilities: BackendCapabilities = {
    supportsIES: false,
    supportsGodrays: false,
    supportsEffectComposer: true,
    toneMapping: 'ACESFilmic',
    supportsShadows: true,
  };

  // 自动曝光采样：渲染到 16×16 临时 RT 后 readRenderTargetPixels 回读。
  // 16×16 = 256 像素，足够代表全屏平均亮度，单次回读代价可忽略。
  // 不启用深度/模板缓冲（亮度采样不需要，省带宽）。
  const SAMPLE_SIZE = 16;
  const sampleRT = new WebGLRenderTarget(SAMPLE_SIZE, SAMPLE_SIZE, {
    type: UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  const sampleBuffer = new Uint8Array(SAMPLE_SIZE * SAMPLE_SIZE * 4);

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
      webglRenderer.render(scene, camera);
    },
    resize: (w: number, h: number) => {
      webglRenderer.setSize(w, h, false);
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
      // 渲染当前场景到 16×16 RT（暴露当前色调映射 + 曝光，
      // 因此采样值是「用户视角看到的画面亮度」，不是后处理前线性值）
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
      webglRenderer.setRenderTarget(null);
      return averageLuminanceFromRGBA(sampleBuffer);
    },
    setShadows: (enabled: boolean) => {
      webglRenderer.shadowMap.enabled = enabled;
    },
    setToneMapping: (_type: 'ACESFilmic') => {
      // 已设置
    },
    dispose: () => {
      sampleRT.dispose();
      webglRenderer.dispose();
    },
  };

  return {
    backend,
    capabilities,
    ...(degradationReason !== undefined ? { degradationReason } : {}),
  };
}
