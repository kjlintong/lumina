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

// Node 26 起，jsdom 内的 window.localStorage 变成 undefined
// （Node 提示：localStorage is not available because --localstorage-file was not provided）。
// Lumina 的「专业模式」开关靠 localStorage 持久化（src/store/professionalMode.ts），
// App.test.tsx 的 P19 / P26a 测试也直接读写 window.localStorage。
// 这里补一个内存版 Storage，让测试在 Node 26 下与 Node 20/22 行为一致；
// 真实浏览器自带 localStorage，本 polyfill 不会被使用。
if (typeof window !== 'undefined' && !window.localStorage) {
  const store = new Map<string, string>();
  const fakeStorage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    key(i: number) {
      return Array.from(store.keys())[i] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(window, 'localStorage', {
    value: fakeStorage,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: fakeStorage,
    configurable: true,
    writable: true,
  });
}
