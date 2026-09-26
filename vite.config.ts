/// <reference types="vitest" />
// @ts-check
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * Vite 配置。
 *
 * 关键约束（见 docs/00-p0-version-verification.md）：
 * - three@0.186 是拆包 ESM：`three` / `three/webgpu` / `three/tsl` 三个 entry。
 *   Vite 对 ESM bare import 处理正常，无需优化器干预。
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
    exclude: ['three', 'three/webgpu', 'three/tsl'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          'three-webgpu': ['three/webgpu'],
        },
      },
    },
  },
  server: { port: 5173 },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: false,
  },
});
