/**
 * 回路 / 场景预设映射（P34 · Phase 3 §5 / Part C）。
 *
 * **不做**新的 `ScenePreset` 类型——`SceneDefinition` 已有 `{ key, name, levels, cct }`，够用。
 * 三种预设（会客/观影/阅读）是「按 fixture.type 分组的亮度模板」，本文件提供从
 * `Fixture[]` + `PresetId` 到 `SceneDefinition` 的纯映射。
 *
 * 语义边界（与方案原文对齐）：
 *   - 只改 `sceneLevels`（每盏灯的亮度）+ `electrical.cct`（色温）
 *   - **不动** `pos` / `shape` / `rot`（ADR「场景只写此表，不动位置与形状」）
 *   - **不动** `lockedFields` 里的字段（ADR-17）
 *   - 场景预设不写 `control.circuit`（circuit 是「物理回路」，跟场景无关；
 *     但预设可以选择「按 circuit 分组应用」——见 `applyPresetToFixture`）
 *
 * 命名冲突说明：内置 `PRESET_SCENES`（sceneSystem.ts）含一个 `'reading'` key
 * （name=阅读），Part C 的 3 个快速预设用不同 sceneKey 前缀 `qp-` 落盘，
 * 避免与内置预设的 SceneSystem 内部 Map 冲突。
 */

import type { CCTValue, Fixture, SceneDefinition } from './types.js';
import { PRESET_GRADE } from '../render/gradePass.js';

export type PresetId = 'reception' | 'cinema' | 'reading';

/** 3 个预设的元数据 */
export interface PresetMeta {
  id: PresetId;
  name: string;
  description: string;
}

export const PRESET_META: Record<PresetId, PresetMeta> = {
  reception: { id: 'reception', name: '会客', description: '整体明亮、中性偏暖' },
  cinema: { id: 'cinema', name: '观影', description: '筒灯全关，边灯/氛围光为主' },
  reading: { id: 'reading', name: '阅读', description: '局部高亮、暖色' },
};

/** 3 个预设的可迭代 ID 列表（UI 用） */
export const PRESET_IDS: readonly PresetId[] = ['reception', 'cinema', 'reading'] as const;

/** 每盏灯的亮度/色温目标 */
export interface PresetTarget {
  level: number;
  cct: CCTValue;
}

/** 按 fixture.type 决定目标亮度/色温 */
export function presetTarget(fixture: Fixture, preset: PresetId): PresetTarget {
  switch (preset) {
    case 'reception':
      // 全亮，主灯 100%，边灯/落地灯 70%，色温 3500K
      if (fixture.type === 'sconce' || fixture.type === 'floor') {
        return { level: 0.7, cct: 3200 };
      }
      return { level: 1.0, cct: 3500 };

    case 'cinema':
      // 筒灯/吊灯/射灯全关，壁灯/落地灯/台灯留 30%，色温暖
      if (
        fixture.type === 'downlight' ||
        fixture.type === 'spot' ||
        fixture.type === 'pendant'
      ) {
        return { level: 0, cct: 2700 };
      }
      return { level: 0.3, cct: 2400 };

    case 'reading':
      // 局部（table/spot 高亮），其它低亮
      if (fixture.type === 'table' || fixture.type === 'spot') {
        return { level: 1.0, cct: 3000 };
      }
      if (fixture.type === 'pendant') {
        return { level: 0.5, cct: 3000 };
      }
      return { level: 0.1, cct: 2700 };
  }
}

/**
 * 把预设写到 fixture 上。
 *
 * 返回**新的** `Fixture`（不 mutate），并保留原 `lockedFields` 未锁的字段更新。
 * 若 `fixture.lockedFields` 包含 `control.sceneLevels.<presetKey>` 或
 * `electrical.cct`，遵循 ADR-17 不覆盖。
 */
export function applyPresetToFixture(
  fixture: Fixture,
  preset: PresetId,
  presetKey: string = preset,
): Fixture {
  const target = presetTarget(fixture, preset);
  const sceneLevels = { ...fixture.control.sceneLevels };
  // ADR-17：用户已锁过 sceneLevels[preset] 的不动
  const sceneLevelsKey = `control.sceneLevels.${presetKey}`;
  if (!fixture.lockedFields.has(sceneLevelsKey)) {
    sceneLevels[presetKey] = target.level;
  }
  const electrical: typeof fixture.electrical = {
    ...fixture.electrical,
    cct: fixture.lockedFields.has('electrical.cct')
      ? fixture.electrical.cct
      : target.cct,
  };
  return {
    ...fixture,
    control: { ...fixture.control, sceneLevels },
    electrical,
  };
}

/**
 * 把预设写成 SceneDefinition（可保存到 project.scenes）。
 *
 * `SceneDefinition` 契约（src/core/types.ts）：
 *   { key, name, transitionMs, levels: Record<string, number>,
 *     cct: Record<string, number>, exposure?: number }
 * `cct` 是 `Record<string, number>`（**不是** `CCTValue`）——每盏灯的色温值直接写 K 数。
 *
 * `transitionMs` 默认 800ms（与已有场景过渡一致）。
 * 用户保存后走 `sceneController.applyScene(sceneKey)` 复用已有动画通道。
 *
 * 返回的 SceneDefinition 的 `key` 会加 `qp-` 前缀（`qp-reception` / `qp-cinema` /
 * `qp-reading`），避免与内置 PRESET_SCENES 的 `'reading'` key 冲突。
 */
export function presetToSceneDefinition(
  fixtures: Iterable<Fixture>,
  preset: PresetId,
  transitionMs = 800,
): SceneDefinition {
  const meta = PRESET_META[preset];
  const levels: Record<string, number> = {};
  const cct: Record<string, number> = {};
  for (const f of fixtures) {
    const t = presetTarget(f, preset);
    levels[f.id] = t.level;
    // presetTarget 返回 CCTValue（number | [min,max]），这里统一取中点作为渲染值
    cct[f.id] = typeof t.cct === 'number' ? t.cct : (t.cct[0] + t.cct[1]) / 2;
  }
  return {
    key: `qp-${preset}`,
    name: meta.name,
    transitionMs,
    levels,
    cct,
    // P35：调色参数随预设写入 SceneDefinition，走 sceneController.tick 的 lerp 通道。
    // PRESET_GRADE 只含 3 个 preset key，PresetId 是它的子集，业务上 key 一定命中。
    grade: PRESET_GRADE[preset],
  };
}
