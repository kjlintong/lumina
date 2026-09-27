# P20 规格：场景曝光矩阵（§5 的 toneMappingExposure 半块）

> 依据 `../../LUMINA_两周执行规格_hermes.md` §5「场景色温与曝光矩阵」。
> §5 的 **CCT 半块已在 P12 落地**（`PRESET_SCENES` 的 `cct` 表，
> `sceneSystem.ts:75-110`），但 `toneMappingExposure` 一列从未实现——
> 曝光目前只由太阳强度分两档（`sceneEngine.ts` `updateSunPosition` 的
> P9b 曝光分档：白天 1.0 / 夜晚 0.5 / 线性插值），完全不看用户选了
> 哪个场景。这正是 §5 注释点出的失败模式：「让 autoExposure 同时承担
> 物理正确和好看两个目标」。本规格把**场景预设曝光曲线**补上。

## 1. 目标

`SceneDefinition` 增加可选 `exposure` 字段；6 个内置预设按 §5 矩阵填值；
引擎在「有激活场景预设」时用它覆盖曝光，「无激活场景」时回落到 P9b 的
太阳分档。**不改** P9b 的太阳分档公式，只在它之上加一层优先覆盖。

| 场景 | §5 目标 exposure | 现状 |
|---|---|---|
| daylight 日间 12:00 | 1.00 | — |
| sunset（17:45） | 0.85–1.05 | 无此预设，由时间轴驱动，回落 P9b 分档 ✅ 符合 §5「日落由太阳决定」 |
| dinner 晚餐 19:00 | 0.80 | 缺 |
| movie 观影 21:00 | 0.65 | 缺 |
| reading 阅读 | 0.90 | 缺（CCT 2900 已对，见 `sceneSystem.ts:103`） |
| night 夜间 02:00 | 0.55 | 缺 |

`relax`（放松）不在 §5 矩阵里：它是 `dinner`(2400K@0.65) 与 `movie`(2200K@0.15)
之间的中间态，取 **0.72**。这是本规格唯一的自行取值，理由写在字段注释里。

## 2. 交付物

### 2.1 `src/core/types.ts` — `SceneDefinition` 加可选字段

```ts
export interface SceneDefinition {
  key: string;
  name: string;
  transitionMs: number;
  /** fixtureId -> 目标亮度 0..1 */
  levels: Record<string, number>;
  /** fixtureId -> 目标色温 K */
  cct: Record<string, number>;
  /**
   * 场景预设曝光（§5 曝光矩阵）。**可选**：未定义时引擎回落到按太阳
   * 强度的分档曝光（P9b）。
   *
   * 语义是「用户选了某个场景意图」时锁定的 toneMappingExposure，
   * 优先级高于太阳分档。日落等**无对应预设**的时刻仍由太阳分档驱动，
   * 二者不冲突。
   */
  exposure?: number;
}
```

字段可选是刻意的：**用户自定义场景**（`SceneSystem.create`，
`sceneSystem.ts:453-470`）不给 exposure，回落太阳分档——避免自定义场景
意外把画面压死。

### 2.2 `src/scene/sceneSystem.ts` — 6 个预设填值

给 `PRESET_SCENES` 每一项加 `exposure`：

```ts
daylight: { ..., exposure: 1.0 },   // §5 日间 12:00
dinner:   { ..., exposure: 0.8 },   // §5 晚餐 19:00
movie:    { ..., exposure: 0.65 },  // §5 观影 21:00
relax:    { ..., exposure: 0.72 },  // §5 无此场景；取 dinner 与 movie 的中间态
reading:  { ..., exposure: 0.9 },   // §5 阅读
night:    { ..., exposure: 0.55 },  // §5 起夜 02:00
```

`cloneScene`（`sceneSystem.ts:230`）**自动带上** exposure（它是数值字段，
`{ ...scene }` 浅拷贝即含），**不要**为它加特殊处理。
`SceneSystem.create` 不填 exposure（保持回落）。

### 2.3 `src/scene/sceneEngine.ts` — 引擎读预设曝光

`updateSunPosition()` 里 P9b 曝光分档段（`:854-866`）改为：

```ts
// ---- P20：场景预设曝光优先（§5 曝光矩阵）----
// 有激活场景预设且它声明了 exposure 时，用它覆盖太阳分档。
// 语义：用户选了「观影」就是想看暗场，不该因为太阳还在 0.85。
// 无激活场景（用户手动调灯）时回落 P9b 太阳分档，保持昼夜连续过渡。
// 注意：这里是**覆盖**不是**替换** —— P9b 的太阳分档公式原样保留，
// 作为 fallback 与手动调灯时的曝光源。
let targetExposure: number;
if (this.activeSceneKey) {
  const presetExposure = presetExposureBySceneKey(this.activeSceneKey);
  targetExposure = presetExposure ?? sunExposure;
} else {
  targetExposure = sunExposure;
}
this.backend.setToneMappingExposure(targetExposure);
```

其中 `sunExposure` 是原来那段的两行：

```ts
const nightFactor = clamp01((0.2 - this.sunLight.intensity) / 0.15);
const sunExposure = 1.0 - nightFactor * 0.5;
```

**新增 `src/render/sceneExposure.ts`**（纯函数，便于单测）：

```ts
/**
 * 场景预设 -> 曝光的纯查表（P20，§5 曝光矩阵）。
 *
 * 独立成文件而非写在 sceneEngine 里：曝光矩阵是数据不是逻辑，
 * 抽出来可以让 sceneEngine 只做「查 → 用」，单测不必构造引擎实例。
 *
 * 为什么不直接 import PRESET_SCENES：那是 sceneSystem.ts 的运行时表，
 * 由用户可扩展（SceneSystem.create 可加自定义场景）。查表必须容忍
 * 表里查不到（自定义场景 / key 已删），所以这里做成纯函数而非闭包。
 */
import { PRESET_SCENES } from '../scene/sceneSystem.js';

/** 按场景 key 取预设曝光；未命中或未定义返回 undefined。 */
export function presetExposureBySceneKey(
  sceneKey: string,
): number | undefined {
  const preset = PRESET_SCENES[sceneKey as keyof typeof PRESET_SCENES];
  return preset?.exposure;
}
```

**导入方向检查**：`sceneSystem.ts` 只 import `../core/types.js`（`:21`），
不 import 引擎，所以 `sceneExposure.ts` import `sceneSystem.ts` 不构成环。
`sceneEngine.ts` 再 import `sceneExposure.js` 也没有环。

`setActiveScene(sceneKey)`（`:687`）保持只存 key —— 曝光在每帧
`updateSunPosition()` 里查表，不需要在 set 时快照（`updateSunPosition`
每帧都跑，`setHour`/`advanceTime`/`start()` 都会触发）。

## 3. 测试

### `src/render/__tests__/sceneExposure.test.ts`（新增）

```ts
import { describe, expect, it } from 'vitest';
import { PRESET_SCENES } from '../../scene/sceneSystem.js';
import { presetExposureBySceneKey } from '../sceneExposure.js';

describe('场景曝光矩阵（P20，§5）', () => {
  it('6 个内置预设全部声明了 exposure', () => {
    for (const scene of Object.values(PRESET_SCENES)) {
      expect(
        typeof scene.exposure,
        `${scene.key} 应当声明 exposure`,
      ).toBe('number');
    }
  });

  it('§5 矩阵目标值（日间 1.00 / 晚餐 0.80 / 观影 0.65 / 阅读 0.90 / 夜间 0.55）', () => {
    expect(presetExposureBySceneKey('daylight')).toBe(1.0);
    expect(presetExposureBySceneKey('dinner')).toBe(0.8);
    expect(presetExposureBySceneKey('movie')).toBe(0.65);
    expect(presetExposureBySceneKey('reading')).toBe(0.9);
    expect(presetExposureBySceneKey('night')).toBe(0.55);
  });

  it('relax 取 dinner 与 movie 的中间态（§5 无此场景，本规格自行取值）', () => {
    expect(presetExposureBySceneKey('relax')).toBeGreaterThan(0.65);
    expect(presetExposureBySceneKey('relax')).toBeLessThan(0.8);
  });

  it('未知 key 返回 undefined（自定义场景回落太阳分档）', () => {
    expect(presetExposureBySceneKey('does-not-exist')).toBeUndefined();
  });

  it('所有 exposure 在 [0.3, 1.2] 合理区间内（防止误填把画面压死）', () => {
    for (const scene of Object.values(PRESET_SCENES)) {
      expect(scene.exposure).toBeGreaterThanOrEqual(0.3);
      expect(scene.exposure).toBeLessThanOrEqual(1.2);
    }
  });
});
```

### `src/scene/__tests__/sceneEngine.test.ts` 新增

已有 37 条引擎用例，沿用现有 `backend` mock 构造方式（见 `:469` 一带）。

```ts
describe('场景预设曝光（P20，§5 曝光矩阵）', () => {
  it('激活 reading 场景时曝光为 0.9（覆盖太阳分档）', () => {
    const engine = new SceneEngine(backend);
    engine.setHour(12); // 正午太阳，太阳分档会给 1.0
    engine.setActiveScene('reading');
    // 触发一帧太阳更新（setHour 已调 updateSunPosition）
    expect(backend.setToneMappingExposure.mock.calls.at(-1)?.[0]).toBeCloseTo(0.9);
  });

  it('无激活场景时回落太阳分档（正午 = 1.0）', () => {
    const engine = new SceneEngine(backend);
    engine.setActiveScene(null);
    engine.setHour(12);
    expect(backend.setToneMappingExposure.mock.calls.at(-1)?.[0]).toBeCloseTo(1.0);
  });

  it('夜间太阳 + 激活 night 场景 → 0.55 而非太阳分档的 0.5', () => {
    const engine = new SceneEngine(backend);
    engine.setHour(2);
    engine.setActiveScene('night');
    expect(backend.setToneMappingExposure.mock.calls.at(-1)?.[0]).toBeCloseTo(0.55);
  });

  it('setActiveScene(null) 后恢复太阳分档', () => {
    const engine = new SceneEngine(backend);
    engine.setActiveScene('movie');
    engine.setHour(12);
    expect(backend.setToneMappingExposure.mock.calls.at(-1)?.[0]).toBeCloseTo(0.65);
    engine.setActiveScene(null);
    engine.setHour(12);
    expect(backend.setToneMappingExposure.mock.calls.at(-1)?.[0]).toBeCloseTo(1.0);
  });
});
```

**关键**：`setActiveScene` 只存 key，不触发渲染更新。所以测试里必须
**在 setActiveScene 之后调一次 `setHour`**（或 `advanceTime`）来触发
`updateSunPosition()` 重算曝光。若 `backend.setToneMappingExposure` 在当前
mock 里未配置，按现有 `backend` mock 的补法加（参考 sceneEngine.test.ts 已有的
`setBloom` / `getBloom` mock 写法）。

**别用 `Date.now()` 相关断言**：曝光与时间源无关，纯查表 + 太阳强度。

## 4. 验证

```bash
npm run verify
npm run build
```

**运行时验证**（父级做，需真实 GPU 机器）：
1. 不选任何场景（手动调灯）→ 时间轴拖过中午/深夜，曝光随太阳变化（P9b 行为不变）
2. 点「观影」→ 曝光立刻压到 0.65，画面整体变暗（哪怕正午）
3. 点「阅读」→ 0.90，比观影亮、比日间稍暗，灯罩 2900K 暖光
4. 点「夜间」→ 0.55，接近但略高于纯夜间太阳分档的 0.5
5. 连续切场景，曝光**立即切换**（不插值）—— §5 的语义是「固定曝光曲线」，
   过渡由 `transitionMs` 的灯亮度/色温过渡负责，曝光不做 tween

## 5. 红线

1. **不改 P9b 的太阳分档公式**（`1.0 - nightFactor * 0.5`），只加覆盖层。
2. **不改 P16 的 Bloom 分档**（`bloomForSunIntensity`）、**不改 P13 godrays**、
   **不改 P12 的 camera / CCT 矩阵 / IBL**、**不改 P17 阴影**。
3. **不给 `SceneSystem.create` 生成的自定义场景填 exposure**（保持回落）。
4. **不改 `SceneDefinition` 的既有字段**，只加可选 `exposure?`。
   `serialize.ts` 的 `schemaVersion: 1` **不变**（新增可选字段向后兼容）。
5. **不改 `PRESET_SCENES` 的任何 levels / cct / transitionMs**——本轮只加 exposure。
6. **不做曝光 tween**（§5 明说是「固定曝光曲线」）。
7. **不新增依赖**、**不改 `useProjectStore`**、**不动 P19 的专业模式门禁**。
8. **不要 push**（父级统一提交）。

## 6. 提交

```
P20: 场景曝光矩阵（§5 toneMappingExposure 半块）

- SceneDefinition 加可选 exposure 字段（自定义场景回落太阳分档）
- 6 个内置预设按 §5 填值；relax 取 dinner/movie 中间态 0.72
- 新增 src/render/sceneExposure.ts 纯查表函数
- sceneEngine：激活场景预设曝光优先于 P9b 太阳分档（覆盖不替换）
- sceneExposure.test.ts 5 条 + sceneEngine.test.ts 4 条
```

**不要 push**。
