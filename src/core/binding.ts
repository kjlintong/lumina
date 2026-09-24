/**
 * 绑定引擎：需求侧 / 供给侧分离的核心（工程方案 §4.6，ADR-12/13/17）。
 *
 * 这里的每条规则都对应任务书 §6 P3 的一条硬性验收判据：
 *  - `moveZone`：区移动时，启用绑定的灯具按偏移跟随平移；解绑的不动。
 *  - `moveZoneRotation`：区旋转时，绑定灯具按局部偏移重新落位（ADR-13）。
 *  - `moveFixture`：用户手动移动灯具 -> 自动解绑（§2.2），此后灯具保持世界坐标。
 *  - `removeZone`：删除区不级联删除灯具，绑定灯具自动解绑但保留原位（§2.4）。
 *  - `lockField` / `isLocked`：user-locked 字段保护（ADR-17）。
 *
 * 全部为纯函数：输入 project，返回新的 project（不可变）。便于 round-trip 与撤销栈。
 */

import { localToWorld, worldToLocal } from './coord.js';
import type { ActivityZone, Fixture, LuminaProject } from './types.js';

/** 深拷贝项目（用于纯函数的不可变更新）。结构化克隆在 Node/DOM 均可用。 */
export function cloneProject(p: LuminaProject): LuminaProject {
  return structuredClone(p);
}

// ---------------------------------------------------------------------------
// 锚定 / 解绑
// ---------------------------------------------------------------------------

/**
 * 把灯具锚定到活动区：记录灯具当前世界坐标，反算出区局部偏移。
 * 锚定是「便利规则」，不是所有权转移。
 */
export function bindFixture(
  p: LuminaProject,
  fixtureId: string,
  zoneKey: string,
): LuminaProject {
  const next = cloneProject(p);
  const fixture = next.fixtures[fixtureId];
  const zone = next.zones[zoneKey];
  if (!fixture || !zone) return p;

  const offsets = [worldToLocal(zone.pos, zone.rotY, fixture.pos)];
  fixture.binding = { zoneKey, offsets, enabled: true };

  // 活动区侧镜像
  if (!zone.fixtures.some((b) => b.fixtureId === fixtureId)) {
    zone.fixtures = [...zone.fixtures, { fixtureId, offsets, enabled: true }];
  }
  return next;
}

/**
 * 解除绑定：清除双侧记录，**保留灯具世界坐标**（解绑后位置不变）。
 */
export function unbindFixture(p: LuminaProject, fixtureId: string): LuminaProject {
  const next = cloneProject(p);
  const fixture = next.fixtures[fixtureId];
  if (!fixture || !fixture.binding) return p;

  const zone = next.zones[fixture.binding.zoneKey];
  if (zone) {
    zone.fixtures = zone.fixtures.filter((b) => b.fixtureId !== fixtureId);
  }
  fixture.binding = null;
  return next;
}

// ---------------------------------------------------------------------------
// 区的变换 -> 绑定灯具跟随
// ---------------------------------------------------------------------------

/**
 * 区整体平移（pos 改变）：启用绑定的灯具按相同位移跟随；解绑的不跟随。
 * 纯函数，返回新 project。
 */
export function moveZone(
  p: LuminaProject,
  zoneKey: string,
  delta: readonly [dx: number, dz: number],
): LuminaProject {
  const next = cloneProject(p);
  const zone = next.zones[zoneKey];
  if (!zone) return p;

  zone.pos = [zone.pos[0] + delta[0], zone.pos[1] + delta[1]];
  for (const b of zone.fixtures) {
    if (!b.enabled) continue;
    const f = next.fixtures[b.fixtureId];
    if (!f) continue;
    // 跟随平移：世界坐标直接加位移（y 不变）
    f.pos = [f.pos[0] + delta[0], f.pos[1], f.pos[2] + delta[1]];
  }
  return next;
}

/**
 * 区旋转 rotY：启用绑定的灯具按**局部偏移**重新落位（ADR-13）。
 *
 * 关键：偏移定义在局部坐标系，所以旋转区等于把偏移一起旋转。
 * 餐桌转 90°，沿长边排列的吊灯必须跟着转 —— 这就是本函数的职责。
 */
export function rotateZone(p: LuminaProject, zoneKey: string, newRotY: number): LuminaProject {
  const next = cloneProject(p);
  const zone = next.zones[zoneKey];
  if (!zone) return p;

  zone.rotY = newRotY;
  for (const b of zone.fixtures) {
    if (!b.enabled) continue;
    const f = next.fixtures[b.fixtureId];
    if (!f) continue;
    for (const off of b.offsets) {
      const [lx, ly, lz] = [off[0] ?? 0, off[1] ?? 0, off[2] ?? 0];
      const [wx, wy, wz] = localToWorld(zone.pos, zone.rotY, [lx, ly, lz]);
      f.pos = [wx, wy, wz];
      break; // 每盏灯一条主偏移
    }
  }
  return next;
}

/**
 * 区尺寸变化：不影响任何灯具位置（尺寸只描述范围，不持有灯具）。
 * 提供此函数以证明需求侧参数与供给侧位置正交。
 */
export function resizeZone(
  p: LuminaProject,
  zoneKey: string,
  size: readonly [w: number, d: number],
): LuminaProject {
  const next = cloneProject(p);
  const zone = next.zones[zoneKey];
  if (!zone) return p;
  zone.size = [size[0], size[1]];
  return next;
}

// ---------------------------------------------------------------------------
// 用户手动操作灯具
// ---------------------------------------------------------------------------

/**
 * 用户手动移动灯具：
 *  - 若该灯处于启用绑定 -> **自动解绑**（§2.2），位置设为新值，此后保持世界坐标。
 *  - 若该灯本就未绑定 -> 仅设置位置。
 * 返回是否发生了自动解绑（供 UI 提示「该灯已脱离跟随」）。
 */
export function moveFixture(
  p: LuminaProject,
  fixtureId: string,
  newPos: readonly [x: number, y: number, z: number],
): { project: LuminaProject; autoUnbound: boolean } {
  const next = cloneProject(p);
  const fixture = next.fixtures[fixtureId];
  if (!fixture) return { project: p, autoUnbound: false };

  fixture.pos = [newPos[0], newPos[1], newPos[2]];

  if (fixture.binding && fixture.binding.enabled) {
    const zone = next.zones[fixture.binding.zoneKey];
    if (zone) {
      zone.fixtures = zone.fixtures.filter((b) => b.fixtureId !== fixtureId);
    }
    fixture.binding = null;
    return { project: next, autoUnbound: true };
  }
  return { project: next, autoUnbound: false };
}

/**
 * 删除灯具：清除双侧绑定记录。
 * 与 removeZone 对称 —— 删灯具也不影响区，删区也不影响灯具。
 */
export function removeFixture(p: LuminaProject, fixtureId: string): LuminaProject {
  const next = cloneProject(p);
  const fixture = next.fixtures[fixtureId];
  if (!fixture) return p;

  if (fixture.binding) {
    const zone = next.zones[fixture.binding.zoneKey];
    if (zone) {
      zone.fixtures = zone.fixtures.filter((b) => b.fixtureId !== fixtureId);
    }
  }
  delete next.fixtures[fixtureId];
  return next;
}

// ---------------------------------------------------------------------------
// 删除活动区：不级联删除灯具（§2.4）
// ---------------------------------------------------------------------------

/**
 * 删除活动区。
 * 绑定的灯具**自动解绑但保留原位** —— 这是需求侧 / 供给侧分离最直接的检验标准。
 *
 * 测试判据（任务书 §6 P3）：删除区后，原绑定灯具仍然存在且坐标不变。
 */
export function removeZone(p: LuminaProject, zoneKey: string): LuminaProject {
  const next = cloneProject(p);
  const zone = next.zones[zoneKey];
  if (!zone) return p;

  // 解绑所有绑定灯具，但不删除它们
  for (const b of zone.fixtures) {
    const f = next.fixtures[b.fixtureId];
    if (f) f.binding = null;
  }
  delete next.zones[zoneKey];
  return next;
}

/**
 * 改活动区类型：同步切换工作面高度 / 目标照度 / 推荐色温等需求侧参数。
 * 已绑定灯具不解绑，仅更新需求与建议（§4.6.3）。
 */
export function changeZoneType(
  p: LuminaProject,
  zoneKey: string,
  type: string,
  defaults: { planeH: number; lux: number; cct: number; need: string; suggestion: ActivityZone['suggestion'] },
): LuminaProject {
  const next = cloneProject(p);
  const zone = next.zones[zoneKey];
  if (!zone) return p;
  zone.type = type;
  zone.planeH = defaults.planeH;
  zone.lux = defaults.lux;
  zone.cct = defaults.cct;
  zone.need = defaults.need;
  zone.suggestion = defaults.suggestion;
  return next;
}

// ---------------------------------------------------------------------------
// user-locked 字段保护（ADR-17）
// ---------------------------------------------------------------------------

/**
 * 标记字段为用户手动锁定。锁定后自动逻辑必须跳过该字段。
 * 字段路径用点号，如 'electrical.cct' / 'photometric.beamAngle'。
 */
export function lockField(p: LuminaProject, fixtureId: string, fieldPath: string): LuminaProject {
  const next = cloneProject(p);
  const f = next.fixtures[fixtureId];
  if (!f) return p;
  f.lockedFields = new Set([...f.lockedFields, fieldPath]);
  return next;
}

/** 字段是否被用户锁定 */
export function isLocked(f: Fixture, fieldPath: string): boolean {
  return f.lockedFields.has(fieldPath);
}

/**
 * 自动逻辑写入前的守卫：**只有未被锁定的字段才允许写**。
 * 返回过滤后的补丁（已剔除 locked 字段）。
 *
 * 用法：自动布灯 / 风格推荐 / 场景切换在写 fixture 前统一过这里。
 */
export function filterLockedPatch(
  f: Fixture,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!isLocked(f, k)) out[k] = v;
  }
  return out;
}
