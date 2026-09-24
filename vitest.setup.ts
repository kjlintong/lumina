import '@testing-library/jest-dom/vitest';

// jsdom 没有这些 Web API；测试里如需渲染真实 WebGL 请走 mock，见
// src/render/__tests__ 的说明。这里只补测试环境缺的基础 polyfill。

if (typeof globalThis.matchMedia !== 'function') {
  globalThis.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof globalThis.matchMedia;
}
