/**
 * 单位换算 —— 单位制是**数据模型**而非显示格式化（ADR-08）。
 *
 * 内部一律以**米（m）/ 千焦耳等 SI 量**存储几何。所有输入（CAD/DXF 的 mm、
 * 图像的像素）必须先归一到米再入库；显示层再按 unitSystem 反向格式化。
 *
 * 这是建模最致命的错误源：英寸/毫米混淆会让整张户型缩小或放大 25.4 倍。
 */

import type { UnitSystem } from './types.js';

export const MM_PER_M = 1000;
export const IN_PER_M = 39.37007874015748;
export const FT_PER_M = 3.280839895013123;
export const M_PER_IN = 1 / IN_PER_M;

export interface UnitConverter {
  /** 内部 SI（米）-> 目标单位 */
  fromMeters(m: number): number;
  /** 目标单位 -> 内部 SI（米） */
  toMeters(v: number): number;
  /** 单位显示标签 */
  readonly label: string;
}

/** 公制：内部即米，1:1 */
export const METRIC: UnitConverter = {
  fromMeters: (m) => m,
  toMeters: (v) => v,
  label: 'm',
};

/** 英制：以英尺为显示主单位（几何仍存米） */
export const IMPERIAL: UnitConverter = {
  fromMeters: (m) => m * FT_PER_M,
  toMeters: (v) => v / FT_PER_M,
  label: 'ft',
};

/** 毫米（CAD/DXF 原生单位，建模输入归一用） */
export const MILLIMETERS: UnitConverter = {
  fromMeters: (m) => m * MM_PER_M,
  toMeters: (v) => v / MM_PER_M,
  label: 'mm',
};

export function getUnit(system: UnitSystem): UnitConverter {
  return system === 'imperial' ? IMPERIAL : METRIC;
}

/**
 * 带容差的数值相等判定。
 * 浮点比较（坐标、旋转角）必须走这个，不得用 === 或 toFixed。
 */
export function close(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}
