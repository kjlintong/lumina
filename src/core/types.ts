/**
 * Lumina 领域数据模型 —— 需求侧 / 供给侧分离（工程方案 §4.6，ADR-12）。
 *
 * 本文件是**唯一权威**的数据结构定义。字段名严格遵循任务书 §5，不得擅改。
 *
 * 三条铁律（违反即为实现错误）：
 *  1. ActivityZone 描述「人在这里要什么光」；Fixture 描述「这盏灯是什么、装在哪」。
 *     两者是**独立实体**，关系是**可选绑定**，不是派生（ADR-12）。
 *  2. Fixture.pos 是世界坐标，唯一权威数据源。绑定只提供更便利，绝不意味着活动区拥有灯具。
 *  3. user-locked 字段受保护：自动逻辑必须跳过 lockedFields 中的字段。
 *
 * 注意（工程口径）：lux/candela 均为相对估算量，**非实测照度、非验收依据**（§6.3、ADR-15）。
 */

// ---------------------------------------------------------------------------
// 需求侧：活动区
// ---------------------------------------------------------------------------

/** 活动区类型库 key（预设 10 类，可扩展 —— §4.6.3 / ADR-16） */
export const ACTIVITY_ZONE_TYPES = [
  'sleep', // 睡眠
  'work', // 工作
  'dining', // 用餐
  'lounge', // 休闲
  'kitchen', // 厨房操作
  'bathroom', // 卫浴
  'reading', // 阅读角
  'nursery', // 婴儿房
  'wardrobe', // 衣帽间
  'entry', // 玄关
] as const;

export type ActivityZoneType = (typeof ACTIVITY_ZONE_TYPES)[number] | (string & {});

/**
 * 建议灯型：只「建议」，不写入灯具（§4.6.2 权责表末行）。
 */
export interface SuggestedFixture {
  /** Fixture.type 枚举值 */
  type: FixtureType;
  count: number;
  reason: string;
}

/**
 * 可选绑定关系：定义在活动区的**局部坐标系**（ADR-13，最易写错处）。
 */
export interface FixtureBinding {
  fixtureId: string;
  /** 区局部坐标下的偏移，单位米。区旋转 90° 时这些偏移必须跟着转。 */
  offsets: readonly (readonly [dx: number, dy: number, dz: number])[];
  /** 用户可开关；关闭后拖动区不影响该灯 */
  enabled: boolean;
}

/**
 * 需求侧实体：只描述需求，**不持有灯具**（ADR-12）。
 *
 * 删除 ActivityZone 不会级联删除灯具 —— 绑定的灯具自动解绑但保留原位（§4.6.3）。
 */
export interface ActivityZone {
  key: string;
  /** 类型库 key，可增删改（ADR-16） */
  type: ActivityZoneType;
  name: string;
  /** 区中心（世界坐标，米）。x = 东西，z = 南北；y 不参与定位（由 planeH 表达工作面） */
  pos: readonly [x: number, z: number];
  /** 朝向角，弧度（绕 Y 轴） */
  rotY: number;
  /** 区范围 [宽, 深]，米，定义在局部坐标系 */
  size: readonly [w: number, d: number];
  /**
   * 工作面高度（米）：桌面 0.75 / 床头 0.60 / 餐桌面 0.78 / 沙发 0.45（§5 数据模型）。
   */
  planeH: number;
  /** 目标照度（相对估算，需求值，非承诺；单位 lx，仅用于相对比较 —— §6.3） */
  lux: number;
  /** 推荐色温，K */
  cct: number;
  /** 面向业主的需求说明 */
  need: string;
  /** 建议灯型与数量：只建议，不写入灯具 */
  suggestion: readonly SuggestedFixture[];
  /** 可选绑定关系（活动区侧的镜像记录，供遍历使用） */
  fixtures: readonly FixtureBinding[];
}

// ---------------------------------------------------------------------------
// 供给侧：灯具
// ---------------------------------------------------------------------------

/** 灯具类型 */
export type FixtureType =
  | 'downlight'
  | 'spot'
  | 'pendant'
  | 'linear'
  | 'cove'
  | 'sconce'
  | 'floor'
  | 'table';

/** 安装方式：决定可吸附的表面与姿态约束（§4.6.4） */
export type MountType =
  | 'ceiling'
  | 'recessed'
  | 'suspended'
  | 'track'
  | 'wall'
  | 'floor'
  | 'tabletop';

/** 灯体造型 */
export type ShadeForm = 'cone' | 'cylinder' | 'sphere' | 'disc' | 'line' | 'plane' | 'custom';

/** 灯罩材质：透光率 0..1 / 粗糙度 0..1 / 金属度 0..1 / 颜色（sRGB hex） */
export interface ShadeMaterial {
  transmission: number;
  roughness: number;
  metalness: number;
  color: string;
}

export interface FixtureShape {
  form: ShadeForm;
  /** 直径，米 */
  diameter: number;
  /** 高度，米 */
  height: number;
  /** 出光面尺寸，米 */
  aperture: number;
  shade: ShadeMaterial;
}

/**
 * 配光：二选一。
 * - `ies`：指向 IES(LM-63) 文件，真实配光（有 IES 时显式可用）。
 * - 参数化：光通量 / 光束角 / 配光类型 —— **此时必须标注为近似配光**（红线 5）。
 */
export type Photometric =
  | {
      readonly ies: string;
      readonly iesVerified?: boolean;
      readonly iesChecksum?: string;
    }
  | {
      readonly lumens: number;
      readonly beamAngle: number;
      readonly distribution: string;
      readonly ies: undefined;
      readonly iesVerified: false;
      readonly iesChecksum: undefined;
    };

/** 是否真实配光（决定 UI 是否标注「配光为近似值」） */
export function hasVerifiedIES(p: Photometric): boolean {
  return p.ies !== undefined && p.iesVerified !== false;
}

/** 色温：固定值，或可调区间 */
export type CCTValue = number | readonly [min: number, max: number];

export interface Electrical {
  cct: CCTValue;
  /** 显色指数 */
  cri: number;
  /** 功率，W */
  watt: number;
  /** 调光下限，0..1 */
  dimFloor: number;
}

export interface Control {
  group: string;
  circuit: string;
  /** 场景 -> 亮度表（0..1）。场景只写此表，不动位置与形状（§6 P5） */
  sceneLevels: Record<string, number>;
}

/**
 * 灯具侧的绑定记录（与 ActivityZone.fixtures 互为镜像）。
 * 这是 Fixture 上的**唯一**绑定真相：enabled=false 即解绑。
 */
export interface FixtureSideBinding {
  zoneKey: string;
  offsets: readonly (readonly number[])[];
  enabled: boolean;
}

/**
 * 供给侧实体：灯具是**完全独立的实体**，用户全权控制（ADR-12）。
 * pos 是世界坐标，唯一权威数据源。
 */
export interface Fixture {
  id: string;
  type: FixtureType;
  mount: MountType;
  shape: FixtureShape;
  /** 世界坐标（米）—— 唯一权威数据源（§2.2） */
  pos: readonly [x: number, y: number, z: number];
  /** 姿态：pitch 俯仰 / yaw 方位，弧度 */
  rot: { pitch: number; yaw: number };
  photometric: Photometric;
  electrical: Electrical;
  control: Control;
  /** 可选绑定；null = 完全独立 */
  binding: FixtureSideBinding | null;
  /** user-locked 字段路径集合：自动逻辑必须跳过（ADR-17 / §2.3） */
  lockedFields: ReadonlySet<string>;
  /** sku = 可进采购清单；custom = 仅方案推敲（ADR-18 双轨） */
  source: 'sku' | 'custom';
}

// ---------------------------------------------------------------------------
// 场景 / 项目根
// ---------------------------------------------------------------------------

/** 单位制：数据模型而非显示格式化（ADR-08） */
export type UnitSystem = 'metric' | 'imperial';

/**
 * 完整设计方案（可序列化根）。round-trip 测试的目标对象（任务书 §7）。
 */
export interface LuminaProject {
  /** schema 版本，用于迁移 */
  schemaVersion: 1;
  name: string;
  unitSystem: UnitSystem;
  /** 层高，米 */
  ceilingH: number;
  zones: Record<string, ActivityZone>;
  fixtures: Record<string, Fixture>;
  /** M3 场景预设（本阶段仅保留抽象，见 src/scene） */
  scenes?: Record<string, SceneDefinition>;
}

/**
 * 场景定义：只持有亮度与色温表，**不动位置与形状**（§6 P5）。
 * 保留抽象以满足 M3，但 M3 不在本轮范围。
 */
export interface SceneDefinition {
  key: string;
  name: string;
  transitionMs: number;
  /** fixtureId -> 目标亮度 0..1 */
  levels: Record<string, number>;
  /** fixtureId -> 目标色温 K */
  cct: Record<string, number>;
}
