# Lumina P5 — 自动曝光采样接入（WebGL2）+ WebGPU 后续说明

> 本轮交付：把 P1 留空转的 `AutoExposure.sampler` 真正接进 WebGL2 渲染管线，
> 让夜间场景能自动提亮、白天能自动降曝。WebGPU 后端本轮保持固定曝光（恒 1.0），
> 文档说明后续接入方案。
>
> 现状：`npm run verify` 全绿（250 测试，新增 11 个 `luminance` 测试），
> `npm run build` 成功，工作树干净（提交前）。

## 背景：为什么做这个

`src/render/autoExposure.ts` 在 P1 就写好了完整模块：`ExposureSampler` 接口、
`targetLuminance / 平均亮度` 的目标曝光算法、指数平滑、min/max 截断，单测也齐了。
但整个仓库**没有任何地方调用 `setSampler()`**——引擎构造时只 new 了 `AutoExposure`，
从没给它喂采样器。

后果：`AutoExposure.update()` 每帧走的是「无采样器」分支，`currentExposure` 恒等于
初始值 1.0，`backend.setExposure(1.0)` 每帧空转。表现为：

- 夜间（太阳下山、室内灯是唯一光源）画面一片死黑，用户看不到灯的真实效果；
- 白天（太阳强 + 环境光 + 多盏灯叠加）画面过曝发白；
- 时间滑杆从白天拖到夜晚，曝光毫无过渡，画面突兀黑掉。

这是 Lumina 的核心遗留项——用户调灯、看灯效是产品主流程，没有动态曝光适配
这个工具就只是个 3D 模型查看器。

## 本轮范围：WebGL2 完整 + WebGPU 占位

WebGL2 路径：标准做法，`readRenderTargetPixels` 同步回读，与 engine 当前
同步 `render()` 调用模型完全兼容。

WebGPU 路径：原生的 `WebGPURenderer.render` 返回 Promise（异步），且回读
需要 `requestAdapter` + `requestDevice` 的 buffer copy + `mapAsync`，与 engine
的同步循环有架构冲突。本轮不实现，文档说明后续方案，WebGPU 后端保持
固定曝光（曝光恒 1.0，无采样器）。

这是有意识的范围切分——WebGPU 后端目前只在支持它的浏览器里走（多数用户
仍落 WebGL2 降级路径），先把主路径打通。

## 实现

### 交付物 1：`src/render/luminance.ts`（新建，纯函数）

`averageLuminanceFromRGBA(rgba: Uint8Array): number` —— 把 `readRenderTargetPixels`
回读的 RGBA8 像素转线性空间平均亮度。

- 字节 → [0,1] sRGB 分量
- sRGB → 线性（反 gamma：`c ≤ 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`）
- Rec.709 权重（R=0.2126, G=0.7152, B=0.0722）算每像素亮度
- 全块求平均
- alpha 通道不参与（亮度只取 RGB）
- 空数组 / 长度不足一像素时尾部字节忽略

不依赖 three、不依赖 DOM，便于单测。采样器接口在 `autoExposure.ts` 已定义，
本文件只提供纯计算。

### 交付物 2：`RenderBackend.getAverageLuminance()`（接口新增，可选）

`src/render/backend.ts` 接口加可选项：

```ts
getAverageLuminance?(): number;
```

注释里写清：

- WebGL2 后端实现：渲染到 16×16 临时 RT + `readRenderTargetPixels` +
  `averageLuminanceFromRGBA`。
- WebGPU 后端**不实现**（返回 undefined），原因：异步 render + buffer 回读
  与同步调用模型冲突，此阶段曝光恒 1.0，后续单独接入。
- 引擎构造时检测此方法存在才 `setSampler`。

### 交付物 3：WebGL2 后端采样实现

`createBackend` 的 WebGL2 路径里：

- 动态 import 增加 `WebGLRenderTarget`、`UnsignedByteType`。
- 创建 `SAMPLE_SIZE = 16` 的临时 RT（`depthBuffer: false, stencilBuffer: false`
  省带宽，亮度采样不需要深度模板）。
- 预分配 `Uint8Array(16*16*4)` 复用缓冲，避免每帧 GC。
- 缓存 `lastScene` / `lastCamera`（在 `render()` 里记录）。
- `getAverageLuminance()`：若缓存为空返回 0；否则 `setRenderTarget(sampleRT)` →
  `render(lastScene, lastCamera)` → `readRenderTargetPixels` → 回 `setRenderTarget(null)`
  → 调 `averageLuminanceFromRGBA`。
- `dispose()` 释放 RT。

**采样语义**：渲染到 RT 时保留当前 `toneMappingExposure`，因此采样值是
「用户视角看到的画面亮度」，不是后处理前线性值。这与 AutoExposure 的目标
（让画面平均亮度接近 `targetLuminance=0.17`）一致——曝光适应的是最终画面，
不是物理输入。

### 交付物 4：`sceneEngine` 构造时接入采样器

构造器里 `new AutoExposure` 之后：

```ts
if (typeof this.backend.getAverageLuminance === 'function') {
  this.autoExposure.setSampler({
    getAverageLuminance: () => this.backend.getAverageLuminance?.() ?? 0,
  });
}
```

- 检测而非假设：WebGPU 后端无此方法时不 set，`AutoExposure.update()` 自然走
  固定曝光路径（曝光恒 1.0），不会空转。
- 箭头函数包装：避免 ESLint `unbound-method` 警告（方法引用可能 this 错绑定），
  且显式捕获 `this.backend` 让作用域清晰。

## 测试（新增，不删改既有）

`src/render/__tests__/luminance.test.ts`：11 个用例覆盖

- 空数组、长度不足一像素尾部忽略
- 纯白=1.0、纯黑=0
- 三原色对应 Rec.709 权重（红 0.2126 / 绿 0.7152 / 蓝 0.0722）
- sRGB→线性：sRGB 128 对应线性 ≈ 0.216（< 0.5）
- 半白半黑 = 0.5
- alpha 不影响亮度
- 均匀中等亮度块 = 单像素亮度（平均正确）

WebGL2 采样实现本身在 jsdom 里跑不通（需要真实 WebGL 上下文），
通过 `npm run verify` 全绿 + 手工跑 dev 验证。

## WebGPU 后续接入方案（本轮不做）

WebGPU 后端要支持自动曝光，有几条路，按改动从小到大：

### 方案 A：WebGPU render pass 加 resolve-target（推荐，改动最小）

Three.js r186 WebGPU 的 `WebGPURenderer.render` 返回 `Promise<WebGPUFrameGraph>`。
可以在 render pass 结束时给 frame graph 加一个 resolve target，把屏幕内容
downsample 到一个小 texture（如 16×16），然后从该 texture 同步回读。

但 WebGPU 的 texture-to-buffer copy 是异步的，需要：

1. render pass 结束
2. `copyTextureToBuffer`
3. `await buffer.mapAsync()`
4. `buffer.getMappedRange()` 读
5. `buffer.unmap()`

第 3 步是异步的，与 engine 当前同步循环冲突。

**接入做法**：把 `setSampler` 改成接收异步采样器（`getAverageLuminance():
Promise<number>`），engine 在每帧用 `void sampler.getAverageLuminance()
.then(lum => autoExposure.setLuminance(lum))` 非阻塞调用，下一帧采样到
上一帧的亮度。改动集中在 `autoExposure.ts` 接口和 `sceneEngine` 一处。

### 方案 B：compute shader 内做曝光反馈

WebGPU 的看家本领。写一个 TSL/compute shader，每帧对场景做一遍亮度统计
（`textureLoad` 累加到 buffer），输出到 `storage` buffer，下一帧 main render
读取 buffer 决定曝光。

这是 Three.js WebGPU 路径的「正统」做法，性能最好（全 GPU，无回读 CPU 往返），
但要写自定义 TSL node + 改 render pipeline，工程量大。本轮不做。

### 方案 C：先不做，保持固定曝光

最省事。代价是 WebGPU 用户拿不到动态曝光。考虑到 WebGPU 普及度，
本轮就选了这条路。

**本轮选方案 C**，文档留位。等真要做时按方案 A 起步（接口先改异步），
方案 B 作为性能优化后续。

## 验收

1. `npm run verify` 全绿（typecheck + lint 0 error + 250 测试）。
2. `npm run build` 成功。
3. 手工 `npm run dev`，浏览器确认（WebGL2 路径）：
   - 初始 18:00（傍晚）画面亮度合理，不过曝。
   - 时间拖到 22:00（夜间），太阳下山后室内灯变主光源，画面自动提亮
     （`toneMappingExposure` 升高，可在 devtools 里看 `renderer.toneMappingExposure`）。
   - 时间拖到 12:00（正午），太阳强 + 环境光，画面自动降曝（不过曝）。
   - 拖动时间滑杆连续变化，曝光平滑过渡（指数平滑，speed=0.03，无突变）。
   - 控制台无 WebGL warning。
4. WebGPU 路径（支持的浏览器）：曝光恒 1.0，画面亮度固定（与 P4 行为一致），
   无报错。

## 红线（违反即返工）

- 不破坏既有 239 测试（本轮 250，净增 11）。
- `RenderBackend.getAverageLuminance` 必须是**可选**的（WebGPU 后端不实现）。
- `averageLuminanceFromRGBA` 是纯函数，不碰 DOM / three / WebGL 上下文。
- 采样 RT 不启用深度/模板缓冲（省带宽）。
- `readRenderTargetPixels` 后必须 `setRenderTarget(null)` 还原（否则后续 render 写错目标）。
- 不引入新的 ESLint error（67 warning 是既有的非空断言，本轮不动）。

## 提交

`P5: wire AutoExposure sampler — WebGL2 pixel readback, WebGPU documented as follow-up`。
提交后 push origin/master。
