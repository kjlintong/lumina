# P7 — Godrays Volumetric Light Spec

> **状态：** 模块实现完成，深度纹理集成待后续  
> **对应里程碑：** M1.5 → M2  
> **依赖：** three.js r186, EffectComposer (P7 bloom pass), 深度纹理

## 1. 目标

实现经典的**体积光散射效果**（Godrays / Volumetric Light Scattering），使光源周围的空气看起来被照亮。

核心原理：从光源到相机方向进行屏幕空间光线行进（Ray Marching），在每个采样点检查深度遮挡，被场景遮挡处产生散射光，逐段累积。

## 2. 技术实现

### 2.1 模块：`src/render/godrays.ts`

| 导出 | 类型 | 说明 |
|------|------|------|
| `godraysShader` | `ShaderPass` 格式 shader | 顶点 + 片元着色器 |
| `GodraysPass` | `class extends ShaderPass` | EffectComposer 集成用 |
| `GodraysSettings` | `interface` | 可调参数 |
| `DEFAULT_GODRAYS` | `const` | 默认参数 |

### 2.2 参数

| 参数 | 默认值 | 范围 | 说明 |
|------|--------|------|------|
| `density` | 0.2 | 0–1 | 散射密度，越大越浓 |
| `decay` | 2.0 | 0–10 | 衰减系数，越大消散越快 |
| `weight` | 1.0 | 0–10 | 强度权重 |
| `screenRadius` | 1.0 | 0–2 | 光晕半径（屏幕空间） |
| `sampleCount` | 24 | 4–64 | 采样数，越高越精细但越慢 |
| `enabled` | true | — | 是否启用 |

### 2.3 着色器算法

```
1. 从光源屏幕位置 (lightScreen) 到当前像素 (cameraPos) 建立光线方向
2. 沿光线方向均匀采样 sampleCount 个点
3. 对每个采样点：
   a. 读取深度纹理 → sampleDepth
   b. 计算深度差 depthDiff = pixelDepth - sampleDepth
   c. 如果 depthDiff < 0（当前像素更近），跳过
   d. 散射 = depthDiff × density × weight
   e. 距离衰减 = exp(-t × decay × 2)
   f. 光晕衰减 = smoothstep(radiusDist)
4. 累积所有采样点的散射贡献
5. 最终颜色 = sceneColor + volumetric × 0.5
```

### 2.4 深度纹理

GodraysPass 需要 `tDepth` uniform（场景深度纹理）。获取方式：

```ts
// 方案 A：WebGL2 — 渲染到带深度 RT，然后传递深度纹理
const depthRT = new THREE.WebGLRenderTarget(w, h, {
  depthBuffer: true,
  depthTexture: new THREE.DepthTexture(w, h),
});
renderer.setRenderTarget(depthRT);
renderer.render(scene, camera);
renderer.setRenderTarget(null);
godraysPass.setDepthTexture(depthRT.depthTexture);

// 方案 B：WebGPU — 使用 PassNode + scenePassDepth
// 需要 GodraysNode（TSL），通过 composer.addPass(new PassNode(...)) 集成
```

当前 GodraysPass 在 `tDepth` 未设置时自动禁用（`this.enabled = false`），不会报错。

## 3. 与 EffectComposer 集成

```ts
import { GodraysPass } from './godrays.js';

// 在 PostProcessing 中（需要深度纹理支持）：
// const godraysPass = new GodraysPass();
// composer.addPass(godraysPass);
// godraysPass.setLightScreenPosition(0.5, 0.8); // 光源在屏幕右上角
// godraysPass.setSettings({ density: 0.3 });
```

深度纹理渲染需要在 `PostProcessing.render()` 中先渲染到深度 RT，再传递给 GodraysPass。这是后续集成的工作。

## 4. 性能

| 参数组合 | 帧率影响 |
|----------|---------|
| sampleCount=16, decay=3 | 低（推荐默认） |
| sampleCount=24, decay=2 | 中（当前默认） |
| sampleCount=48, decay=1 | 高（高质量） |

建议：低端设备用 sampleCount=16，高端设备用 32–48。

## 5. 后续集成计划

- [ ] 在 `PostProcessing.render()` 中添加深度纹理渲染步骤
- [ ] 将 `GodraysPass` 加入 `PostProcessing` 管线（在 RenderPass 之后、Bloom 之前）
- [ ] 将光源世界坐标投影到屏幕空间（需要相机引用）
- [ ] 在 `RenderPanel` 中添加 Godrays 参数 UI
- [ ] WebGPU 路径：使用 `GodraysNode` + `PassNode` + `scenePassDepth`

## 6. 验证

| 检查 | 结果 |
|------|------|
| `npm run typecheck` | 通过 |
| `npm run test` | 通过 |
| `npm run lint` | 无新增错误 |
| `npm run build` | 通过 |

Godrays shader 正确性在运行时通过 WebGL2 深度纹理验证。测试覆盖 shader 定义完整性、uniform 声明、算法核心结构。
