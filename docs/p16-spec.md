# P16 规格：Bloom 按太阳高度分档

## 目标

按审查报告 §4 Day 4 h「Bloom 定版」，把 Bloom 从固定单档改成按太阳高度分三档：
- 日间（elevation ≥ 0.262，即 sunInt > 0.2）：strength 0.25 / radius 0.70 / threshold 0.85
- 日落（elevation ∈ (0, 0.262)，即 sunInt ∈ (0.05, 0.2]）：strength 0.55 / radius 0.70 / threshold 0.85
- 夜间（elevation ≤ 0，即 sunInt ≤ 0.05）：strength 0.45 / radius 0.70 / threshold 0.90

**前提**：规格原文「必须有真 HDR 高光源（灯体 emissiveIntensity > 1、窗光超 1.0）。否则 threshold 0.85 会把白墙一起溢，画面变糊」。当前代码已满足：
- 太阳圆盘：`MeshBasicMaterial` + `toneMapped=false`，`color` 钳到 3.0（HDR）
- 灯罩：`emissive` + `emissiveIntensity` 无上限（IES 解析的 candela 直接驱动）

所以 threshold 0.85 是安全的。

## 已核实的现状

- `postProcessing.ts:93-101`：Bloom 在构造时用固定值 `0.22 / 0.30 / 0.85`
- `sceneEngine.ts:826-827`：曝光按 sunInt 分两档（白天 1.0 / 夜 0.5）
- `App.tsx:224`：Bloom state 初始化为 `useState<BloomSettings | null>(null)`，由 `backend.getBloom()` 拉取
- `backend.ts:286-288`：Bloom 配置在构造时传入 `strength: 0.22, radius: 0.3, threshold: 0.85`

## 交付物

### 1. `src/render/postProcessing.ts` — 新增 Bloom 分档函数

在 `setBloom` 方法上方新增：

```ts
/** Bloom 三档参数（按太阳高度）。对应审查报告 §4 Day 4 h。 */
export const BLOOM_DAY: BloomSettings = { strength: 0.25, radius: 0.7, threshold: 0.85 };
export const BLOOM_SUNSET: BloomSettings = { strength: 0.55, radius: 0.7, threshold: 0.85 };
export const BLOOM_NIGHT: BloomSettings = { strength: 0.45, radius: 0.7, threshold: 0.9 };

/**
 * 按太阳强度选择 Bloom 档位。
 *
 * @param sunIntensity 太阳平行光强度（由 sceneEngine.updateSunPosition 每帧更新）
 * @returns 匹配的 Bloom 参数
 */
export function bloomForSunIntensity(sunIntensity: number): BloomSettings {
  if (sunIntensity > 0.2) return BLOOM_DAY;
  if (sunIntensity > 0.05) return BLOOM_SUNSET;
  return BLOOM_NIGHT;
}
```

### 2. `src/scene/sceneEngine.ts` — 在 updateSunPosition 里调用

找到 `updateSunPosition` 末尾（line 826-827 的曝光分档之后），新增：

```ts
// ---- P16：Bloom 按太阳高度分档（审查报告 §4 Day 4 h）----
// 与曝光分档同源：sunInt 由上方太阳天文位置决定。日间/日落/夜间各一套 Bloom
// 参数，过渡带由调用方（RenderPanel）的 lerp 平滑处理（见下条交付物）。
const bloom = bloomForSunIntensity(this.sunLight.intensity);
this.backend.setBloom?.(bloom.strength, bloom.radius, bloom.threshold);
```

**注意**：`setBloom` 是可选方法（`backend.setBloom?.()`），WebGPU 后端没有它（后处理不可用）。用 `?.` 保底。

### 3. `src/App.tsx` — Bloom state 同步

`handleBloomChange` 当前是手动设置（用户拖 UI 滑杆）。现在场景里会自动覆盖 Bloom，需要确保 UI state 与 backend 同步。

**最小改动**：在 `init` 回调里，Bloom 初始化之后，加一个周期性同步（或用 requestAnimationFrame 驱动）：

```ts
// P16：Bloom 由场景引擎按太阳高度自动驱动，UI state 需定期同步。
// 用 rAF 轮询 backend 的当前 Bloom 值，避免用户看到 UI 与实际渲染不一致。
const syncBloomFromBackend = () => {
  const b = backendRef.current?.getBloom?.();
  if (b && backendType === 'webgl2') {
    setBloom((prev) => (prev && prev.strength === b.strength && prev.radius === b.radius && prev.threshold === b.threshold ? prev : b));
  }
  rafRef.current = requestAnimationFrame(syncBloomFromBackend);
};
```

**但这会引入 rAF 轮询开销**——其实更好的做法是：让 `updateSunPosition` 在设置 Bloom 时，通过一个回调通知 UI。不过 sceneEngine 没有回调机制，加一个会改架构。

**最简单的方案**：在 `App.tsx` 的 `handleAxisHourChange` 里，时间轴变化时拉一次 Bloom：

```ts
const handleAxisHourChange = (hour: number) => {
  engineRef.current?.setHour(hour);
  // P16：时间轴变化会触发 updateSunPosition → setBloom，这里同步 UI state
  const b = backendRef.current?.getBloom?.();
  if (b && backendType === 'webgl2') setBloom(b);
};
```

但这样只在用户拖时间轴时同步，sun 自动流逝时（`timeSpeed > 0`）UI state 不会更新。

**实际方案**：把 Bloom 的自动驱动改成**每帧同步**，但只在值变化时才更新 state（避免 React 重渲染）：

```ts
// P16：Bloom 由场景引擎每帧按太阳高度自动驱动。用 rAF 轮询 backend 的当前值，
// 只在值变化时 setState，避免每帧重渲染。
useEffect(() => {
  if (backendType !== 'webgl2' || !ready) return;
  let rafId: number;
  const tick = () => {
    const b = backendRef.current?.getBloom?.();
    if (b) {
      setBloom((prev) => (prev && prev.strength === b.strength && prev.radius === b.radius && prev.threshold === b.threshold ? prev : b));
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(rafId);
}, [backendType, ready]);
```

**注意**：`handleBloomChange` 保留（用户手动调），但会被下一帧的自动驱动覆盖。这符合「自动曝光只服务昼夜连续过渡」的规格意图。

### 4. 测试

`src/render/__tests__/postProcessing.test.ts` 新增：
- `bloomForSunIntensity(1.0)` 返回 `BLOOM_DAY`（strength 0.25）
- `bloomForSunIntensity(0.15)` 返回 `BLOOM_SUNSET`（strength 0.55）
- `bloomForSunIntensity(0)` 返回 `BLOOM_NIGHT`（threshold 0.9）
- 边界值：0.2、0.05 的行为明确

## 验证

```bash
npm run verify
npm run build
```

**运行时验证**（父级做）：
1. `?debug` 打开，读 `backend.getBloom()`，应返回当前 sunInt 对应的档位
2. 设 `timeSpeed = 0.1`，等 20 秒（太阳从日落过渡到夜间），Bloom 应自动从 sunset 切到 night
3. 用户硬刷新真 GPU，看日落时窗洞光晕是否更明显（strength 0.55 比 0.25 更强）

## 红线

1. **不要动 godrays 参数**（P13 已定版）
2. **不要动曝光分档逻辑**（`sunLight.intensity > 0.2 → exposure 1.0` 等，那是另一套机制）
3. **不要动 P14 的材质**
4. **不要动场景预设 PRESET_SCENES**——场景只改 fixture 的 levels/cct，不动环境光
5. **不要改 Bloom 的 UI 滑杆行为**——`handleBloomChange` 保留，用户仍可手动调（会被下一帧覆盖）

## 提交

commit message 风格参考 `ddde017`（中文标题 + 要点）。**不要 push**。
