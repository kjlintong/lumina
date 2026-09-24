# P0 — Three.js 版本与 WebGPU/TSL API 核实结论

> 本文件是动 P1 渲染管线之前的强制核实产物（任务书 §4「动手前必须核实，不得凭记忆写 API」）。
> 所有结论均来自 **2026-09-24 实测**：`npm view` 取版本号 + 直接读取 npm 包源码文件路径/内容 + Node 运行时 `import` 验证。
> 凡与工程方案（Lumina 工程方案.docx §3.2 / §5）假设不一致之处，**以本文件实测为准**，方案需相应修订。

## 1. 版本核实

| 项 | 实测值 | 来源 |
|---|---|---|
| three（latest） | **0.186.0** | `npm view three version` |
| three 版本区间（近 12） | 0.180.0 → 0.186.0 | `npm view three versions` |
| @react-three/fiber | 9.8.0（peer `three >=0.156`） | `npm view @react-three/fiber@9.8.0 peerDependencies` |
| @react-three/drei | 10.7.8 | `npm view @react-three/drei version` |
| @react-three/postprocessing | 3.1.2（peer `three >=0.156`, `postprocessing ^6.36.0`） | `npm view @react-three/postprocessing` |
| three-god-rays（独立包） | **不存在**（npm 404） | `npm view three-god-rays` |

**与方案偏差**：方案 §3.2 写「r171+ WebGPU 生产支持，r184/r185 已修复后期与透明混合」——r186 已涵盖，且**引入了方案未提及的拆包结构**（见 §2）。

## 2. 关键发现：r186 把构建拆成三个独立 entry（方案未提及，影响架构）

`three` 的 `package.json#exports` 实测为：

```
".":        "./build/three.module.js"      // WebGL 侧
"./webgpu": "./build/three.webgpu.js"      // WebGPU 渲染器 + Node 系统
"./tsl":    "./build/three.tsl.js"         // TSL（着色语言）
"./addons/*": "./examples/jsm/*"
```

build 产物实测体积：

| 文件 | 体积 |
|---|---|
| `three.core.js` | 1424 KB |
| `three.module.js` | 647 KB（444 个导出） |
| `three.webgpu.js` | 2231 KB（635 个导出） |
| `three.tsl.js` | 36 KB（re-export 聚合，682 个导出） |

**运行时实测（Node `import` 验证，非猜测）：**

- `import { WebGLRenderer } from 'three'` → ✓；`WebGPURenderer`、`NodeMaterial`、`NodeLoader`、`NodeBuilder` → ✗（不在 `three` 主入口导出）
- `import { WebGPURenderer } from 'three/webgpu'` → ✓（含 `NodeMaterial`/`NodeLoader`/`NodeBuilder`）
- `import { uniform, vec3, color, mix, smoothstep, texture, sampler, toneMapping, compute, Fn, If, Loop, reference, uniformArray, passTexture, viewZToPerspectiveDepth } from 'three/tsl'` → ✓
- **两个渲染器可在同一 bundle 共存**：`import { WebGLRenderer } from 'three'` + `import { WebGPURenderer } from 'three/webgpu'` 同文件实测通过。

**结论 / 架构影响**：方案 §3.3 的 `RenderBackend` 抽象不是「可选的优雅设计」，而是 **r186 下的硬性要求**——两个渲染器根本不在同一个 import specifier 下，业务层必须屏蔽这个差异。本仓库据此实现 `src/render/backend.ts` 的后端抽象与工厂。

## 3. 关键发现：EffectComposer 是 WebGL 专属（方案警告已验证）

`three/examples/jsm/postprocessing/EffectComposer.js` 源码实测：

- 文件头部 docstring 明确写着：`This module can only be used with {@link WebGLRenderer}.`
- constructor 内部硬编码 `new WebGLRenderTarget(...)`，并从 `'three'` 导入 `WebGLRenderTarget`。

**结论**：方案 §3.2「旧版 EffectComposer 的 Pass 在 WebGPURenderer 下会静默失效」——措辞需更硬：在 r186，EffectComposer 是 **WebGL 单后端强绑定**，不是「静默失效」而是结构上不兼容。**WebGPU 路径的后期必须用 TSL（NodeMaterial/NodeShaderMaterial 自研 pass）**；pmndrs `postprocessing` 包同理（基于 WebGLEffectComposer，WebGL 专属）。双后端后期是本项目真实工程成本，不做像素一致承诺（见 §7 风险）。

## 4. 关键发现：r186 自带 WebGPU 原生 IES 系统（比方案假设更成熟）

方案 §5.2 描述的是「自研四层 IES 实现」。实测 r186 已内置：

| 文件 | 内容 |
|---|---|
| `src/lights/webgpu/IESSpotLight.js` | `class IESSpotLight extends SpotLight`，带 `.iesMap: Texture \| null`；docstring 明写 `Can only be used with WebGPURenderer`；**intensity 单位是 candela (cd)** |
| `src/nodes/lighting/IESSpotLightNode.js` | WebGPU 节点版 |
| `examples/jsm/loaders/IESLoader.js` | 解析 LM-63，输出 `DataTexture`（`RedFormat`，默认 `HalfFloatType`，360×180 网格，归一化衰减 0..1）；`const tex = await loader.loadAsync(url); spotLight.iesMap = tex;` |

**结论 / 双后端分歧（重要）**：
- **WebGPU 路径**：`IESSpotLight` + `IESLoader` 直接给到「真实配光」，强度单位是 cd，符合 §5.2 物理口径。
- **WebGL2 兜底路径**：**没有 `IESSpotLight`**。IES-accurate 配光必须降级为 `SpotLight` + 自定义纹理采样（手写 shader），或直接走 §5.2「回退层」的 cone/rect/disk 近似并在 UI 显式标注。
- 因此 §5.2 的「GPU 采样层」在 r186 只对 WebGPU 成立；WebGL2 是**近似路径**。两后端的配光**精度不等价**——这是必须在 UI 与文档中明示的口径局限。

## 5. 关键发现：GodraysNode 是官方的，且在 three 内部（不是独立包）

- `npm view three-god-rays` → **404 Not Found**（方案提到的「three-good-godrays」独立包不存在）。
- 实测 `three/examples/jsm/tsl/display/GodraysNode.js`（16457 字节）存在，文件头 docstring 注明 `Reference: This Node is a part of three-good-godrays`——即该实现已并入 three 的 addons。
- 导出：`import { godrays } from 'three/addons/tsl/display/GodraysNode.js'`，签名 `godrays(depthNode, camera, light) => GodraysNode`，可调 `raymarchSteps`(默认60) / `density`(0.7) / `maxDensity`(0.5) / `distanceAtte(nuation)`。
- 配套：`depthAwareBlend(sceneColor, blur, sceneDepth, camera, opts)` 做合成、`bilateralBlur` 降噪。

**源码自述限制（必须遵守）**：
1. **仅支持 PointLight 与 DirectionalLight**（RectAreaLight 不支持，故暗槽灯带的体积光不能用此 node）。
2. **需要完整阴影**：renderer 开 shadow、物体 castShadow/receiveShadow、主光 castShadow。

**结论**：方案 §3.2 引用的「官方 GodraysNode（TSL，屏幕空间光线步进，仅支持点光/方向光）」完全准确。窗口体积光束（方向光）✓；暗槽灯带体积光（面光）✗——后者需另行设计（见 §7 风险）。

## 6. 关键发现：`three/addons` 桶文件在 Node ESM 下不可用（构建陷阱）

`import * as A from 'three/addons'` 实测抛 `ERR_UNSUPPORTED_ESM_URL_SCHEME`（桶文件 `examples/jsm/Addons.js` 内引了 CDN URL）。**必须按具体路径导入**：`three/addons/postprocessing/OutputPass.js`、`three/addons/tsl/display/GodraysNode.js` 等，不要引桶。Vite 打包同理。

## 7. 其它确认

- **色调映射**：`ACESFilmicToneMapping` ✓、`AgXToneMapping` ✓（方案 §5.4 的 AGX「艺术备选」在 r186 可用）。经 `renderer.toneMapping` 设置；WebGL2 另需 `OutputPass`，WebGPU 在管线内完成。
- **光类型**：`AmbientLight`/`DirectionalLight`/`HemisphereLight`/`LightProbe`/`PointLight`/`RectAreaLight`/`SpotLight` 均在 `three` 主入口 ✓。`RectAreaLightUniformsLib` 不在 `three` 主入口（在 `three/addons/lights/`）。
- **眼适应自动曝光（§5.4）**：**无内置**，须自研——16×16 降采样求平均亮度 → log2 编码 RGBA8 → 每 18 帧回读 → 目标曝光 `0.17/平均亮度` → 平滑。本仓库以「采样回调」接口实现，由各后端插自己的回读（WebGL2: `readRenderTargetPixels`；WebGPU: compute/回读 buffer）。
- **R3F 与 WebGPU**：R3F 9.x 的 WebGPU 支持仍是实验态。本项目**渲染层不绑定 React 生命周期**（方案 §3.1 备注），故渲染引擎为独立模块，React 仅做 UI 面板——这是与方案「React + R3F」表述的**有意偏离**，理由：§3.1 同时要求「渲染层不依赖 React 生命周期」，R3F 会反向绑定；且 P3 的拖拽/拾取/选中需求在独立引擎中更易精确控制。R3F 作为 P1 之后再评估的编辑交互层选项保留。

## 8. 选型决策（方案未锁死，任务书 §4 授权我定）

| 项 | 选择 | 理由 |
|---|---|---|
| 构建 | **Vite** | 原生 ESM + top-level await；对 r186 的 `three` / `three/webgpu` / `three/tsl` 三 entry 拆包与按需 code-split 最友好；沿用 LightCraft HA 已验证栈 |
| UI | **React 19** | 方案 §3.1 指明 React 做 UI 与状态 |
| 状态 | **Zustand + immer** | 渲染层与业务状态分离；Zustand 支持 transient subscribe 避免拖拽时每帧触发 React rerender（LightCraft HA 已验证的 store+持久化模式）；immer 处理 Fixture/ActivityZone 树的不可变更新 |
| 测试 | **Vitest + @testing-library/react** | 沿用 LightCraft HA 已验证配置（jsdom 配置见技能 references/m3-app-test-setup.md） |
| lint/format | **ESLint(flat, typescript-eslint) + Prettier** | — |

## 9. 本仓库据此确定的工程约束（写入代码注释/ADR）

1. 业务代码只经 `src/render/backend.ts` 的 `RenderBackend` 抽象取渲染器，**不得**直接 `import { WebGLRenderer } from 'three'` 或 `three/webgpu` 在业务层。
2. 后期链：WebGL2 用 EffectComposer（WebGL 专属）；WebGPU 用 TSL 自研 pass。**两路径后期不做像素一致承诺**。
3. IES：WebGPU 走 `IESSpotLight`+`IESLoader`（真实配光，cd 单位）；WebGL2 走 SpotLight 近似 + UI 标注「配光为近似值」。
4. 体积光：方向光（窗口）走 GodraysNode；面光（暗槽灯带）不走 GodraysNode，另行实现并标注。
5. 单位：cd 用于发光强度，lux 仅用于显示且必须标注「相对估算，非实测照度」。
6. 锁定 three 次版本 0.186.0；升级走方案 §3.3 门禁清单（双后端截图比对）。
