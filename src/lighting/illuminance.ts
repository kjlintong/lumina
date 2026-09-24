/**
 * 照度估算（工程方案 §6）—— 活动区工作面的**相对**照度。
 *
 * ── 工程红线（§6.3 / ADR-15）────────────────────────────────────────────
 * 本模块产出的 lx 是**相对估算值，不是实测照度**，不可作为验收依据。
 * UI 展示**必须**带「相对估算，非实测照度」标注：一律走 `formatIlluminance`
 * （它统一追加标注），不要在别处手写裸的 lx 字符串。
 *
 * ── 算法（点光源近似，§6）───────────────────────────────────────────────
 *   E = I / d²
 *     I  坎德拉（cd）：均匀球面发射时 I = Φ / 4π（Φ = 光通量 lm）
 *     d  灯具世界坐标 → 活动区工作面中心点的欧氏距离
 *        d² = dx² + dy² + dz²，其中 dy = fixture.y - zone.planeH
 *
 *   定向灯（spot / downlight / linear / cove / sconce）额外乘方向因子：
 *     factor = cosθ · beamFactor
 *     beamFactor = (θ ≤ beamAngle/2) ? 1 : 0
 *     θ = 灯具瞄准方向 与 「灯具→工作面点」向量 的夹角
 *   实现取「硬边界」读法：θ 在光束内 factor = 1，出界即 0。这样才与下面的
 *   点光源型一致 —— 否则正对直照的聚光灯（cosθ = 1）与吊灯（factor = 1）
 *   会算出同样低一半的照度，违背「吊灯各向同性、无方向衰减」。
 *   代价：光束边缘无余弦柔和过渡（已知近似）。
 *   点光源型（pendant / floor / table）各向同性，factor = 1（忽略 rot）。
 *
 * ── 姿态约定 ────────────────────────────────────────────────────────────
 * pitch 是瞄准方向与「正下方（-Y）」的夹角（0 = 垂直向下，π/2 = 水平），
 * yaw 是水平方位角（0 = -Z，π/2 = +X）。因此瞄准俯角为
 * atan2(水平距离, 垂直距离)、yaw = 0 时正好投向 -Z。
 *
 * ── 已知且可接受的近似 ──────────────────────────────────────────────────
 * 未计入墙面/桌面反射、多次漫反射、真实配光曲线与灯具外壳遮挡；无 IES
 * 解析器时 IES 灯具按「无可参数化光强」处理，贡献记 0。结果只用于方案
 * 阶段的相对比较（够不够亮），不用于照度验收。
 */

import type { ActivityZone, Fixture, Photometric } from '../core/types.js';

/** 结果里附带的红线标注（§6.3）。任何展示层都必须能检索到这句话。 */
export const DISCLAIMER = '相对估算，非实测照度';

/** 灯具与工作面点的最小距离（米）：避免 d→0 时 E 爆炸。 */
export const MIN_DISTANCE = 0.1;

/** 参与计算的灯具范围：区中心平面距离 ≤ 3 × 区最大边长。 */
export const RANGE_FACTOR = 3;

/** 结果（所有 lux 均为相对估算，见文件头红线）。 */
export interface IlluminanceResult {
  /** 所有参与灯具贡献之和（lx，相对估算） */
  readonly total: number;
  /**
   * fixtureId -> 该灯具的独立贡献（lx）。
   * 只含范围内的灯具；在范围内但落在光束外的灯具记为 0。
   */
  readonly perFixture: Map<string, number>;
  /** 目标照度（lx，来自 zone.lux，需求值） */
  readonly target: number;
  /** total / target（0.8 = 达到目标的 80%）；target 为 0 时为 Infinity */
  readonly ratio: number;
}

/** 各向同性的点光源型灯具：忽略 rot，不做方向衰减。 */
const ISOTROPIC_TYPES: ReadonlySet<string> = new Set(['pendant', 'floor', 'table']);

const FOUR_PI = 4 * Math.PI;

interface Parametric {
  readonly lumens: number;
  readonly beamAngle: number;
}

/** 取参数化配光数据；IES 配光无解析器，返回 undefined（贡献 0）。 */
function parametric(p: Photometric): Parametric | undefined {
  return 'lumens' in p ? { lumens: p.lumens, beamAngle: p.beamAngle } : undefined;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 瞄准方向单位向量。约定：pitch = 与正下方（-Y）的夹角（0 = 垂直向下，
 * π/2 = 水平），yaw 是水平方位角（0 = -Z，π/2 = +X）。
 * pitch = atan2(水平距离, 垂直距离)、yaw = 0 时正好指向 -Z，
 * 与「灯具在正上方偏 +Z、俯角对正下方目标」的直观摆法一致。
 */
function aimDirection(rot: { pitch: number; yaw: number }): readonly [number, number, number] {
  const sp = Math.sin(rot.pitch);
  return [sp * Math.sin(rot.yaw), -Math.cos(rot.pitch), -sp * Math.cos(rot.yaw)];
}

/**
 * 方向因子：θ 在光束内 = 1，出界 = 0（各向同性灯具恒为 1）。
 *
 * `toZone` 是 **fixture → zone** 的向量（与 aimDirection 同朝向），直接点乘即可，
 * 不要取反：aimDirection 本身已按「指向目标」定义（见其注释里的约定说明）。
 *
 * beamAngle = 0 表示「未定向/各向同性」（与 0° 硬边界把一切都挡掉区分开），
 * 此时不做方向衰减。落在光束外就是 0，不出现负贡献。
 */
function directionFactor(
  fixture: Fixture,
  toZone: readonly [number, number, number],
  distance: number,
  beamAngle: number,
): number {
  if (ISOTROPIC_TYPES.has(fixture.type) || beamAngle <= 0) {
    return 1;
  }
  const a = aimDirection(fixture.rot);
  const dot = a[0] * toZone[0] + a[1] * toZone[1] + a[2] * toZone[2];
  const cos = clamp(dot / (distance || 1e-12), -1, 1);
  const ang = Math.acos(cos);
  const halfBeamRad = (beamAngle * Math.PI) / 360;
  return ang <= halfBeamRad ? 1 : 0;
}

/** 单盏灯具对单个工作面的贡献（lx，相对估算）。 */
export function fixtureContribution(
  fixture: Fixture,
  toZone: readonly [number, number, number],
  distance: number,
): number {
  const pm = parametric(fixture.photometric);
  if (!pm) {
    return 0;
  }
  const cd = pm.lumens / FOUR_PI;
  const factor = directionFactor(fixture, toZone, distance, pm.beamAngle);
  return (cd / (distance * distance)) * factor;
}

/**
 * 计算单个活动区工作面的相对照度（§6）。
 *
 * 范围筛除按**平面（x-z）距离**判：灯具中心在地面上离区中心多远，
 * 不受高度影响（避免把「正上方但很高」的灯误判出局）。
 */
export function calculateZoneIlluminance(
  zone: ActivityZone,
  fixtures: Fixture[],
): IlluminanceResult {
  const perFixture = new Map<string, number>();
  const [zx, zz] = zone.pos;
  const zy = zone.planeH;
  const maxDim = Math.max(zone.size[0], zone.size[1]);
  const range = Math.max(maxDim * RANGE_FACTOR, MIN_DISTANCE);
  let total = 0;

  for (const fixture of fixtures) {
    const [fx, fy, fz] = fixture.pos;
    const dx = fx - zx;
    const dy = fy - zy;
    const dz = fz - zz;
    if (Math.hypot(dx, dz) > range) {
      continue;
    }
    // toZone = fixture → zone（灯具看区），与 aimDirection 的朝向一致；
    // dx/dy/dz 是「zone → fixture」，这里取反，距离用平方，符号无所谓。
    const toZone: readonly [number, number, number] = [-dx, -dy, -dz];
    const distance = Math.max(Math.hypot(dx, dy, dz), MIN_DISTANCE);
    const e = fixtureContribution(fixture, toZone, distance);
    if (!Number.isFinite(e)) {
      continue;
    }
    perFixture.set(fixture.id, e);
    total += e;
  }

  return {
    total,
    perFixture,
    target: zone.lux,
    ratio: zone.lux > 0 ? total / zone.lux : Infinity,
  };
}

/** 批量：每个活动区独立计算，互不影响。 */
export function calculateAllZones(
  zones: Record<string, ActivityZone>,
  fixtures: Record<string, Fixture>,
): Record<string, IlluminanceResult> {
  const fixtureList = Object.values(fixtures);
  const out: Record<string, IlluminanceResult> = {};
  for (const [key, zone] of Object.entries(zones)) {
    out[key] = calculateZoneIlluminance(zone, fixtureList);
  }
  return out;
}

/** lx 展示格式化：大值取整，小值留小数（避免 0.4 lx 被抹成 0 lx）。 */
export function fmtLx(v: number): string {
  if (!Number.isFinite(v)) {
    return String(v);
  }
  if (v === 0) {
    return '0';
  }
  const a = Math.abs(v);
  if (a < 1) {
    return v.toFixed(2);
  }
  if (a < 10) {
    return v.toFixed(1);
  }
  return String(Math.round(v));
}

/**
 * UI 展示用的一行文案，形如
 *   `目标 300 lx | 估算 245 lx (82%) · 相对估算，非实测照度`
 *
 * 红线：末尾的 DISCLAIMER **不可省略**（§6.3）—— 调用方不要再自己拼字符串。
 */
export function formatIlluminance(result: IlluminanceResult): string {
  const pct = Number.isFinite(result.ratio) ? `${Math.round(result.ratio * 100)}%` : '∞%';
  return `目标 ${fmtLx(result.target)} lx | 估算 ${fmtLx(result.total)} lx (${pct}) · ${DISCLAIMER}`;
}
