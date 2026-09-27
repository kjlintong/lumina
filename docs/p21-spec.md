# P21 规格：导入建模闭环的地基 —— 数据契约 + 比例尺标定 + 拓扑校验

> 依据 `../../LUMINA_两周执行规格_hermes.md` §6「第 2 周：导入建模闭环（最小版，不做 DWG/IFC）」
> 的 §6 范围 1/2/7/8 与「数据契约」验收判据。
>
> **本规格只交第 2 周的地基层**：类型契约、标定数学、置信度模型、拓扑规则校验。
> 全部是纯 TypeScript 逻辑，**不引入 Three.js / DOM / 图像库**，jsdom 下可直接单测。
> 上传入口、墙体视觉分割、3D 挤出、校正器 UI、户型库模板属于后续阶段（P22–P24），
> 但必须建在本规格定义的契约之上。

## 0. 阶段定位与不做什么

| 本阶段做 | 本阶段**不**做（后续阶段） |
|---|---|
| `ModelGeometry` 数据契约（墙体/房间/开口/楼板/天花） | 图像预处理、墙体自动分割（P23） |
| 两点标定（图上距离 → 实际距离）+ 单位强制确认 | PDF/图像上传入口与文件解析（P23） |
| `confidence` / `provenance` 模型 | 3D 挤出渲染、材质分配（P24） |
| 拓扑校验规则引擎（§6 范围 8 的 5 条） | 校正器 UI、描墙兜底路径、户型库模板（P23/P24） |
| undo 栈的数据结构契约（不实现 UI 接线） | 渲染验收截图（本阶段无渲染，红线 2 不适用） |
| parser 接口预留 + 分档 SLA 字段（§6 范围 1） | DWG/DXF/IFC 解析（明确不做） |

§6「明确不做」四条全部继承：不做 DWG/DXF/IFC、不做水电/合规、不做照度报告、
不做反射率自动识别。

## 1. 目标（验收判据，不是步骤）

1. 存在一个可序列化的 `ModelGeometry` 结构，内部**一律 SI 单位（米）**，
   每个几何体带 `confidence` 与 `provenance`，符合 §6 数据契约判据。
2. 比例尺标定是**强制确认**流程：英寸/毫米混淆必须能被拦住（这是 `units.ts`
   文件头点名的「建模最致命的错误源，25.4 倍」）。
3. 拓扑校验 5 条规则各自独立可测，能给出**定位到具体元素 id** 的违规报告，
   而不是一个笼统的布尔值。
4. 分档 SLA 显式建模：扫描图路径**不承诺** CAD 路径的精度，UI 据此区分。

## 2. 关键现状缺口（已 grep 确认，不要重复造）

- **`src/core/types.ts` 完全没有墙/房间/楼板/开口概念** —— 只有需求侧
  `ActivityZone` 与供给侧 `Fixture`。`LuminaProject` 是 `schemaVersion: 1`，
  含 `ceilingH: 2.8`（米，见 `projectStore.ts:189`）。
- **墙体厚度**：`src/render/room.ts:93` 已有 `const WALL_THICKNESS = 0.15;`
  （渲染层硬编码，房间墙体 `BoxGeometry` 全部用它）。**新契约的默认墙厚必须取
  `0.15` 并与该常量对齐**，不得另立 0.24 之类的值 —— 否则领域契约说墙厚 0.24、
  渲染出来是 0.15，两套数字打架。本阶段不改渲染层（禁令 6），但契约默认值
  必须与 `room.ts` 的现状一致，并在 `src/core/modeling.ts` 里写常量
  `DEFAULT_WALL_THICKNESS = 0.15`，注释指向 `room.ts:93` 作为出处。
- **`LuminaProject.schemaVersion: 1`** 出现在 `types.ts:226`、`serialize.ts:13/30/48`
  共 4 处，且 `serialize.ts` 有 round-trip 深度相等测试 —— 所以**不能** bump 它，
  只能给 `LuminaProject` 加可选字段。
- **`ceilingH: 2.8`**（`projectStore.ts:189`）是既有层高事实值，`Slab.ceilingH`
  的示例/默认值应与之一致。
- **`src/core/units.ts` 已有** `UnitConverter`（`METRIC` / `IMPERIAL` / `MILLIMETERS`）、
  `close(a, b, eps = 1e-6)` 容差判定、`FT_PER_M = 3.280839895013123`、
  `MM_PER_M = 1000`、`IN_PER_M = 39.37007874015748`（高精度值，勿截断）、
  `M_PER_IN = 1 / IN_PER_M`。**没有** `FT_IN_PER_M` —— 需新增，
  且必须由 `IN_PER_M * 12` 推导而非硬编码 36.0 截断值。
  `IN_PER_M` 是英寸不是英尺-英寸，英尺-英寸必须显式区分（这正是 §6 范围 2
  要拦的混淆）。
- **`src/core/serialize.ts` 的 Set↔数组对称处理**是既有范式（`lockedFields`）。
  本阶段若契约里出现 Set，必须同样对称，否则 round-trip 深度相等会失败。
- **`src/render/planLayout.ts` 的坐标系约定必须继承**：世界 x = 东西、
  世界 z = 南北且**负为北**、SVG y 向下。新建的 `RoomPolygon` / `WallSegment`
  顶点坐标在同一坐标系，不得翻转 z 轴（这是 `planLayout.ts` 注释里
  `SVG_y = originY + z * scale` 成立的前提）。
- **jsdom 下 `canvas.getContext('2d')` 返回 null**（现有测试栈的已知限制）。
  本阶段刻意不碰 canvas，全部纯数学，因此**没有**该限制；
  若实现时发现某需求必须读像素，**停下来说明**，不要自己降级成 mock 断言。

## 3. 交付物

### 3.1 `src/core/modeling.ts` —— 数据契约（新文件）

```ts
/** schema 命名空间；wire 契约标识符，非数字版本号 */
export const MODEL_SCHEMA_ID = 'lumina.model/1' as const;
export type ModelSchemaId = typeof MODEL_SCHEMA_ID;

/** 几何体来源：决定 confidence 的语义与能否被自动逻辑覆盖 */
export type Provenance =
  | { kind: 'image_element'; /** 分割出的图元 id，可选 */ elementId?: string }
  | { kind: 'model_inferred'; /** 推断规则名，便于追责 */ rule: string }
  | { kind: 'user_edit' };

/** 0..1。低置信度区域在 UI 上高亮（§6 范围 7） */
export type Confidence = number;

/**
 * 墙体段：世界坐标，顶点顺序即墙的延伸方向。
 * a → b 定义方向；thickness 沿该方向的**左侧**（用户视角看墙时在内侧）。
 */
export interface WallSegment {
  id: string;
  a: readonly [x: number, z: number];
  b: readonly [x: number, z: number];
  /**
   * 墙体厚度（米）。默认取 `DEFAULT_WALL_THICKNESS = 0.15`，
   * 出处是 `src/render/room.ts:93` 的 `WALL_THICKNESS`（渲染层已用 0.15，
   * 契约必须与渲染对齐，否则两套数字打架）。
   */
  thickness: number;
  /** 墙高（米），可小于 ceilingH（半高墙 / 隔断） */
  height: number;
  confidence: Confidence;
  provenance: Provenance;
}

/** 开口：挂在某条墙段上，沿墙以米表示（沿 a→b 方向的正方向） */
export interface Opening {
  id: string;
  wallId: string;
  /** 门 / 窗 */
  kind: 'door' | 'window';
  /** 沿墙起点偏移（米，从 a 端算起） */
  offset: number;
  width: number;
  height: number;
  /** 台高（米，距地面）。门为 0；窗为窗台高 */
  sill: number;
  confidence: Confidence;
  provenance: Provenance;
}

/** 房间：闭合多边形顶点（世界坐标，逆时针），面积由 `roomArea` 计算 */
export interface RoomPolygon {
  id: string;
  name: string;
  /** 至少 3 个顶点；闭合性由拓扑校验负责，契约不假定已闭合 */
  vertices: readonly (readonly [x: number, z: number])[];
  confidence: Confidence;
  provenance: Provenance;
}

/** 楼板 / 天花（厚度参与 §6 校正器第 4 项「层高与楼板厚度」） */
export interface Slab {
  /** 0 表示地面层 */
  level: number;
  /** 楼板厚度（米） */
  thickness: number;
  ceilingH: number;
}

/**
 * 分档 SLA（§6 结尾：「不要让扫描图路径背负 CAD 路径的精度承诺」）。
 * UI 必须按此显式区分，不得让两条路径共用一个精度承诺。
 */
export type ImportTrack =
  | { track: 'scan'; /** 扫描图不承诺统一误差，必须显式显示置信度 */ guaranteesUniformError: false; maxErrorCm?: number }
  | { track: 'cad'; guaranteesUniformError: true; /** §6 验收：墙位误差 < 5cm */ maxErrorCm: number }
  | { track: 'template'; guaranteesUniformError: true; maxErrorCm: number };

/** 导入建模的几何集合（`LuminaProject` 的建模半块） */
export interface ModelGeometry {
  schemaId: ModelSchemaId;
  walls: readonly WallSegment[];
  openings: readonly Opening[];
  rooms: readonly RoomPolygon[];
  slab: Slab;
  /** 标定完成前为 null —— 未标定的几何不得参与面积/误差判定 */
  calibration: ScaleCalibration | null;
  track: ImportTrack;
}
```

**契约纪律**：
- 全 readonly，与既有 `ActivityZone` / `Fixture` 风格一致。
- `confidence` 类型别名而非裸 `number`，便于 UI 层按「低置信度高亮」统一处理。
- **不改** `LuminaProject.schemaVersion`（仍是 1）。`ModelGeometry.schemaId`
  用字符串命名空间 `lumina.model/1`，与 `schemaVersion: 1` 是两套独立演进轴 ——
  避免为加一个可选字段去 bump 全局版本号、牵连既有 `serialize.ts` 的 round-trip 测试。
  `LuminaProject` 增一个**可选** `model?: ModelGeometry` 字段即可，
  既有 `serializeProject` / `deserializeProject` 对未设置该字段保持现状。

### 3.2 `src/core/scale.ts` —— 比例尺标定（新文件）

§6 范围 2（P0）：「两点标注「图上距离 = 实际距离」，支持英尺-英寸 / 米切换，
**强制用户确认单位**（防英寸/毫米混淆）」。

```ts
export type LengthUnit = 'm' | 'mm' | 'cm' | 'in' | 'ft' | 'ft-in';

/** 1 个「ft-in」= 1 英尺（36 英寸）；ft-in 是「英尺+英寸」的复数输入单位 */
export interface ScaleCalibration {
  /** 两点标定：图上测量距离（任意像素/图纸单位） */
  measuredOnDrawing: number;
  /** 用户声明的实际距离 */
  realDistance: number;
  realUnit: LengthUnit;
  /** 用户已确认单位 —— 强制门禁字段，见 `confirmScale` */
  unitConfirmed: true;
  /** 换算系数：1 图上单位 = scale 米 */
  toMeters: number;
}

/** 像素/图纸单位 → 米 */
export function drawingToMeters(v: number, cal: ScaleCalibration): number;

/** 米 → 图纸单位（校正器 UI 反向渲染用） */
export function metersToDrawing(m: number, cal: ScaleCalibration): number;

/** 两点标定：返回含 toMeters 的标定结果 */
export function calibrate(measuredOnDrawing: number, realDistance: number, realUnit: LengthUnit): ScaleCalibration;

/**
 * 强制确认门禁（§6 范围 2 的「强制用户确认单位」）。
 * UI 必须调用它并在返回 false 时拒绝继续。
 * 只检查语义，不做 UI 交互。
 */
export function confirmScale(cal: ScaleCalibration): boolean;
```

**实现要点**：
- `realUnit` 的单位换算表用 `units.ts` 现有常量拼装，**新增** `FT_IN_PER_M = 36`
  或等价写法（`IN_PER_M * 12`），并引用 `IN_PER_M` 的源定义，不得硬编码 39.3701
  之类的截断值。
- `measuredOnDrawing` 或 `realDistance` 为 0 / 负 / NaN 时**必须抛错**，
  不得静默返回 `toMeters: 0` —— 那会让整张户型缩成一点却无任何报错。
- `confirmScale` 的判定必须能拦住「英寸当毫米」这种典型错：
  即结果米数明显荒谬时返回 false。荒谬阈值的判定用**双区间夹逼**，
  不要写单点死值（理由与阈值写入注释，可测试）。

### 3.3 `src/core/confidence.ts` —— 置信度与 provenance（新文件）

§6 范围 7：「按来源（图元 / 模型推断 / 用户编辑）与规则通过率给 0–1 分值；
低置信度区域高亮，提供『只修这一项』入口；**任何修改写 undo 栈并把
provenance 更新为 `user_edit`**」。

```ts
/** 低置信度阈值：低于此值 UI 高亮。默认 0.6，理由写注释 */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

export function isLowConfidence(c: Confidence): boolean;

/**
 * 用户编辑：任何手工修改必须重置 provenance 为 user_edit 并把置信度顶到 1。
 * 理由（写注释）：用户手工修过的地方，「模型认为它不准」的提示已经失效，
 * 继续高亮只会制造噪声；同时它成为新的可信锚点。
 * 纯函数：返回新对象，不改入参（与 store 的不可变风格一致）。
 */
export function applyUserEdit<T extends { confidence: Confidence; provenance: Provenance }>(el: T): T;

/**
 * Undo 栈条目。本阶段只定义结构 + 应用/回滚的纯函数，
 * 不接线 UI（接线属 P23 校正器）。
 */
export interface UndoEntry<T> {
  /** 被改元素 id（用于「只修这一项」入口定位） */
  elementId: string;
  label: string;
  before: T;
  after: T;
}

export interface UndoStack<T> { /* push / undo / redo / canUndo / canRedo / snapshot */ }
```

`UndoStack` 必须支持 **redo**（推 undo 后清空 redo 分支是既有约定），
并且 `push` 会丢弃 redo 分支 —— 这两条是必测项。

### 3.4 `src/core/topology.ts` —— 拓扑校验规则引擎（新文件）

§6 范围 8（「规则层，必过」）5 条规则。**每条规则独立导出，返回定位到
具体 id 的违规列表**，不得只返回 `boolean`：

```ts
export interface RuleViolation {
  /** 规则 id，稳定字符串，用于 UI 展示与「只修这一项」定位 */
  rule: TopologyRule;
  message: string;
  /** 相关元素 id；单条违规可涉多个元素 */
  elementIds: readonly string[];
  /** 可测的数值证据（例如实际面积 / 期望面积 / 连通缺口米数） */
  detail?: Record<string, number>;
}

export type TopologyRule =
  | 'room_closed'        // 房间多边形闭合
  | 'opening_on_wall'    // 门窗必须落在墙段内
  | 'wall_endpoints_connected' // 墙段端点连通
  | 'area_matches_label' // 面积与标注一致
  | 'scale_self_consistent';    // 比例尺与单位自洽

export interface TopologyReport {
  violations: readonly RuleViolation[];
  /** 必过规则全部通过（§6「规则层，必过」） */
  passed: boolean;
}

export function checkTopology(model: ModelGeometry): TopologyReport;
```

**每条规则的判据（务必按此实现，不要自己发挥）**：
- `room_closed`：首尾顶点 `close(a, b, 0.01)` 不成立 → 违规。
  容差 0.01 米（1cm）= 户型可接受的最小端点误差；
  `units.ts` 的 `close` 默认 eps 是 1e-6（1 微米），太严，**必须显式传 0.01**。
  顺带检查顶点数 ≥ 3 与退化（三点共线 → 违规）。
- `opening_on_wall`：`wallId` 必须存在（孤儿开口 → 违规）；
  且 `offset ≥ 0 && offset + width ≤ wallLength(wall) + 1e-6`。
  注意 `1e-6` 用 `close` 而非 `===`（`units.ts` 文件头明令不得用 `===`）。
- `wall_endpoints_connected`：对每对墙段，若某端点与另一墙段的端点
  `close(..., 0.01)` 则视为连通；统计孤立端点（不被任何 1cm 容差内端点匹配）。
  孤立端点数 > 0 → 违规，`elementIds` 列出孤立端点所属墙段。
- `area_matches_label`：用 shoelace 算 `RoomPolygon` 面积，与
  `RoomPolygon.labeledArea?`（米²，可选）比较；容差 **5%**（相对误差，
  与 §6「面积与标注一致」的经验判定一致，阈值写注释）。
  未提供 `labeledArea` 的房间跳过（不制造假违规）。
- `scale_self_consistent`：`calibration === null` → 违规（未标定不得入库使用）；
  否则校验 `calibration.unitConfirmed === true` 且 `toMeters` 落在合理量级区间。

**`RoomPolygon` 需要补一个可选 `labeledArea?: number` 字段**（米²），
否则第 4 条规则无法实现。加在 `modeling.ts` 的 `RoomPolygon` 里。

### 3.5 `src/core/importers.ts` —— parser 接口预留（新文件，§6 范围 1）

只做**接口与分档声明**，不实现任何真实解析：

```ts
/** 支持的导入源；DWG/DXF/IFC 明确不做，但类型上占位以保留扩展点 */
export type ImportSource =
  | { kind: 'image'; format: 'pdf' | 'jpg' | 'png' }
  | { kind: 'cad'; format: 'dwg' | 'dxf' }   // 本期不实现
  | { kind: 'ifc' }                           // 本期不实现
  | { kind: 'template'; templateId: string };

/** 分档 SLA 声明（与 `ImportTrack` 对齐，§6「分档承诺是产品可信度的关键」） */
export interface ImporterDescriptor {
  source: ImportSource;
  /** 本期能否真跑：cad/ifc 必须 false */
  available: boolean;
  track: ImportTrack;
  /** 不支持时给用户的可理解提示，不得是技术报错 */
  unavailableReason?: string;
}

/** 解析入口的契约形状；本期抛出 NotSupportedError，不做任何真实解析 */
export function describeImporter(source: ImportSource): ImporterDescriptor;
```

CAD/IFC 路径**必须** `available: false` 且带人话提示 —— 这是「分档 SLA」在
数据层的落地，UI 据此显式区分两条路径的承诺。

## 4. 测试要求（必测清单）

新文件放 `src/core/__tests__/`，命名 `*.test.ts`（与既有约定一致）。

| 文件 | 必测点 |
|---|---|
| `scale.test.ts` | 米/毫米/厘米/英寸/英尺-英寸 全部 5 个单位的往返；`calibrate` 在 0/负/NaN 时**抛错**；`confirmScale` 拦住英寸当毫米（25.4 倍场景）；`drawingToMeters` / `metersToDrawing` 互逆 |
| `topology.test.ts` | 5 条规则**各自**至少一个正例 + 一个反例；违规必须带正确 `elementIds`；`passed === violations.length === 0`；`labeledArea` 缺失时第 4 条不报假违规；容差边界（恰好 0.01 米应视为闭合） |
| `confidence.test.ts` | `applyUserEdit` 重置 provenance 且置信度 → 1，**且不改入参**（不可变）；`UndoStack` 的 push/undo/redo、push 清空 redo 分支、空栈 `canUndo === false` |
| `modeling.test.ts` | 契约对象可构造、可 `structuredClone`；`MODEL_SCHEMA_ID` 值稳定；`ImportTrack` 三档的 `guaranteesUniformError` 语义（scan=false，cad/template=true） |
| `importers.test.ts` | cad/ifc `available === false` 且有 `unavailableReason`；image/pdf/jpg/png `available === true`；`describeImporter` 对全部 5 种 source 返回合法 descriptor |
| `serialize.test.ts`（**既有文件，追加**） | `model` 字段可选：未设置时 round-trip 行为与现状**完全一致**（既有断言不得改动）；设置了 `model` 时 round-trip 深度相等 |

**红线（测试必须覆盖，违反即返工）**：
1. `calibrate` 绝不得在非法输入下静默返回可用结果。
2. 违规报告绝不得只返回 `boolean`，必须定位到 `elementIds`。
3. `applyUserEdit` 必须把 provenance 改成 `user_edit` —— 这是 §6 范围 7 的硬性要求。
4. 浮点比较一律走 `units.ts` 的 `close()`，**禁止** `===` / `toFixed`（`units.ts` 文件头明令）。
5. 未标定（`calibration: null`）的几何必须被判为违规，不得默默放行。

## 5. 验证

实现者必须跑完并把输出贴进汇报：

```bash
npm run typecheck   # tsc --noEmit -p tsconfig.json
npm run lint        # eslint .
npm test            # vitest run（vite.config.ts 已限并发 maxForks=4，勿改）
npm run verify      # 以上三项
```

**当前基线：37 个测试文件 / 514 个测试全部通过。** 实现后测试数应**多于** 514。
如果测试数没变或变少，说明测试没写进 `src/core/__tests__/` 或被 vitest 排除，
必须查清（`vitest run --reporter=verbose | grep -c "✓"` 或看 vitest 的 include 规则）。

`npm run build` 也应通过（tsc + vite build），确认没有产物层面的破坏。

## 6. 硬性禁令（继承 §7，违反即返工）

1. 本阶段**不写任何 Three.js / DOM / canvas 代码** —— 全部纯逻辑。
2. **禁止 `any`**（`tsconfig` strict + ESLint 强制）。禁止 `any` 类型逃逸。
3. 一律 ESM 导入，导出用 named export，不混 default export。
4. **不 bump `LuminaProject.schemaVersion`**，用 `ModelGeometry.schemaId` 独立演进。
5. 不动 `serialize.ts` 既有 round-trip 行为 —— 只能追加 `model` 字段的可选支持。
6. 不接线 UI，不改 store，不改 `projectStore.ts`（本阶段是纯契约层）。
7. 不删既有测试断言来「修绿」。
8. 中文注释沿用既有风格：关键决策必须写「为什么」，尤其是自行取值的常量。

## 7. 提交

- 提交信息风格沿用既有：`P21: <一句话>` （参考 `571f310 P20: 场景曝光矩阵…`）。
- 本阶段建议**一次提交**（契约 + 标定 + 置信度 + 拓扑 + parser 预留，它们互相依赖，
  拆开会产生中间不可编译状态）。
- **不要 push**，Hermes 侧验收后再推。
- 完成后在仓库 `docs/P8-plan.md` 的进度表追加一行 P21，并新建 `docs/p21-spec.md`
  为本文件的最终版（把本规格内容复制进去即可，Hermes 侧已放好草稿）。
