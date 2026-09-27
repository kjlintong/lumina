/**
 * 导入建模的数据契约（执行规格 §6「第 2 周：导入建模闭环」范围 1/7/8）。
 *
 * 本文件是建模半块的**唯一权威**类型定义。与 `types.ts`（需求侧 zones +
 * 供给侧 fixtures）并列：`LuminaProject.model?` 挂一个可选 `ModelGeometry`。
 *
 * 三条铁律（违反即为实现错误）：
 *  1. **内部一律 SI 单位（米）**：几何体的坐标、尺寸、厚度均以米为权威单位。
 *     所有外部输入（图像像素、CAD mm、图纸英尺）必须先归一到米再入库
 *     （`scale.ts` 的标定系数是那个转换桥梁）。
 *  2. **每个几何体带 `confidence` 与 `provenance`**：§6 范围 7 要求「按来源
 *     （图元 / 模型推断 / 用户编辑）与规则通过率给 0–1 分值」，这是分档 SLA
 *     在数据层的落地。
 *  3. **未标定的几何不得参与面积/误差判定**：`calibration: null` 时
 *     `topology.ts` 必须判违规（§4 红线 5）。
 *
 * 坐标系约定（与 `render/planLayout.ts` 一致）：
 *  - 世界 x：东西向，右为正
 *  - 世界 z：南北向，**负为北**
 *  - y 轴不在此契约使用（本文件全是平面几何；高度用 `WallSegment.height` 表达）
 *
 * 本文件不含任何 Three.js / DOM / canvas 依赖 —— 纯 TypeScript 类型 + 常量。
 */

import type { ScaleCalibration } from './scale.js';

/**
 * schema 命名空间。
 *
 * 用字符串命名空间而非数字版本号，避免与 `LuminaProject.schemaVersion: 1`
 * 混淆 —— 两条独立演进轴：
 *   - `schemaVersion`：整个 `LuminaProject` 的 schema（改动需 migration）
 *   - `schemaId`：建模半块的 wire 契约标识符（`lumina.model/1`）
 *
 * 之所以不 bump `schemaVersion`：给 `LuminaProject` 加一个可选字段不影响
 * 既有 `serialize.ts` 的 round-trip 测试；反过来，为加可选字段去 bump
 * 全局版本号会牵连既有断言（详见 `p21-spec.md` §2）。
 */
export const MODEL_SCHEMA_ID = 'lumina.model/1';
/** 字面量类型（不用 `typeof`，避免 `as const` 多余的 lint 报错） */
export type ModelSchemaId = 'lumina.model/1';

/** 世界坐标平面点：`[x, z]`，米。 */
export type PlanePoint = readonly [x: number, z: number];

/**
 * 几何体来源：决定 `confidence` 的语义与能否被自动逻辑覆盖。
 *
 * 分档 SLA（§6 范围 7）—— UI 据此判断该元素是否可以被自动优化、
 * 是否应该显示「只修这一项」入口、以及「只修这一项」入口的提示语。
 */
export type Provenance =
  | {
      /** 图像分割出的图元（视觉分割结果）。`elementId` 是分割器输出的图元 id */
      kind: 'image_element';
      elementId?: string;
    }
  | {
      /** 模型推断（规则推导结果，如「此墙端点对齐另一段墙的中点，推断为连通」） */
      kind: 'model_inferred';
      /** 推断规则名，便于追责与审计 */
      rule: string;
    }
  | {
      /** 用户编辑（`confidence.ts` 的 `applyUserEdit` 强制重置为此） */
      kind: 'user_edit';
    };

/** 0..1。低置信度区域在 UI 上高亮（§6 范围 7） */
export type Confidence = number;

/**
 * 墙体段：世界坐标，顶点顺序即墙的延伸方向。
 *
 * `a → b` 定义方向；`thickness` 沿该方向的**左侧**（从用户视角看墙时
 * 在内侧）。这是为了与 `render/room.ts` 的墙体构建方向约定一致。
 */
export interface WallSegment {
  id: string;
  a: PlanePoint;
  b: PlanePoint;
  /**
   * 墙体厚度（米）。默认取 `DEFAULT_WALL_THICKNESS`，
   * 出处是 `src/render/room.ts:93` 的 `WALL_THICKNESS = 0.15` ——
   * 渲染层已用 0.15，契约必须与渲染对齐，否则两套数字打架。
   */
  thickness: number;
  /** 墙高（米），可小于 `slab.ceilingH`（半高墙 / 隔断） */
  height: number;
  confidence: Confidence;
  provenance: Provenance;
}

/** 默认墙厚（米）。与 `src/render/room.ts:93` 的 `WALL_THICKNESS` 对齐。 */
export const DEFAULT_WALL_THICKNESS = 0.15;

/**
 * 开口：挂在某条墙段上，沿墙以米表示。
 *
 * 沿 `a → b` 方向的正方向：`offset` 从 `a` 端算起，`offset + width` 必须
 * ≤ 墙长（`topology.ts` 的 `opening_on_wall` 规则负责检查）。
 */
export interface Opening {
  id: string;
  wallId: string;
  kind: 'door' | 'window';
  /** 沿墙起点偏移（米，从 `a` 端算起） */
  offset: number;
  width: number;
  height: number;
  /** 台高（米，距地面）。门为 0；窗为窗台高 */
  sill: number;
  confidence: Confidence;
  provenance: Provenance;
}

/**
 * 房间：闭合多边形顶点（世界坐标，逆时针），面积由 `topology.ts` 用
 * shoelace 公式计算。
 *
 * `vertices` 首尾不需要在契约层面闭合 —— 契约不假定已闭合，闭合性由
 * `topology.ts` 的 `room_closed` 规则负责判定（§4 红线 2 要求违规必须
 * 定位到具体 id，所以闭合性不能靠契约强约束）。
 */
export interface RoomPolygon {
  id: string;
  name: string;
  /** 至少 3 个顶点；退化（三点共线）也算违规 */
  vertices: readonly PlanePoint[];
  /**
   * 图纸上标注的面积（米²，可选）。拓扑校验的 `area_matches_label` 规则
   * 用 shoelace 算出实际面积，与此值比较（容差 5%，§4 红线 2）。
   * 未提供时该规则跳过（不制造假违规）。
   */
  labeledArea?: number;
  confidence: Confidence;
  provenance: Provenance;
}

/** 楼板 / 天花（厚度参与 §6 校正器第 4 项「层高与楼板厚度」）。 */
export interface Slab {
  /** 0 表示地面层；本阶段只支持单层住宅（值恒为 0） */
  level: number;
  /** 楼板厚度（米） */
  thickness: number;
  /** 层高（米）。示例值 2.8 与 `projectStore.ts:189` 的 `ceilingH` 一致 */
  ceilingH: number;
}

/**
 * 分档 SLA（§6 结尾：「不要让扫描图路径背负 CAD 路径的精度承诺，也不要因为
 * 扫描图不准就放弃自动化。UI 上必须显式区分」）。
 *
 * UI 据此显示不同的精度承诺文案，并对扫描图路径显式显示置信度。
 */
export type ImportTrack =
  | {
      /** 扫描图路径：不承诺统一误差，必须显式显示置信度 */
      track: 'scan';
      guaranteesUniformError: false;
      /** 扫描图路径下置信度参考区间上限（可选；实际由元素 confidence 决定） */
      maxErrorCm?: number;
    }
  | {
      /** CAD 路径：承诺统一误差（§6 验收判据：墙位误差 < 5cm） */
      track: 'cad';
      guaranteesUniformError: true;
      maxErrorCm: number;
    }
  | {
      /** 户型库模板：承诺统一误差（模板本身是可信的） */
      track: 'template';
      guaranteesUniformError: true;
      maxErrorCm: number;
    };

/**
 * 导入建模的几何集合（`LuminaProject` 的建模半块）。
 *
 * 挂在 `LuminaProject.model?` 上；未设置时保持既有 `serialize.ts` 行为不变。
 */
export interface ModelGeometry {
  schemaId: ModelSchemaId;
  walls: readonly WallSegment[];
  openings: readonly Opening[];
  rooms: readonly RoomPolygon[];
  slab: Slab;
  /**
   * 标定完成前为 null —— 未标定的几何不得参与面积/误差判定
   * （`topology.ts` 的 `scale_self_consistent` 规则判违规）。
   */
  calibration: ScaleCalibration | null;
  track: ImportTrack;
}
