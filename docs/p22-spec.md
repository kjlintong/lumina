# P22 规格：户型库模板 + 手动描墙 + store 接线 + 2D/3D 房间同步

> 依据 `../../LUMINA_两周执行规格_hermes.md` §6 范围 4（手动描墙兜底）/ 9
> （户型库模板）/ 7（置信度 provenance + undo 栈）/ 5（3D 生成的最小半块），
> 以及 p21-spec.md §0「后续阶段（P22–P24）」的分工。
>
> **本规格交第 2 周的「冷启动 + 兜底路径 + 接线」半块**：8 个户型库模板、
> 手动描墙（P0 兜底路径，不是失败降级）、`LuminaProject.model` 接入 store
> （含 undo 栈与 `applyUserEdit`）、2D 户型图改挂 `ModelGeometry`、3D 场景
> 房间尺寸跟随 model 包围盒。
>
> **不做**（P23 起）：上传入口与图像预处理、墙体自动分割、校正器四项
> （P0 四项里除「描墙」外的三项）、门窗开口增删改、墙体 3D 挤出与材质分配。

## 0. 阶段定位与不做什么

| 本阶段做 | 本阶段**不**做（后续阶段） |
|---|---|
| `src/core/templates.ts`：8 个户型库模板（范围 9，冷启动另一条腿） | 上传入口 / PDF 解析 / 图像预处理（范围 1–3，P23） |
| `src/store/modelingStore.ts`：`model` + undo/redo 栈 + 描墙动作 | 墙体视觉分割与自动识别（范围 4 前半，P23） |
| 手动描墙：点加点、网格吸附 0.1m、正交吸附 15°、首末自动闭合（范围 4） | 校正器其余三项：端点拖拽 / 门窗增删改 / 层高楼板厚度（范围 6，P23） |
| `src/render/modelPlanLayout.ts`：`ModelGeometry` → SVG / `RoomDims` 纯函数 | 墙体 3D 挤出（保留厚度）/ 楼板天花 / 门窗布尔（范围 5，P23–P24） |
| `FloorPlan` 改挂 `ModelGeometry`（2D 图读真实 model） | 户型库模板缩略图渲染（P23 用 SVG 缩略图补） |
| 3D 场景房间尺寸读 model 包围盒（渲染改动的**最小**半块） | 户型库模板的 3D 差异展示、材质分配 |

§6「明确不做」四条全部继承：不做 DWG/DXF/IFC、不做水电/合规、不做照度报告、
不做反射率自动识别。

## 1. 目标（验收判据，不是步骤）

1. **模板即冷启动**：8 个模板，点一个即得可用的 `ModelGeometry`；
   每个模板 `checkTopology(...)`.passed === true（不是"看起来对"，是真跑过校验）。
2. **描墙是保底路径**：空画布逐点点房间轮廓，Enter 提交，首末自动闭合；
   网格 0.1m + 正交 15° 吸附生效；描完的墙段 / 房间 `provenance.kind === 'user_edit'`
   且 `confidence === 1`。
3. **修改进 undo 栈**：每次描墙提交写一条 `UndoEntry`，undo/redo 可用；
   新编辑清空 redo 分支（P21 `UndoStack` 的既有约定，必测）。
4. **2D 与 3D 同源**：`FloorPlan` 直接画 `ModelGeometry` 的墙段与房间，
   不再有硬编码 6×4.5；3D 场景 `RoomDims` 来自 `modelingToRoom` 的包围盒。
5. **拓扑违规在 UI 可见**：选中模板 / 描完户型后，拓扑校验报告列出
   `elementIds`，用户能定位到哪条墙 / 哪个房间出了问题（不是只给一个红叉）。

## 2. 关键现状（已确认，不要重复造 / 不要踩坑）

- **P21 已交付并全绿**：41 个测试文件 / 652 个测试通过。
  `src/core/modeling.ts`（契约）、`scale.ts`（标定）、`confidence.ts`
  （阈值 + `applyUserEdit` + `UndoStack`）、`topology.ts`（5 条规则）、
  `importers.ts`（分档 descriptor）全部存在且可用。
- **`topology.ts` 现有导出**（P22 直接复用，不要重造）：
  `checkTopology(model)`, `checkRoomClosed(rooms)`, `checkOpeningOnWall(walls, openings)`,
  `checkWallEndpointsConnected(walls)`, `checkAreaMatchesLabel(rooms)`,
  `checkScaleSelfConsistent(model)`, `wallLength(wall)`, `roomArea(room)`,
  `TOPOLOGY_EPSILON = 0.01`, `AREA_RELATIVE_TOLERANCE = 0.05`,
  `WALL_ENDPOINT_EPSILON = 0.01`。
- **坐标系约定（继承 `render/planLayout.ts:6-12`，不得翻转）**：
  世界 x 东向右正、世界 z 南向正**负为北**、SVG y 向下；
  `worldToPlan(x, z) = { x: ox + x*scale, y: oy + z*scale }`，房间中心在世界原点。
- **墙段约定（`modeling.ts:75-77`）**：`a → b` 定义方向，`thickness` 沿该方向
  左侧（用户视角看墙时在内侧）。
- **房间多边形**：`RoomPolygon.vertices` 顶点按**逆时针**，
  且**必须首尾重合**（最后一个顶点坐标 == 第一个）——`topology.ts` 的
  `room_closed` 判首尾 `close(a, b, 0.01)`，且 shoelace 面积只有在首尾重合时
  才是完整闭合面积。契约本身不强制闭合（P21 §3.1），但**入库的模板与描墙结果
  必须闭合**，否则第 4 条规则永远违规。
- **默认墙厚**：`modeling.ts` 的 `DEFAULT_WALL_THICKNESS = 0.15`
  （出处 `render/room.ts:93` 的 `WALL_THICKNESS`）。P22 不改渲染层常量，
  模板与描墙生成的墙段一律用它。
- **`LuminaProject.schemaVersion` 仍是 1，不得 bump**（P21 §6 禁令 4）。
  `LuminaProject.model?: ModelGeometry` 可选字段已加好，`serialize.ts` 的
  round-trip 已支持（条件展开，未设 model 时 wire 格式与现状完全一致）。
  **P22 不碰 `serialize.ts`**，只追加 round-trip 测试断言。
- **`projectStore.ts` 有 ADR 铁律（ADR-01/02/13/17）**，全部与灯具/活动区相关，
  与 `model` 无关。P22 **不改 `projectStore.ts` 的既有 action 与 ADR 语义**，
  只做一次 `project.model` 的赋值同步（见 §3.3）。
- **既有 UI 惯例**：CSS 全部在 `index.html` 的单个 `<style>` 块里，
  用 P10 design tokens（`--accent-warm: #f0a040`、`--bg-panel`、`--border-subtle`、
  `var(--radius-md)` 等）。**不要新建 .css 文件**，追加到 index.html 的 style 块。
  面板容器用 `ui/panels/Panel.tsx` 的 `<Panel title=...>`。
  测试用 `@testing-library/react` + `user-event` + `jest-dom`（已在 package.json），
  既有 UI 测试见 `src/ui/__tests__/panels.test.tsx`（`resetStore` 模式可参考）。
- **jsdom 限制**：`canvas.getContext('2d')` 返回 null。本阶段全部走 **SVG**
  （与 P8f `FloorPlan` 一致），不碰 canvas。若实现时发现某需求必须读像素，
  **停下来说明**，不要降级成 mock 断言。
- **vitest 并发已被限制**（`vite.config.ts` `maxForks=4`，WSL 内存保护），**勿改**。

## 3. 交付物

### 3.1 `src/core/templates.ts` —— 户型库模板（范围 9）

8 个常见户型，覆盖中国大陆住宅的常见开间模数（2.8 / 3.3 / 3.6m 开间、
2.4m 进深、0.9–1.2m 过道）。**每个模板必须是可入库的 `ModelGeometry`**：

```ts
import type { ModelGeometry } from './modeling.js';

export interface HouseTemplate {
  /** 稳定 id，用于持久化 / 「以这个起步」的历史记录 */
  id: string;
  name: string;
  /** 建筑面积（米²，与 sum(rooms.area) 一致，UI 展示用） */
  area: number;
  /** 开间（米，东西向最大跨度） */
  width: number;
  /** 进深（米，南北向最大跨度） */
  depth: number;
  model: ModelGeometry;
}

export const HOUSE_TEMPLATES: readonly HouseTemplate[];   // 8 个，长度必测
export function getTemplate(id: string): HouseTemplate | undefined;
```

**模板清单（8 个，面积 = 各房间面积之和，不是外框面积）**：

| id | 名称 | 外框 | 总面积 | 房间构成 |
|---|---|---|---|---|
| `studio-compact` | 一居室 25㎡ | 3.0 × 4.5 | 25.5 | 客厅卧室 18 + 厨卫 7.5 |
| `1br` | 两居 50㎡ | 5.0 × 5.0 | 49.5 | 卧室 12 + 客厅 24 + 厨卫 13.5 |
| `2br` | 两居 62㎡ | 5.5 × 5.5 | 61.5 | 主卧 14 + 次卧 10 + 客厅 20 + 厨卫 17.5 |
| `3br` | 三居 78㎡ | 7.0 × 5.0 | 77.5 | 主卧 14 + 次卧 10 + 书房 9 + 客厅 20 + 厨卫 24.5 |
| `large-flat` | 大平层 128㎡ | 9.0 × 6.5 | 127.5 | 三卧 + 客厅餐厅 + 厨卫 |
| `bay-window` | 飘窗开间 2.8m | 3.0 × 4.5 | 25.5 | 一居室 + 南向飘窗 |
| `loft-split` | 复式两居 | 5.0 × 4.5 | 45.0 | 下厅上卧 |
| `corner-l` | L 型两居 | 6.0 × 4.0 | 48.0 | 卧室 12 + 客厅 24 + 厨卫 12（外框非矩形） |

**几何约束（每个模板都要满足，否则 `checkTopology` 会失败）**：

- **墙段只建外墙环，不建内墙**（关键，否则会触发 `wall_endpoints_connected` 违规）：
  `topology.ts:209-245` 的 `checkWallEndpointsConnected` 只做**端点 ↔ 端点**匹配，
  不识别 T 形接头（内墙端点落在外墙中间）。所以任何内墙端点都会被判为孤立端点。
  本阶段模板的墙段只包含建筑外框（端点两两共享的闭合环），
  **房间功能分区一律用 `RoomPolygon` 表达**，不靠内墙几何。
  这是数据模型的合理简化：外墙定义建筑边界，房间多边形定义功能分区，
  两者不要求几何对应。扩展拓扑规则支持 T 形接头属 P23 校正器的范围
  （配合「端点拖拽」一起解决），本阶段不改 `topology.ts`。
- **墙段端点两两共享**：相邻外墙段共享同一个角点坐标（`close(..., 0.01)` 成立），
  否则触发 `wall_endpoints_connected`。矩形外框 = 4 段墙，4 个角点各被 2 段共享。
  L 型外框 = 6 段墙，6 个角点各被 2 段共享。
- 墙段 `height` = `slab.ceilingH`，`thickness = DEFAULT_WALL_THICKNESS`。
- **房间多边形**：顶点**逆时针** + **首尾重合**（最后一个顶点 === 第一个），
  否则 `room_closed` 违规（`topology.ts:127-139`）。
  另外要注意 `checkRoomClosed` 还有**退化检查**（`topology.ts:145-151`）：
  前三个顶点共线也会违规，所以房间不能退化成一条线。
  **顶点方向不影响校验通过** —— `roomArea`（`topology.ts:79-90`）用
  `Math.abs(shoelace) / 2`，方向无关；`isCollinear` 也是 abs 判定。
  「逆时针」是数据契约的约定（面积符号 / 外法线方向），不是校验必要条件，
  不要在这里纠结方向，重点是首尾重合 + 不共线。
  内墙隔出的每个房间都要有自己的 `RoomPolygon`；
  `labeledArea` 一律填与 `roomArea` 实测一致的值（5% 容差内，`topology.ts:263`）。
- **开口**：模板至少含 1 个南向窗（`kind: 'window'`，`sill > 0`）
  与 1 个入户门（`kind: 'door'`，`sill = 0`），挂在**外墙**段上；
  `wallId` 必须存在（孤儿开口违规，`topology.ts:165-172`），
  且 `offset ≥ 0` 且 `offset + width ≤ wallLength(wall)`（`topology.ts:179-195`）。
- **`track: { track: 'template', guaranteesUniformError: true, maxErrorCm: 5 }`**
  （§6 验收判据：墙位误差 < 5cm）。
- **`calibration`**：模板已在 SI 单位，不需要图纸标定，但类型上必须非 null
  才能通过 `scale_self_consistent`（`topology.ts:287-295` 在 `null` 时**必判违规**）。
  填**恒等标定**：
  `{ measuredOnDrawing: 1, realDistance: 1, realUnit: 'm', unitConfirmed: true, toMeters: 1 }`。
  语义注释要写清：模板路径的标定是「1 图上单位 = 1 米」的恒等映射，
  与扫描图路径的真实两点标定不同（分档 SLA 在数据层的体现）。
- **`confidence` / `provenance`**：模板元素一律 `confidence: 1`，
  `provenance: { kind: 'model_inferred', rule: 'house_template' }`
  —— 模板是可信但**不是**用户编辑的，所以不能标 `user_edit`。

**`area` 一致性**：`HOUSE_TEMPLATES[n].area` 必须等于
`rooms.reduce((s, r) => s + roomArea(r), 0)`（容差 5%）。这条必测 ——
否则 UI 上写的「50㎡」和实际画出来的是两个数。

### 3.2 `src/store/modelingStore.ts` —— 建模状态 + undo 栈（范围 7）

**新 store，不要往 `projectStore.ts` 里堆**。理由写进文件头注释：
`projectStore` 每次变更都会触发 `App.tsx` 的 store→engine 订阅并可能重建 Three.js
对象；建模阶段（描墙点加点、吸附预览）变更极频繁，走独立 store 可以只在
「描墙提交」时同步一次 `project.model`，避免渲染层抖动。

```ts
import type { ModelGeometry, WallSegment, RoomPolygon } from '../core/modeling.js';
import type { UndoEntry } from '../core/confidence.js';
import { UndoStack } from '../core/confidence.js';
import { HOUSE_TEMPLATES } from '../core/templates.js';

export interface ModelingState {
  /** 当前选中的模板 id；null = 空画布（手动描墙模式） */
  selectedTemplateId: string | null;
  model: ModelGeometry;
  /** 进行中的描墙多边形顶点（世界坐标，米）；提交后清空 */
  pendingRoom: readonly (readonly [x: number, z: number])[];

  applyTemplate: (id: string) => void;
  clearModel: () => void;
  /** 描墙：追加一个顶点（世界坐标，吸附在纯函数侧完成） */
  addPendingVertex: (p: readonly [x: number, z: number]) => void;
  cancelPending: () => void;
  /**
   * 提交描墙：首末自动闭合 → 生成 RoomPolygon + 外墙段 → 写 undo 栈
   * → 每个元素经 `applyUserEdit`（provenance 置 user_edit、confidence 置 1）
   * → 同步到 projectStore 的 project.model。
   */
  commitRoom: (name: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export function useModelingStore(): ModelingState;
```

**实现要点**：

- `UndoStack<ModelGeometry>` 实例放在 store 外部（模块级），不入 state
  —— 它是可变对象，进 state 会被 immer draft 化。`canUndo/canRedo` 是
  读函数，不返回 state 里的布尔值（描墙状态变化时用 `set` 触发一次
  重渲染即可）。
- **描墙提交生成的元素必须经 `confidence.ts` 的 `applyUserEdit`** ——
  这是 §6 范围 7 的硬性要求（红线 3）。直接手写 `provenance: { kind: 'user_edit' }`
  不算数，必须调函数。
- `applyTemplate` / `clearModel` / `commitRoom` 都要写 undo 条目
  （`label` 用「套用模板：xxx」「清空画布」「描墙：卧室」这种人话，
  UI 可在后续阶段用它做 undo 历史列表）。
- 空画布的 `model` 是一个合法的 `ModelGeometry`（`schemaId: MODEL_SCHEMA_ID`、
  `walls: []`, `openings: []`, `rooms: []`, `slab: { level: 0, thickness: 0.15, ceilingH: 2.8 }`,
  `calibration: null`, `track: { track: 'scan', guaranteesUniformError: false }`）。
  `calibration: null` 会让 `scale_self_consistent` 判违规 —— **这是预期的**：
  空画布 / 描墙模式下拓扑面板就该提示「尚未标定比例尺」，UI 按 `track` 分档
  显示不同的提示文案（描墙走「米制直接输入，无需标定」分支）。
- **同步到 projectStore**：`applyTemplate` / `commitRoom` / `undo` / `redo` 之后
  调一次 `useProjectStore.setState({ project: { ...p, model } })`。
  这是唯一一次跨 store 写入，**不要**订阅 projectStore 反向同步（会成环）。

### 3.3 `src/render/modelPlanLayout.ts` —— 建模布局纯函数

与既有 `planLayout.ts`（房间 + 活动区 + 灯具）并列，处理 `ModelGeometry`。
**纯函数，无 Three.js / DOM 依赖，jsdom 下可单测**。

```ts
import type { ModelGeometry, WallSegment, RoomPolygon } from '../core/modeling.js';

/**
 * ModelGeometry 的世界包围盒（米），中心已归零到世界原点。
 * `walls` 与 `rooms` 都为空时返回 null（空画布）。
 */
export function modelBounds(model: ModelGeometry): { width: number; depth: number } | null;
/**
 * 包围盒 + 层高 → 引擎侧房间尺寸。
 * 注意：**不要**复用 `planLayout.RoomDims` 类型 —— 那是 2D 平面图的视图配置
 * （带 SVG px），而 3D 侧 `sceneEngine` 读的是 `SceneEngineConfig.roomWidth /
 * roomDepth`（米）。这里返回引擎侧的形状，避免把两种语义混成一个类型。
 */
export function modelToRoomDims(model: ModelGeometry): { width: number; depth: number; height: number } | null;

/** 墙段 → SVG 端点（复用 `planLayout.worldToPlan`，不要另写一套坐标变换） */
export function wallsToSvg(
  walls: readonly WallSegment[],
  ox: number, oy: number, scale: number,
): { id: string; x1: number; y1: number; x2: number; y2: number }[];

export function roomsToPaths(
  rooms: readonly RoomPolygon[],
  ox: number, oy: number, scale: number,
): { id: string; name: string; d: string; cx: number; cy: number }[];

export function openingsToSvg(
  openings: readonly Opening[],
  ox: number, oy: number, scale: number,
): { id: string; kind: 'door' | 'window'; x1: number; y1: number; x2: number; y2: number }[];

// ---- 描墙吸附（范围 4「网格吸附、正交吸附、长度与角度锁定」）----

export const GRID_SNAP_M = 0.1;            // 网格吸附步长（米）
export const ORTHO_ANGLE_DEG = 15;         // 正交吸附的角度阈值（度）

/** 网格吸附：把点吸附到最近的 0.1m 网格交点 */
export function snapToGrid(p: readonly [x: number, z: number], gridM: number): readonly [number, number];
/**
 * 正交吸附：给「上一顶点」与「当前鼠标点」，若连线与水平/竖直的夹角
 * 小于 ORTHO_ANGLE_DEG 则吸附到该方向。用角度判定（atan2），不用 === 比较坐标。
 */
export function snapOrtho(
  from: readonly [x: number, z: number],
  to: readonly [x: number, z: number],
): readonly [number, number];
/** 描墙点 → 世界坐标（SVG 反向变换，用 `planLayout.worldToPlan` 的逆） */
export function planToWorld(sx: number, sy: number, ox: number, oy: number, scale: number): readonly [number, number];
/** 点集首末闭合：若首末 close 则去掉重复末点，否则补上首点坐标 */
export function closeVertices(pts: readonly (readonly [x: number, z: number])[]): readonly (readonly [x: number, z: number])[];
```

**注意**：`modelBounds` / `modelToRoomDims` 在 `model.walls` 与 `model.rooms`
都为空时返回 `null`（空画布），调用方必须处理 null（回退到既有默认
6×4.5×2.8，见 §3.6）。

**包围盒必须中心归零**：`modelBounds` 返回的是「中心在世界原点的包围盒尺寸」，
即先把墙段 / 房间顶点整体平移使几何中心落在原点，再取 max-min。理由：
`sceneEngine` 的房间是「中心在原点，x∈±w/2, z∈±d/2」（`sceneEngine.ts:321`），
不归零会让 3D 房间整体偏移到墙角。这条是 2D/3D 同源的关键，必须单测。

### 3.4 UI

#### `src/ui/panels/ModelPanel.tsx`（新）

面板标题「户型」，内容：

1. **户型库**：8 个模板按钮（名称 + 面积），点击 `applyTemplate`；当前选中的
   按钮带 `active` 高亮（沿用 `ScenePanel` 的既有 class 模式）。
   另加一个「空画布（手动描墙）」按钮调 `clearModel`。
2. **拓扑校验报告**：跑 `checkTopology(project.model)`，
   - 全通过：显示「✓ 拓扑通过」徽标（用 `--bg-badge-ok`）；
   - 有违规：每条一个条目，显示 `rule` 中文名 + `message` + `elementIds`，
     并用 `--bg-badge-warn` 标红。按 §6「规则层，必过」，这是硬门禁显示。
3. **分档 SLA 提示**：按 `model.track.track` 分三种文案
   （`scan` = 显式显示置信度、不承诺统一误差；`cad` = 未上线提示；
   `template` = 承诺墙位误差 < 5cm）。文案必须是产品语言，不得是技术报错
   （与 `importers.ts` 的 `UNAVAILABLE_REASON` 风格一致）。
4. **undo / redo 按钮**：`canUndo/canRedo` 为 false 时置灰（`disabled`）。

#### `FloorPlan.tsx`（改造，不是新建）

从硬编码 6×4.5 的矩形改成读 `ModelGeometry`：

- 从 `useModelingStore().model` 取 `walls` / `rooms` / `openings`；
- 视图配置（scale / origin）用 `modelBounds` + `planOrigin` 算，
  让新户型自动铺满绘图区（不再是固定 6×4.5）；
- 墙段画成粗线（`strokeWidth` 表达墙厚感，与既有 P8f 的 1.5px 内框描边风格一致）；
- 房间画成半透明填充 + 名称标签（`roomsToPaths`）；低置信度房间
  （`isLowConfidence(room.confidence)`）用不同颜色高亮（§6 范围 7）；
- 开口按 kind 画成不同样式（窗 = 蓝色段、门 = 缺口，沿用既有「窗」的画法）；
- **保留**既有的活动区矩形与灯具点（`zonesToRects` / `fixturesToDots`）——
  它们挂在 `project.zones` / `project.fixtures` 上，与 `model` 无关，不能丢。
- 有 `model` 时显示「户型图」标题 + 面积；`model.walls` 为空时显示空态
  提示（引导去「户型」面板选模板或描墙）。

**兼容性红线**：既有测试 `panels.test.tsx` 若对 `FloorPlan` 有断言，
必须继续通过（`npm test` 全绿是硬门禁，不得删改既有断言来「修绿」）。

#### `src/ui/panels/ModelCanvas.tsx`（新）—— 手动描墙画布

SVG 交互，**不用 canvas**（jsdom 限制）。交互：

1. 从 store 取 `model` + `pendingRoom`；
2. `onPointerMove`：鼠标 SVG 坐标 → `planToWorld` → `snapToGrid` → `snapOrtho(prev, p)`
   → 画预览线段（虚线，`stroke-dasharray`）+ 显示当前长度（米，保留 2 位小数）；
3. `onClick`：把吸附后的点 `addPendingVertex`；
4. 显示已有点（小圆）；点 ≥ 3 个时显示闭合预览（首末连线，不同颜色）；
5. 提交：一个「完成房间」按钮 + 房间名输入框（默认「卧室」），
   点按钮或按 Enter 调 `commitRoom(name)`；
6. Esc 键 `cancelPending`；
7. 吸附开关：「网格吸附」「正交吸附」两个 checkbox，默认都开。

### 3.5 store 接线

- `modelingStore.ts` 已负责把 `model` 同步到 `projectStore.project.model`（§3.2）。
- **不要**在 `App.tsx` 里写额外的 store→store 同步逻辑（会成环）。
- `App.tsx` 的 store→engine 订阅（`createBackend` / `SceneEngine`）保持不动，
  只有 §3.6 的 `RoomDims` 一处改动。

### 3.6 3D 最小同步（**这是本阶段唯一的渲染改动**）

房间尺寸目前硬编码在 `App.tsx:329-333` 构造 `SceneEngine` 的地方：

```ts
const engine = new SceneEngine(result.backend, {
  roomWidth: 6,
  roomDepth: 4.5,
  roomHeight: 2.8,
  ...
});
```

改为从 `project.model` 取，走 `modelToRoomDims`：

- 非 null 时用它的 `width` / `depth` / `height`（`height` 来自 `model.slab.ceilingH`）；
- null（空画布 / 无 model）时**回退到既有默认 6 × 4.5 × 2.8**，
  保证首屏行为完全不变（既有测试与首屏截图不得因此变化）。

**实现方式由实现者选，但语义必须满足**：房间尺寸随 `project.model` 变化而更新。
可选两条路：① 引擎已支持重建房间（`sceneEngine` 里若已有 `roomWidth/roomDepth`
的 setter / rebuild 路径就复用，`sceneEngine.ts:413` 有
`const roomDepth = config.roomDepth ?? 4.5;` 说明存在默认值回退）；
② 不支持就重建 `SceneEngine`。选实现成本最低的一条，**但不得**为了省事把
`room.ts` 的几何改成每帧重算（性能红线：描墙时点加点极频繁）。

**兼容性硬约束**：`sceneEngine.test.ts` 有若干断言建立在 6×4.5×2.8 默认值上
（`sceneEngine.test.ts:321` 的「中心在原点，x∈±3, z∈±2.25」、`:445` 的
`halfDiag = √(6²+4.5²)/2`、`cameraPresets.test.ts:26` 的
「所有 position 在房间 6×4.5×2.8m 内」）。
这些是**默认值**测试，改动后必须继续通过 ——
即「无 model 时默认仍是 6×4.5×2.8」是硬门禁，**不得**修改这些既有断言。

**禁止**在本阶段做墙体挤出 / 楼板天花 / 门窗布尔（那是 P23–P24）。
本阶段 3D 里看到的只是「房间变成新尺寸」，外墙仍是 `room.ts` 的既有画法。

## 4. 测试要求（必测清单）

新文件放对应目录，命名 `*.test.ts(x)`（与既有约定一致）。

| 文件 | 必测点 |
|---|---|
| `src/core/__tests__/templates.test.ts` | ① `HOUSE_TEMPLATES.length === 8`；② **每个模板** `checkTopology(t.model).passed === true`（循环断言，不是只测一个）；③ 每个模板 `area` == `sum(rooms.area)` 容差 5%；④ 每个模板 `track.track === 'template'` 且 `maxErrorCm === 5`；⑤ 每个模板 `calibration` 非 null 且 `unitConfirmed === true`；⑥ 每个房间的顶点首尾 `close(a, b, 0.01)` 成立、顶点数 ≥ 4（含重复末点）；⑦ `provenance.kind === 'model_inferred'` 且 `rule === 'house_template'`；⑧ 每个模板至少 1 个 `kind: 'door'`（`sill === 0`）和 1 个 `kind: 'window'`（`sill > 0`）；⑨ `DEFAULT_WALL_THICKNESS` 被所有墙段使用；⑩ `getTemplate` 命中 / 未命中 |
| `src/store/__tests__/modelingStore.test.ts` | ① `applyTemplate` 后 `projectStore.project.model` 已同步且 `checkTopology.passed === true`；② `clearModel` 后 `model.walls/rooms` 为空且 `project.model` 同步为空画布；③ 描墙提交后 `rooms` 新增一个、每个新元素 `provenance.kind === 'user_edit'` 且 `confidence === 1`（**红线 3**）；④ 提交后首末顶点 `close(..., 0.01)` 成立（闭合）；⑤ 提交后由该房间外墙段组成的 `wall_endpoints_connected` 不违规（若描的是矩形）；⑥ `undo` 回到提交前，`redo` 再回来；⑦ 提交两次后 `undo` 两次分别回到各步；⑧ **新编辑清空 redo 分支**（描墙提交 → undo → 再提交 → `canRedo() === false`）；⑨ 空栈 `canUndo() === false` / `canRedo() === false`；⑩ `cancelPending` 不写 undo 条目 |
| `src/render/__tests__/modelPlanLayout.test.ts` | ① `modelingToRoom` 对包围盒正确的模型返回正确 `width/depth`（中心归零，不偏移到墙角）；② 空 model 返回 `null`；③ `snapToGrid` 吸附到 0.1 网格交点（含恰好落在网格上、正好跨半格）；④ `snapOrtho` 在 15° 内吸附到水平 / 竖直、超过 15° 不吸附（含正好 15° 的边界）；⑤ `planToWorld` 与 `worldToPlan` 互逆（`close` 判定，**禁止 `===`**）；⑥ `closeVertices`：已闭合的去重、未闭合的补点；⑦ `wallsToSvg` / `roomsToPaths` 坐标与 `worldToPlan` 一致 |
| `src/ui/__tests__/modelPanel.test.tsx` | ① 渲染 8 个模板按钮 + 「空画布」按钮；② 点模板按钮 `applyTemplate` 生效、`project.model` 同步、当前模板 active 高亮；③ 套用模板后拓扑报告显示「✓ 拓扑通过」；④ `clearModel` 后显示「尚未标定比例」类的分档提示（走 scan 分支）；⑤ 故意构造一个违规 model（`useProjectStore.setState` 注入未闭合房间），报告列出该房间的 `elementId`，不是只给红叉（**红线 2**）；⑥ undo/redo 按钮在不可用时 `disabled` |
| `src/ui/__tests__/modelCanvas.test.tsx` | ① 初始无 pending 点、无预览线；② 点画布追加 pending 顶点（store 里 `pendingRoom.length` 递增）；③ 点 ≥ 3 个时出现闭合预览；④ Esc 调 `cancelPending`（`pendingRoom` 清空）；⑤ 「完成房间」调 `commitRoom`，`pendingRoom` 清空且 `rooms` 新增；⑥ 网格吸附关闭后点坐标不吸附（直接进 store） |
| `src/core/__tests__/serialize.test.ts`（**既有文件，只追加**） | ① `model` 字段 round-trip 深度相等（`checkTopology` 对往返后的 model 仍 passed）；② 未设 `model` 的既有断言**不得改动**（现状行为完全一致） |

**红线（测试必须覆盖，违反即返工）**：
1. **8 个模板每一个都过 `checkTopology`** —— 只测第一个或只测两个不算通过。
2. 拓扑违规在 UI 上必须带 `elementIds`（可定位），不得只显示「有 N 条违规」。
3. 描墙提交的元素**必须**经 `applyUserEdit` 得到 `provenance: { kind: 'user_edit' }`
   与 `confidence: 1` —— 这是 §6 范围 7 的硬性要求。
4. 浮点比较一律走 `core/units.ts` 的 `close()`，**禁止** `===` / `toFixed`
   （`units.ts` 文件头明令）。吸附判定的阈值（0.1m / 15°）必须写进注释并测边界。
5. **不得删改既有测试断言**来「修绿」；`npm test` 全绿是硬门禁。
6. `LuminaProject.schemaVersion` 仍是 1，不得 bump。

## 5. 验证

实现者必须跑完并把输出贴进汇报：

```bash
npm run typecheck   # tsc --noEmit -p tsconfig.json
npm run lint        # eslint .
npm test            # vitest run（maxForks=4 勿改）
npm run verify      # 以上三项
npm run build       # tsc + vite build
```

**当前基线：41 个测试文件 / 652 个测试全部通过。** 实现后测试数应**多于** 652。
如果测试数没变或变少，说明测试没写进正确的目录或被 vitest 排除，
必须查清（`npx vitest run --reporter=verbose | grep -c "✓"`）。

**渲染改动附证据**（§7 禁令 2）：`room.ts` 的房间尺寸改动属渲染改动，
必须附首屏截图 + 「套用 3br 模板后」截图各一张，存 `docs/lookdev/YYYY-MM-DD/`。
**但截图必须在真实 GPU 机器上导出** —— 本开发环境是 WSL2 + SwiftShader，
rAF 不派发，渲染开销不可作为画面依据（§7 禁令 1）。
Claude Code 若无法截图，**停下来说明**并把截图任务留给我，**不要**自己降级成
mock 断言或跳过禁令。

## 6. 硬性禁令（继承 §7，违反即返工）

1. 一律 ESM 导入，导出用 named export，不混 default export。
2. **禁止 `any`**（`tsconfig` strict + ESLint 强制）。禁止 `any` 类型逃逸。
3. **不 bump `LuminaProject.schemaVersion`**（仍是 1）。
4. **不碰 `serialize.ts` 既有行为** —— 只追加测试断言，不改实现。
5. **不改 `projectStore.ts` 的既有 action 与 ADR 语义**（ADR-01/02/13/17）；
   只做一次 `project.model` 赋值同步。
6. **CSS 追加到 `index.html` 的 style 块**，用既有 design tokens，
   不新建 .css 文件、不引入 CSS 框架。
7. **不写 Three.js 墙体挤出 / 楼板 / 门窗布尔 / 材质分配**（P23–P24）。
   本阶段渲染改动只有 `room.ts` 的房间尺寸一处。
8. **不引入图像库 / canvas / DOM 像素读取**（jsdom 下 `getContext('2d')` 为 null）。
   描墙画布用 SVG。
9. **不碰 `vite.config.ts` 的 `maxForks=4`**（WSL 内存保护）。
10. 中文注释沿用既有风格：关键决策必须写「为什么」，
    尤其是自行取值的常量（`GRID_SNAP_M`、`ORTHO_ANGLE_DEG`、模板面积等）。
11. 禁止在 SwiftShader 下验收画面（§7 禁令 1）。
12. 禁止默认俯视相机、禁止把开发调试控件留在主界面默认状态（§7 禁令 6/7）。

## 7. 提交

- 提交信息风格沿用既有：`P22: <一句话>`（参考 `80de790 P21: 导入建模地基…`）。
- 建议**一次提交**（模板 + store + 描墙 UI + 2D/3D 同步互相依赖，
  拆开会产生中间不可编译状态）。
- **不要 push**，Hermes 侧验收后再推。
- 完成后在 `docs/P8-plan.md` 的进度表追加一行 P22。
