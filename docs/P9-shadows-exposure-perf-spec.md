# P9 — 真实阴影 + 动态范围 + 性能恢复

> 交给 Claude Code 执行。先读 `CLAUDE.md`（ADR 与红线），再读本文件。
>
> P8 已「按规格完成」，但实测画面与参考项目差距巨大。本文件**只解决诊断确证的
> 4 个硬伤**，不动布局/材质/装饰（那是 P10）。每条根因都带实测数值，**先读代码
> 复核，不要重新发现**，也不要凭记忆改。
>
> 本轮**不得破坏**任何既有测试（当前 435 条，`npm run verify` 全绿）。

## 0. 目标

**验收判据（全部必须满足，用截图目测 + 数值校验双重把关）：**

1. **地板上有真实可见的阴影**：沙发、餐桌、绿植在地板上投出**可辨认的暗形轮廓**
   （不是完全没有，不是只有窗框小斑）。把「阴影」开关关掉再开，截图 diff 应
   **至少变化 1 万以上的像素**（这是硬判据，见 §6 验证脚本）。
2. **窗洞不再整面纯白**：窗格内能看到室外天空/天际线剪影与太阳圆盘，
   窗框把光斑切成格状；窗洞平均亮度应明显**低于纯白**（截图取样：窗洞区域
   RGB 均值 < 250，而不是当前几乎贴 255）。
3. **画面动态范围正常**：ACES 之后暗部不死黑、亮部不糊白，室内家具细节可读。
   太阳圆盘触发 bloom 但**不蔓延全屏**。
4. **帧率回到 30+**：当前实测 **5–8 FPS**（HUD 读数）。修完后 HUD 帧率应在
   1280×577 窗口、默认场景下稳定 ≥30 FPS。
5. **自动曝光真的生效**：`getAverageLuminance()` 必须返回 **> 0** 的值
   （当前返回 **0**，导致曝光恒 1.0、自动曝光整条链路死掉）。

## 1. 已确证的根因（实测数据，直接照改）

### 根因 A：自动曝光链路全死 —— `getAverageLuminance()` 恒返回 0

`src/render/backend.ts` 的 WebGL2 路径：

```ts
const sampleRT = new WebGLRenderTarget(SAMPLE_SIZE, SAMPLE_SIZE, {
  type: UnsignedByteType,          // ← 这里
  depthBuffer: false,
  stencilBuffer: false,
});
...
getAverageLuminance: () => {
  webglRenderer.setRenderTarget(sampleRT);
  webglRenderer.render(lastScene, lastCamera);
  webglRenderer.readRenderTargetPixels(sampleRT, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE, sampleBuffer);
  ...
}
```

**实测**：`getAverageLuminance()` 返回 `0`（不是「低」，是精确的 `0`），
`toneMappingExposure` 因此恒为 `1.0`，`AutoExposure.update()` 的
`targetLuminance / safeLuminance` 分母被 clamp 到 1e-6，曝光恒等于
`maxExposure = 8` 又被平滑拉回……整条链路是**摆设**。

**为什么是 0**：scene 的 background 是 `Color`（`this.scene.background = this.bgColor`），
`sampleRT` 是 `UnsignedByteType` + **默认无 samples + 无 toneMapping 输出链**。
`renderToTarget` 时 `renderer.toneMapping` 仍然生效，但 RT 的色深/颜色空间
与最终 canvas 输出不一致，导致回读到的字节几乎全 0（暗部被 clamp）。
而 `averageLuminanceFromRGBA` 对全 0 字节求平均 → `0`。

**改法**（两选一，推荐 A）：

- **A（推荐）**：采样时**临时关闭色调映射**并采样线性 HDR，再手动还原。
  ```ts
  getAverageLuminance: () => {
    if (!lastScene || !lastCamera) return 0;
    const prevTM = webglRenderer.toneMapping;
    const prevBT = webglRenderer.getRenderTarget();
    webglRenderer.toneMapping = NoToneMapping;   // 采样线性值，符合算法注释的「线性空间」
    webglRenderer.setRenderTarget(sampleRT);
    webglRenderer.render(lastScene, lastCamera);
    webglRenderer.readRenderTargetPixels(sampleRT, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE, sampleBuffer);
    webglRenderer.setRenderTarget(prevBT);
    webglRenderer.toneMapping = prevTM;
    return averageLuminanceFromRGBA(sampleBuffer);
  },
  ```
  同时把 `sampleRT.type` 改为 `HalfFloatType`（HDR 采样，不丢暗部），
  并在 `sampleBuffer` 处换成 `Uint16Array(SAMPLE_SIZE * SAMPLE_SIZE * 4)`，
  更新 `averageLuminanceFromRGBA` 的签名（见交付物 1）。
- **B（兜底）**：保留 UnsignedByte，但采样时 `toneMapping = NoToneMapping`，
  然后 `averageLuminanceFromRGBA` 内部按 8-bit → 线性 sRGB 反变换再求平均。

**验收硬指标**：改完 `getAverageLuminance()` 返回值必须 **> 0.001**，
且在 `17:45` 与 `06:00` 两个时刻返回值应**明显不同**（证明它在采样真实画面）。

### 根因 B：Godrays 光源位置永久冻结在默认值 (0.5, 0.8)

`src/App.tsx:375-385`：

```ts
_tmpVec.set(sun.x, sun.y, sun.z).project(eng.getCamera());
const uvX = (_tmpVec.x + 1) / 2;
const uvY = (_tmpVec.y + 1) / 2;
if (_tmpVec.z < 1) {
  bkd.setGodraysLightPosition(uvX, uvY);
}
```

**实测（17:45，相机默认位）**：
- 太阳世界坐标 `(-12.92, 4.22, -6.34)`
- 投影 NDC = `(-1.461, 0.508, 0.978)` → **UV = (-0.23, 0.754)**，**x < 0，屏幕外**
- `getGodraysLightPosition()` 返回值 = `{x: 0.5, y: 0.8}` —— **永远是初始默认值**

原因：`0.978 < 1` 这个 gate 通过了，但 UV 是负数，被写成负 UV 后又因为
某种 clip 逻辑没生效；更根本的是**太阳在世界坐标 -12.92 处（窗外 15m 外），
投影到相机视野外是必然的**——神天光柱的屏幕锚点根本不该由太阳世界坐标投影决定。

**改法**：把 godrays 的屏幕锚点改成**窗在屏幕上的中心区域**（固定锚点），
不再依赖太阳世界坐标。参考 P8b 规格「优先方案 B」的意图。具体：

- 在 `sceneEngine` 新增 `getWindowScreenAnchor(camera): {x, y, z}` 纯函数，
  把窗中心世界坐标投影到 NDC → UV。**只有当 `z < 1 && 0 <= uv.x <= 1 &&
  0 <= uv.y <= 1` 时才更新**（窗必须真在视野里）。
- `App.tsx` 的 `setFrameCallback` 调用 `setGodraysLightPosition(
  anchor.x, anchor.y)`。
- 若窗不在视野内（相机转走了），保持上一个有效锚点，不要归零。
- 太阳圆盘是否可见、光柱强度由太阳高度角决定（已有逻辑），与锚点无关。

**验收硬指标**：改完 `getGodraysLightPosition()` 返回的 x 必须在 `[0, 1]` 内
（17:45 默认相机下 x 应约 0.55–0.65，不是 0.5 的巧合默认值）。

### 根因 C：整屏只有 6 张 2048² 阴影贴图 + 3 张 512² 立方图，帧率 5 FPS

**实测（默认场景，3 盏灯具）**：
- 1 个 `DirectionalLight` castShadow, mapSize `[2048, 2048]`
- 1 个 `SpotLight` castShadow, mapSize `[2048, 2048]`
- 2 个 `PointLight` castShadow, 每个 `PointLight` 用 `PointLightShadow`
  （立方体贴图 = 6 面）, mapSize `[512, 512]`

即每帧渲染 `1 + 1 + 2×6 = 14` 张阴影贴图。**HUD 读数 5–8 FPS**，
控制台驱动 `getRenderer().info.render.calls = 1`（这是 composer 的 pass 数，
不含阴影 pass）。5 FPS 下 `Runtime.evaluate` 都会超时 5s，页面基本不可交互。

**同时还有 `godraysRT`**（`UnsignedShortType` 深度 RT，与画布同分辨率）每帧
额外渲染一次完整场景（`postProcessing.render()` 里先 `setRenderTarget(godraysRT)`
再 `render(scene, camera)`，然后 `composer.render()` 又渲染一次）→ 场景**每帧
渲染两次**，加上 14 张阴影贴图，5 FPS 是必然结果。

**改法**（按收益/风险比排序，全部要做）：

1. **只让太阳 + 最多 1 盏主灯具投阴影**。`src/render/lightBuilder.ts`：
   - `SPOT_DISTANCE`/`POINT_DISTANCE` 保留。
   - **新增** `Fixture.castShadow` 的启发式：`downlight` / `spot` 投阴影
     （向下投射，阴影落在活动区工作面上，视觉价值最高）；
     `pendant` / `sconce` / `floor` / `table` **不投阴影**（`castShadow = false`）。
   - 在 `buildLightFromFixture` 返回值里新增 `castsShadow: boolean`，
     由 `sceneEngine` 记录，供 UI 调试。
2. **阴影贴图尺寸降到 1024²**：`SHADOW_MAP_SIZE = 1024`、`POINT_SHADOW_MAP_SIZE = 512`
   保持（但点光源不再投阴影，此项实际无影响）。
3. **godrays 不再渲染两次场景**：`GodraysPass` 的深度可以**复用** composer 的
   RenderPass 输出深度（`renderPass.renderToScreen = false` 后 composer RT 已有深度），
   而不是单独 `setRenderTarget(godraysRT)` 再渲染一次完整场景。
   改法：在 `PostProcessing.render()` 里删掉「先渲染场景到 godraysRT」那 4 行，
   改成从 composer 的当前 render target 取深度纹理。
   **如果这条实现有坑（composer RT 没有 depth texture），退回方案**：
   保留双渲染，但把 `godraysRT` 的分辨率降一半（`width/2, height/2`），
   并把 `sampleCount` 默认从 24 降到 16。
4. **性能兜底**：`EffectComposer` 的 `renderTarget1/renderTarget2` 显式设
   `HalfFloatType` 已是默认，不改。但 `PostProcessing` 构造时应设置
   `composer.renderToScreen = true`（默认已如此），确认 `outputPass` 是最后一个 pass。

**验收硬指标**：`getRenderStats().fps` 在稳定 3 秒后 **≥ 30**；
`getRenderer().info.memory.textures` 应比当前（3 张，因 HUD 未含阴影图）
**至少减少一半**阴影贴图数（可通过 `info.render.shadowMap` 之类或遍历 scene
的 `isLight && castShadow` 数量验证 —— 改完应 ≤ 3 张投阴影光）。

### 根因 D：窗洞纯白 + 太阳圆盘压死 bloom

**实测**：窗洞区域在截图中几乎纯白（RGB 均值贴近 255）。原因叠加：

1. `skySun` 是 `MeshBasicMaterial` + `toneMapped: false`，颜色被钳到 `≤ 1.0`
   （`sceneEngine.ts:628-632`），但由于 `toneMapped: false`，这个 1.0 是
   **未过 ACES 的原始值**，bloom 阈值 0.85 一抓就是满强度 → 太阳圆盘
   直接糊成一大团白光。
2. 太阳圆盘半径 `SphereGeometry(1.4, ...)`，放在窗外 `SKY_SUN_DIST`（应为 15m+），
   从室内看视直径约 `2·atan(0.7/15) ≈ 5.4°` —— 相机 FOV 60°，占屏高约 9%，
   是一大块。**加上 bloom radius 0.4 + strength 0.35，这团白会晕染到整面窗。**
3. `lightShaft` 的 opacity 实测只有 **0.080**（`shaftBaseOpacity 0.15 ×
   lowAngleFactor × 1.4`），几乎不可见；而 bloom 把窗洞糊白 → 视觉上「光柱」
   其实是「窗洞被 bloom 糊成白团」。

**改法**：

1. **太阳圆盘降尺寸 + 提亮度**：`SphereGeometry(0.55, 24, 24)`（原 1.4），
   颜色**不再钳 1.0**，改为 `Math.min(r, 3.0)`（HDR 值，让 bloom 抓它、
   但本体尺寸小所以不会糊满窗）。
2. **窗框必须真正遮光**：`frame.castShadow = true` 已有，但框太细
   （`frameT = 0.06`），阴影几乎看不见。把 `frameT` 提到 `0.09`，
   并给窗加**一根中梃**（vertical mullion，`windowWidth/2` 位置），
   让光斑被切成 2–3 格。这是「落地窗室内落日光斑」的视觉核心。
3. **`lightShaft` 加强**：`shaftBaseOpacity` 从 `0.15` 提到 `0.28`，
   并做**双平面交叉**（一个 yaw 0°、一个 90°）以在任意视角都可见；
   光柱颜色随太阳高度角变化（贴近地平线更红，用 `solarColor(elevation)`）。
4. **bloom 参数收敛**：默认 `threshold 0.85` 保留，但 `strength` 从
   `0.35` 降到 `0.22`，`radius` 从 `0.4` 降到 `0.3`。目的：让太阳圆盘
   与灯罩仍被抓到，但**不再把整个窗洞糊白**。
5. **环境反射强度收敛**：`scene.environment` 的 PMREM 会让所有 PBR 面
   都反射环境光，室内白天会显得整体发灰亮。`sceneEnvironmentIntensity`
   （Three.js r163+ 支持）设 `0.35`，让环境反射只做「细节补充」而非主光。
   若 r186 支持，在 `sceneEngine.initEnvironment()` 里设置：
   ```ts
   if ('environmentIntensity' in this.scene) this.scene.environmentIntensity = 0.35;
   ```

**验收硬指标**：窗洞区域（截图中央偏右的窗）RGB 均值 **< 250** 且**不等于**
纯白；能肉眼看出窗框把光斑切成格状。

## 2. 交付物

### 交付物 1：自动曝光采样修复（`src/render/backend.ts` + `src/render/luminance.ts`）

- `sampleRT.type` → `HalfFloatType`；`sampleBuffer` → `Uint16Array`。
- `getAverageLuminance` 采样前临时 `toneMapping = NoToneMapping`，采样后还原。
- `averageLuminanceFromRGBA(buffer: Uint16Array)`：签名从 `Uint8Array` 改为
  `Uint16Array`，内部按 HalfFloat 解码（用 `DataView` + `getUint16` +
  HalfFloat→float32 转换，Three.js 有 `Float32BufferAttribute` 但没现成
  HalfFloat 解码器，自己写一个 `halfToFloat(v: number): number` 纯函数，
  抽出来单测）。

**单测** `src/render/__tests__/luminance.test.ts`（新增或追加）：
- `halfToFloat(0)` = 0；`halfToFloat(0x3C00)` = 1.0；`halfToFloat(0x7BFF)` ≈ 65504。
- `averageLuminanceFromRGBA` 输入全 0 → 返回 0；输入全 `0x3C00`（线性 1.0 的
  HalfFloat）→ 返回 0.7152（Rec.709 亮度系数 × 1.0，允许误差 1e-3）。

### 交付物 2：Godrays 屏幕锚点改为窗中心（`src/App.tsx` + `src/scene/sceneEngine.ts`）

- `sceneEngine` 新增：
  ```ts
  /** 窗中心在当前相机下投影到屏幕 UV；窗不在视野内返回 null */
  getWindowScreenAnchor(camera: Camera): { x: number; y: number } | null
  ```
  纯几何计算，抽成一个可单测的纯函数 `projectToScreenUV(
  worldPos: Vector3, camera: Camera): {x, y, z} | null`（z≥1 返回 null）。
- `App.tsx` 的 `setFrameCallback` 改为调用 `getWindowScreenAnchor`，
  拿到有效锚点才 `setGodraysLightPosition`。

**单测**：`projectToScreenUV` 在窗位于相机正前方时 UV = (0.5, 0.5)；
在窗外侧时 UV.x < 0 → 返回 null；`z >= 1`（背后/近平面外）→ null。

### 交付物 3：阴影预算收敛（`src/render/lightBuilder.ts` + `src/render/postProcessing.ts`）

- 新增导出常量 `SHADOW_CASTING_TYPES: ReadonlySet<FixtureType>` =
  `{'downlight', 'spot'}`。`buildLightFromFixture` 里 PointLight 分支与
  兜底分支的 `castShadow = false`。
- `SHADOW_MAP_SIZE = 1024`（原 2048）。
- `PostProcessing.render()`：移除「先渲染场景到 godraysRT」的双渲染。
  **改法**：给 `renderPass` 设置 `depthBuffer` 复用 —— 具体做法是
  `new EffectComposer(renderer, rt)` 时用自定义 `WebGLRenderTarget`
  带 `depthBuffer: true`，然后 `godraysPass` 通过
  `composer.renderTarget1.depthTexture` 拿深度。
  **如果实现有坑（30 分钟内搞不定）**：走兜底方案 —— 保留双渲染但
  `godraysRT` 分辨率降一半，`sampleCount` 默认 16。
  无论走哪条，**都要在代码注释里写清楚选了哪条路径**。

**验收**：遍历 scene 统计 `isLight && castShadow === true` 的数量，
改完必须 **≤ 3**（当前 4：1 directional + 1 spot + 2 point）。

### 交付物 4：窗洞与光柱视觉修复（`src/render/room.ts` + `src/render/sky.ts` + `src/scene/sceneEngine.ts` + `src/render/backend.ts`）

- `room.ts`：`frameT = 0.09`；新增窗中梃（vertical mullion），
  中梃 `castShadow = true`，加入 `windowFrame` 数组。
- `sky.ts`：`sun` 的 `SphereGeometry(0.55, 24, 24)`（原 1.4）。
- `sceneEngine.ts`：
  - `skySunMat.color` 钳到 `≤ 3.0`（不再 1.0），保留 `toneMapped = false`。
  - `shaftBaseOpacity = 0.28`（原 0.15）。
  - 光柱做**双平面交叉**：`buildLightShaft` 返回 `Mesh[]`（2 个），
    第二个 yaw 旋转 90°；或新增 `buildLightShaftCross(...)` 返回 `Group`。
    签名变更时同步更新 `volumetricShaft.test.ts`。
  - `initEnvironment()` 里加 `environmentIntensity = 0.35`（若 r186 支持）。
- `backend.ts`：默认 bloom `strength 0.22, radius 0.3`（原 0.35 / 0.4）。
  `App.tsx` 里 `setBloom(result.backend.getBloom?.() ?? null)` 保持不变。

**验收**：见 §0 判据 2、3。

## 3. 单测要求

- 既有 435 条必须全绿。
- 新增：`luminance.test.ts`（HalfFloat 解码 + 亮度平均）；
  `projectToScreenUV` 的 3 个边界用例；
  `volumetricShaft.test.ts` 更新（若签名变）。
- `sceneEngine.test.ts` 若有断言 `SHADOW_MAP_SIZE` / bloom 默认值 /
  `shaftBaseOpacity` 的用例，**更新断言**并在测试注释里写清楚原因。
- **不要**在单测里真实渲染（jsdom 无 WebGL）。

## 4. 验证

```bash
npm run verify    # typecheck + lint + 全部测试
npm run build
```

然后**必须起 dev 服务器截图目测**（Hermes 会做这一步，但你至少要跑通
`npm run verify`）。视觉判据见 §0。

## 5. 红线

- 不新增 npm 依赖，不新增图片/字体资源（贴图仍程序化）。
- 不动 ADR-08 / 02 / 13 / 17。
- 不动 UI 布局与配色（P10 的事）。
- 不动业务层不直接 import `WebGLRenderer`（ADR），仍走 `RenderBackend`。
  `PMREMGenerator` / `NoToneMapping` 通过 `backend.getRenderer()` 转型，加注释。
- 每帧不 `new` 对象（复用成员变量）。
- **不要**为了「让阴影更明显」而把 `shadow.bias` 设成很大负数导致阴影剥离
  （剥离线）—— 若阴影太软，改 `normalBias`（`0.02–0.06`）而不是 `bias`。

## 6. 提交

单个 commit：`fix(P9): real shadows, working auto-exposure, shadow budget, window fix`

不要 push。改完把 `npm run verify` 与 `npm run build` 的真实输出贴到最终回复里，
**并报告**：
- `getAverageLuminance()` 的实测返回值（必须 > 0.001）
- `getGodraysLightPosition()` 的实测返回值（x 必须在 [0,1]）
- 遍历 scene 的 `castShadow === true` 光源数量（必须 ≤ 3）
- 稳定 3 秒后的 `getRenderStats().fps`（必须 ≥ 30）
