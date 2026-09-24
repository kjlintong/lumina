/**
 * 太阳位置计算（P1 — 日落时间系统）
 *
 * 根据一天中的时间计算太阳高度角和方位角。
 * 使用简化的天文学公式，精度足够室内设计用途。
 *
 * 参考：NOAA Solar Calculator 简化版
 * 注意：此模块只负责太阳几何位置，光照强度和颜色由 sceneEngine 处理。
 */

export interface SolarPosition {
  /** 太阳高度角（弧度），0 = 地平线，π/2 = 天顶 */
  elevation: number;
  /** 太阳方位角（弧度），0 = 正北，π/2 = 正东，π = 正南，3π/2 = 正西 */
  azimuth: number;
  /** 太阳是否在地下 */
  belowHorizon: boolean;
}

/**
 * 计算太阳位置。
 *
 * @param hour 小时（0-24，小数表示分钟）
 * @param latitude 纬度（弧度，正北）
 * @param declination 太阳赤纬（弧度），可从日期计算
 * @returns 太阳位置
 */
export function solarPosition(
  hour: number,
  latitude: number,
  declination: number,
): SolarPosition {
  // 时角（弧度）：12:00 = 正午 = 0
  const hourAngle = ((hour - 12) * Math.PI) / 12;

  // 太阳高度角
  const sinElev =
    Math.sin(latitude) * Math.sin(declination) +
    Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle);
  const elevation = Math.asin(Math.min(1, Math.max(-1, sinElev)));

  // 太阳方位角
  const cosAz =
    (Math.sin(declination) - Math.sin(elevation) * Math.sin(latitude)) /
    (Math.cos(elevation) * Math.cos(latitude) || 1e-10);
  let azimuth = Math.acos(Math.min(1, Math.max(-1, cosAz)));
  if (hour > 12) {
    azimuth = 2 * Math.PI - azimuth;
  }

  return {
    elevation,
    azimuth,
    belowHorizon: elevation < 0,
  };
}

/**
 * 从日期计算太阳赤纬（弧度）。
 *
 * @param dayOfYear 一年中的第几天（1-365）
 */
export function solarDeclination(dayOfYear: number): number {
  return 23.45 * (Math.PI / 180) * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81));
}

/**
 * 计算日出日落时间（小时）。
 *
 * @param latitude 纬度（弧度）
 * @param declination 太阳赤纬（弧度）
 * @returns { sunrise, sunset } 小时
 */
export function sunriseSunset(
  latitude: number,
  declination: number,
): { sunrise: number; sunset: number } {
  const cosHourAngle =
    -Math.tan(latitude) * Math.tan(declination);
  if (cosHourAngle < -1) {
    // 极昼
    return { sunrise: 0, sunset: 24 };
  }
  if (cosHourAngle > 1) {
    // 极夜
    return { sunrise: 12, sunset: 12 };
  }
  const hourAngle = Math.acos(cosHourAngle);
  return {
    sunrise: 12 - (hourAngle * 12) / Math.PI,
    sunset: 12 + (hourAngle * 12) / Math.PI,
  };
}

/**
 * 根据太阳高度角计算太阳光色温（近似）。
 * 日出日落时 ~2000K，正午时 ~5500K。
 *
 * @param elevation 太阳高度角（弧度）
 * @returns 色温（K）
 */
export function solarCct(elevation: number): number {
  if (elevation <= 0) return 2000;
  if (elevation >= Math.PI / 4) return 5500;
  // 线性插值
  const t = elevation / (Math.PI / 4);
  return 2000 + t * 3500;
}

/**
 * 根据太阳高度角计算太阳光颜色（RGB）。
 *
 * @param elevation 太阳高度角（弧度）
 * @returns { r, g, b } 0-1
 */
export function solarColor(elevation: number): { r: number; g: number; b: number } {
  if (elevation <= 0) return { r: 0, g: 0, b: 0 };
  if (elevation <= Math.PI / 12) {
    // 地平线附近：橙红色
    const t = elevation / (Math.PI / 12);
    return { r: 1.0, g: 0.5 + 0.3 * t, b: 0.2 + 0.3 * t };
  }
  if (elevation <= Math.PI / 4) {
    // 上升期：橙→黄
    const t = (elevation - Math.PI / 12) / (Math.PI / 12);
    return { r: 1.0, g: 0.8 + 0.2 * t, b: 0.5 + 0.5 * t };
  }
  // 高角度：暖白
  const t = Math.min(1, (elevation - Math.PI / 4) / (Math.PI / 4));
  return { r: 1.0, g: 1.0, b: 0.8 + 0.2 * t };
}
