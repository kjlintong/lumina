# P9b — 曝光曲线修复 + 光柱可见性 + 小 UI 清理

> 交给 Claude Code 执行。先读 `CLAUDE.md`（ADR 与红线），再读本文件。
>
> P9 提交后 Hermes 起了 dev server 做了视觉验收，发现 P9 修好了「采样为 0」，
> 但**没修曝光算法的假设**，导致白天和夜晚 exposure 完全一样、整个画面偏暗；
> 同时 P9 为了压窗洞白把 bloom strength 从 0.35 压到 0.22，反而把 godrays
> 与 lightShaft 一起压没了。**本轮只解决这三个硬伤**，不动布局/材质/装饰。
>
> 本轮**不得破坏**任何既有测试（当前 452 条，`npm run verify` 全绿）。

## 0. 验收判据

**全部必须满足（截图目测 + 数值校验双重把关）：**

1. **12:00 中午与 21:00 夜晚的 exposure 必须不同**：`getToneMappingExposure()`
   差值 **≥ 0.15**（不是「略不同」，是肉眼可辨）。
2. **12:00 中午画面明显比 21:00 夜晚亮**：采样 12:00 与 21:00 的 `getAverageLuminance()`
   都 > 0.1（说明采样在工作），但**渲染后的画面亮度**必须不同——白天地板应能
   看清木纹细节、窗外天空是浅蓝，夜晚地板偏暗、窗外是深蓝夜空。
3. **18:30 日落时段能肉眼看到体积光束**：太阳高度角 ≈ 23°，此时
   `lightShaft.opacity` 应 **> 0.4**，且**截图里光柱穿过窗**在地板上形成可见
   的暖色斑块。若 godrays 采样通路与 lightShaft 都不明显，至少其中一者可见。
4. **室内灯具在夜晚明显发光**：21:00 时 3 盏灯具的 `emissiveIntensity` 应
   > 0.5，且截图里灯罩是画面里最亮的几个点（bloom 抓到）。
5. **时间轴药丸显示与 3D 视图时刻一致**：拖动时间轴到 21，中间 3D 视图和
   时间轴药丸都应显示 21:00。

## 1. 已确证的根因（Hermes 实测数据，直接照改）

### 根因 E：自动曝光 `targetLuminance = 0.17` 是错的假设

**实测（默认相机，1440×900 视口）**：

| 时间 | 太阳高度 | sunInt | getAverageLuminance | getToneMappingExposure |
|------|---------|--------|--------------------|----------------------|
| 12:00 | 64.8° | 2.91 | 1.21 | 0.14 |
| 17:45 | 23.6° | 1.29 | 1.14 | 0.14 |
| 18:30 | 23.5° | 0.84 | 1.20 | 0.14 |
| 19:00 | 4.1° | 0.47 | 1.24 | 0.14 |
| 21:00 | -14° | 0 | 1.21 | 0.14 |

**关键观察**：所有时刻 `lum` 都在 1.14–1.24 之间（采样到窗外天空的 linear 亮度，
因为玻璃 transmission 采样包含室外 sky scene），`targetLuminance = 0.17` 算出的
`targetExposure = 0.17 / 1.2 ≈ 0.14`，中午和夜晚一模一样。

**为什么 0.17 是错的**：0.17 是 Rec.709 中间灰在 sRGB 里的值，对应的 linear
亮度约 0.024。但我们的场景是 HDR 渲染（`sunLight.intensity` 最高 3.0、灯具
emissive 无上限），采样回来全是 1+ 的 linear 值。**用 0.17 当 targetLuminance
等于告诉算法「请把线性亮度压到 0.024」，必然全场景暗成夜晚**。

**改法**（选方案 A）：

- **A（推荐）：按太阳状态分两档曝光，不做完整 autoExposure**
  - 白天（`sunInt > 0.2`）：`exposure = 1.0` 硬锁定（ACES toneMapping 自己处理 HDR）
  - 夜晚（`sunInt < 0.05`）：`exposure = 0.5`（让室内灯具成为主视觉，但保留一些窗外月光感）
  - 过渡（`0.05 ≤ sunInt ≤ 0.2`）：线性插值到 0.5
  - 删除或降级 `AutoExposure.update()` 的使用；保留类与采样器供未来恢复

- **B（次选，若想保留自动曝光）**：把 `targetLuminance` 从 0.17 提到 1.0，
  `maxExposure = 4`，`minExposure = 0.15`；`getAverageLuminance` 采样点从
  `SAMPLE_SIZE × SAMPLE_SIZE` 缩到 `32×32`（当前默认已是 64，可再降），
  并把采样区域 mask 掉窗外 sky scene 区域（避免天空亮度污染室内曝光）。

**验收硬指标**：
- 改完 `getToneMappingExposure()` 在 12:00 = 1.0、21:00 ≤ 0.6，差值 ≥ 0.4。
- 12:00 与 21:00 的 `getAverageLuminance()` 都 > 0.1（采样器仍在正常工作）。

### 根因 F：bloom 参数被 P9 压太狠，把 godrays / lightShaft 一起压死

**现状**（P9 改后）：`strength = 0.22, radius = 0.3, threshold = 0.85`。
godrays shader 输出 `depthDiff * density * weight`（默认 `density=0.2, weight=1.0`），
叠加后亮度约 0.05–0.2，**远低于 0.85 阈值**，bloom 完全不抓它。
`lightShaft` 的 `MeshBasicMaterial` 加法混合在暗背景下 0.28 opacity 也几乎看不见。

**改法**（三条全部要做）：

1. **godrays 输出前手动放大**：`src/render/godrays.ts` 的 fragment shader 最后
   那行（`gl_FragColor = ...`）在返回前把 `scatter` 乘一个 `godraysBoost`
   uniform（默认 3.0）。这是把 godrays 从「微弱的加法混合」变成「能被 bloom
   抓到的亮点」。改完默认 `strength=0.22` 仍保留。
2. **lightShaft 基础 opacity 提到 0.6**：`sceneEngine.shaftBaseOpacity` 从 0.28
   → 0.6；`lowAngleFactor` 的分母从 `π/4` 改成 `π/6`（45° → 30°，让太阳更高时
   也保持满强度）；乘数 1.4 保留。改完 18:30（太阳 23°）opacity ≈ 0.6 × 0.77 × 1.4 ≈ 0.65。
3. **godrays 默认参数上调**：`density 0.2 → 0.5`，`weight 1.0 → 2.0`（`src/render/godrays.ts`
   `DEFAULTS` 常量）。这两个参数目前用户 UI 可以调，改默认即可。

**验收硬指标**：
- 18:30 时 `lightShaft.opacity` 采样必须 **> 0.4**（当前 0.15 上下）。
- 18:30 时 godrays shader `u.scatterBoost` 或等价 uniform 必须存在且 > 1。
- 截图里能肉眼看到光柱穿过窗（不是只有「窗口亮」）。

### 根因 G：室内灯具 emissive 在夜晚仍不够亮

**现状**：3 盏灯（fx-1/2/3）都是 PointLight + 灯罩 Mesh 有 `emissive`。
夜晚 exposure 被压到 0.14 时，emissive 被 ACES 压成几乎不可见。

**改法**：

- P9b 修完根因 E（夜晚 exposure 提到 0.5）之后，emissive 应该自然变亮。
- 若还不够：`src/render/lightBuilder.ts` 的 `FixtureLight` 里 `emissiveIntensity`
  从当前值提到 `intensity * 2`（保持 emissive 是场景里最亮的点，bloom 抓到）。
- 添加单测：夜晚时 emissive 亮度必须 > 白天（因为夜晚 exposure 更高？不对——
  应该反过来）。**验收硬指标**：21:00 时至少 1 盏灯的 `material.emissiveIntensity`
  × exposure > 0.3（能被 bloom 阈值 0.85 抓到，或直接是画面里最亮的像素）。

### 根因 H：WebGPU 警告显示成红色错误样式

**现状**：`App.tsx` 顶部的「未找到 WebGPU 图形适配器」红色 badge。WebGL2
后端已工作，这条提示是常态不该红色。

**改法**：`src/App.tsx` 找到那个 notice（可能是 `<Badge variant="error">` 或
类似），把红色 error 改成灰色 info（或干脆在开发环境才显示）。找到代码后按
现有组件体系改，不新增样式系统。

### 根因 I：时间轴与 3D 视图不同步（可能是错觉，先复核）

**症状**：Hermes 用 `engine.setHour(21)` 改时间后，3D 视图更新了但时间轴药丸
仍显示 17:45。

**先复核**：`App.tsx:434` 的 `handleAxisHourChange` 里 `setTimeValue` 是本地 state，
`engine.setHour` 是引擎。Hermes 直接调 `engine.setHour` 绕过了 React state，
所以时间轴药丸没更新是**预期行为**，不是 bug。

**改法**：不改代码，改验收脚本——Hermes 下次视觉验收时用 `document.querySelector`
触发时间轴 input 的 `onChange`（模拟真实用户拖动），或改走 `useProjectStore`
的 setter。此条**不需要代码改动**，只在验收环节处理。

## 2. 交付物

### 交付物 1：曝光曲线修复（`src/scene/sceneEngine.ts` + 可选 `src/render/autoExposure.ts`）

- `sceneEngine.updateSunPosition()` 末尾新增曝光分档逻辑：
  ```ts
  // 根据太阳状态分档曝光
  // 白天 sunInt > 0.2：固定 1.0
  // 夜晚 sunInt < 0.05：0.5
  // 过渡：线性插值
  const nightFactor = clamp01((0.2 - this.getSunIntensity()) / 0.15); // 0（白天）→ 1（夜晚）
  const targetExposure = 1.0 - nightFactor * 0.5; // 1.0 → 0.5
  this.backend.setToneMappingExposure(targetExposure);
  ```
- 把 `AutoExposure` 类保留（未来可能恢复），但 `sceneEngine` 里**停止每帧调用
  `autoExposure.update()`**；改由上方案例驱动曝光。
- 更新 `AutoExposure.update()` 里的注释，说明当前被绕过、算法备用。

### 交付物 2：godrays + lightShaft 强度恢复（`src/render/godrays.ts` + `src/scene/sceneEngine.ts`）

- `godrays.ts`：
  - `DEFAULTS.density = 0.5`（原 0.2）
  - `DEFAULTS.weight = 2.0`（原 1.0）
  - Fragment shader 新增 uniform `uBoost`（默认 3.0），最后返回前 `color.rgb *= uBoost`
  - 提供 setter `setBoost(v: number)` 供 UI 调试
- `sceneEngine.ts`：
  - `shaftBaseOpacity = 0.6`（原 0.28）
  - `lowAngleFactor` 分母从 `π/4` 改成 `π/6`

### 交付物 3：室内灯具 emissive 补强（`src/render/lightBuilder.ts`）

- `FixtureLight` 的 emissive 计算：`emissiveIntensity = baseIntensity * 2`
- 单测更新（若 `lightBuilder.test.ts` 有 emissive 断言）

### 交付物 4：WebGPU 提示降级（`src/App.tsx` 或对应组件）

- 找到「未找到 WebGPU 图形适配器」的渲染位置，从红色警告改成灰色 info
- 或者：仅在 dev mode（`import.meta.env.DEV`）显示，生产模式隐藏

## 3. 单测要求

- 既有 452 条必须全绿。
- 新增：
  - `godrays.test.ts`：`DEFAULTS.density === 0.5`、`DEFAULTS.weight === 2.0`；
    `setBoost(v)` 后 getter 返回相同值；fragment shader 源码字符串包含 `uBoost`。
  - `sceneEngine.test.ts`：
    - 12:00 时 `getToneMappingExposure()` ≥ 0.95
    - 21:00 时 `getToneMappingExposure()` ≤ 0.6
    - `shaftBaseOpacity` 断言更新到 0.6
    - 18:30 时 `lightShaft.material.opacity > 0.4`（用 stub 的 Mesh）
- `autoExposure.test.ts`：如果原本有的话，保留但加注释说明类保留、当前
  不被 sceneEngine 使用；如果没有就不新增。
- **不要**在单测里真实渲染（jsdom 无 WebGL）。

## 4. 验证

```bash
npm run verify    # typecheck + lint + 全部测试
npm run build
```

然后**必须起 dev 服务器截图目测**（Hermes 会做这一步，但你至少要跑通
`npm run verify`）。视觉判据见 §0。

**Hermes 会用浏览器控制台驱动以下数据校验**：

```js
// 每个时间点的采样脚本
const {engine, backend} = window.__luminaReady;
const results = [];
for (const h of [12, 15, 17.75, 18.5, 19, 21]) {
  engine.setHour(h);
  // 等一帧
  results.push({
    h,
    sunInt: engine.getSunIntensity(),
    exp: backend.getToneMappingExposure(),
    lum: backend.getAverageLuminance(),
    shaftOp: engine.lightShaft?.material.opacity,
    godraysBoost: backend.getGodrays()?.settings?.boost, // 若实现了
  });
}
```

期望：
- `h=12`：`exp ≥ 0.95`，`lum > 0.5`
- `h=18.5`：`shaftOp > 0.4`，`godraysBoost === 3.0`
- `h=21`：`exp ≤ 0.6`，`lum > 0.1`（夜晚采样仍在工作）
- `exp` 在 12 与 21 的差 ≥ 0.4

## 5. 红线

- 不新增 npm 依赖。
- 不动 ADR-08 / 02 / 13 / 17。
- 不动 UI 布局与配色（P10 的事）——**但根因 H 是样式降级，允许改颜色**。
- 不动业务层不直接 import `WebGLRenderer`（ADR）；通过 `backend.getRenderer()` 转型。
- 每帧不 `new` 对象（复用成员变量）。
- 若 bloom strength / threshold / radius 需要调（例如为了让 godrays 更亮把
  threshold 降到 0.6），必须在代码注释里写清楚原因，并且**不能**把窗洞重新糊白
  （P9 好不容易修好的）。**优先走 `uBoost` uniform 方案，不动 bloom 参数**。

## 6. 提交

单个 commit：`fix(P9b): exposure curves, visible godrays+shafts, warm-up UI notices`

不要 push。改完把 `npm run verify` 与 `npm run build` 的真实输出贴到最终回复里，
**并报告**（Hermes 会用浏览器驱动验证，但你先自己跑一遍）：

- 12:00 / 21:00 的 `getToneMappingExposure()`（差值 ≥ 0.4）
- 12:00 / 21:00 的 `getAverageLuminance()`（都 > 0.1）
- 18:30 的 `lightShaft.material.opacity`（> 0.4）
- 18:30 的 `godrays` `uBoost`（= 3.0）
- 21:00 时至少 1 盏灯 `emissiveIntensity × exposure > 0.3`

**视觉验收**（Hermes 会截图）：
- 12:00 窗外是浅蓝白昼天空（不是深蓝夜）
- 18:30 能看见光柱穿过窗
- 21:00 室内灯具是画面最亮点，bloom 抓到
