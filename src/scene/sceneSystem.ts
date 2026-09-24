/**
 * 场景预设管理器（工程方案 §6 P5 / ADR-17）
 *
 * 把 6 个内置场景预设（日间 / 晚餐 / 观影 / 放松 / 阅读 / 夜间）与用户自定义场景
 * 应用到 Fixture 注册表上，全程尊重 user-locked 字段。
 *
 * 三条工程约束：
 *  1. 场景只写亮度与色温，**不动位置与形状**（§6 P5「场景只写此表，不动位置与形状」）。
 *     亮度写入 `Fixture.control.sceneLevels[sceneKey]`，色温写入 `Fixture.electrical.cct`；
 *     `pos` / `rot` / `shape` / `photometric` / `binding` 一律不触碰。
 *  2. user-locked 字段受保护（ADR-17）：
 *     - `'control.sceneLevels'` 在 lockedFields 中 → 跳过该灯亮度写入
 *     - `'electrical.cct'`      在 lockedFields 中 → 跳过该灯色温写入
 *  3. 尊重灯具能力：亮度截断到 `[electrical.dimFloor, 1]`；色温截断到
 *     `electrical.cct` 声明的可调区间（固定色温灯具截断到 `[CCT_MIN, CCT_MAX]`）。
 *
 * 本模块是**纯逻辑**：不依赖 Three.js，不做渲染。`applySmooth` 只登记过渡，
 * 期间不写 Fixture；调用方逐帧取 `sample()` 驱动动画，结束后调 `finishTransition()` 落盘。
 */

import type { Fixture, SceneDefinition } from '../core/types.js';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** lockedFields 字段路径：锁定后场景不再改该灯亮度 */
export const FIELD_LEVELS = 'control.sceneLevels';

/** lockedFields 字段路径：锁定后场景不再改该灯色温 */
export const FIELD_CCT = 'electrical.cct';

/**
 * 场景 levels / cct 表的通配键：未给出具体 fixtureId 时覆盖注册表内**所有**灯具。
 * 内置预设用此键，因此与具体灯具命名无关（灯具 id 是动态生成的）。
 */
export const ALL_FIXTURES = '*';

/** 场景色温下限（K），低于此值无物理意义 */
export const CCT_MIN = 1000;

/** 场景色温上限（K），高于此值无物理意义 */
export const CCT_MAX = 40000;

/** 用户自定义场景的默认过渡时长（ms） */
export const DEFAULT_TRANSITION_MS = 800;

/** 无场景记录时的默认亮度（全亮） */
const DEFAULT_LEVEL = 1;

/** 判断「未变化」时的浮点容差 */
const EPS = 1e-9;

// ---------------------------------------------------------------------------
// 场景 key
// ---------------------------------------------------------------------------

/** 内置 6 场景的 key（§6 P5） */
export const PRESET_SCENE_KEYS = ['daylight', 'dinner', 'movie', 'relax', 'reading', 'night'] as const;

export type PresetSceneKey = (typeof PRESET_SCENE_KEYS)[number];

/**
 * 内置场景预设表。
 *
 * levels / cct 一律用 `ALL_FIXTURES` 通配：预设是**语义层**（"晚间就该暖、暗一点"），
 * 不绑定具体灯具 id；应用时按注册表展开到每一盏灯。
 */
export const PRESET_SCENES: Record<PresetSceneKey, SceneDefinition> = {
  daylight: {
    key: 'daylight',
    name: '日间',
    transitionMs: 1200,
    levels: { [ALL_FIXTURES]: 0.9 },
    cct: { [ALL_FIXTURES]: 5000 },
  },
  dinner: {
    key: 'dinner',
    name: '晚餐',
    transitionMs: 1500,
    levels: { [ALL_FIXTURES]: 0.65 },
    cct: { [ALL_FIXTURES]: 2700 },
  },
  movie: {
    key: 'movie',
    name: '观影',
    transitionMs: 2000,
    levels: { [ALL_FIXTURES]: 0.15 },
    cct: { [ALL_FIXTURES]: 3000 },
  },
  relax: {
    key: 'relax',
    name: '放松',
    transitionMs: 1800,
    levels: { [ALL_FIXTURES]: 0.4 },
    cct: { [ALL_FIXTURES]: 2400 },
  },
  reading: {
    key: 'reading',
    name: '阅读',
    transitionMs: 900,
    levels: { [ALL_FIXTURES]: 0.95 },
    cct: { [ALL_FIXTURES]: 4000 },
  },
  night: {
    key: 'night',
    name: '夜间',
    transitionMs: 1000,
    levels: { [ALL_FIXTURES]: 0.1 },
    cct: { [ALL_FIXTURES]: 2200 },
  },
};

// ---------------------------------------------------------------------------
// 结果类型
// ---------------------------------------------------------------------------

/** 当前实况快照（每个注册表内灯具各一项） */
export interface AppliedState {
  /** fixtureId -> 亮度 0..1 */
  levels: Record<string, number>;
  /** fixtureId -> 色温 K */
  cct: Record<string, number>;
}

/** 单字段变更（`to` 是实际写入值，可能因灯具能力被截断） */
export interface FieldDelta {
  /** 变更前值 */
  from: number;
  /** 实际写入值 */
  to: number;
}

/** apply() 返回的变更摘要 */
export interface ApplySummary {
  sceneKey: string;
  name: string;
  transitionMs: number;
  /** fixtureId -> 亮度变更（未变的、被锁的都不在里面） */
  levels: Record<string, FieldDelta>;
  /** fixtureId -> 色温变更 */
  cct: Record<string, FieldDelta>;
  /** 因 lockedFields 被跳过的字段 */
  skipped: { levels: string[]; cct: string[] };
  /** 场景与实况已一致、无需写入的字段个数 */
  unchanged: number;
}

/** applySmooth() 登记的过渡（动画端点） */
export interface SceneTransition {
  sceneKey: string;
  name: string;
  durationMs: number;
  /** 起点：当前实况（动画从这里出发） */
  from: AppliedState;
  /** 终点：场景目标（已按 lockedFields 过滤、已按灯具能力截断） */
  to: AppliedState;
}

/** 配置对象：不覆盖内置预设时由构造器自动装载 */
export interface SceneSystemOptions {
  presets?: readonly SceneDefinition[];
}

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

/** 场景 key 不存在时抛出（apply / applySmooth / get / finishTransition） */
export class SceneNotFoundError extends Error {
  readonly sceneKey: string;

  constructor(sceneKey: string) {
    super(`unknown scene: "${sceneKey}"`);
    this.name = 'SceneNotFoundError';
    this.sceneKey = sceneKey;
  }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 平滑插值曲线：动画用 easeInOut，缓入缓出更符合人眼对灯光变化的适应 */
export function easeInOutQuad(t: number): number {
  const r = clamp(t, 0, 1);
  return r < 0.5 ? 2 * r * r : 1 - 2 * (1 - r) * (1 - r);
}

/** 线性插值；两端点直接返回原值，避免浮点误差在 t=0/1 处泄漏 */
function lerp(a: number, b: number, t: number): number {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return a + (b - a) * t;
}

/** 灯具当前亮度：无该场景记录时视为全亮 */
function readLevel(f: Fixture, sceneKey: string): number {
  const v = f.control.sceneLevels[sceneKey];
  return typeof v === 'number' ? v : DEFAULT_LEVEL;
}

/** 灯具当前色温（K）：可调区间取中点 */
function readCct(f: Fixture): number {
  const cct = f.electrical.cct;
  return typeof cct === 'number' ? cct : (cct[0] + cct[1]) / 2;
}

/** 亮度截断到灯具调光能力 `[dimFloor, 1]` */
function clampLevel(f: Fixture, target: number): number {
  const floor = f.electrical.dimFloor;
  const lo = clamp(Number.isFinite(floor) ? floor : 0, 0, 1);
  return clamp(target, lo, 1);
}

/** 色温截断到灯具声明的可调区间；固定色温灯具截断到 [CCT_MIN, CCT_MAX] */
function clampCct(f: Fixture, target: number): number {
  const cct = f.electrical.cct;
  if (typeof cct === 'number') return clamp(target, CCT_MIN, CCT_MAX);
  const lo = Math.min(cct[0], cct[1]);
  const hi = Math.max(cct[0], cct[1]);
  return clamp(target, lo, hi);
}

/** 防御性拷贝：SceneDefinition 的 levels/cct 是可变 Record，绝不外泄内部引用 */
function cloneScene(scene: SceneDefinition): SceneDefinition {
  return {
    key: scene.key,
    name: scene.name,
    transitionMs: scene.transitionMs,
    levels: { ...scene.levels },
    cct: { ...scene.cct },
  };
}

function assertSceneKey(sceneKey: string): void {
  if (typeof sceneKey !== 'string' || sceneKey.trim() === '') {
    throw new TypeError('sceneKey must be a non-empty string');
  }
}

/** create() 用：拒绝非有限值，越界则截断（对 UI 输入更友好，比静默写脏数据更安全） */
function sanitizeLevels(levels: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(levels)) {
    if (!Number.isFinite(v)) throw new RangeError(`levels["${id}"] must be a finite number`);
    out[id] = clamp(v, 0, 1);
  }
  return out;
}

function sanitizeCct(cct: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(cct)) {
    if (!Number.isFinite(v)) throw new RangeError(`cct["${id}"] must be a finite number`);
    out[id] = clamp(v, CCT_MIN, CCT_MAX);
  }
  return out;
}

// ---------------------------------------------------------------------------
// SceneSystem
// ---------------------------------------------------------------------------

/**
 * 场景预设管理器：持有 6 个内置预设 + 自定义场景，应用到 Fixture 注册表。
 *
 * 注册表以引用持有（`Map<string, Fixture>`）：apply() 直接改灯具对象，
 * 注册表增删后本实例无需重建。
 */
export class SceneSystem {
  private readonly fixtures: Map<string, Fixture>;
  private readonly scenes: Map<string, SceneDefinition> = new Map<string, SceneDefinition>();
  private activeSceneKey: string | null = null;
  private transition: SceneTransition | null = null;

  constructor(fixtures: Map<string, Fixture> = new Map<string, Fixture>(), options: SceneSystemOptions = {}) {
    this.fixtures = fixtures;
    const presets = options.presets ?? Object.values(PRESET_SCENES);
    for (const scene of presets) this.scenes.set(scene.key, cloneScene(scene));
  }

  // -- 查询 --------------------------------------------------------------

  /** 全部场景 key（内置 + 自定义），插入序 */
  list(): string[] {
    return Array.from(this.scenes.keys());
  }

  has(sceneKey: string): boolean {
    return this.scenes.has(sceneKey);
  }

  /** 取场景定义（防御性拷贝，改返回值不影响内部预设表） */
  get(sceneKey: string): SceneDefinition {
    return cloneScene(this.require(sceneKey));
  }

  /** 最近一次 apply() 的场景 key；未 apply 过为 null */
  getActiveSceneKey(): string | null {
    return this.activeSceneKey;
  }

  /** 当前实况：注册表内每盏灯的亮度与色温 */
  getAppliedState(): AppliedState {
    const levels: Record<string, number> = {};
    const cct: Record<string, number> = {};
    const key = this.activeSceneKey;
    for (const [id, f] of this.fixtures) {
      levels[id] = key === null ? DEFAULT_LEVEL : readLevel(f, key);
      cct[id] = readCct(f);
    }
    return { levels, cct };
  }

  // -- 应用 --------------------------------------------------------------

  /**
   * 立即应用场景：把亮度与色温写到注册表内的每一盏灯。
   *
   * 具体 fixtureId 优先于 `ALL_FIXTURES` 通配键；场景未提及的灯具不动。
   * user-locked 字段跳过（记入 summary.skipped）。不写位置、姿态、形状与配光。
   */
  apply(sceneKey: string): ApplySummary {
    const scene = this.require(sceneKey);
    const summary: ApplySummary = {
      sceneKey,
      name: scene.name,
      transitionMs: scene.transitionMs,
      levels: {},
      cct: {},
      skipped: { levels: [], cct: [] },
      unchanged: 0,
    };

    for (const [id, f] of this.fixtures) {
      const levelTarget = scene.levels[id] ?? scene.levels[ALL_FIXTURES];
      if (typeof levelTarget === 'number') {
        if (f.lockedFields.has(FIELD_LEVELS)) {
          summary.skipped.levels.push(id);
        } else {
          const to = clampLevel(f, levelTarget);
          const from = readLevel(f, sceneKey);
          if (Math.abs(from - to) < EPS) summary.unchanged++;
          else {
            f.control.sceneLevels[sceneKey] = to;
            summary.levels[id] = { from, to };
          }
        }
      }

      const cctTarget = scene.cct[id] ?? scene.cct[ALL_FIXTURES];
      if (typeof cctTarget === 'number') {
        if (f.lockedFields.has(FIELD_CCT)) {
          summary.skipped.cct.push(id);
        } else {
          const to = clampCct(f, cctTarget);
          const from = readCct(f);
          if (Math.abs(from - to) < EPS) summary.unchanged++;
          else {
            f.electrical.cct = to;
            summary.cct[id] = { from, to };
          }
        }
      }
    }

    this.activeSceneKey = sceneKey;
    this.transition = null;
    return summary;
  }

  /**
   * 登记一次平滑过渡（**不写 Fixture**），返回端点状态供动画插值。
   *
   * `from` 是当前实况，`to` 是已按 lockedFields 过滤、已按灯具能力截断的场景目标。
   * 动画逐帧取 `sample(ratio)`；过渡期结束后调 `finishTransition()` 把终点落盘。
   *
   * @param durationMs 省略时取场景自带的 transitionMs
   */
  applySmooth(sceneKey: string, durationMs?: number): SceneTransition {
    const scene = this.require(sceneKey);
    const dur = durationMs ?? scene.transitionMs;
    if (!Number.isFinite(dur) || dur < 0) {
      throw new RangeError(`durationMs must be a non-negative finite number`);
    }

    const from = this.getAppliedState();
    const to = this.computeTargets(scene);

    const transition: SceneTransition = { sceneKey, name: scene.name, durationMs: dur, from, to };
    this.transition = transition;
    return transition;
  }

  /** 未结束的过渡；无则为 null */
  getTransition(): SceneTransition | null {
    return this.transition;
  }

  /**
   * 按进度采样过渡中间态（0 = from，1 = to），已套用 easeInOut。
   * ratio 越界自动截断到 [0, 1]；无过渡时返回 null。
   */
  sample(ratio: number): AppliedState | null {
    const t = this.transition;
    if (t === null) return null;
    const r = easeInOutQuad(ratio);
    const levels: Record<string, number> = {};
    const cct: Record<string, number> = {};
    for (const [id, fromLevel] of Object.entries(t.from.levels)) {
      const toLevel = t.to.levels[id];
      levels[id] = toLevel === undefined ? fromLevel : lerp(fromLevel, toLevel, r);
    }
    for (const [id, fromCct] of Object.entries(t.from.cct)) {
      const toCct = t.to.cct[id];
      cct[id] = toCct === undefined ? fromCct : lerp(fromCct, toCct, r);
    }
    return { levels, cct };
  }

  /** 落盘过渡终点并清除过渡记录；无过渡（或过渡场景已被删）时返回 null */
  finishTransition(): ApplySummary | null {
    const t = this.transition;
    if (t === null) return null;
    if (!this.scenes.has(t.sceneKey)) {
      this.transition = null;
      return null;
    }
    const summary = this.apply(t.sceneKey);
    return summary;
  }

  // -- 增删 --------------------------------------------------------------

  /**
   * 建（或覆盖）自定义场景。
   *
   * levels / cct 的键为 fixtureId（或用 `ALL_FIXTURES` 覆盖全部灯具）；
   * 亮度截断到 [0,1]，色温截断到 [CCT_MIN, CCT_MAX]，非有限值抛 RangeError。
   * 同名场景被覆盖。
   */
  create(
    sceneKey: string,
    name: string,
    levels: Record<string, number>,
    cct: Record<string, number>,
    transitionMs = DEFAULT_TRANSITION_MS,
  ): SceneDefinition {
    assertSceneKey(sceneKey);
    if (!Number.isFinite(transitionMs) || transitionMs < 0) {
      throw new RangeError('transitionMs must be a non-negative finite number');
    }
    const scene: SceneDefinition = {
      key: sceneKey,
      name,
      transitionMs,
      levels: sanitizeLevels(levels),
      cct: sanitizeCct(cct),
    };
    this.scenes.set(sceneKey, scene);
    return this.get(sceneKey);
  }

  /** 删除场景（内置预设也可删，`PRESET_SCENES` 保留源定义可再建）；同时清掉指向它的过渡 */
  remove(sceneKey: string): boolean {
    const removed = this.scenes.delete(sceneKey);
    if (removed && this.transition !== null && this.transition.sceneKey === sceneKey) {
      this.transition = null;
    }
    return removed;
  }

  // -- 内部 --------------------------------------------------------------

  private require(sceneKey: string): SceneDefinition {
    const scene = this.scenes.get(sceneKey);
    if (scene === undefined) throw new SceneNotFoundError(sceneKey);
    return scene;
  }

  /** 计算场景对注册表的过滤后目标（不写 Fixture） */
  private computeTargets(scene: SceneDefinition): AppliedState {
    const levels: Record<string, number> = {};
    const cct: Record<string, number> = {};
    for (const [id, f] of this.fixtures) {
      const levelTarget = scene.levels[id] ?? scene.levels[ALL_FIXTURES];
      if (typeof levelTarget === 'number' && !f.lockedFields.has(FIELD_LEVELS)) {
        levels[id] = clampLevel(f, levelTarget);
      }
      const cctTarget = scene.cct[id] ?? scene.cct[ALL_FIXTURES];
      if (typeof cctTarget === 'number' && !f.lockedFields.has(FIELD_CCT)) {
        cct[id] = clampCct(f, cctTarget);
      }
    }
    return { levels, cct };
  }
}
