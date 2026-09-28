import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

/**
 * App 组件集成测试（P19 专业模式门禁 + P26a Bloom / Godrays 生产可见性）。
 *
 * 测试策略：
 * - 只 mock `render/backend.js` 与 `render/sceneEngine.js`（渲染侧），
 *   store 层与业务逻辑不 mock —— 保证业务行为未被破坏。
 * - `import.meta.env.DEV` 在 Vitest/SSR transform 下是运行时可写的普通
 *   property（不像 build 时被静态替换），所以测试里可以直接赋值来切换
 *   dev / prod 分支。
 *
 * P26a 起删除了 P10 的 degradation 提示测试块：单后端冻结后，
 * createBackend 不再返回 degradationReason，App 也不再渲染该提示。
 */

// createBackend 真实返回：Promise<{ backend: RenderBackend }>（P26a 起不再有 degradationReason）
vi.mock('./render/backend.js', () => {
  const mockBackend = {
    type: 'webgl2',
    canvas: document.createElement('canvas'),
    dispose: () => {},
    setSize: () => {},
    getBloom: () => ({ strength: 0.22, radius: 0.3, threshold: 0.85 }),
    getGodrays: () => ({
      enabled: false,
      weight: 1.0,
      density: 0.4,
      decay: 1.0,
      screenRadius: 0.35,
      sampleCount: 24,
    }),
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
    createBackend: vi.fn(() => Promise.resolve({ backend: mockBackend })),
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

/** 展开右侧 sidebar 的「专业模式」Panel 并勾选开关，让 RenderPanel 挂载 */
async function enableProfessionalMode(container: HTMLElement) {
  const header = Array.from(container.querySelectorAll('.panel-header')).find((btn) =>
    btn.textContent?.includes('专业模式'),
  );
  if (!header) throw new Error('应当能定位「专业模式」面板标题');
  await userEvent.click(header);
  await act(async () => {
    await Promise.resolve();
  });

  const checkbox = container.querySelector(
    'input[type="checkbox"][aria-label="专业模式"]',
  );
  if (!checkbox) throw new Error('应当能定位专业模式开关');
  await userEvent.click(checkbox);
}

describe('App：专业模式门禁（P19，§4 Day 6 j）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    setDev(true);
  });

  afterEach(() => {
    window.localStorage.clear();
    setDev(true);
  });

  it('默认（未开启）不渲染 照度估算 / 灯具参数 / 渲染与项目 面板', async () => {
    const { container } = await renderApp();
    await flushEffects();
    expect(container.textContent).not.toContain('照度估算');
    expect(container.textContent).not.toContain('灯具参数');
    expect(container.textContent).not.toContain('渲染与项目');
    // 用户可见的产品 UI 仍在
    expect(container.textContent).toContain('场景');
    expect(container.textContent).toContain('相机机位');
  });

  it('勾选专业模式后三个面板出现', async () => {
    const { container } = await renderApp();
    await flushEffects();
    await enableProfessionalMode(container);
    expect(container.textContent).toContain('照度估算');
    expect(container.textContent).toContain('渲染与项目');
    // FixturePanel 在 mock 下「未选中灯具」时依然渲染 <Panel title="灯具参数"> 与空态提示，
    // 因此标题应可见（若后续引入无灯具时整面板 return null 的分支，此处需相应放宽）。
    expect(container.textContent).toContain('灯具参数');
  });

  it('开关状态跨实例持久化（写 localStorage 后再渲染）', async () => {
    window.localStorage.setItem('lumina.professionalMode', '1');
    const { container } = await renderApp();
    await flushEffects();
    expect(container.textContent).toContain('照度估算');
  });
});

describe('App：Bloom / Godrays 滑块的生产可见性（P26a §2.4）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    setDev(true);
  });

  it('生产模式（DEV=false）下勾选专业模式后 Bloom / Godrays 滑块不渲染', async () => {
    setDev(false);
    const { container } = await renderApp();
    await flushEffects();
    await enableProfessionalMode(container);
    // 面板本身应挂载（用户勾了专业模式）
    expect(container.textContent).toContain('渲染与项目');
    // 但 Bloom / Godrays 区块应完全不渲染（DOM 里不存在）
    expect(container.textContent ?? '').not.toContain('光晕 (Bloom)');
    expect(container.textContent ?? '').not.toContain('体积光 (Godrays)');
  });

  it('开发模式（DEV=true）下勾选专业模式后 Bloom / Godrays 滑块渲染', async () => {
    setDev(true);
    const { container } = await renderApp();
    await flushEffects();
    await enableProfessionalMode(container);
    expect(container.textContent).toContain('渲染与项目');
    expect(container.textContent).toContain('光晕 (Bloom)');
    expect(container.textContent).toContain('体积光 (Godrays)');
  });
});
