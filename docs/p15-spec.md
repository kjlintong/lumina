# P15 规格：天空渐变颠倒 + 时间冻结 + 窗户透射（对齐帧A）

## 目标

按审查报告 §2 帧A 的验收标准，修三处画面缺陷。三条必须全部成立：
1. 窗外**天空渐变正确方向**（顶部深蓝紫 → 底部橙金）
2. 太阳**实时移动**（时间流逝、太阳高度角变化、天空颜色随之变化）
3. 窗户有**真实的透光感**（能看到外景，而不是黑块或不透明面板）

## 已核实的现状（逐条 grep + 运行时读回，直接采信）

### 问题 1：鼠标拖动反向

**结论：这不是 bug。** 我实测：
- `OrbitControls.rotateSpeed = 1`（默认值）
- `minAzimuthAngle = null`、`maxAzimuthAngle = null`（无角度限制）
- `enableDamping = true`、`dampingFactor = 0.08`
- 无 CSS `transform: scaleX(-1)` 或任何 canvas 翻转

OrbitControls 默认行为就是「鼠标向右拖 → 相机绕目标顺时针转 → 画面内容向左移动」，这是 3D 查看器的标准交互（与 Sketchfab、Google Earth 一致）。**用户觉得「反」是因为习惯鼠标跟随（画面内容跟着鼠标走），但 3D 轨道相机是相机绕目标转。这属于交互习惯差异，不是 bug。**

**但可以在规格里讨论是否改**：`rotateSpeed` 可以设成 `-1` 让方向反过来，让画面内容跟随鼠标。这是一个交互偏好问题，不是缺陷。**默认保留 rotateSpeed = 1（不改）**，除非用户明确要求反转。

### 问题 2：窗外近似黑色方块

**结论：真 bug。天空背板渐变上下颠倒。**

我读了运行时顶点色数据（`planeGeometry.attributes.color`）：

```
顶点 i=0, y=+75（顶部）→ 颜色 [0.844, 0.294, 0.042] = 橙色
顶点 i=16, y=-75（底部）→ 颜色 [0.020, 0.056, 0.159] = 暗蓝紫
```

目标帧 A 是「顶部深蓝紫、底部橙金」——**当前正好相反**。

根因在 `src/render/sky.ts:194` 的 `setSkyBackdropColors`：

```ts
const w = Math.min((t - 0.12) / (1 - 0.12), 1); // 注释：0（地平线）→ 1（天顶）
```

PlaneGeometry 的 `t = i / 16`，i=0 在顶部（y=+75）、i=16 在底部（y=-75）。当 i=0（顶部）时 `w=0`，取 `horizon`（地平线橙）；当 i=16（底部）时 `w=1`，取 `top`（天顶蓝紫）。**权重方向反了。**

代码注释写的「0（地平线）→ 1（天顶）」是设计意图，但 t 递增对应的 i 递增是**从顶到底**，不是从地平线到天顶。

### 问题 3：没有太阳实时移动 + 从窗户投射的光

**结论：真 bug。时间被冻结。**

我实测：
- `App.tsx:319` `timeSpeed: 0`
- `App.tsx:317` 注释：「P8a：初始 17:45（日落前），时间冻结（timeSpeed=0），用户拖速度滑杆才流逝」
- 运行时读回 `e.getTimeSpeed() === 0`

太阳完全静止。用户看到的画面就是 17:45 那一帧的静态图。

## 交付物

### 1. `src/render/sky.ts` — 修渐变方向

**文件位置**：`setSkyBackdropColors`，line 188-207

**修复**：把 `t` 的方向反过来，让 i=0（顶部）取 `top` 色、i=16（底部）取 `horizon` 色。

**当前**：
```ts
for (let i = 0; i <= BACKDROP_SEG; i++) {
  const t = i / BACKDROP_SEG;  // t=0 是顶部，t=1 是底部
  const w = Math.min((t - 0.12) / (1 - 0.12), 1);  // ← 方向反了
  const r = hl.r + (tl.r - hl.r) * w;
  ...
}
```

**改为**：
```ts
for (let i = 0; i <= BACKDROP_SEG; i++) {
  const t = i / BACKDROP_SEG;  // t=0 是顶部（y=+h/2），t=1 是底部（y=-h/2）
  // P15：t=0 取 top（天顶），t=1 取 horizon（地平线）。旧实现的 w 方向反了
  // （t=0 取 horizon、t=1 取 top），导致整个渐变上下颠倒——顶部本应深蓝紫
  // 却是橙色、底部本应橙金却是暗蓝紫，视觉上就是「窗外一片死黑」的根因。
  // 底部 12% 保持地平线暖色形成明显暖色带（视觉锚点），其上平滑过渡到天顶。
  const w = Math.min(t / 0.12, 1);  // 0（地平线，i=16）→ 1（天顶，i=0）
  const r = hl.r + (tl.r - hl.r) * w;
  const g = hl.g + (tl.g - hl.g) * w;
  const b = hl.b + (tl.b - hl.b) * w;
  ...
}
```

**注意**：`t=1/0.12 ≈ 8.33` 会 clamp 到 1，所以上部 88% 全是 `top` 色；下部 12%（i=14.4 起）才开始向 `horizon` 插值。这是符合原设计意图的（底部有明显暖色带，上方是天顶色）。

**测试**：`src/render/__tests__/sky.test.ts` 里如果已经断言过 `setSkyBackdropColors` 的颜色方向，必须同步修正。查一下当前测试。

### 2. `src/App.tsx` — 时间默认流逝

**文件位置**：line 317-319

**当前**：
```ts
// P8a：初始 17:45（日落前），时间冻结（timeSpeed=0），用户拖速度滑杆才流逝
initialHour: 17.75,
timeSpeed: 0,
```

**改为**：
```ts
// P15：初始 17:45（日落前），时间以 0.1 小时/秒流逝——用户 24 秒能看到
// 太阳从西斜射到日出，画面色温随之渐变。速度滑杆仍可微调（0 = 冻结）。
initialHour: 17.75,
timeSpeed: 0.1,
```

**说明**：`timeSpeed: 0.1` 意味着 24 秒过一天，节奏适中——用户能感知到「时间在流逝、太阳在移动」，又不至于快到肉眼跟不上。**用户可以在 TimeAxis 上拖到 0 冻结**（现有能力保留）。

### 3. 窗户透光感（问题 2 的另一半）

**背景**：P14 已把玻璃改成 `transmission=1.0, ior=1.5, thickness=0.01, opacity=1.0, transparent=true`。理论上是正确的物理透光。

**风险点**：`transparent: true` + `opacity: 1.0` 在 EffectComposer 后处理管线里可能有问题——透明 pass 的 renderOrder 排序、transmission renderTarget 的采样时机都可能让外景采不到。

**处理方式**：
1. **先保留 P14 的 transmission 配置**，让 P15 修完渐变 + 时间后，用户看是否窗户已经有透光感
2. **如果用户还反馈窗户黑块**，再退回 opacity 0.12 方案（把 `opacity: 1.0` 改回 `opacity: 0.12`，`transmission` 保留或去掉，看视觉权衡）

**这条不写死代码改动，等 P15 交付后用户反馈再定**——因为 SwiftShader 下我看不见，必须让真 GPU 用户判定。

## 验证

```bash
npm run verify   # 应该保持全绿
npm run build
```

**运行时验证**（父级做，不用 Claude Code 做）：
1. 浏览器 `?debug` 打开，读顶点色：顶部应是 `[0.020, 0.056, 0.159]`（暗蓝紫），底部应是 `[0.844, 0.294, 0.042]`（橙色）
2. 等 5 秒，`e.getHour()` 应增加（不再冻结）
3. 用户硬刷新真 GPU，看窗外是否变成顶部深蓝紫 → 底部橙金

## 红线

1. **不要动 `skyColors` 的关键帧数据**（`top: hex(0x1a2a4a), horizon: hex(0xe06020)` 等）——那些值是按规格定的，问题在 `setSkyBackdropColors` 的插值方向
2. **不要动 `solarPosition` / `updateSunPosition`** 的太阳天文位置算法——位置算法是对的，只是时间不流逝
3. **不要动 P14 已完成的材质**（木地板、布艺、玻璃 transmission 参数）
4. **不要动 OrbitControls.rotateSpeed**——那是交互偏好不是 bug
5. **测试同步**：如果 `sky.test.ts` 有断言顶点色方向的用例，必须同步更新为新的（正确的）方向

## 提交

commit message 风格参考 `38b6df4` / `feb01c4`（中文标题 + 要点）。**不要 push**。
