import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';

// TEMP-DEBUG (P9): 访问 `/?debug` 时注入浏览器控制台调试钩子。
// `?debug` 是 Vite 原生 import-attribute 语法 —— 未传该 flag 时整段被
// tree-shake 掉，生产构建不含 dev-debug.ts。P9 完成后删除本行。
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('debug')) {
  void import('./dev-debug.ts');
}

const root = ReactDOM.createRoot(document.getElementById('app') as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
