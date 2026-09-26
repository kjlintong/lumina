# P8 — 视觉升级第一阶段：可见的、有氛围的房间

> 交给 Claude Code 执行。先读 `CLAUDE.md`（ADR 与红线），再读本文件。
> 现状：`npm run verify` 全绿（310 测试），工作树干净。本轮**不得破坏**任何既有测试。
> 本文件是一个更大计划（对标两个参考项目）的**第一阶段**。第二阶段（体积光/尘埃粒子）、
> 第三阶段（HUD 重做）会另出规格文件，**本轮不要碰它们**。

## 0. 目标

当前 3D 画面是「昏暗、发灰、无材质、无氛围」的房间，与目标（参考项目那种
可识别的木质室内、暖色夕照、明确的光影层次）**差距巨大**。本阶段只解决
**基础可见性与材质可信度**，不追求体积光与 UI。

**验收判据（全部必须满足）：**

1. **首屏可读**：应用加载后（时间停在默认时刻，不自动流逝），画面能清楚看到
   房间四壁/地板/家具，**平均画面亮度明显高于现在**（截图目测：家具轮廓清晰、
   墙面有色温差异、能辨认是室内而非黑盒子）。
2. **时间不再自己跑**：默认 `timeSpeed = 0`，除非用户拖动速度滑杆。
   用户拖时间滑杆能立刻看到白天/黄昏/夜晚之间的差异。
3. **材质可信**：地板是木地板观感、有可见木纹（Canvas 程序化贴图），
   墙面有轻微法线起伏或明暗变化（不是死平一块色），家具材质分木/布/石材三档且色相有区分。
4. **窗洞与室外**：房间有一面落地玻璃窗，窗外有可见的室外天空/远景（不是黑洞），
   太阳光能从窗外打进来在地板上留下可见的光斑与阴影。
5. **夜间不黑死**：太阳落山后，室内仅靠灯具仍有可读画面（不是当前这种近乎全黑）。

## 1. 已确认的根因（先读代码，别重新发现）

以下是我实测诊断出的问题，**直接照改**：

### 根因 A：时间默认 0.5 小时/秒自动流逝 → 画面常年是深夜

`src/scene/sceneEngine.ts` 构造器：`this.timeSpeed = config.timeSpeed ?? 0.5;`
而 `start()` 里每帧 `this.advanceTime(deltaTime)`。0.5 h/s = 1 小时/2 分钟，
所以页面挂 4 分钟就跑到后半夜，`sunLight.intensity = 0`，室内只有三盏
~50–190 cd 的灯具，画面必然黑。这是「黑屏」的最大元凶。

**改法**：`src/App.tsx` 里 `new SceneEngine(...)` 的 `timeSpeed` 显式传 `0`，
React state 的 `speed` 初始值也改成 `0`。滑杆 `max` 保持 3。**不要**把 `advanceTime`
逻辑删掉——用户调速度滑杆仍要能走。

### 根因 B：`updateSunPosition()` 把背景色写得太暗

`src/scene/sceneEngine.ts` 的 `updateSunPosition()` 里，背景色分支全部是深色：
`0x0a0a1a`（夜）、`0x1a0a05`（日出日落）、`0x1a1520`（傍晚）、`0x87ceeb`（白天）。
17:00–20:00 整段都是接近黑色的背景，加上室内无窗，等于纯黑房间。

**改法**：背景色改为随太阳高度角**平滑插值的渐变**（见 §2 交付物 3）。
不要用 `new Color(...)` 每帧新建对象——用 `this.scene.background` 复用同一个
`Color` 实例并 `lerpColors` / `copy`。

### 根因 C：环境光太弱且无环境反射

`AmbientLight(0x404040, 0.1~0.5)` + `HemisphereLight(..., 0.05~0.35)`，
夜间只剩这点光，室内照度趋零。更关键的是 **scene.environment 从未设置**，
`MeshStandardMaterial` 没有任何环境反射，所有漫反射面都是「死灰」。

**改法**（见 §2 交付物 4）：
- 引入 `RoomEnvironment`（`three/examples/jsm/environments/RoomEnvironment.js`）
  生成一张 PMREM 环境贴图，赋给 `scene.environment`。这是让室内材质「活起来」
  的最小成本手段。
- 注意：**不要**把它赋给 `scene.background`（那会变成灰白房间外壳），
  背景仍由交付物 3 的渐变负责。
- 夜间时降低环境光/半球光强度到很低（~0.05），白天拉高，但都**不要为 0**——
  否则 ACES 会把暗部压成纯黑。

### 根因 D：房间是封闭的盒子，没有任何窗

`src/render/room.ts` 的 `buildRoom()` 建了四面完整 `BoxGeometry` 墙。
相机在房间内部 `(2.5, 1.8, 1.9)`，所以永远看不到室外，太阳也打不进来。
参考项目里「窗」是光影氛围的来源，缺了它整个画面就没有戏剧性。

**改法**（见 §2 交付物 5）：把**北墙**（`z = -depth/2`，相机看不到的一对面）
改成「窗框 + 玻璃 + 墙体分段」的组合，让太阳从北侧打进来。

## 2. 交付物

### 交付物 1：程序化材质贴图模块 `src/render/materials.ts`（新建）

不要引入任何图片资源、不要依赖网络。全部用 `CanvasTexture` 在运行时程序化生成。

> **重要：jsdom 没有 canvas 2D 上下文。** 我实测过：测试环境（Vitest + jsdom）里
> `canvas.getContext('2d')` 返回 `null`。所以**不要**把贴图生成的主路径写进单测里调用。
> 正确做法：把**纯逻辑**抽成导出的纯函数，贴图工厂函数只是调用纯函数 + 填 canvas。
> 单测只测纯函数。这样既能在真实浏览器渲染出贴图，又能在 jsdom 里测逻辑。

导出：

```ts
// ---- 纯逻辑（单测目标）----

/** 种子随机数（mulberry32）。同 seed 产出同一序列，保证贴图确定性。 */
export function mulberry32(seed: number): () => number

/** 木地板贴图参数 */
export interface WoodFloorSettings {
  plankWidth?: number;      // 默认 0.16
  baseColor?: number;       // 默认 0x9c7048
  resolution?: number;      // 默认 512
  repeat?: number;          // 默认 3
  seed?: number;            // 默认 12345
}

/** 计算木地板某一点的颜色。纯函数。
 * @param u 板内横向坐标 0..1  @param v 板内纵向坐标 0..1
 * @param plank 当前板索引
 * @returns { r, g, b } 0..255
 */
export function woodFloorColor(u: number, v: number, plank: number, baseColor: number): { r: number; g: number; b: number }

/** 计算墙面法线贴图某一点的颜色。纯函数。
 * @returns { r, g, b } 0..255，b 恒接近 255
 */
export function wallNormalColor(x: number, y: number): { r: number; g: number; b: number }

/** hex 颜色拆分（工具函数，纯） */
export function hexToRgb(hex: number): { r: number; g: number; b: number }

// ---- Canvas 工厂（浏览器运行时调用，单测不调用）----

export function makeWoodFloorTexture(settings?: WoodFloorSettings): CanvasTexture
export function makeWallNormalTexture(resolution?: number): CanvasTexture
export function makeFabricTexture(baseColor: number, resolution?: number): CanvasTexture
```

实现要点：
- 木地板：横向木板带 + 每块板的随机色差（±8% 明度）+ 沿板长方向的细木纹噪声
  （多层正弦 + 随机扰动即可，不要追求真实木纹精度）+ 板缝（深色 1–2px 线）。
- `wrapS = wrapT = RepeatWrapping`，`repeat.set(repeat, repeat)`，
  `colorSpace = SRGBColorSpace`（颜色贴图必须），`anisotropy` 设 4。
- 法线贴图用 `ColorSpace.NoColorSpace`（线性），颜色编码法线（法线贴图约定：
  R/G 表示 x/y 偏移，B 恒近 1）。起伏幅度要小（±0.03 左右），别做成浮雕。
- 用 `THREE.CanvasTexture`，`new CanvasTexture(canvas)`。
- `makeWoodFloorTexture` 内部：`const rnd = mulberry32(12345)`（固定 seed），
  遍历像素调用 `woodFloorColor(...)` 填充 `ImageData`，`ctx.putImageData`。
- **Canvas 不可用时的防御**：`getContext('2d')` 返回 `null`（jsdom / 极端环境）时，
  工厂函数**不要抛错**——返回一个退化的 `CanvasTexture`（用 1x1 canvas + `data:`
  方案，或返回 `null` 并在调用方判空）。推荐后者：工厂返回 `CanvasTexture | null`，
  `room.ts` 判空后跳过 `material.map` 赋值。这样单测能安全 import 而不崩。

单测 `src/render/__tests__/materials.test.ts`（**只测纯函数，不调 canvas**）：
- `mulberry32(42)()` 连续两次调用产出完全相同的序列。
- `woodFloorColor` 返回值都在 [0, 255] 范围内；相邻板（plank 0 vs 1）在同一 (u,v)
  处颜色不同（验证了板间色差）。
- `wallNormalColor` 的 `b` 在 [230, 255] 区间（法线贴图 B 通道约定）。
- `hexToRgb(0x9c7048)` 返回 `{ r: 156, g: 112, b: 72 }`。

### 交付物 2：房间外壳升级 `src/render/room.ts`（修改）

保持 `buildRoom(width, depth, height): RoomBuildResult` 的签名与既有语义
（`room.test.ts` 有 7 个测试，**必须继续通过**）。新增一个可选参数：

```ts
export interface RoomBuildOptions {
  /** 是否建窗（默认 true） */
  withWindow?: boolean;
  /** 窗在墙上的位置参数（默认合理值） */
  windowWidth?: number;    // 默认 width * 0.7
  windowHeight?: number;   // 默认 height * 0.8
  windowSill?: number;     // 默认 0.25
  /** 地板木纹贴图（可选注入，默认调用 makeWoodFloorTexture()） */
  floorTexture?: CanvasTexture;
  /** 墙面法线贴图 */
  wallNormalTexture?: CanvasTexture;
}
```

改动：
- 地板：`material.map = floorTexture`，`material.displacementScale = 0`（不需要位移）。
  保留 `receiveShadow = true`、`castShadow = false`。
- 墙面：`material.normalMap = wallNormalTexture`，`normalScale = new Vector2(0.4, 0.4)`。
  保留 `castShadow/receiveShadow = true`。
- **北墙**（`z = -depth/2`）改为分段：窗左侧墙体 + 窗右侧墙体 + 窗上方过梁 + 窗下方窗台墙，
  中间留洞。窗洞内放：
  - 窗框：4 根细木条（`BoxGeometry`，深色木），`castShadow = true`。
  - 玻璃：`MeshPhysicalMaterial`，`transmission = 0.9`、`roughness = 0.05`、
    `thickness = 0.02`、`transparent = false`（transmission 模式不需要 transparent）。
    `receiveShadow = false`、`castShadow = false`（玻璃不投影，否则窗框阴影会消失——
    实际是玻璃挡光但保留光通过，用 transmission 表达）。
  - **注意**：`MeshPhysicalMaterial` 的 `transmission` 需要 WebGL2 + 支持，
    如果导致性能问题，退化为 `MeshPhysicalMaterial` + `transparent: true, opacity: 0.08`。
    先用 transmission，写注释说明退化方案。
- 新增导出字段 `windows: Mesh[]`（玻璃 mesh），`windowFrame: Mesh[]`。
  这些**必须**放进返回的 `group`。
- 材质创建时给每个 mesh 独立的 material 实例（当前代码已是如此，保持）。

### 交付物 3：天空/室外与背景渐变（新建 `src/render/sky.ts`）

```ts
export interface SkySettings {
  /** 太阳高度角（弧度） */
  elevation: number;
  /** 太阳方位角（弧度） */
  azimuth: number;
}

/**
 * 根据太阳角度返回一组颜色，供引擎设置背景渐变与半球光。
 * 纯函数、无副作用、无 Three.js 依赖（返回 plain {r,g,b}），便于测试。
 */
export function skyColors(elevation: number): {
  top: { r: number; g: number; b: number };
  horizon: { r: number; g: number; b: number };
  ambientSky: { r: number; g: number; b: number };
  ambientGround: { r: number; g: number; b: number };
  background: { r: number; g: number; b: number };
}
```

关键帧（务必覆盖，参考真实日落色温）：
- 正午（elevation ≥ π/3）：top `#4a90d9`，horizon `#cfe8ff`，background `#9fc5e8`
- 傍晚（elevation ≈ π/8，约 11°）：top `#2a4a7a`，horizon `#ff9a4d`，background `#3a4a6a`
- 日落（elevation ≈ π/30，约 6°）：top `#1a2a4a`，horizon `#ff6a2a`，background `#22203a`
- 黄昏（elevation ≈ 0）：top `#0d1830`，horizon `#c44a1a`，background `#0f1428`
- 夜晚（elevation < 0）：top `#05080f`，horizon `#0a1020`，background `#070a14`

用线性插值在三元关键帧之间过渡（写一个 `lerpColor(a, b, t)` 和 `smoothstep`）。
**夜晚 horizon 不能是纯黑**——保留一点蓝，否则 ACES 会把整屏压死。

另外新增：

```ts
/** 室外场景：一个放在窗外的远景 group（太阳圆盘 + 远景色块） */
export interface SkySceneResult { group: Group; sun: Mesh; }

export function buildSkyScene(windowWorldPos: Vector3, windowNormal: Vector3): SkySceneResult
```

- 太阳圆盘：`MeshBasicMaterial` + `SphereGeometry`（`toneMapped = false`，
  保证它是亮的、会触发 bloom），位置在窗外 15m 处。引擎每帧根据太阳角度移动它。
- 远景：3–4 个大 `PlaneGeometry` 色块排在窗外，代表远山/城市天际线剪影，
  颜色深、`MeshBasicMaterial`（不受访光影响，始终可见），`depthWrite` 正常。
- 所有室外物体放在一个 `group` 里，group 命名为 `sky-scene`，
  **不参与阴影**（`castShadow = receiveShadow = false`）。
- 组整体沿 `windowNormal` 方向外推放置（窗外），这样从室内看窗户能看到室外。

单测 `src/render/__tests__/sky.test.ts`：
- `skyColors` 在 elevation=0 时 background 的 r > b（暖）；elevation=π/2 时 b > r（冷）。
- 单调性：elevation 从 0 升到 π/2，top.b 单调不减。
- elevation 为负时 background 亮度 < 0.1（暗）但不为 0。
- `buildSkyScene` 返回的 group 含 ≥ 1 个 `Mesh`，sun 的 material 是 `MeshBasicMaterial`
  且 `toneMapped === false`。

### 交付物 4：`src/scene/sceneEngine.ts`（修改）

- `timeSpeed` 默认值改为 `0`（见根因 A）。`SceneEngineConfig.timeSpeed` 注释更新。
- 新增 `scene.environment`：构造时
  ```ts
  const { RoomEnvironment } = await import(...)  // 不行，构造器是同步的
  ```
  **构造器是同步的**，所以改用同步导入：
  `import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';`
  然后
  ```ts
  const pmrem = new PMREMGenerator(this.backend.getRenderer() as WebGLRenderer);
  this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0).texture;
  ```
  **已实测核实（P0 式核实，不要凭记忆改）**：
  - `RoomEnvironment` 构造函数**无参数**（已读 `node_modules/three/examples/jsm/environments/RoomEnvironment.js`）。
  - `PMREMGenerator.fromScene(scene, sigma = 0, near = 0.1, far = 100, options = {})`
    —— sigma 传 `0` 即可（`three` r186 `three.module.js` 实测签名）。若 `fromScene` 返回的 texture 需要 dispose 管理，把 `pmrem`
  存起来在 `dispose()` 里清理。
  - 若 `PMREMGenerator` 在 WebGPU 后端上不可用（它依赖 WebGL 内部 API），
    用 `this.backend.type === 'webgl2'` 守卫，WebGPU 路径跳过环境贴图（保留 ambient/hemi）。
    这点在注释里说明。
- 把背景色设置改为**复用同一个 Color 实例**：
  ```ts
  private bgColor = new Color();
  // updateSunPosition 内：
  const c = skyColors(elevation);
  this.bgColor.setRGB(c.background.r, c.background.g, c.background.b);
  this.scene.background = this.bgColor;
  ```
  半球光颜色与强度同样由 `skyColors` 驱动（`ambientSky` / `ambientGround`），
  不要再用写死的 `0x87ceeb` / `0x362d1e`。
- 夜晚/白天强度曲线（替换当前的 `0.1 + dayFactor * 0.4`）：
  - `ambientLight.intensity = 0.04 + Math.max(0, Math.sin(elevation)) * 0.55`
  - `hemiLight.intensity = 0.05 + Math.max(0, Math.sin(elevation)) * 0.35`
  - 太阳强度保持 `Math.sin(elevation) * 3.0`，但**下限保护**：
    当 elevation 在 (0, π/12) 即日落前后，强度不应断崖归零，用
    `intensity = Math.pow(Math.max(0, Math.sin(elevation)), 0.7) * 3.0`
    让暖光在贴地平线时仍有可见强度。
- 把太阳**位置**改成从窗侧打入：当前太阳沿方位角在房间周围 20m 处运动，
  但北墙是窗所在面（z = -depth/2）。让太阳在日落前后主要位于北侧偏西
  （即 `azimuth` 计算出的位置投影到窗外），这样光斑能落在室内地板上。
  具体：保持 `solarPosition()` 的天文计算不变，但在 `updateSunPosition()` 里
  把最终 `sunLight.position` 限制在窗外距离（12–20m），并保证其 z 分量 < 0
  （北侧）。加注释说明这是为了窗内光斑的视觉效果做的取景调整，
  **不是**修改天文公式。
- `dispose()` 里清理 PMREM 产物与环境贴图 texture。
- 新增 `updateSky()` 或直接把 `buildSkyScene` 的结果存为字段，
  在 `updateSunPosition()` 里移动 `sun` 的 mesh 位置与颜色
  （`MeshBasicMaterial.color.setRGB(...)`，按 `solarColor(elevation)`；
  日落时更红更亮，`sun.material.color.multiplyScalar(1.5)` 也可以，注意不要溢出）。

**`sceneEngine.test.ts` 有 26 个测试，必须全部继续通过。** 如果 `timeSpeed` 默认值
被某个测试断言为 0.5，**更新那个测试的断言**（这是有意变更，在测试注释里写清楚原因）。

### 交付物 5：`src/App.tsx`（修改）

- `new SceneEngine(result.backend, { ..., timeSpeed: 0 })`。
- `const [speed, setSpeed] = useState(0)`。
- 底部时间滑杆：`<input type="time" min="00:00" max="23:59">`，
  并把范围收到 **16:00 – 21:00**（这是产品主场景：日落到夜晚），
  即 `min="16:00" max="21:00"`，`step={300}`（5 分钟）。
- 时间输入值 `timeValue` 初始 `'17:45'`，`initialHour: 17.75`。
- **不要**在本阶段动 UI 布局与样式——那是第三阶段的事。

## 3. 单测要求

新增/修改测试后必须覆盖：
- `materials.test.ts`（新，见交付物 1）
- `sky.test.ts`（新，见交付物 3）
- `room.test.ts`（既有 7 个必须绿；新增：`withWindow: false` 时不产生玻璃 mesh、
  `windows.length === 0`；默认时 `windows.length >= 1` 且玻璃 material 有 `transmission`）
- `sceneEngine.test.ts`（既有 26 个必须绿）

测试写法与现有保持一致：Vitest，纯逻辑函数优先测纯函数，Three.js 对象断言结构
（类型、children 数量、布尔标志），**不要**在测试里真实渲染。

## 4. 验证

```bash
npm run verify    # typecheck + lint + 全部测试
npm run build
```

两条都必须绿。然后我会用浏览器实测画面（截图 + 目测），
所以**请确保 `npm run dev` 起来后首屏不是黑的**。

## 5. 红线

- **不得破坏 310 个既有测试**（个别因 timeSpeed 默认值变更需更新的除外，且要写注释）。
- **不得新增任何 npm 依赖**。只用 `three` 现有导出 + `three/examples/jsm/...`。
- **不得引入图片/字体等静态资源文件**，所有贴图程序化生成。
- **不得 import `three/addons` 桶文件**，按具体路径导入
  （如 `three/examples/jsm/environments/RoomEnvironment.js`）。
- **不得用 `any`**，TypeScript strict。ESLint 有一条 `consistent-type-imports`：
  不能用 `import()` 内联类型标注，必须顶层 `import type`。
- **业务层不得直接 import `WebGLRenderer`/`WebGPURenderer` 构造实例**（ADR），
  仍走 `RenderBackend` 抽象。`sceneEngine` 里如确需 `PMREMGenerator`，
  通过 `this.backend.getRenderer()` 转型，并加注释。
- **ADR-17 user-locked、ADR-02 自动解绑、ADR-13 旋转跟随**等既有不变式不得破坏。
- 每帧不要 `new Color()` / `new Vector3()`（GC 压力），复用成员变量。

## 6. 提交

单个 commit，信息格式：`feat(P8a): room materials, window glazing, sky gradient, frozen time`
不要 push。改完把 `npm run verify` 与 `npm run build` 的真实输出贴到最终回复里。
