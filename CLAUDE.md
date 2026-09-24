# Lumina — 家庭/室内灯光设计系统

## 架构铁律（ADR）

### ADR-08: 需求侧/供给侧分离
ActivityZone（需求侧）描述"人在这里要什么光"；Fixture（供给侧）描述"这盏灯是什么、装在哪"。两者是完全独立的实体，关系是可选绑定，不是派生。

### ADR-13: 旋转跟随
当 ActivityZone 旋转时，绑定的 Fixture 必须根据旋转矩阵更新位置（不是简单复制坐标）。

### ADR-17: user-locked 保护
用户手动设置过的字段（`lockedFields: Set<string>`）不得被自动逻辑（场景预设、批量操作等）覆盖。

### ADR-01: 删除不级联
删除 ActivityZone 时不级联删除 Fixture，只解绑。

### ADR-02: 灯具自动解绑
手动拖动 Fixture 时，自动解除与 ActivityZone 的绑定。

## 技术栈

- Three.js 0.186.0 (r186)
- React 19 + Zustand 5 + Immer 10
- TypeScript strict mode
- Vite 7 (build), Vitest 3 (test), ESLint 9 (lint), Prettier 3 (format)

## 关键 Three.js r186 API 事实（P0 实测验证）

### 导入路径
```typescript
// 主入口（WebGL 侧）
import { Scene, PerspectiveCamera, WebGLRenderer, ACESFilmicToneMapping,
         AmbientLight, DirectionalLight, HemisphereLight, SpotLight,
         PointLight, MeshStandardMaterial, BoxGeometry } from 'three';

// WebGPU 渲染器（独立 entry，不在 three 主入口导出）
import { WebGPURenderer } from 'three/webgpu';

// IES 相关（WebGPU 专属）
// IESSpotLight 在 'three' 内部，不在主入口导出
// IESLoader 在 'three/examples/jsm/loaders/IESLoader.js'
// GodraysNode 在 'three/examples/jsm/tsl/display/GodraysNode.js'
```

### 重要限制
- `EffectComposer` 是 WebGL 专属，硬编码 `WebGLRenderTarget`，不能与 WebGPURenderer 混用
- `WebGPURenderer` 不在 `three` 主入口导出，必须从 `three/webgpu` 导入
- `IESSpotLight` 在 `three/src/lights/webgpu/IESSpotLight.js`，不在主入口
- 双后端后期链不做像素一致承诺

## 代码规范

- TypeScript strict: true, noImplicitAny: true, strictNullChecks: true
- 所有导入使用 ESM 语法
- 文件名使用 camelCase
- 导出使用 named export，不混用 default export
- 不使用 `any` 类型逃逸（ESLint 强制）

## 测试要求

- 单元测试放在 `src/**/*.test.ts` 或 `src/__tests__/` 目录
- 使用 Vitest + @testing-library/react
- 测试文件命名 `*.test.ts`

## 构建命令

- `npm run typecheck` — TypeScript 类型检查
- `npm run lint` — ESLint 检查
- `npm test` — 运行测试
- `npm run verify` — 运行以上所有
- `npm run dev` — 启动开发服务器
- `npm run build` — 生产构建
