import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

/**
 * P10：WebGPU → WebGL2 降级提示（`degradation`）只在 dev 模式显示。
 *
 * 测试策略：
 * - App 组件首次渲染时 `degradation` 是 null，需要 createBackend 返回非空
 *   `degradationReason`（或抛错）才会走到显示分支。
 * - `import.meta.env.DEV` 在 Vitest/SSR transform 下是运行时可写的普通
 *   property（不像 build 时被静态替换），所以测试里可以直接赋值来切换
 *   dev / prod 分支。
 * - 只 mock `render/backend.js` 与 `render/sceneEngine.js`（渲染侧），
 *   store 层与业务逻辑不 mock —— 保证业务行为未被破坏。
 */

// createBackend 真实返回：Promise<{ backend: RenderBackend, degradationReason?: string }>
// 这里 mock 成"降级到 WebGL2"的成功结果，用于触发 UI 上的 degradation 提示。
vi.mock('./render/backend.js', () => {
  const mockBackend = {
    type: 'webgl2',
    canvas: document.createElement('canvas'),
    dispose: () => {},
    setSize: () => {},
    getBloom: () => null,
    getGodrays: () => null,
    setGodrays: () => {},
    setBloom: () => {},
    getRenderer: () => ({}),
    setToneMappingExposure: () => {},
    setToneMapping: () => {},
    setExposure: () => {},
    getExposure: () => 1,
    getToneMappingExposure: () => 1,
    setShadows: () => {},
    render: () => {},
    resize: () => {},
  };
  return {
    createBackend: vi.fn(() =>
      Promise.resolve({
        backend: mockBackend,
        degradationReason: 'WebGPU unsupported — fallback to WebGL2',
      }),
    ),
  };
});

vi.mock('./render/sceneEngine.js', () => ({
  SceneEngine: vi.fn().mockImplementation(() => ({
    start: () => {},
    stop: () => {},
    dispose: () => {},
    resize: () => {},
    setHour: () => {},
    setTimeSpeed: () => {},
    setShadows: () => {},
    setDustVisible: () => {},
    setLightShaftVisible: () => {},
    setFixtureCct: () => {},
    setFixtureLevel: () => {},
    setFixturePos: () => {},
    setFixtureRotation: () => {},
    setFixtureBeamAngle: () => {},
    setFixturePhotometric: () => {},
    addFixture: () => {},
    addZone: () => {},
    updateFixture: () => {},
    updateZone: () => {},
    removeFixture: () => {},
    removeZone: () => {},
    setActiveScene: () => {},
    selectZone: () => {},
    getHour: () => 17.75,
    isSunsetActive: () => false,
    getSunIntensity: () => 0,
    getCamera: () => ({}),
    getWindowScreenAnchor: () => null,
    setFrameCallback: () => {},
    getRenderStats: () => ({ triangles: 0, objects: 0, fps: 0 }),
  })),
}));

/** 切换 import.meta.env.DEV（Vite/Vitest SSR transform 下是可写的 data prop） */
function setDev(v: boolean) {
  (import.meta.env as unknown as { DEV: boolean }).DEV = v;
}

async function renderApp() {
  // dynamic import 保证 mock 与 DEV flag 都在用例加载期生效
  const { default: App } = await import('./App.js');
  return render(<App />);
}

async function flushEffects() {
  // createBackend 是同步 mock（返回已 resolve 的 Promise）；等几个 microtask
  // 让 effect 里的 async 走完 + React 19 state update 都落库。
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('App：degradation 提示的 dev/prod 可见性（P10 §交付物 3）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    // 恢复 DEV 默认值，避免污染后续测试
    setDev(true);
  });

  it('DEV=true 时降级提示可见（.info.dev-only 渲染）', async () => {
    setDev(true);
    const { container } = await renderApp();
    await flushEffects();
    const el = container.querySelector('.info.dev-only');
    expect(el, 'dev 模式下应当显示 .info.dev-only 元素').not.toBeNull();
    expect(el!.textContent).toContain('WebGPU');
  });

  it('DEV=false（prod）时降级提示不渲染（.info.dev-only 不存在）', async () => {
    setDev(false);
    const { container } = await renderApp();
    await flushEffects();
    expect(container.querySelector('.info.dev-only')).toBeNull();
    // degradation 文本本身也不该出现在页面上（避免"提示存在但被藏起来"）
    expect(container.textContent ?? '').not.toContain('WebGPU');
  });
});
