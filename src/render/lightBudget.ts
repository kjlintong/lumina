/**
 * 实时光源预算（P34 · Phase 3 §4）。
 *
 * 背景：一盏 SpotLight（带 shadow）≈ 12–15ms，一盏 PointLight（无 shadow）≈ 5–8ms，
 * 一盏 RectAreaLight（无 shadow，需 LTC 表）≈ 6–10ms。P9 记录：2 盏 PointLight
 * 即 12 张阴影贴图；P33 后默认工程 3 盏 SpotLight + 1 盏 PointLight 已让
 * 1080p 桌面浏览器落到 30fps 边缘。**50 盏筒灯 = 50 个 SpotLight 必卡死**。
 *
 * 策略：预算按"类型优先级"分配。前 N 盏（N = MAX_REAL_LIGHTS）保留真光源，
 * 其余降级为「proxy」（只保留 `shade` 灯罩 Mesh，不建 `Light` 对象）。
 * 视觉损失可控——超过 8 盏的灯多数是远处筒灯，人眼感知不到它们的光照贡献。
 *
 * **user-locked 保护（ADR-17）**：用户手动调过 `light.intensity` 的灯**优先**
 * 保留为真光源，因为降级会让 UI 上显示的数字与视觉不一致，是最容易被投诉的一类 bug。
 *
 * 纯函数，无 DOM / canvas 依赖，jsdom 下可直接单测。
 */

import type { Fixture } from '../core/types.js';

/** 实时光源硬上限。审查方案 §Phase 3.4：50 盏筒灯必卡，8 盏是 P9/P26b 实测下能稳定 30fps 的临界点。 */
export const MAX_REAL_LIGHTS = 8;

/** 预算项：一盏灯的"渲染身份" */
export interface LightBudgetEntry {
  /** 灯具 id */
  id: string;
  /** true = 保留真光源；false = 只保留灯罩 Mesh（proxy 模式） */
  isReal: boolean;
  /** 保留为真光源的原因（用于 UI 提示，非必需） */
  reason: 'shadow' | 'locked' | 'budget' | 'proxy';
}

export interface LightBudgetResult {
  /** 有序的预算表，`isReal=true` 的在前，`isReal=false` 的在后 */
  entries: LightBudgetEntry[];
  /** 真光源集合（O(1) 查询） */
  realSet: ReadonlySet<string>;
  /** proxy 集合 */
  proxySet: ReadonlySet<string>;
  /** 是否被截断（`fixtures.length > MAX_REAL_LIGHTS` 时为 true） */
  truncated: boolean;
}

/** 光源类型 → 3D 引擎构造类型（用于优先级排序） */
function lightKind(f: Fixture): 'spot_shadow' | 'spot_noshadow' | 'point' | 'rect' {
  switch (f.type) {
    case 'downlight':
    case 'spot':
      return 'spot_shadow';      // buildLightFromFixture 里这两个走 SpotLight.castShadow=true
    case 'pendant':
    case 'sconce':
    case 'floor':
    case 'table':
      return 'point';            // PointLight，无 shadow
    case 'linear':
    case 'cove':
      return 'rect';             // RectAreaLight，无 shadow
  }
}

/**
 * 计算预算。
 *
 * 排序键（字典序，越小越靠前 = 越应该保留真光源）：
 *   1. `isLocked` 降序（user-locked 优先，ADR-17）
 *   2. `kind` 权重：spot_shadow=0, spot_noshadow=1, point=2, rect=3
 *      （SpotLight 带 shadow 最贵也最"可见"，先保留）
 *   3. `id` 升序（同权重的稳定排序，测试可预测）
 */
export function computeLightBudget(
  fixtures: Iterable<Fixture>,
  maxReal = MAX_REAL_LIGHTS,
): LightBudgetResult {
  const list = [...fixtures];
  const kindRank = { spot_shadow: 0, spot_noshadow: 1, point: 2, rect: 3 } as const;

  const sorted = list.slice().sort((a, b) => {
    const aLocked = a.lockedFields.has('light.intensity');
    const bLocked = b.lockedFields.has('light.intensity');
    if (aLocked !== bLocked) return aLocked ? -1 : 1;
    const ra = kindRank[lightKind(a)];
    const rb = kindRank[lightKind(b)];
    if (ra !== rb) return ra - rb;
    return a.id.localeCompare(b.id);
  });

  const entries: LightBudgetEntry[] = sorted.map((f, i) => {
    if (f.lockedFields.has('light.intensity')) return { id: f.id, isReal: true, reason: 'locked' };
    if (i < maxReal) {
      const kind = lightKind(f);
      return {
        id: f.id,
        isReal: true,
        reason: kind === 'spot_shadow' ? 'shadow' : 'budget',
      };
    }
    return { id: f.id, isReal: false, reason: 'proxy' };
  });

  const realSet = new Set(entries.filter((e) => e.isReal).map((e) => e.id));
  const proxySet = new Set(entries.filter((e) => !e.isReal).map((e) => e.id));

  return {
    entries,
    realSet,
    proxySet,
    truncated: list.length > maxReal,
  };
}
