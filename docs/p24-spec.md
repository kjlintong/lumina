# P24 规格：画面质量收口

> 上游：`LUMINA_两周执行规格_hermes.md` §4 Day 6 j / §4 Day 7 验收
> 上游：报告 §6「UI 收口」「lookdev」「分区线框」
> 前置：P0a–P4k 画面地基已落地（IBL / toneMapping / 阴影 / 曝光矩阵 / Bloom / 4 机位 / 材质 6 件套）
> 范围：仅补 3 个剩余缺口，不重做已达标项，不扩 SKU

---

## 0. 当前状态（已达标，不重做）

| 规格项 | 文件:行 | 状态 |
|---|---|---|
| P0a IBL | sceneEngine.ts `RoomEnvironment` + `scene.environment` | ✅ |
| P0b Tone mapping | backend.ts:215 ACESFilmic + SRGBColorSpace | ✅ |
| P0c 删除人工灯锥形光束 | 0 个 fixture cone mesh | ✅ |
| P0d 相机平视 fov 37 | sceneEngine.ts「fov 60 → 37」+ y=1.55 | ✅ |
| P1e 材质 6 件套 | room.ts/furniture.ts/materials.ts | ✅ 见下表 |
| P1f 体积光只给太阳 | lightShaft 仅 sun | ✅ |
| P2g 曝光色温矩阵 | presetExposureBySceneKey | ✅ |
| P2h Bloom 定版 | UnrealBloomPass 5 处 | ✅ |
| P3i 阴影策略 | backend.ts:278 PCFSoftShadowMap | ✅ |
| P4k 4 机位预设 | cameraPresets.ts window/sofa/dining/overview | ✅ |

### 材质 6 件套实际覆盖（核对报告 §4 e）

| 表面 | roughness | normal | albedo | 其他 | 文件 |
|---|---|---|---|---|---|
| 橡木地板 | 0.4 | ✅ woodFloorNormalColor | ✅ woodFloorColor | roughnessMap + clearcoat 0.15 | room.ts:273 |
| 墙面涂料 | 0.90 | ✅ wallNormalColor | — | normalScale 0.4 | room.ts:242 |
| 天花 | 0.95 | — | — | 反射率 0.8 | room.ts:261 |
| 布艺沙发 | 0.95 | ✅ fabricNormalColor | ✅ makeFabricTexture | normalScale 0.5 | furniture.ts:116 |
| 玻璃 | 0.05 | — | — | transmission 1.0, ior 1.5, thickness 0.01 | room.ts:179 |
| 混凝土 | — | — | — | 场景无混凝土表面，未造几何体凑数（红线 #7） | — |

> 结论：材质最小包已达标。P14 已记录「不凭空造混凝土几何体凑数」。

---

## 1. P24-a：UI 收口（剩余两项）

报告硬伤第 6 条：JSON 导入导出 / lux / XYZ 坐标 / 置信度调试开关，全部收进「开发者」折叠区或「专业模式」开关后，默认关闭。

### 1.1 现状

专业模式开关已存在（`src/store/professionalMode.ts`，localStorage 持久化），RenderPanel 和 IlluminancePanel 已收在 `{professional && ...}` 后。

**仍泄漏的两项：**

1. **RenderPanel.tsx:284-290** —— 「导出 JSON / 导入 JSON」按钮在「项目管理」字段组里。RenderPanel 整体已在 `professional` 后，但 JSON 按钮与渲染调参混在同一面板，C 端开专业模式后仍会看到 JSON 控件。
2. **ZonePanel.tsx:87** —— `目标 {z.lux} lx` 在 `item-meta` 里常显。ZonePanel 不在 `professional` 后，C 端默认就看见 lux 绝对值。报告 §2 明确「C 端不靠 lux 绝对值」。

### 1.2 改动

#### 1.2.1 RenderPanel：JSON 按钮独立折叠区

在 RenderPanel 内把「项目管理」字段组里的 JSON 导入导出按钮，移到一个 `Panel title="开发者" defaultOpen={false}` 折叠区内（或同级 `defaultOpen={false}` 的折叠块）。方案名称输入框和「重置为示例方案」按钮保留在原「项目管理」组。

**不动**：RenderPanel 整体仍保持 `{professional && <RenderPanel/>}` 的外层门（这是 P19 既有逻辑，不破坏）。

#### 1.2.2 ZonePanel：lux 收进专业模式

ZonePanel 需要读 professionalMode。两种实现方式：

- **方式 A（推荐）**：ZonePanel 内部 `import { readProfessionalMode }` + 订阅 localStorage 变化（或直接用 App 层已有的 `professional` state 通过 props 传入）。lux 数字 `{z.lux} lx` 只在 `professional` 时渲染。
- **方式 B**：把 lux 行包进 `<details>` 元素，默认收起。

优先方式 A：与 FixturePanel / IlluminancePanel 保持一致的 `professional` 门控语义，不引入新 UI 模式。

ZonePanel 当前未读 professionalMode，需要加订阅。实现要点：
- ZonePanel 接收 `professional?: boolean` prop（可选，默认 false）
- App.tsx:567 改为 `<ZonePanel professional={professional} />`
- lux 行 `{professional && <> · 目标 {z.lux} lx</>}`

### 1.3 验收

- 默认（未开专业模式）：ZonePanel 不显示 lux 数字；RenderPanel 整个不可见（既有逻辑）。
- 开专业模式：ZonePanel 显示 lux；RenderPanel 出现，但「开发者」折叠区默认收起，JSON 按钮需点击展开才可见。
- 不引入新 UI 库，不新增依赖。
- 测试：现有 ZonePanel / RenderPanel 测试（如有）全部通过；新增一个「未开专业模式时 ZonePanel 不渲染 lux 文本」的断言。

---

## 2. P24-b：分区线框从 3D 移到 2D

报告硬伤第 2 条：「地面绿/黄活动区线框常显，业主第一眼认定这是工程工具」。

### 2.1 现状

`activityZone.ts:67-90` 在 3D 场景里画：
- 半透明工作面包（opacity 0.08/0.16，P12 已收敛）
- EdgesGeometry 边框线（opacity 0.35/0.8，P12 已加透明退背景）

`FloorPlan.tsx` 已用 `zonesToRects` 画分区矩形（2D 平面图视图）。

**问题**：3D 里仍保留工作面包 + 边框线，业主看 3D 主画面时仍能看到半透明色块和边框。

### 2.2 改动

**3D 场景默认隐藏工作面包和边框**，仅在 hover/选中时显示半透明柔和高亮。

具体：
- `buildActivityZone(zone, selected)` 的 `selected` 参数语义不变，但默认 `selected=false` 时整组 `visible=false`
- 选中时 `visible=true`，opacity 用 P12 的选中档（fill 0.16 / edges 0.8）
- 未选中时不可见（不是 0.08/0.35，是直接 `visible=false`）

实现要点：
- `activityZone.ts` 加 `group.visible = selected`（或更细：fill/edges 子对象分别控制）
- `sceneEngine.ts:822 addZone(zone, selected)` 已有 selected 参数，逻辑不需改
- App.tsx 选中态变化触发 `updateZone`（已有逻辑，App.tsx:138 注释提到「选中态变化也触发重建」）

**2D 平面图 FloorPlan 保留分区矩形常显**（这是规格明确要的方向：「分区线框移到 2D 平面图视图」）。

### 2.3 验收

- 3D 主画面默认无分区色块/边框线
- 点击选中某个分区后，3D 里该分区显示半透明高亮
- 取消选中后恢复隐藏
- 2D FloorPlan 分区矩形不受影响，常显
- 测试：新增「buildActivityZone 未选中时 group.visible === false」断言；「选中时 visible === true」断言

---

## 3. P24-c：lookdev 截图文档

Day 7 验收要求：8 张截图（4 机位 × 日落/夜间）与帧 A、帧 B 并排，逐条写差距，提交到 `docs/lookdev/` 目录带日期。

### 3.1 现状

`docs/lookdev/` 目录不存在。无截图脚本。

### 3.2 改动

**仅补文档和目录结构，不在软渲染环境下跑截图。**

理由：
- 规格 §1 硬红线：「禁止在 SwiftShader / 软件渲染下验收画面」
- 当前 WSL2 环境 `DISPLAY=:0` 但无 Chrome/Chromium，无 playwright/puppeteer 依赖
- 装 playwright + 下载 chromium（~150MB）+ 跑 WebGL 软渲染 = 违反红线
- 截图必须由用户在真实 GPU（RTX 3060 / Apple M2）上手动跑，提交截图

**交付物**：
1. 创建 `docs/lookdev/README.md` —— 说明截图流程、机位、验收标准
2. 创建 `docs/lookdev/templates/` —— 4 机位 × 2 时段（日落 17:45 / 夜间 21:00）= 8 张截图的文件名占位（空目录或带说明的占位文件）
3. 创建 `docs/lookdev/frames.md` —— 帧 A（目标帧）、帧 B（验收帧）的描述与差距记录模板

### 3.3 验收

- `docs/lookdev/` 目录存在，结构清晰
- README 说明：截图命令、机位名、时段、验收标准
- 不引入 playwright/puppeteer 依赖
- 不跑任何截图（当前环境不具备真实 GPU）

---

## 4. 不做（明确排除）

| 项 | 理由 |
|---|---|
| 材质升级（重做 6 件套） | 已达标，不重做 |
| 混凝土材质 | 场景无混凝土表面，红线 #7 不凑数 |
| 自动墙体提取 | 第 2 周导入建模范畴，不是画面 |
| PDF 上传 | 第 2 周导入建模范畴 |
| 照度报告 / 扩 SKU | 规格明确不新增功能 |
| WebGPU 后端 | 规格 §3 明确决策：不上 WebGPU |
| 跑 lookdev 截图 | 软渲染违反红线，必须由用户手动跑 |
| 性能优化（60fps 调优） | 规格 Day 7 验收项，但属用户实测范畴 |

---

## 5. 验收清单

### P24-a UI 收口
- [ ] RenderPanel JSON 按钮在 `defaultOpen={false}` 折叠区内
- [ ] ZonePanel lux 只在 professional 时显示
- [ ] App.tsx 传 `professional` prop 给 ZonePanel
- [ ] 新增测试：未开专业模式 ZonePanel 不渲染 lux 文本
- [ ] 现有测试全绿（基线 734 tests）

### P24-b 分区 3D→2D
- [ ] buildActivityZone 未选中时 group.visible=false
- [ ] 选中时 visible=true
- [ ] 2D FloorPlan 分区矩形不受影响
- [ ] 新增测试：未选中 visible=false / 选中 visible=true

### P24-c lookdev 文档
- [ ] docs/lookdev/README.md
- [ ] docs/lookdev/frames.md
- [ ] docs/lookdev/templates/ 目录
- [ ] 不引入 playwright/puppeteer 依赖

### 全局
- [ ] tsc --noEmit 0 error
- [ ] vitest run 全绿（基线 734 + 新增）
- [ ] 不扩 SKU、不新增功能
