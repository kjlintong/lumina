# P12 规格：止损 + Day 1 P0（收益约 60%）

> 依据：`../LUMINA_两周执行规格_hermes.md` 第 0 步（止损）+ 第 4 节 Day 1。
> 本阶段只做视觉地基，不做新增功能。做完即提交，不要继续往下堆。

## 0. 目标与验收

**目标**：把当前渲染画面从"工程工具感"推向"家居产品感"。核心是三件地基修复：相机平视、场景色温符合物理直觉、材质参数不再"塑料"。

**验收（全部必须满足，缺一不可）**：

1. `npm run verify` 全绿（typecheck + lint + test）。
2. `npm run build` 成功。
3. **禁止自评达标**。本环境是 WSL2 + SwiftShader（CPU 软渲染），rAF 不派发，拍不出有效截图。视觉验收由用户在真实 GPU 上完成，你只负责交付参数改动并写明每项改动的意图。
4. 工作树 clean、单独一个 commit。
5. 不新增文件（除必要测试更新），不新增依赖。

## 1. 关键现状诊断（Hermes 已读完代码确认）

审查报告有几处对现状的判断是**错的**，以下条目**不要动**（动了等于回退已完成的工作）：

- **`scene.environment` 已经设了**。`src/scene/sceneEngine.ts` 第 482–505 行的 `initEnvironment()` 已用 `RoomEnvironment` + PMREM 生成并赋给 `scene.environment`。问题是 `environmentIntensity = 0.35` 偏低，且仅在 `backend.type === 'webgl2'` 分支运行。
- **`lightBuilder.ts` 里的 `case 'cone'` 是灯罩几何**（`shadeGeometry`），配合 `emissiveIntensity` 是 P8b 有意的"灯具即可见发光体"，P11（commit `736b82c`）刚修过灯罩可见性。**不要删**。
- **人工灯没有体积光 mesh**。`lightBuilder.ts` 只建光源 + 灯罩，没有 cone beam 挂在灯具下。审查报告第 2 条硬伤不成立。

以下是**成立的真硬伤**，本阶段要修：

| # | 硬伤 | 证据位置 |
|---|---|---|
| 1 | 相机俯视 17.6°（`fov=60`、pos `(2.5,1.8,1.9)` → target `(0,0.8,0)`） | `src/scene/sceneEngine.ts:306-311` |
| 2 | 阅读场景 4000K（应是 2900K 暖光） | `src/scene/sceneSystem.ts:103` |
| 3 | 场景色温矩阵整体偏差（daylight 5000、dinner 2700、movie 3000 均偏离规范） | `src/scene/sceneSystem.ts:69-112` |
| 4 | 地板粗糙度 0.7 过高（木地板应 0.35–0.45） | `src/render/room.ts:245` |
| 5 | 墙面/天花粗糙度 0.95 太高（墙 0.90、天花 0.95） | `src/render/room.ts:217` |
| 6 | `environmentIntensity` 0.35 偏低 | `src/scene/sceneEngine.ts:500` |
| 7 | 假体积光柱（`volumetricShaft` 双平面）默认开启，与后期链 godrays 重复 | `src/scene/sceneEngine.ts:274` `shaftUserEnabled = true` |
| 8 | 天花未独立设粗糙度，跟着墙面 0.95 走 | `src/render/room.ts:263` |

## 2. 具体改动

### 2.1 相机平视（对应报告 Day 1 d）

**文件**：`src/scene/sceneEngine.ts`

- 相机 `fov`：`60` → `37`（35mm 全幅等效，37° 垂直角）。
- 相机位置：`this.camera.position.set(2.5, 1.8, 1.9)` → `(1.7, 1.55, 1.6)`。
- 轨道目标：`this.orbitControls.target.set(0, 0.8, 0)` → `(0, 1.5, 0)`。
- 同时更新 `setCameraPosition` 方法内硬编码的 target `(0, 0.8, 0)` → `(0, 1.5, 0)`。

**几何校验**：新 pos `(1.7, 1.55, 1.6)`、target `(0, 1.5, 0)` 得 pitch ≈ `atan(0.05 / √(1.7² + 1.6²))` = **2.1°**，接近 0° 平视，符合报告"禁止默认俯视"。

**测试兼容性**：`src/scene/__tests__/sceneEngine.test.ts` 断言 `|x|<3, |z|<2.25, 0<y<2.8`——新坐标全部满足。不要改测试。

**注意**：`setPixelRatio` 已用 `Math.min(dpr, maxPixelRatio)`（`backend.ts:274`），且 `maxPixelRatio` 默认值已是 `2`（`backend.ts:184`）。**已符合报告要求，本项无需改动**，仅在规格中记录以证明已核对。

### 2.2 场景色温矩阵（对应报告 §5）

**文件**：`src/scene/sceneSystem.ts` 的 `PRESET_SCENES`

| 场景 | 旧 cct | 新 cct | 备注 |
|---|---|---|---|
| `daylight` | 5000 | **5500** | 日光色温 |
| `dinner` | 2700 | **2400** | 晚餐更暖 |
| `movie` | 3000 | **2200** | 观影极暗极暖 |
| `relax` | 2400 | 2400 | 不动 |
| `reading` | **4000** | **2900** | **本报告重点**：阅读是暖光 |
| `night` | 2200 | 2200 | 不动 |

`levels`（亮度）不动——报告的 §5 表格里给的是 `2700K @ 25%` 这种表述，那是"主光+人工补光"两层，属于场景引擎级，`PRESET_SCENES` 只承载"人工光"一层，其亮度已在既有值上（reading 0.95、dinner 0.65、movie 0.15、night 0.1），符合报告精神。

**测试兼容性**：`src/scene/__tests__/sceneSystem.test.ts` 里所有断言用的是自建 fixtures（`makeFixture({cct: 3000})`），不依赖 `PRESET_SCENES` 的具体数值。唯一的间接断言是 `expect(daylight.cct) > night.cct`（5500 > 2200 仍成立）。**不要改测试**。

### 2.3 材质粗糙度（对应报告 Day 2–3 e）

**文件**：`src/render/room.ts`

- **地板**：`roughness: 0.7` → `0.40`（橡木地板区间中值，让太阳斜射时出现高光带）。**注意**：地板 `castShadow=false, receiveShadow=true` 保持不变，这是既有正确行为。
- **墙面**：`surfaceRoughness = 0.95` → `0.90`（报告数值）。
- **天花**：现在天花复用 `makeSurfaceMaterial()`（跟墙面同粗糙度）。**拆出来**，让天花独立 `roughness = 0.95`（报告数值），保持反射率较高以承接"天花最亮"层次。做法：新增 `makeCeilingMaterial()` 函数，参数 `roughness: 0.95`，颜色仍用 `surfaceColor`；`ceiling` 构造改用此新材质。

**注意**：不要动 `surfaceColor`（`0xe6e6e6` 乳胶漆）——报告没要求改色。不要动 `normalMap` / `normalScale`——已在做微起伏，保留。

### 2.4 环境反射强度（对应报告 Day 1 a）

**文件**：`src/scene/sceneEngine.ts` 的 `initEnvironment()`

- `environmentIntensity = 0.35` → `0.55`。

**背景**：报告建议 0.6，但 0.35 是 P9 为了压掉白天过灰特意调低的。0.55 是折中——保留 P9 的冷暖对比，同时让 PBR 反射可见。这是主观判断，改动后如果用户在真 GPU 上仍觉得偏灰，可以再调；本阶段先给一个明确的起点。

**WebGPU 分支**：`initEnvironment` 目前 `if (this.backend.type !== 'webgl2') return;` 就退出，WebGPU 路径无 IBL。r186 的 `PMREMGenerator` 依赖 WebGL 内部 API，无法跨后端复用。**本阶段不解决 WebGPU IBL**（要解决得走 `three/webgpu` 的 `EnvironmentNode` 路线，属于架构级改动）。在代码注释里显式标注这个已知缺口，让下阶段有明确的入口。

### 2.5 假体积光柱默认关闭（对应报告硬伤 #2 的精神，但方式不同）

**文件**：`src/scene/sceneEngine.ts`

- 类字段 `private shaftUserEnabled = true;` → `false`。
- 构造函数末尾的 `updateSunPosition()` 已存在，会把 `lightShaft.visible` 设为 `false`（因为 `shaftUserEnabled=false` 时 `visible = false && ...` 恒 false）。不需要额外逻辑。

**背景**：`godrays.ts`（屏幕空间体积光，锚点 = 窗中心）已经实现了"太阳穿过洞口"的体积光效果，且是深度纹理驱动的真体积光。`volumetricShaft.ts` 的两片半透明平面是伪体积光（几何近似），两者同时开会让画面糊。默认关闭 shafts 不影响 godrays。

**UI 侧同步**：`src/App.tsx` 第 220 行 `const [lightShaftVisible, setLightShaftVisible] = useState(true);` → `useState(false)`（否则用户看到开关是"开"但实际没效果，会以为坏了）。**同时不要删** `volumetricShaft.ts` 及其测试——保留模块与开关，用户手动打开仍有意义（P12 阶段不做代码删除，避免破坏 `volumetricShaft.test.ts`）。

### 2.6 活动区线框收敛（对应报告硬伤 #2）

**文件**：`src/render/activityZone.ts`

报告硬伤：「地面绿/黄活动区线框常显，调试可视化暴露在主画面，业主第一眼认定这是工程工具」。改动：

- **边框线**（第 82–88 行的 `LineSegments` + `LineBasicMaterial`）：把 `LineBasicMaterial` 加上 `transparent: true` 与 `opacity`——未选中 `0.35`，选中 `0.8`。这样常显但明显退到背景，不再是抢眼的绿/黄框线。
- **填充面**（第 63–73 行）：`opacity` 未选中 `0.15` → `0.08`，选中 `0.22` → `0.16`。填充也应更收敛，避免与家具抢注意力。

**为什么保留而不删除**：活动区可视化是需求侧实体的必要可视化（P4 的设计，见 `activityZone.ts` 顶部注释）。完全删除会让用户增删改活动区、调 planeH/size/rotY 时看不出效果（这正是原注释里"避免白盒子"要防的反面）。**正确的做法是收敛而非移除**——业主看到的是一个几乎透明的柔和高亮区，而不是工程线框。

**测试兼容性**：`src/render/__tests__/activityZone.test.ts` 第 80–82 行断言 `mat.opacity < 0.5`——新值 0.08 与 0.16 均满足。不要改测试。

## 3. 严禁事项（红线条款）

1. **不要删** `lightBuilder.ts` 里的 `case 'cone'`（灯罩几何，P11 刚修过）。
2. **不要删** `RoomEnvironment` / `initEnvironment()`（已存在且工作）。
3. **不要动** `PRESET_SCENES` 里的 `levels` 值（除非报告明确要求；本阶段只动 `cct`）。
4. **不要引入**新依赖（无 `RoomEnvironment` 以外的新 `three/examples` 导入需求）。
5. **不要动** 场景应用链路（`SceneSystem.apply` / `SceneController.applyScene` / `projectStore.applyScene`）。
6. **不要动** ADR（`CLAUDE.md` 里的 5 条铁律）。
7. **不要修改测试来让测试通过**。若必须改测试，先停下报告给 Hermes。
8. **不要新增文件**（除非是必要的新测试）。

## 4. 测试要求

改动完成后**必须**跑 `npm run verify`，预期结果：

- typecheck：通过（无类型错误）。
- lint：通过。
- test：33 个测试文件全绿，测试数 ≥ 454（可以只增不减；若下降即改错）。

**若某条测试因为参数变化而失败**：先判断是不是断言本身写死了旧值。若断言只检查结构/范围（如相机在房间内），改参数后应仍通过；若断言写死了旧值（如某处 `expect(roughness).toBeCloseTo(0.7)`），**停下报告**，不要改测试。

## 5. 交付物清单

改动清单（每一项都要在 commit 里能定位）：

- [ ] `src/scene/sceneEngine.ts`：相机 fov/pos/target、`setCameraPosition` 内 target、`environmentIntensity`、`shaftUserEnabled` 默认值、`initEnvironment` 注释标注 WebGPU IBL 缺口。
- [ ] `src/scene/sceneSystem.ts`：`PRESET_SCENES` 中 daylight/dinner/movie/reading 的 cct。
- [ ] `src/render/room.ts`：地板 roughness、墙面 roughness、天花独立材质函数。
- [ ] `src/render/activityZone.ts`：边框线 `transparent/opacity`（未选中 0.35 / 选中 0.8）、填充面 opacity（未选中 0.08 / 选中 0.16）。
- [ ] `src/App.tsx`：`lightShaftVisible` 初始 state 为 false。

## 6. 提交与不推送

- 单独一个 commit。
- 提交信息：`fix(P12): camera-level, scene CCT matrix, materials, IBL intensity, shaft default`
- **不要 push**，Hermes 会独立验收后再决定。
- 报告改动清单时附上：`git show --stat` 输出、`npm run verify` 完整输出、以及每一项改动的 before/after diff 片段。

## 7. 不做（本阶段明确排除）

- 不做 bloom 参数定版（Day 4 h，下阶段）。
- 不做 UI 收口 / 开发者折叠区（Day 6 j，下阶段）。
- 不做 4 个机位预设（Day 6 k，下阶段）。
- 不做阴影预算重排（Day 5 i，下阶段）。
- 不做上传户型图 / 建模闭环（第 2 周）。
- 不做曝光矩阵与场景预设联动（Day 4 g，下阶段）。
