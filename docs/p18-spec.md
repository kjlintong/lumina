# P18 规格：4 机位预设（审查报告 §4 Day 6 k）

## 目标

按审查报告 §4 Day 6 k「4 个机位预设」：窗景位 / 沙发位 / 餐桌位 / 全景位。**禁止只有自由 OrbitControls**。

## 已核实的现状

- `sceneEngine.ts:995`：`setCameraPosition(x, y, z)` 已存在，设置相机位置并朝向房间中心 `(0, 1.5, 0)`
- `OrbitControls` 已配置（`target (0, 1.5, 0)`、`minDistance 1`、`maxDistance 20`、`maxPolarAngle 0.85π`、`rotateSpeed -1`）
- App.tsx 右侧 sidebar 有 ScenePanel（场景预设）、IlluminancePanel、RenderPanel，但**没有相机预设 UI**
- 当前只有一个初始相机位置 `(1.7, 1.55, 1.6)`（P12 定的平视位）

## 交付物

### 1. `src/scene/cameraPresets.ts` — 新增相机预设定义

```ts
/** 相机机位预设（审查报告 §4 Day 6 k） */
export interface CameraPreset {
  key: 'window' | 'sofa' | 'dining' | 'overview';
  name: string;
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

export const CAMERA_PRESETS: CameraPreset[] = [
  {
    // 窗景位：站在窗前，看向窗外（看天空渐变、太阳）
    key: 'window',
    name: '窗景位',
    position: { x: 0, y: 1.5, z: -1.5 },
    target: { x: 0, y: 1.5, z: -3 },
  },
  {
    // 沙发位：坐在沙发区，看向餐厅/窗户（家庭起居视角）
    key: 'sofa',
    name: '沙发位',
    position: { x: -1.5, y: 1.2, z: 1.2 },
    target: { x: 0, y: 1.2, z: -1 },
  },
  {
    // 餐桌位：餐桌边，看向对面（用餐视角）
    key: 'dining',
    name: '餐桌位',
    position: { x: 1.5, y: 1.3, z: 1.0 },
    target: { x: 0, y: 1.0, z: -0.5 },
  },
  {
    // 全景位：房间一角高角度，俯瞰整个房间（户型展示）
    key: 'overview',
    name: '全景位',
    position: { x: 2.5, y: 2.2, z: 2.5 },
    target: { x: 0, y: 1.0, z: 0 },
  },
];
```

**注意**：这些坐标是估算的「合理位置」，实际房间尺寸是 6×4.5×2.8 米。用户验收时需要看是否符合直觉，可以微调。

### 2. `src/scene/sceneEngine.ts` — 新增 setCameraPreset 方法

```ts
/**
 * 切换到指定相机机位预设。
 *
 * @param presetKey 预设 key（'window' | 'sofa' | 'dining' | 'overview'）
 * @param durationMs 过渡时长（毫秒，默认 800）
 */
setCameraPreset(presetKey: string, durationMs = 800): void {
  const preset = CAMERA_PRESETS.find((p) => p.key === presetKey);
  if (!preset) return;

  // 相机位置过渡：从当前位置平滑移到预设位置
  const from = { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z };
  const to = preset.position;
  const fromTarget = { x: this.orbitControls.target.x, y: this.orbitControls.target.y, z: this.orbitControls.target.z };
  const toTarget = preset.target;

  // 用 lerp 插值（线性），配合 OrbitControls.update()
  const start = Date.now();
  const animate = () => {
    const elapsed = Date.now() - start;
    const t = Math.min(elapsed / durationMs, 1);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad

    this.camera.position.set(
      from.x + (to.x - from.x) * eased,
      from.y + (to.y - from.y) * eased,
      from.z + (to.z - from.z) * eased,
    );
    this.orbitControls.target.set(
      fromTarget.x + (toTarget.x - fromTarget.x) * eased,
      fromTarget.y + (toTarget.y - fromTarget.y) * eased,
      fromTarget.z + (toTarget.z - fromTarget.z) * eased,
    );
    this.orbitControls.update();

    if (t < 1) requestAnimationFrame(animate);
  };
  animate();
}
```

**但 sceneEngine 没有现有的「动画系统」**，这个 animate 函数会自己跑 rAF 循环。更好的做法是让 App.tsx 用 React state 驱动，但那样改动更大。

**简单方案**：直接在 sceneEngine 里加 animate（一次性，不持久）：

```ts
setCameraPreset(presetKey: string, durationMs = 800): void {
  const preset = CAMERA_PRESETS.find((p) => p.key === presetKey);
  if (!preset) return;

  const from = { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z };
  const to = preset.position;
  const fromTarget = { x: this.orbitControls.target.x, y: this.orbitControls.target.y, z: this.orbitControls.target.z };
  const toTarget = preset.target;
  const start = Date.now();
  const self = this;

  const animate = () => {
    const elapsed = Date.now() - start;
    const t = Math.min(elapsed / durationMs, 1);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    self.camera.position.set(
      from.x + (to.x - from.x) * eased,
      from.y + (to.y - from.y) * eased,
      from.z + (to.z - from.z) * eased,
    );
    self.orbitControls.target.set(
      fromTarget.x + (toTarget.x - fromTarget.x) * eased,
      fromTarget.y + (toTarget.y - fromTarget.y) * eased,
      fromTarget.z + (toTarget.z - fromTarget.z) * eased,
    );
    self.orbitControls.update();

    if (t < 1) requestAnimationFrame(animate);
  };
  animate();
}
```

### 3. `src/ui/panels/CameraPanel.tsx` — 新增相机预设面板

参考 ScenePanel 的结构（按钮列表），但更简单：

```tsx
import { useState } from 'react';
import { CAMERA_PRESETS } from '../../scene/cameraPresets.js';

interface CameraPanelProps {
  onPresetChange: (key: string) => void;
}

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

### 4. `src/App.tsx` — 集成 CameraPanel

在右侧 sidebar（和 ScenePanel 同级）加入 CameraPanel：

```tsx
<CameraPanel onPresetChange={(key) => controllerRef.current?.engine?.setCameraPreset(key)} />
```

**注意**：`controllerRef.current` 可能没有 `engine` 直接暴露，需要看 sceneController 是否暴露 engine。如果没有，通过 `engineRef` 直接调用：

```tsx
<CameraPanel onPresetChange={(key) => engineRef.current?.setCameraPreset(key)} />
```

### 5. 测试

- `cameraPresets.test.ts`（新增）：4 个预设都存在、key 不重复、name 不空
- `sceneEngine.test.ts`：`setCameraPreset('window')` 调用后相机位置会变化（用 mock 时间）

## 验证

```bash
npm run verify
npm run build
```

**运行时验证**（父级做）：
1. `?debug` 打开，右侧 sidebar 应出现「相机机位」面板，4 个按钮
2. 点击「窗景位」，相机应平滑过渡到窗前位置（看向窗外）
3. 点击「全景位」，相机应过渡到高角度俯瞰

## 红线

1. **不要动 P16 的 Bloom 分档逻辑**（P16 正在跑）
2. **不要动 P17 的阴影策略**（P17 还没跑，但会改 sceneEngine.ts）
3. **不要动 godrays**（P13 已定版）
4. **不要动曝光分档逻辑**
5. **不要动 P14 的材质**
6. **不要动场景预设 PRESET_SCENES**
7. **不要在 setCameraPreset 里改 orbitControls.rotateSpeed**（P15 定的 -1，不要动）
8. **不要在 setCameraPreset 里改 camera.fov**（P12 定的 37°，不要动）

## 提交

commit message 风格参考 `ddde017`（中文标题 + 要点）。**不要 push**。
