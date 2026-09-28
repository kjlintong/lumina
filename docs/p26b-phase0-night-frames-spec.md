# P26b · Phase 0 止血（入夜画面）

> 来源：`/home/ryan/project/Lumina项目审查与后续工作方案.md` §一.4 第 1 项 + §二 Phase 0 第 3 项。
> HEAD 基线：`7ac61a2`。
> 与 P26a 并行开发、独立提交。P26a 负责工程（WebGPU/时间/布局/dev 面板），P26b 只碰入夜画面。
> **本阶段所有画面相关改动必须由用户在真实 GPU 上判定**，WSL2 SwiftShader 截图不作数（方案 §三.1）。

---

## 1. 目标（判定标准）

在真实 GPU、1920×1080、默认相机「房间内东南角望中心」、默认工程三盏灯（筒灯 downlight 400lm / 吊灯 pendant 800lm / 落地灯 floor 600lm）全部可见且亮度 = 1.0 的前提下：

- **17:45 帧**（P26a 已改为默认冻结）：天花板接近白色但不过曝、窗外有暖色日落光、桌面反光可见 —— 与既有 P18 交付一致，不允许劣化。
- **20:00 帧**（`__lumina.setHour(20)`）：
  - **天花最亮**（P20 场景预设「会客」exposure 语义下的天花高光可见）
  - **桌面次亮**（桌面有明确反射面，反射光源位置可见）
  - **墙面有洗墙光斑**（吊灯 / 落地灯投射出柔和的墙面渐变，不是死黑也不是过曝白）
  - **地面中等暗部有细节**（地板纹理/家具轮廓可见，暗部不是纯 0 值）
- 4 张截图用户逐张判定；任一张不达标 = 阶段未完成。

---

## 2. 现状与根因分析

`src/scene/sceneEngine.ts:1100-1116`（P9b + P20 定型）：

```ts
const nightFactor = clamp01((0.2 - this.sunLight.intensity) / 0.15); // 0（白天）→ 1（夜晚）
const sunExposure = 1.0 - nightFactor * 0.5;                          // 1.0 → 0.5
let targetExposure: number;
if (this.activeSceneKey) {
  const presetExposure = presetExposureBySceneKey(this.activeSceneKey);
  targetExposure = presetExposure ?? sunExposure;
} else {
  targetExposure = sunExposure;
}
this.backend.setToneMappingExposure(targetExposure);
```

**根因**：入夜曝光从 1.0 降到 0.5，同时默认场景 `activeSceneKey === null`（用户没点场景预设），落到 `sunExposure` 分支。0.5 曝光下 3 盏室内灯（合计 1800lm ≈ 25 cd）在 ACES 下不足以撑起暗场视觉主导。

同时：
- `sceneEngine.ts:757` 附近 IBL 只有 `scene.environment = PMREM(RoomEnvironment)`，`environmentIntensity = 0.55` 恒定，没有夜间降低；但夜间环境光与人工光源比例失衡。
- `sceneEngine.ts` 里 `ambientLight / hemiLight` 兜底值是否随太阳强度衰减未查证，可能是根因之一。

**修法**：不重构曝光公式，只在夜间分支加两条：
1. 夜间曝光下限上调到 1.6（人工光源主导时曝光比白天略高，符合「让室内灯成为主视觉」的语义，方案 §Phase 0 第 3 项明确说这一目标）
2. 夜间给 ambient/hemi 一个额外兜底光（不覆盖环境光 IBL）

---

## 3. 交付物

### 3.1 夜间曝光分档上调 —— `src/scene/sceneEngine.ts`

- 第 1100 行起 `nightFactor / sunExposure` 计算公式改为：

```ts
// P9b 白天/夜晚两档曝光 + P20 场景预设覆盖（原逻辑保留）
//
// P26b 修订：入夜曝光下限从 0.5 上调到 1.6。
//
// 根因（审查报告 §一.4 第 1 项）：默认工程 3 盏灯合计 1800lm 在 ACES + exposure 0.5 下
// 画面几乎全黑。人工光源主导的夜晚场景，曝光应比白天略高（不是略低），
// 让室内灯具作为主视觉锚点。1.6 是 ACES 3000-4000K 灯罩 800lm 类光源的
// 经验下限；再高会过曝，再低画面死黑。
//
// 数值来源：审查方案 §Phase 0 第 3 项验收标准（天花最亮 + 桌面次亮 + 墙面洗墙光斑
// + 地面暗部有细节）。具体数字需在真实 GPU 上以固定机位截图迭代，
// 允许在 1.4-2.0 之间调整。
const nightFactor = clamp01((0.2 - this.sunLight.intensity) / 0.15); // 0（白天）→ 1（夜晚）
const sunExposure = 1.0 + nightFactor * 0.6;                          // 1.0 → 1.6
```

- 只改这两行 + 上方注释。**不动** `activeSceneKey` / `presetExposure` 分支，也不动 `setToneMappingExposure` 调用。
- `docs/lookdev/frames.md` 里若有「exposure 1.0 → 0.5」的表述，同步改为「1.0 → 1.6」。

### 3.2 夜间 ambient/hemi 兜底 —— `src/scene/sceneEngine.ts`

- 在 `updateSunPosition()` 方法内、更新 `sunLight` 强度之后，找到/新增如下：

```ts
// P26b：夜间环境光兜底。白天的 ambient/hemi 已经足够撑起画面，
// 但入夜后（sunInt < 0.1）若不额外补一点环境光，室内会瞬间死黑。
// 使用 sunLight.intensity 反比公式，让补光在日落过渡带（0.15–0.05）平滑爬升。
//
// 注意：**不**去改 scene.environment（PMREM IBL）的 intensity —— 那是 P12 定的
// 白昼/傍晚视觉基调，改它会连带影响白天。这里的兜底是独立的 ambient/hemi 光，
// 只在夜间贡献可见度。
const nightAmbientBoost = clamp01((0.1 - this.sunLight.intensity) / 0.1) * 0.15;
if (this.ambientLight) this.ambientLight.intensity = 0.05 + nightAmbientBoost; // 白天基线 0.05
if (this.hemiLight) this.hemiLight.intensity = 0.35 + nightAmbientBoost;        // 白天基线 0.35
```

- **注意**：以上数值（`0.05 / 0.35 / 0.15`）是审查报告根因分析下的初值；实际基线以 `sceneEngine.ts` 里构造 `ambientLight` / `hemiLight` 时设的值为**权威**（子代理 grep 一次 `new AmbientLight` / `new HemisphereLight` 确认基线值后再落地）。
- 若 ambient/hemi 在 `sceneEngine.ts` 里根本没设基线值（走 Three.js 默认 1.0），改为**不覆盖**，改为新增：`private nightAmbient: AmbientLight | null`，构造器里加进场景，只承担夜间兜底作用。**不要**动既有 ambient/hemi 的语义。

### 3.3 IES 近似路径的夜间视觉检查 —— `src/render/iesParser.ts` / `iesTexture.ts`

- 若默认工程里 pendant / downlight 用的是 IES 近似（`IES` 解析 + spotlight pattern texture），检查 `lookupCandela` 是否随角度分布给出合理分布（筒灯 36° 光束、吊灯 60° 光束）。
- **只检查、不改**：若发现 IES 分布本身有问题（例如峰值偏置），在 commit message 的 `deviations` 里说明，本轮**不**动。

### 3.4 `__lumina` 快照钩子 —— `src/dev-debug.ts`

- 新增 `nightSnapshot(): { hour: number; sunIntensity: number; toneMappingExposure: number; lights: any[]; renderInfo: any }`，输出格式与 `stats()` 一致（复用）。
- 用法：`__lumina.setHour(20); __lumina.stats()`，用户把 `stats()` 结果贴回来做诊断。

### 3.5 规格文档 —— `docs/lookdev/frames.md`

- 追加一节 `## P26b 入夜画面验收帧`：列出 17:45 / 20:00 / 21:00 三个时刻的期望视觉要点，与验收标准对应。
- 明确「WSL2 SwiftShader 截图不作数」（呼应方案 §三.1）。

---

## 4. 测试

- **不新增单元测试**：曝光与灯光分布是视觉判定，写不出稳定的数值断言。
- **既有测试**：`npm run verify` 全绿。若 `sceneEngine.test.ts` 里有关于 `sunExposure` 具体数值的断言（例如 `expect(exposure).toBe(0.5)`），改为新公式下的期望值 `expect(exposure).toBe(1.6)`，并在 commit message 里说明。
- **运行时验证**（用户执行）：
  1. `npm run dev` → 打开首页（P26a 已改为默认冻结）→ 截图 A（17:45，白天）。
  2. Console：`__lumina.setHour(20)` → 等 2 秒（sunLight 更新）→ 截图 B（20:00，人工光主导）。
  3. Console：`__lumina.setHour(21)` → 等 2 秒 → 截图 C（21:00，深夜）。
  4. Console：`__lumina.setHour(14)` → 等 2 秒 → 截图 D（14:00，正午回归测试，确认白天没被拖累）。
  5. Console：`__lumina.stats()` → 贴回 JSON。
- 4 张截图 + JSON 是**唯一**验收依据，判定权在用户。

---

## 5. 不做的事

- **不**改 `AutoExposure` 类（P9b 已定型）。
- **不**动 `presetExposureBySceneKey` 表（`src/scene/sceneSystem.ts` 里的场景预设曝光矩阵，P20 落地）。
- **不**改 `bloomForSunIntensity` 分档表（`src/render/godrays.ts` 或相关模块，P16 落地）。
- **不**改 `solar.ts`（太阳轨迹）。
- **不**改 `room.ts` / `furniture.ts` / `lightBuilder.ts` 里的灯具参数与几何。
- **不**改 CSS / 布局（那是 P26a 的范围）。
- **不**引入新依赖。
- **不**改 `docs/p25-spec.md`（P25 已归档）；本阶段新建 `docs/p26b-phase0-night-frames.md` 或直接补进 `docs/lookdev/frames.md`（子代理二选一，倾向后者）。

---

## 6. 红线

- 只碰 `src/scene/sceneEngine.ts`（曝光公式 + ambient/hemi 兜底）、`src/dev-debug.ts`（新增 `nightSnapshot` 可选，若已有 `stats` 够用则不加）、`docs/lookdev/frames.md`（追加验收帧章节）。
- **不**改 `activeSceneKey` 相关分支。
- **不**改测试断言以「凑绿」：若 `sunExposure` 有直接数值断言，改断言到 1.6 并在 commit message 说明。
- 回退成本：`git revert <P26b-hash>` 即可。改动集中在 `sceneEngine.ts` 约 10 行。

---

## 7. 提交

一次 commit：

```
P26b: Phase 0 止血（入夜画面）

- 夜间曝光下限 0.5 → 1.6：默认工程 3 盏灯合计 1800lm 在 ACES 下需要更高曝光才可见
- 夜间 ambient/hemi 兜底：sunInt < 0.1 时补 0.05→0.20 ambient + 0.35→0.50 hemi
- 新增 __lumina.nightSnapshot 快照钩子（若需要）
- 更新 lookdev/frames.md 入夜验收帧章节
- 画面判定权在用户，WSL2 SwiftShader 截图不作数
```

不 push。

---

## 8. 交付证据

回报时给出：
- `commit_hash`
- `npm run verify` 结果
- 改动文件清单（`git show --stat HEAD`）
- `sceneEngine.ts` 曝光公式与 ambient/hemi 兜底的最终代码片段（直接粘贴，便于父代理 diff）
- `deviations`

**明确声明**：本子代理**不判定**画面是否达标；4 张截图判定交给用户。
