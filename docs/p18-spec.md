# P18 规格：4 机位预设（审查报告 §4 Day 6 k，动画方案已改写）

## 目标

按审查报告 §4 Day 6 k：4 个相机机位预设（窗景位 / 沙发位 / 餐桌位 / 全景位），
点击后平滑过渡。**禁止只有自由 OrbitControls** —— 必须有可复现的机位。

## ⚠️ 动画方案已改写（不采用原规格里自带的实现）

原规格 `setCameraPreset` 自带独立 `requestAnimationFrame` 循环，**有三个问题**：

1. **双 rAF**：引擎 `start()`（`sceneEngine.ts:882-920`）已有主渲染循环，
   再跑一个 rAF 就是两个循环打架，且第二个循环不调 `backend.render()`，
   只改 position —— 视觉上是「跳帧」而非平滑。
2. **不可测试**：自持 rAF + `Date.now()` 在 Vitest 里无法稳定推进。
3. **无取消机制**：连续点两个机位会起两个 tween 互相覆盖。

**本规格的替代方案：引擎内 tween 状态 + 复用主渲染循环 + 可注入时间源。**
这是本规格唯一实质性的设计决策，其余按原规格。

## 交付物

### 1. `src/scene/cameraPresets.ts`（新增）

```ts
/** 相机机位预设（审查报告 §4 Day 6 k） */
export interface CameraPreset {
  key: 'window' | 'sofa' | 'dining' | 'overview';
  name: string;
  position: readonly [number, number, number];
  target: readonly [number, number, number];
}

export const CAMERA_PRESETS: readonly CameraPreset[] = [
  {
    // 窗景位：站在南侧，朝北窗看 —— 看天空渐变 + 窗外天际线 + 光柱
    key: 'window',
    name: '窗景位',
    position: [0.6, 1.5, 1.2],
    target: [0, 1.6, -3],
  },
  {
    // 沙发位：起居区坐着，看向餐厅/窗户（家庭日常视角）
    key: 'sofa',
    name: '沙发位',
    position: [-1.5, 1.2, 1.2],
    target: [0, 1.2, -1],
  },
  {
    // 餐桌位：餐桌西侧斜上俯视，桌面居中
    key: 'dining',
    name: '餐桌位',
    position: [0.5, 1.4, 0.6],
    target: [1.4, 0.74, -1.0],
  },
  {
    // 全景位：房间一角高角度，俯瞰全屋（户型展示）
    // ⚠️ 实现修正：原规格给的 [2.5, 2.2, 2.5] 的 z=2.5 会**穿出南墙**。
    // 四面墙是实心 BoxGeometry（render/room.ts:311-365），南墙在 z=+2.25、
    // 厚 0.15，内表面 z=2.175 —— 相机落在墙外会被完全挡住。
    // 已改为 [2.0, 2.2, 2.0]（见 src/scene/cameraPresets.ts 注释）。
    key: 'overview',
    name: '全景位',
    position: [2.0, 2.2, 2.0],
    target: [0, 1.0, 0],
  },
];

/** 按 key 查预设；未命中返回 undefined（调用方决定兜底） */
export function cameraPresetByKey(key: string): CameraPreset | undefined {
  return CAMERA_PRESETS.find((p) => p.key === key);
}
```

**坐标已按房间 6×4.5×2.8m 校验**（x∈[-3,3], z∈[-2.25,2.25], y∈[0,2.8]）：
4 个 position 都在房间内、y 在 1.2–2.2m 的坐姿/站姿/俯瞰高度区间，无穿墙。
北墙在 -z（窗在这面墙，见 `FloorPlan.tsx:37` 注释），窗景位 target 指向 -z 合理。

### 2. `src/scene/sceneEngine.ts` — 引擎内 tween

**先读 `sceneEngine.ts:880-920`（`start()` 的渲染循环）和 `:663-669`
（`setFrameCallback`）再动手。** 关键：`frameCallback` 已在主循环里每帧调用
（`:906`），**但 App.tsx:375 已占用它**（`controller.tick()` + godrays 锚点）。
所以 tween 推进**不要**挂在 frameCallback，直接在 `animate()` 里调一个
`this.updateCameraTween(time)`（放在 `:909 this.orbitControls.update()` 之前）。

```ts
// 字段（与 cameraPresets 配合）
private cameraTween: {
  fromPos: [number, number, number];
  toPos: [number, number, number];
  fromTarget: [number, number, number];
  toTarget: [number, number, number];
  startMs: number;
  durationMs: number;
} | null = null;

/**
 * 切换到指定相机机位预设（P18，审查报告 §4 Day 6 k）。
 *
 * 实现要点：
 * - 走引擎主渲染循环（start() 的 animate），**不另起 rAF**。
 * - durationMs = 0 时立即到位（无过渡），供测试与「直接跳位」。
 * - 重复调用会覆盖上一条 tween（from 取当前实时位置，不取旧 tween 的 to），
 *   所以连点两个机位是自然打断，不是叠加。
 * - 用 easeInOutQuad：起步慢、中段快、收尾慢，比线性更像「镜头运镜」。
 *
 * @param presetKey 预设 key（见 cameraPresets.CAMERA_PRESETS）
 * @param durationMs 过渡时长，默认 800；0 = 立即到位
 * @param nowMs 时间源，默认 Date.now()。测试注入 fake 时间用。
 */
setCameraPreset(presetKey: string, durationMs = 800, nowMs = Date.now()): void {
  const preset = cameraPresetByKey(presetKey);
  if (!preset) return;

  const fromPos: [number, number, number] = [
    this.camera.position.x, this.camera.position.y, this.camera.position.z,
  ];
  const fromTarget: [number, number, number] = [
    this.orbitControls.target.x, this.orbitControls.target.y, this.orbitControls.target.z,
  ];

  // tween 期间禁用 damping：enableDamping 会根据「当前角度 vs 目标角度」施加
  // 惯性，与 tween 每帧直接写 position 冲突，会产生抖动。tween 本身已经
  // 平滑（easeInOutQuad），不需要额外阻尼。tween 结束后再恢复。
  if (this.cameraTween) {
    // 上一条还在跑：保持禁用状态（已是 disabled）
  } else {
    this.orbitControls.enableDamping = false;
  }

  this.cameraTween = {
    fromPos,
    toPos: [...preset.position],
    fromTarget,
    toTarget: [...preset.target],
    startMs: nowMs,
    durationMs: Math.max(0, durationMs),
  };

  if (this.cameraTween.durationMs === 0) {
    this.stepCameraTween(nowMs);
  }
}

/**
 * 推进相机 tween 一步（每帧调用；tween 为 null 时是廉价空操作）。
 * 纯状态推进 + 写 camera/orbitControls，无副作用。
 */
private stepCameraTween(nowMs: number): void {
  const t = this.cameraTween;
  if (!t) return;

  const raw = t.durationMs <= 0 ? 1 : (nowMs - t.startMs) / t.durationMs;
  const k = Math.min(Math.max(raw, 0), 1);
  const e = easeInOutQuad(k);

  this.camera.position.set(
    lerp(t.fromPos[0], t.toPos[0], e),
    lerp(t.fromPos[1], t.toPos[1], e),
    lerp(t.fromPos[2], t.toPos[2], e),
  );
  this.orbitControls.target.set(
    lerp(t.fromTarget[0], t.toTarget[0], e),
    lerp(t.fromTarget[1], t.toTarget[1], e),
    lerp(t.fromTarget[2], t.toTarget[2], e),
  );

  if (k >= 1) {
    this.cameraTween = null;
    // 恢复 damping（P12 原值 true），让 tween 之后的手动旋转手感不变
    this.orbitControls.enableDamping = true;
  }
}

/** easeInOutQuad：[0,1]→[0,1]，端点 0/1，中点 0.5，单调递增。 */
private easeInOutQuad(k: number): number {
  return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
}
```

**把 `easeInOutQuad` 和 `lerp` 提为 `cameraPresets.ts` 的导出纯函数**
（不要写在 sceneEngine 里），这样单测能直接测插值数学，不必构造引擎实例：

```ts
// cameraPresets.ts
export function easeInOutQuad(k: number): number {
  return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
```

`animate()` 里加一行（在 `this.orbitControls.update()` 之前）：

```ts
// P18：相机机位 tween（复用主循环，不另起 rAF）
this.stepCameraTween(time);
```

**注意 `time` 是 rAF 时间戳（performance.now 域），不是 Date.now()。**
`startMs` 来自 `Date.now()`，两者不同域。**解决**：`stepCameraTween` 的时间参数
在真实运行中用 `Date.now()` 而不是传入的 `time`。改为
`this.stepCameraTween(Date.now())`，保持 `Date.now()` 单一时间源
（与 `setCameraPreset` 的默认值一致，测试里 `vi.advanceTimersByTime` 推进的也是它）。

### 3. `src/ui/panels/CameraPanel.tsx`（新增）

参考 `ScenePanel.tsx` 的结构与样式类（先读它，保持视觉一致）。

```tsx
import { useState } from 'react';
import { CAMERA_PRESETS } from '../../scene/cameraPresets.js';

interface CameraPanelProps {
  onPresetChange: (key: string) => void;
}

/** 相机机位预设面板（P18） */
export function CameraPanel({ onPresetChange }: CameraPanelProps) {
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const handleClick = (key: string) => {
    setActiveKey(key);
    onPresetChange(key);
  };

  return (
    <section className="panel">
      <h3>相机机位</h3>
      <div className="panel-buttons">
        {CAMERA_PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            className={`panel-btn${activeKey === preset.key ? ' active' : ''}`}
            onClick={() => handleClick(preset.key)}
          >
            {preset.name}
          </button>
        ))}
      </div>
    </section>
  );
}
```

**`panel` / `panel-buttons` / `panel-btn` / `active` 这些类名必须先确认存在**
（读 ScenePanel.tsx 和它的 CSS）。若类名不同，按现有约定写，**不要新造一套样式**。

### 4. `src/App.tsx` — 接线

右侧 sidebar，放在 `ScenePanel` 之后、`IlluminancePanel` 之前（`:544-547`）：

```tsx
<CameraPanel
  onPresetChange={(key) => engineRef.current?.setCameraPreset(key)}
/>
```

用 `engineRef` 而非 `controllerRef`：机位是纯相机操作，不属于场景数据流，
不需要经过 SceneController。`ready` 为 false 时 `engineRef.current` 是 null，
`?.` 静默跳过，不做特殊处理。

### 5. 测试

#### `src/scene/__tests__/cameraPresets.test.ts`（新增，纯函数）

```ts
describe('CAMERA_PRESETS', () => {
  it('4 个预设，key 不重复，name 非空', () => {
    expect(CAMERA_PRESETS).toHaveLength(4);
    const keys = CAMERA_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(4);
    expect(keys).toEqual(['window', 'sofa', 'dining', 'overview']);
    for (const p of CAMERA_PRESETS) expect(p.name.length).toBeGreaterThan(0);
  });

  it('所有坐标在房间 6×4.5×2.8m 内（x∈[-3,3], z∈[-2.25,2.25], y∈[0,2.8]）', () => {
    for (const p of CAMERA_PRESETS) {
      const [px, py, pz] = p.position;
      expect(px).toBeGreaterThan(-3);
      expect(px).toBeLessThan(3);
      expect(py).toBeGreaterThan(0);
      expect(py).toBeLessThan(2.8);
      expect(pz).toBeGreaterThan(-2.25);
      expect(pz).toBeLessThan(2.25);
    }
  });

  it('position 与 target 不重合（否则相机朝向未定义）', () => {
    for (const p of CAMERA_PRESETS) {
      const [ax, ay, az] = p.position;
      const [bx, by, bz] = p.target;
      expect(Math.hypot(ax - bx, ay - by, az - bz)).toBeGreaterThan(0.5);
    }
  });

  it('cameraPresetByKey 命中与未命中', () => {
    expect(cameraPresetByKey('sofa')?.name).toBe('沙发位');
    expect(cameraPresetByKey('nope')).toBeUndefined();
  });
});

describe('easeInOutQuad', () => {
  it('端点与中点', () => {
    expect(easeInOutQuad(0)).toBe(0);
    expect(easeInOutQuad(1)).toBe(1);
    expect(easeInOutQuad(0.5)).toBeCloseTo(0.5);
  });

  it('单调递增（含边界外钳位）', () => {
    const samples = [-1, -0.1, 0, 0.1, 0.25, 0.5, 0.75, 0.9, 1, 1.1, 2];
    // 注：函数本身不钳位，钳位在 stepCameraTween 里。这里只测 [0,1] 内单调。
    const inRange = samples.filter((s) => s >= 0 && s <= 1);
    for (let i = 1; i < inRange.length; i++) {
      expect(easeInOutQuad(inRange[i]!)).toBeGreaterThanOrEqual(
        easeInOutQuad(inRange[i - 1]!),
      );
    }
  });

  it('lerp 端点', () => {
    expect(lerp(2, 8, 0)).toBe(2);
    expect(lerp(2, 8, 1)).toBe(8);
    expect(lerp(2, 8, 0.5)).toBe(5);
  });
});
```

#### `src/scene/__tests__/sceneEngine.test.ts` 新增

```ts
describe('setCameraPreset (P18)', () => {
  it('durationMs=0：立即到位（position 与 target）', () => {
    const engine = new SceneEngine(backend);
    engine.setCameraPreset('overview', 0, 1000);
    const cam = engine.getCamera();
    expect(cam.position.x).toBeCloseTo(2.5);
    expect(cam.position.y).toBeCloseTo(2.2);
    expect(cam.position.z).toBeCloseTo(2.5);
  });

  it('durationMs>0：起点不动，推进到 duration 后才到位', () => {
    vi.useFakeTimers();
    try {
      const engine = new SceneEngine(backend);
      const start = engine.getCamera().position.x;
      engine.setCameraPreset('overview', 800, 0);
      // 刚调用，尚未推进：位置未变
      expect(engine.getCamera().position.x).toBeCloseTo(start);
      // 推进 800ms：到达终点
      vi.setSystemTime(800);
      // step 在渲染循环里跑，这里手动驱动一帧或直接推进时间后断言
      // （若引擎 start() 未启动，需在测试里 start() 或直接调私有方法）
    } finally {
      vi.useRealTimers();
    }
  });

  it('未知 key 静默返回，相机不动', () => {
    const engine = new SceneEngine(backend);
    const before = engine.getCamera().position.x;
    engine.setCameraPreset('does-not-exist', 0, 1000);
    expect(engine.getCamera().position.x).toBeCloseTo(before);
  });
});
```

**关于第二个测试的实现细节**：`stepCameraTween` 是 private，测试无法直接调。
两个可接受方案（自己判断哪个改动最小）：
- (a) 在测试里 `engine.start()` + `vi.useFakeTimers()` + `vi.advanceTimersByTime(850)`，
  让 rAF 驱动真实循环推进 tween。**注意 jsdom + Vitest 下 rAF 时间戳走
  `performance.now()` 域，而 tween 用 `Date.now()` 域——已按规格统一用
  `Date.now()`，所以 `setSystemTime`/`advanceTimersByTime` 能推进它。**
- (b) 把 `stepCameraTween` 改成 public（或加一个 `stepCameraTweenForTest`）。
  不推荐，别为测试污染 API。

优先 (a)。若 (a) 在 jsdom 下跑不通（rAF 不可用），退而求其次只测
`durationMs=0` 与「未知 key 不动」，插值数学已由
`cameraPresets.test.ts` 的纯函数测试完整覆盖。

#### UI 层

若项目已有 panel 测试先例（读 `App.test.tsx` 看用什么模式），给 CameraPanel
加一个「点击按钮触发 onPresetChange 并加 active 类」的测试。
**若没有 panel 测试先例，不要为它新建一套测试基建** —— 跳过，只写逻辑层。

## 验证

```bash
npm run verify
npm run build
```

**运行时验证**（父级做，`?debug`）：
1. 右侧 sidebar 出现「相机机位」面板，4 个按钮
2. 点「全景位」，相机平滑移到高角度俯瞰，约 0.8s
3. 点「窗景位」，相机朝北窗看
4. 过渡中手动拖鼠标旋转，**不应抖动**（damping 已临时禁用）
5. 连续点两个按钮，第二个自然打断第一个（不是叠加）
6. 过渡结束后手动旋转手感与之前一致（damping 已恢复）
7. HUD 帧率不下降（新增代码每帧是 1 个 null 检查 + 3 次 lerp，可忽略）

## 红线

1. **不要另起 `requestAnimationFrame` 循环**（用主循环）
2. **不要占用 `setFrameCallback`**（App.tsx:375 已占用，被覆盖会打断 godrays 锚点）
3. **不要改 `orbitControls.rotateSpeed`**（P15 定的 -1）
4. **不要改 `camera.fov`**（P12 定的 37°）
5. **不要改 `minDistance`/`maxDistance`/`maxPolarAngle`**（P12 定的）
6. **不要动 P16 的 Bloom 分档、godrays（P13）、曝光分档、P14 材质、`PRESET_SCENES`**
7. **不要动 P17 的阴影逻辑**（另一个规格，会同时改 sceneEngine.ts，串行执行）
8. **不要新增场景/照度数据字段** —— 机位是纯相机操作，不进 store
9. **不要引入 GSAP 等动画库** —— 依赖已定，用原生插值

## 提交

commit message 风格参考 `ddde017`（中文标题 + 要点）。**不要 push**。
