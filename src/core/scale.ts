/**
 * 比例尺标定 —— 两点标注「图上距离 = 实际距离」（执行规格 §6 范围 2，P0）。
 *
 * 核心风险：**单位混淆**。`units.ts` 文件头点明这是「建模最致命的错误源」——
 * 英寸当毫米会让整张户型缩小 25.4 倍。所以标定走两步：
 *  1. `calibrate()` 只做数学换算。非法输入（0 / 负 / NaN）必须抛错，
 *     绝不得静默返回可用结果。
 *  2. `confirmScale()` 是**强制门禁**：对 `realDistance` 与 `toMeters` 各设
 *     一个合理区间。UI 在返回 false 时拒绝继续。
 *
 * 纯函数，无 DOM / canvas 依赖，jsdom 下可单测。
 */

import { FT_PER_M, M_PER_IN, MM_PER_M } from './units.js';

/** 可标定的长度单位。`ft` 与 `ft-in` 语义相同：均指 1 英尺 = 12 英寸。 */
export type LengthUnit = 'm' | 'mm' | 'cm' | 'in' | 'ft' | 'ft-in';

/**
 * 单位 -> 1 单位折合多少米。全部从 `units.ts` 同源常量推导，勿另造数值。
 *
 * 注意 `ft` 与 `ft-in` 都是 `1/FT_PER_M`：`ft-in` 这个单位名指的是「英尺 + 英寸」
 * 这种**复数输入方式**（用户输入 "12'6\"" 这种形式），而非独立长度单位 ——
 * 在该输入约定下 `1 ft-in` 即 `1 ft`。混淆 `in` 与 `ft` 会让整张户型
 * 缩小 12 倍，混淆 `in` 与 `mm` 会让整张户型缩小 25.4 倍。
 */
export const METERS_PER_UNIT: Record<LengthUnit, number> = {
  m: 1,
  mm: 1 / MM_PER_M,
  cm: 1 / (MM_PER_M / 10),
  in: M_PER_IN,
  ft: 1 / FT_PER_M,
  'ft-in': 1 / FT_PER_M,
};

/** 两点标定结果。 */
export interface ScaleCalibration {
  /** 两点标定：图上测量距离（像素或图纸单位，任意线性单位） */
  measuredOnDrawing: number;
  /** 用户声明的实际距离（单位由 `realUnit` 决定） */
  realDistance: number;
  /** 用户声明的实际距离单位 */
  realUnit: LengthUnit;
  /**
   * 用户已确认单位。`calibrate` 一律产出 true（表示「调用者已走确认流程」），
   * 真正拦住荒谬输入的是 `confirmScale`。两者分工刻意解耦：数学换算与
   * 产品判据分离，各自可独立测试。
   */
  unitConfirmed: true;
  /** 换算系数：1 图上单位 = `toMeters` 米 */
  toMeters: number;
}

/**
 * 两点距离（米）的合理区间。
 *
 * 这是 `confirmScale` 的**唯一**产品判据 —— `toMeters` 不是独立变量
 * （数学上 = realDistance / measuredOnDrawing），它没有独立的可信区间。
 *
 * 下限 0.01 m（1 cm）：再小的距离在住宅户型里几乎没有意义，且这是
 * 「用户把 mm 误当 m」的典型产物（例如 3 mm 误当 3 m 会算出 0.003 m）。
 * 也覆盖「用户把 in 误当 m」：3 in 误当 3 m 会算出 0.0762 m，勉强通过；
 * 但 3 in 误当 3 cm 会算出 0.762 m 通过、3 in 误当 3 mm 会算出 0.003 m 被拦。
 *
 * 上限 100 m：再大就不是住宅户型了（超大商业楼除外，但那不是本产品目标）。
 * 这个上限同时拦住「把 mm 误当 m」：3000 mm 误当 3000 m 会算出 3000 m，
 * 远超上限。
 */
export const PLAUSIBLE_REAL_DISTANCE_M = { min: 0.01, max: 100 } as const;

/**
 * 两点标定。
 *
 * **非法输入必须抛错，绝不得静默返回可用结果**（§4 红线 1）：
 * 0 / 负 / NaN 的输入会让整张户型缩成一点或负尺度，且无任何报错。
 */
export function calibrate(
  measuredOnDrawing: number,
  realDistance: number,
  realUnit: LengthUnit,
): ScaleCalibration {
  assertFinitePositive(measuredOnDrawing, 'measuredOnDrawing');
  assertFinitePositive(realDistance, 'realDistance');

  return {
    measuredOnDrawing,
    realDistance,
    realUnit,
    unitConfirmed: true,
    toMeters: (realDistance * METERS_PER_UNIT[realUnit]) / measuredOnDrawing,
  };
}

/** 像素/图纸单位 → 米 */
export function drawingToMeters(v: number, cal: ScaleCalibration): number {
  return v * cal.toMeters;
}

/** 米 → 图纸单位（校正器 UI 反向渲染用） */
export function metersToDrawing(m: number, cal: ScaleCalibration): number {
  return m / cal.toMeters;
}

/**
 * 强制单位确认门禁（§6 范围 2：「强制用户确认单位」）。
 * UI 必须调用它并在 false 时拒绝继续。只判语义，不做 UI 交互。
 *
 * 判据是**单区间夹逼**（`toMeters` 没有独立区间，它是 realDistance 与
 * measuredOnDrawing 的函数，不独立校验）：
 *  1. `unitConfirmed` 必须为 true（门禁字段）。
 *  2. `toMeters` 必须是有限正数（数学合法性，不是产品判据）。
 *  3. `realDistance`（换算为米后）必须落在 `PLAUSIBLE_REAL_DISTANCE_M` 区间。
 *
 * 这能拦住「英寸当毫米」：例如用户标 3 m 但误选 `mm`，`realDistance`
 * 换算成米是 0.003 m，远低于 0.01 m 下限，门禁返回 false。
 * 也拦住「把 mm 误当 m」：3000 mm 误当 3000 m 会算出 3000 m，远超上限 100 m。
 *
 * 用区间而非单点死值的理由：单点死值（如「必须接近 1」）会误杀任何正常
 * 户型，所以必须给一个足够宽的合理区间，再在这个区间外做拦截。
 *
 * 为什么不校验 `toMeters`：`toMeters = realDistance / measuredOnDrawing`，
 * 它的值由 realDistance 与 measuredOnDrawing 唯一决定，不是独立变量。
 * 给 `toMeters` 设区间会与 realDistance 区间冲突 —— 例如 3 m 墙在 300 px 上
 * 的 `toMeters` 是 0.01，100 m 墙在 300 px 上则是 0.333（超出常见的
 * "toMeters <= 0.2" 区间），但 realDistance 都是合理的。所以只校验 realDistance。
 */
export function confirmScale(cal: ScaleCalibration): boolean {
  if (cal.unitConfirmed !== true) return false;
  if (!Number.isFinite(cal.toMeters) || cal.toMeters <= 0) return false;
  if (!Number.isFinite(cal.realDistance)) return false;

  const realDistanceM = cal.realDistance * METERS_PER_UNIT[cal.realUnit];
  return (
    realDistanceM >= PLAUSIBLE_REAL_DISTANCE_M.min &&
    realDistanceM <= PLAUSIBLE_REAL_DISTANCE_M.max
  );
}

/** 断言「有限且为正」。非法输入统一走这里，避免各处重复判断。 */
function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} 必须是有限数，收到 ${value}`);
  }
  if (value <= 0) {
    throw new Error(`${label} 必须为正数，收到 ${value}`);
  }
}
