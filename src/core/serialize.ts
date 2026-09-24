/**
 * 序列化 / 反序列化（M2 方案持久化，任务书 §7 round-trip 测试）。
 *
 * 难点：Fixture.lockedFields 是 ReadonlySet，JSON 不支持 Set。
 * 序列化时转为数组，反序列化时还原。必须**对称**，否则 round-trip 深度相等会失败。
 *
 * round-trip 判据（任务书 §7）：serialize -> deserialize -> 深度相等（含绑定关系一致）。
 */

import type { LuminaProject } from './types.js';

export interface SerializedProject {
  schemaVersion: 1;
  name: string;
  unitSystem: 'metric' | 'imperial';
  ceilingH: number;
  zones: LuminaProject['zones'];
  fixtures: LuminaProject['fixtures'];
  scenes?: LuminaProject['scenes'];
  /** Set -> string[]，仅用于 wire 格式 */
  lockedFields: Record<string, string[]>;
}

export function serializeProject(p: LuminaProject): SerializedProject {
  const lockedFields: Record<string, string[]> = {};
  for (const [id, f] of Object.entries(p.fixtures)) {
    lockedFields[id] = [...f.lockedFields];
  }
  return {
    schemaVersion: 1,
    name: p.name,
    unitSystem: p.unitSystem,
    ceilingH: p.ceilingH,
    zones: structuredClone(p.zones),
    fixtures: structuredClone(p.fixtures),
    scenes: p.scenes ? structuredClone(p.scenes) : undefined,
    lockedFields,
  };
}

export function deserializeProject(s: SerializedProject): LuminaProject {
  const zones = structuredClone(s.zones);
  const fixtures = structuredClone(s.fixtures);
  for (const [id, f] of Object.entries(fixtures)) {
    f.lockedFields = new Set(s.lockedFields[id] ?? []);
  }
  return {
    schemaVersion: 1,
    name: s.name,
    unitSystem: s.unitSystem,
    ceilingH: s.ceilingH,
    zones,
    fixtures,
    ...(s.scenes ? { scenes: structuredClone(s.scenes) } : {}),
  };
}

/** JSON 往返（localStorage / 分享链接 / 导出用） */
export function toJSON(p: LuminaProject): string {
  return JSON.stringify(serializeProject(p));
}

export function fromJSON(text: string): LuminaProject {
  return deserializeProject(JSON.parse(text) as SerializedProject);
}
