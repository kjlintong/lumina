# P36 — Phase 3 §3.3 双视图联动 + 家具 `.gltf` loader 升级

> 属于 `Lumina项目审查与后续工作方案.md` §二 Phase 3，P34 §9.3 明确排除、P35 只做
> loader 骨架但只支持 `.glb`（Poly Haven 实为分离格式，需升级）。
>
> 用户已确认：Poly Haven 资产仍在下载中（chair/cabinet 404、灯具 slug 已确认），
> 本规格**只处理已确认的 sofa/bed/table 三件**——loader 必须从硬编码文件名改为
> manifest 驱动，才能兼容已下 / 待下 / 未来下三种状态。
>
> 视觉验收归用户（真机 GPU）；子代理只交付**结构性验收**（build 通过、单测通过、
> 静态文件读得到的地方对得上）。

---

## 1. 目标（验收口径）

**功能验收**（用户真机浏览器手动测）：
1. **顶视机位**：CameraPanel 里出现「顶视」按钮，点击后 3D 相机切到正交俯视姿态
   （沿 -Y 轴垂直看房间，XZ 平面铺满视野）。OrbitControls 在顶视模式下不响应
   右键平移、只响应滚轮缩放（避免误操作把视角转回侧视）。切回「窗景/沙发/餐桌/全景」
   中任一机位，OrbitControls 恢复正常。
2. **2D→3D 选中同步**：`FloorPlan` 里点击任一灯具 dot → `projectStore.selectedFixtureId`
   更新 → 3D 里对应灯具 shade 材质 emissive 高亮（现有链路已通），且 `FloorPlan` 上
   该 dot 显示选中态（描边高亮）。**新增的是 FloorPlan 上选中态的可视化**——3D→2D
   方向的 store 更新链路已通，但 2D 面板上没画出来。
3. **`.gltf` loader 生效**：sofa/bed/table 三件从 `public/assets/furniture/{zone}/`
   下的分离 `.gltf + .bin + textures/` 加载成功（GLTFLoader 天然支持，无需 KHR 扩展）；
   chair/cabinet 缺失时回落程序化（不报错、不阻塞）；新增 manifest 驱动的路径解析。

**技术验收**（子代理自测 + 父代理复验）：
- `npm run verify` 全绿（typecheck + lint + tests）
- `npm run build` 通过
- 测试数：新增 ≥ 12 条（顶视 tween 数学 4 条 + planCameraPreset 纯函数 3 条 + loader manifest 驱动 5 条）
- 现有 930 条测试全通过，零改动

---

## 2. 现状关键缺口（子代理直接读到的，不要重新发现）

### 2.1 相机机位没有「顶视」
- `src/scene/cameraPresets.ts`：`CameraPreset` 只有 4 个 key（window/sofa/dining/overview），
  全部基于 PerspectiveCamera，没有俯视机位。
- `src/scene/sceneEngine.ts:420`：`this.camera = new PerspectiveCamera(37, 1, 0.1, 100)`
  全程一个相机实例。**不要**引入 OrthographicCamera——那要重构渲染管线（backend.render
  签名、Resize 处理、TransformControls 都要改），本阶段范围不允许。
- 顶视的正确做法：**用透视相机的极端俯角姿态**近似正交俯视
  （`position = [0, 6, 0.001]`，`target = [0, 0, 0]`——z=0.001 是防止相机与 target 重合
  导致 lookAt 除零；`fov` 保持 37 不变，`near=0.1 far=100` 已覆盖房间对角）。
  这样视觉上是「近似顶视」（有一定透视收敛，但极近端点几乎对齐），比真的 OrthographicCamera
  改动成本低得多。**不要**为这个改 `sceneEngine` 渲染管线。

### 2.2 OrbitControls 在顶视模式下要限制
- 顶视下 `orbitControls` 若保留默认行为，用户滚轮缩放正常，但鼠标拖动会绕 Y 轴转视角
  ——转完就成了侧视，破坏顶视语义。
- 修法：**不动 OrbitControls**（它是共享实例），只在切换到顶视机位时把
  `orbitControls.enableRotate = false`，切回普通机位时 `= true`。
- OrbitControls 有 `enableRotate` 属性（`three/examples/jsm/controls/OrbitControls.js`）
  —— 已在依赖里，直接读属性即可，不新增。
- **不要**动 `orbitControls.target`（P34a 的 TransformControls 依赖 target 不偏移）。

### 2.3 `FloorPlan` 没有选中态可视化
- `src/ui/panels/FloorPlan.tsx:43-44`：已经 `useProjectStore((s) => s.selectedZoneKey)` 和
  `selectZone`，但那是 **zone** 选中态，不是 **fixture** 选中态。
- 家具 dot 渲染在 128-131 行 `<text>` 上，没读 `selectedFixtureId`。
- 修法：**新增** `useProjectStore((s) => s.selectedFixtureId)`，给对应 dot 加 stroke 高亮
  （选中时描边 `#f0a040` + `strokeWidth=3`，未选中无边）。这是纯 UI 显示改动，不动 store。

### 2.4 家具 loader 硬编码 `.glb`
- `src/render/furnitureAssets.ts:76`：`await l.loadAsync(`/assets/furniture/${key}.glb`)`
  是硬编码单一路径。
- Poly Haven 实际下载结构（已验证，`public/assets/furniture/sofa/ArmChair_01_1k.gltf`）：
  ```
  /assets/furniture/sofa/
    ArmChair_01_1k.gltf          ← GLTFLoader 入口
    ArmChair_01_1k.bin           ← 相对同目录
    textures/
      Armchair_01_diff_1k.jpg    ← 相对 textures/
      Armchair_01_nor_gl_1k.jpg
      ...（3 张，具体见 .gltf 的 images[]）
  ```
- `.gltf` 里 `images[0].uri = "textures/Armchair_01_nor_gl_1k.jpg"`、
  `buffers[0].uri = "ArmChair_01.bin"`——GLTFLoader 会自动按 `.gltf` 的 base URL 解析
  相对路径（浏览器 fetch `/assets/furniture/sofa/textures/xxx.jpg`），
  无需 KHR 扩展或 loader 侧特殊处理。
- 修法：**新增** `public/assets/furniture/manifest.json`（下载脚本已生成雏形，见下），
  loader 从 manifest 拿 `FurnitureKey → {zone, gltfPath}` 映射；缺失或加载失败回落程序化。
- 现有 `FURNITURE_LIST = ['sofa', 'bed', 'table', 'chair', 'cabinet']` 保持不变——
  chair/cabinet 在 manifest 里缺失或 gltfPath 指向不存在的文件，loader 走 catch 分支返回 null。

### 2.5 manifest 已部分存在
- `scripts/download-assets.py:262`：`download_models` 已生成
  `public/assets/furniture/manifest.json`，结构：
  ```json
  {
    "sofa": { "slug": "ArmChair_01", "gltf": "ArmChair_01_1k.gltf", "files": [...] },
    "bed":  { "slug": "GothicBed_01", "gltf": "GothicBed_01_1k.gltf", ... },
    "table":{ "slug": "CoffeeTable_01", "gltf": "CoffeeTable_01_1k.gltf", ... },
    "chair":{ "slug": "ArmChair_02", "gltf": "ArmChair_02_1k.gltf", ... },   // 404
    "cabinet":{ "slug": "GothicCabinet_01", ... }                              // 404
  }
  ```
- **loader 不要读这个 manifest**——它写死了目标文件名，chair/cabinet 的 gltf 不存在会导致
  loader 404。子代理要**新写**一个 loader 侧 manifest，只登记实际能加载的路径：
  `public/assets/furniture/loader-manifest.json`：
  ```json
  {
    "sofa":    { "zone": "sofa",  "gltf": "sofa/ArmChair_01_1k.gltf" },
    "bed":     { "zone": "bed",   "gltf": "bed/GothicBed_01_1k.gltf" },
    "table":   { "zone": "table", "gltf": "table/CoffeeTable_01_1k.gltf" }
  }
  ```
  缺失的 key 不在 manifest 里，loader 直接返回 null 回落。
- **下载脚本 `--skip-existing` 会跳过 manifest.json 的写入**（因为它不是单文件下载）——
  需要子代理确认 manifest 生成时机。**不要**改 `scripts/download-assets.py`（本规格范围外）。

---

## 3. 交付物

### 3.1 `src/scene/cameraPresets.ts` — 追加 plan 机位

在 `CAMERA_PRESETS` 数组末尾追加：

```ts
{
  // 顶视（正交近似）：3D 视口垂直俯视房间，与 2D FloorPlan 视觉对齐。
  // P36 · Phase 3 §3.3：3D 里能直接看到 2D 户型图的内容，选中态可跨视图同步。
  //
  // 坐标依据：room 尺寸 6×4.5×2.8（projectStore.ts:245 默认），房间中心 (0,0,0)。
  // 相机放在正上方 z=0.001（防 lookAt 除零），target 是地面中心。
  // fov=37° + distance=6m 时垂直视角覆盖约 3.6m 宽，正好铺满房间 4.5m 深边
  // 的一半，配合 OrbitControls 缩放能铺满全景。
  //
  // **切到 plan 机位后，`sceneEngine.setCameraPreset` 调 `orbitControls.enableRotate = false`**
  // ——见 sceneEngine.ts 修改项。
  key: 'plan',
  name: '顶视',
  position: [0, 6, 0.001],
  target: [0, 0, 0],
}
```

`CameraPreset.key` 联合类型同步更新：
```ts
key: 'window' | 'sofa' | 'dining' | 'overview' | 'plan';
```

### 3.2 `src/scene/sceneEngine.ts` — `setCameraPreset` 支持 plan 模式

在 `setCameraPreset` 方法（约 1785 行）里，**tween 启动前**加：
```ts
// P36：顶视机位禁用 OrbitControls 的 Y 轴旋转，防止用户拖拽破坏俯视语义。
// enableRotate 只影响鼠标左键拖动，滚轮缩放和右键平移不受影响。
// 切回任一非 plan 机位时立刻恢复（避免顶视后切回窗景仍是锁定状态）。
const isPlan = preset.key === 'plan';
this.orbitControls.enableRotate = !isPlan;
```

**不要**动 `orbitControls.target`（TransformControls 依赖它，见 `src/scene/sceneEngine.ts:446`）。
**不要**动 `this.camera.fov`（切换 fov 需要 `updateProjectionMatrix`，本阶段不做）。

### 3.3 `src/ui/panels/CameraPanel.tsx` — 无需改（自动继承新 preset）

`CAMERA_PRESETS.map` 已用 `preset.key` 作 key、`preset.name` 作 label，
追加的 plan 项会自动出现在「相机机位」面板里。子代理**不要**改这个文件。

### 3.4 `src/ui/panels/FloorPlan.tsx` — 加选中态

在 `FloorPlan` 函数体开头追加：
```ts
const selectedFixtureId = useProjectStore((s) => s.selectedFixtureId);
```

灯具 dot 渲染（128-131 行）改为：
```tsx
{dots.map((d) => (
  <text
    key={d.id}
    x={d.x}
    y={d.y}
    textAnchor="middle"
    fontSize={10}
    fill={selectedFixtureId === d.id ? '#f0a040' : dotColor(d.type)}
    stroke={selectedFixtureId === d.id ? '#f0a040' : 'none'}
    strokeWidth={selectedFixtureId === d.id ? 2 : 0}
    className="floor-plan-fixture"
    style={selectedFixtureId === d.id ? { filter: 'drop-shadow(0 0 3px #f0a040)' } : undefined}
  >
    {dotSymbol(d.type)}
  </text>
))}
```

**说明**：
- SVG `<text>` 的 stroke 只描文字轮廓，配合 `strokeWidth=2` 让选中 dot 明显加粗
- `drop-shadow` CSS filter 加光晕，比纯 stroke 更醒目
- 未选中时 `stroke="none"` + `strokeWidth=0`，视觉上无差异

### 3.5 `src/render/furnitureAssets.ts` — 升级为 `.gltf` + manifest 驱动

**核心改动**：删除 `.glb` 硬编码，改为 manifest 驱动。

**新文件**：`public/assets/furniture/loader-manifest.json`（子代理新建，内容见 §2.5）

**loader 内部改造**：
```ts
// 顶部 import
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
// **移除** KTX2Loader —— Poly Haven 用 JPG/PNG 贴图，不需要 KTX2。
// 保留 DRACOLoader（polyhaven 未来可能用 Draco 压缩；当前 .bin 未压缩，
// GLTFLoader 会自动跳过 Draco 分支，无副作用）。

type FurnitureKey = 'sofa' | 'bed' | 'table' | 'chair' | 'cabinet';
export const FURNITURE_LIST: readonly FurnitureKey[] = ['sofa', 'bed', 'table', 'chair', 'cabinet'];

// 单例：manifest 缓存
let manifestCache: Map<string, string> | null = null;
// 键：FurnitureKey；值：相对 public/ 的 .gltf 路径（例如 'assets/furniture/sofa/ArmChair_01_1k.gltf'）

async function loadManifest(): Promise<Map<string, string> | null> {
  if (manifestCache) return manifestCache;
  try {
    const res = await fetch('/assets/furniture/loader-manifest.json');
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, { gltf: string }>;
    const m = new Map<string, string>();
    for (const [k, v] of Object.entries(data)) {
      m.set(k, `/${v.gltf}`);  // 前缀 / 保证绝对 URL
    }
    manifestCache = m;
    return m;
  } catch (err) {
    console.warn('[furnitureAssets] manifest 加载失败，回落到程序化家具', err);
    return null;
  }
}

export async function loadFurniture(
  key: FurnitureKey,
  renderer: THREE.WebGLRenderer,
): Promise<THREE.Group | null> {
  const cached = assetCache[key];
  if (cached) return cached;

  const manifest = await loadManifest();
  const gltfPath = manifest?.get(key);
  if (gltfPath === undefined) return null;  // manifest 里没有这个 key → 直接回落

  try {
    const l = ensureLoader(renderer);
    const gltf = await l.loadAsync(gltfPath);
    // 归一化：polyhaven 家具是真实尺寸（沙发 0.9m 深、床 2m 长），
    // 直接按 box.max.y 缩放到 1m 会变形。改为**只水平居中 + 贴地**，不改尺寸。
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const center = box.getCenter(new THREE.Vector3());
    gltf.scene.position.x -= center.x;   // 水平居中
    gltf.scene.position.z -= center.z;
    gltf.scene.position.y -= box.min.y;  // 贴地
    gltf.scene.updateMatrixWorld(true);
    assetCache[key] = gltf.scene;
    return gltf.scene;
  } catch (err) {
    console.warn(`[furnitureAssets] ${key} 加载失败，回落到程序化模型`, err);
    return null;
  }
}
```

**测试用清理函数** `_resetFurnitureCacheForTest()` 同步清理 `manifestCache`：
```ts
export function _resetFurnitureCacheForTest(): void {
  for (const k of Object.keys(assetCache) as FurnitureKey[]) { /* ... 现有清理 */ }
  manifestCache = null;
  loader = null;
}
```

**KTX2Loader 移除**：Poly Haven 用 JPG/PNG 贴图（`images[].mimeType = "image/jpeg"`），
KTX2Loader 无用。DRACOLoader 保留——`.bin` 是标准 glTF binary buffer，不是 Draco 压缩，
但 DRACOLoader 挂在 loader 上不产生副作用（GLTFLoader 只在遇到 KHR_draco_mesh_compression
扩展时才调用它，未压缩 .bin 走标准路径）。

**红线**：
- 不改 `FURNITURE_LIST` 常量（ZonePanel / 家具放置代码依赖）
- 不改 `snapToWall` 函数（P35 已验证）
- 不改 `ensureLoader` 的 DRACOLoader 挂载（只是不挂 KTX2Loader 了）

### 3.6 `public/assets/furniture/loader-manifest.json` — 新建

内容（子代理按下面这个 JSON 写死）：
```json
{
  "sofa":  { "zone": "sofa",  "gltf": "assets/furniture/sofa/ArmChair_01_1k.gltf" },
  "bed":   { "zone": "bed",   "gltf": "assets/furniture/bed/GothicBed_01_1k.gltf" },
  "table": { "zone": "table", "gltf": "assets/furniture/table/CoffeeTable_01_1k.gltf" }
}
```

**不要**加 chair/cabinet ——它们在 manifest 里缺失会导致 loader 走 null 分支回落程序化，
这是**期望行为**，不是 bug。

---

## 4. 明确不做（P36 范围外）

- **不做** 灯具资产 loader（`lightAssets.ts`）与 `FixtureLibraryPanel` 接入真实 mesh——
  灯具下载还在跑，规格独立（P37 立项）。
- **不做** 3D 视口内的建模 UI（在 3D 里直接描墙 / 拖拽顶点 / 编辑房间）——
  那是整个 Phase 2 级别的工作，方案 §Phase 2 有专门条目。
- **不做** OrthographicCamera 切换——本阶段用透视相机 + 极端俯角近似。真要正交投影
  得改 backend.render 签名，本阶段不接受。
- **不做** 相机 fov 切换（顶视时用更大的 fov）—— 会污染 TransformControls 的
  世界坐标拾取（TransformControls 用 camera 做 raycast）。
- **不改** `scripts/download-assets.py`（脚本 bug 独立修复，不阻塞 P36）。
- **不改** `src/lighting/illuminance.ts` / `src/lighting/heatmap.ts`。
- **不动** `CLAUDE.md` / `vite.config.ts` / `tsconfig.json` / `package.json` / `package-lock.json`。
- **不新增 npm 依赖**（`three/addons` 下已有的直接 import）。
- **不删** 现有测试（930 条）；新增测试只加不减。

---

## 5. 测试要求（新增 ≥ 12 条，全绿）

### 5.1 `src/scene/__tests__/cameraPresets.test.ts` — 追加（如已存在）或新建

```ts
import { describe, it, expect } from 'vitest';
import { CAMERA_PRESETS, cameraPresetByKey } from '../cameraPresets.js';

describe('cameraPresets (P36 plan preset)', () => {
  it('plan preset exists with key=plan', () => {
    const p = cameraPresetByKey('plan');
    expect(p).toBeDefined();
    expect(p!.key).toBe('plan');
  });

  it('plan preset is top-down (y=6, z≈0)', () => {
    const p = cameraPresetByKey('plan')!;
    expect(p.position[1]).toBeGreaterThan(3);  // 高
    expect(Math.abs(p.position[2])).toBeLessThan(0.01);  // z 近 0（防 lookAt 除零）
    expect(p.target).toEqual([0, 0, 0]);
  });

  it('plan preset is included in CAMERA_PRESETS array', () => {
    expect(CAMERA_PRESETS.some((p) => p.key === 'plan')).toBe(true);
  });

  it('plan preset name is 顶视', () => {
    expect(cameraPresetByKey('plan')!.name).toBe('顶视');
  });
});
```

### 5.2 `src/render/__tests__/furnitureAssets.test.ts` — 追加 4 条

新增测试（追加到现有文件末尾，或新建）：

```ts
describe('furnitureAssets (P36 manifest-driven)', () => {
  it('loadFurniture returns null when manifest lacks the key', async () => {
    // mock fetch to return 200 with { sofa: ..., bed: ..., table: ... } (no chair)
    // assert loadFurniture('chair', mockRenderer) returns null
  });

  it('loadFurniture falls back to null when manifest fetch fails', async () => {
    // mock fetch to reject
    // assert returns null, does not throw
  });

  it('loadFurniture caches manifest between calls', async () => {
    // call loadFurniture twice, mock fetch with jest.fn(), assert fetch called only once
  });

  it('_resetFurnitureCacheForTest clears manifest cache', () => {
    // load manifest once, call reset, load again, assert fetch called twice
  });
});
```

**mock 建议**：`vi.mock('three/addons/loaders/GLTFLoader.js')` 让 GLTFLoader.loadAsync
返回假 `{ scene: new THREE.Group() }`；`vi.stubGlobal('fetch', mockFetch)` 让 fetch
返回可控 JSON。参考现有 `src/render/__tests__/hdriLoader.test.ts` 的 mock 风格。

### 5.3 `src/ui/__tests__/floorPlan.test.tsx` — 追加

```tsx
describe('FloorPlan (P36 fixture selection highlight)', () => {
  it('selected fixture dot has amber stroke', () => {
    // render <FloorPlan /> with projectStore selectedFixtureId set
    // query the <text> element with matching key, assert stroke="#f0a040"
  });

  it('unselected dots have stroke="none"', () => {
    // same setup, query unselected dot, assert stroke="none"
  });
});
```

**jsdom 注意**：SVG stroke 属性可以通过 `element.getAttribute('stroke')` 读，
无需真实浏览器渲染。

---

## 6. 验证

子代理提交前必须跑通：

```bash
npm run typecheck    # 0 error
npm run lint         # 0 error（eslint --fix 后）
npm test             # 全绿，条数 ≥ 942（930 + 新增 12）
npm run build        # 通过，仍 2 chunk
```

**手动验收清单**（用户真机 GPU 执行）：
1. 打开首页，等 HDRI 加载（若已下载）
2. 点击「相机机位」→「顶视」→ 3D 视口变成垂直俯视
3. 顶视下滚动滚轮缩放、右键拖动平移**正常**；左键拖动**不旋转**
4. 切到「窗景位」→ OrbitControls 恢复，左键拖动能转视角
5. 在 3D 视口里点一盏灯 → 左侧「户型图」里对应 dot 高亮
6. 在「户型图」里点一个 dot → 3D 视口里对应灯高亮
7. 描墙（ModelCanvas 描一个房间）→ 3D 里房间更新（现有能力，回归确认）
8. 家具：把「活动区」的 `type` 改为 `sleep`（卧室），点某处放置，若床模型加载成功
   则 3D 里显示真实 Bed 模型；失败则显示程序化方块（不报错、不阻塞）

---

## 7. 提交模板

```bash
git add src/scene/cameraPresets.ts src/scene/sceneEngine.ts
git add src/ui/panels/FloorPlan.tsx
git add src/render/furnitureAssets.ts
git add public/assets/furniture/loader-manifest.json
git add src/scene/__tests__/cameraPresets.test.ts
git add src/render/__tests__/furnitureAssets.test.ts
git add src/ui/__tests__/floorPlan.test.tsx
git add docs/P8-plan.md

git commit -m "P36: 顶视机位 + 2D/3D 选中同步 + 家具 .gltf loader 升级

Phase 3 §3.3 双视图联动（P34 明确排除、P35 只做 loader 骨架但仅 .glb）：
- CameraPanel 追加「顶视」机位（透视相机俯角近似，不改渲染管线）
- 顶视模式下 OrbitControls.enableRotate=false，切回普通机位自动恢复
- FloorPlan 显示 fixture 选中态（stroke + drop-shadow）
- 家具 loader 从 .glb 硬编码升级为 manifest 驱动（Poly Haven 分离 .gltf+.bin+textures/）
- 新增 public/assets/furniture/loader-manifest.json（sofa/bed/table）
- 移除 KTX2Loader 依赖（Poly Haven 用 JPG/PNG）

测试 930 → 942+；构建仍 2 chunk。

docs/P8-plan.md 追加 P36 行。"
```

**红线**：
- **不 push**（用户自己提交）
- **不 rebase** 主线
- 提交前 `git status` 确认无未纳入文件

---

## 8. 子代理执行顺序

1. 修改 `src/scene/cameraPresets.ts`（追加 plan preset + 更新 key 联合类型）
2. 修改 `src/scene/sceneEngine.ts`（`setCameraPreset` 加 enableRotate 切换）
3. 修改 `src/ui/panels/FloorPlan.tsx`（selectedFixtureId + 高亮）
4. 新建 `public/assets/furniture/loader-manifest.json`
5. 修改 `src/render/furnitureAssets.ts`（manifest 驱动 + 移除 KTX2Loader + 修改归一化）
6. 追加测试文件（5.1 / 5.2 / 5.3）
7. 跑 `npm run verify`（typecheck + lint + tests）→ 全绿
8. 跑 `npm run build` → 通过
9. 追加 `docs/P8-plan.md` 的 P36 行
10. `git add` + `git commit`（按第 7 节模板）

**每步之间跑一次 `npm test`（不跑 build，太慢）**。第 7 步是全量 verify。

---

## 9. 关于视觉判定（给子代理的免责声明）

P36 的顶视视觉质量（俯角透视 vs 真正交）、灯具选中态光晕（drop-shadow 是否够醒目）、
家具模型加载成功与否的视觉呈现——这些**必须**由用户在真机 GPU 浏览器上验收。

子代理跑 headless SwiftShader 时：
- 3D 渲染可能出现黑屏 / 材质灰平（无 IBL），**不要**因此判定 plan preset 失败
- 用 `sceneEngine.getCamera()` 读 position 验证数学正确性（`y=6, z≈0.001`）
- 用 `useProjectStore.getState().selectedFixtureId` 读 store 状态验证同步链路
- 用 DOM 属性查询（`element.getAttribute('stroke')`）验证 FloorPlan 高亮

视觉截图不作数。用户会在本地跑 dev server 亲眼看画面。
