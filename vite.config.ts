/// <reference types="vitest" />
// @ts-check
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * Vite 配置。
 *
 * 关键约束（见 docs/00-p0-version-verification.md）：
 * - three@0.186 是拆包 ESM：`three` / `three/tsl` 等 entry。
 *   Vite 对 ESM bare import 处理正常，无需优化器干预。
 * - P26a：WebGL2 单后端，不再排除或加载 `three/webgpu`。
 * - 禁止引入 `three/addons` 桶文件（其内部含 CDN URL，Node ESM 下不可解析），
 *   一律按具体路径导入，例如 `three/addons/postprocessing/OutputPass.js`。
 */
export default defineConfig({
  plugins: [react()],
  define: {
    // P8c BuildBadge：构建时间注入，运行时在右下角显示
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@render': fileURLToPath(new URL('./src/render', import.meta.url)),
      '@modeling': fileURLToPath(new URL('./src/modeling', import.meta.url)),
      '@lighting': fileURLToPath(new URL('./src/lighting', import.meta.url)),
      '@scene': fileURLToPath(new URL('./src/scene', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['three', 'three/tsl'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        // P26a：删除 'three-webgpu' manualChunk。WebGL2 单后端后 src 里已无
        // import 'three/webgpu'，保留该条目会让 Rollup 强制创建一个 0 字节
        // three-webgpu-*.js 空 chunk 污染 dist/assets。
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  server: { port: 5174, host: true },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: false,
    // 限制并发：本机 WSL 仅 15GiB，Three.js+React19+jsdom 的依赖树很重，
    // 默认按 32 核起 32 个 worker 会瞬间吃爆内存触发 OOM killer，导致 WSL 卡死重启。
    // 固定用 forks 池（进程隔离，单进程崩了不会拖垮整套）+ 少量 worker。
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 4,
        minForks: 1,
      },
    },
  },
});
