/**
 * 项目状态 store（Zustand 5 + Immer 10）—— 唯一权威数据源。
 *
 * 架构（工程方案 §3.1 / P3-M1.6 规格）：
 *   用户操作 → store action（不可变更新 project）→ SceneEngine 订阅渲染。
 *   store 是数据层，不 import three 渲染器；引擎是渲染投影。
 *
 * 与 binding.ts 的关系：所有结构性变更（删区、移灯、绑定、锁定）都调用
 * `src/core/binding.ts` 的纯函数完成，store 只负责「落地」新 project。
 * 铁律落点：
 *   - ADR-01 删除区不级联删灯 → binding.removeZone
 *   - ADR-02 手动移灯自动解绑 → binding.moveFixture
 *   - ADR-13 区旋转灯具跟随 → binding.rotateZone
 *   - ADR-17 user-locked 保护 → updateFixture 把改过的字段路径写入 lockedFields，
 *     applyScene 经 SceneSystem 过滤锁定字段。
 */

import { enableMapSet } from 'immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import * as binding from '../core/binding.js';
import { makeFixture } from '../core/makeFixture.js';
import type { FixtureOptions } from '../core/makeFixture.js';
import type { ActivityZoneType, Fixture, FixtureType, LuminaProject, SceneDefinition } from '../core/types.js';
import { makeZone, ZONE_TYPE_TEMPLATES } from '../core/zoneTypes.js';
import { SceneSystem, PRESET_SCENES } from '../scene/sceneSystem.js';
import { pushCommand } from './commandBus.js';

/** 命令栈 label 用的中文类型名（与 FixturePanel.FIXTURE_TYPE_LABELS 平行；store 层不能引 UI） */
const FIXTURE_TYPE_LABELS: Record<FixtureType, string> = {
  downlight: '筒灯',
  spot: '射灯',
  pendant: '吊灯',
  linear: '线性灯',
  cove: '灯带',
  sconce: '壁灯',
  floor: '落地灯',
  table: '台灯',
};

// project 内含 Set（Fixture.lockedFields），immer 需要 MapSet 插件才能 draft 它们
enableMapSet();

/**
 * 无活跃场景时，手动亮度写入的 sceneLevels 键。
 * FixturePanel 的亮度滑杆读/写 `sceneLevels[activeSceneKey ?? MANUAL_LEVEL_KEY]`，
 * App 的 store→engine 订阅据此同步引擎亮度。它不是 SceneSystem 里的真实场景，
 * 因此 applyScene 不会触碰它（手动亮度在场景切换间保持）。
 */
export const MANUAL_LEVEL_KEY = 'manual';

// ---------------------------------------------------------------------------
// 状态形状
// ---------------------------------------------------------------------------

/**
 * 递归 Partial：嵌套对象（electrical / photometric / rot…）可只给要改的叶子字段；
 * 数组（pos / size）、Set（lockedFields）、函数原样，不展开。
 * 规格的 `Partial<Fixture>` 是它的子集，浅层调用方完全兼容。
 */
export type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly unknown[] | ReadonlySet<unknown> | ReadonlyMap<unknown, unknown>
    ? T
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

/** 进行中的场景过渡（渲染层逐帧推进，见 sceneController） */
export interface SceneTransitionInfo {
  /** 过渡开始的 Date.now() 时间戳 */
  startedAt: number;
  durationMs: number;
  /** 场景 key */
  key: string;
}

export interface ProjectState {
  /** 唯一权威数据（ADR-08/12：需求侧 zones 与供给侧 fixtures 分离） */
  project: LuminaProject;
  selectedFixtureId: string | null;
  selectedZoneKey: string | null;
  activeSceneKey: string | null;
  sceneTransition: SceneTransitionInfo | null;

  // -- 活动区（需求侧） ------------------------------------------------------
  addZone: (type: ActivityZoneType, pos: readonly [number, number], name?: string) => string;
  /** 删除区：**不级联删灯**，绑定灯自动解绑但保留原位（ADR-01） */
  removeZone: (zoneKey: string) => void;
  renameZone: (zoneKey: string, name: string) => void;
  /** 切换类型：同步工作面高度 / 目标照度 / 推荐色温（zoneTypes 模板） */
  changeZoneType: (zoneKey: string, type: ActivityZoneType) => void;
  moveZone: (zoneKey: string, delta: readonly [number, number]) => void;
  rotateZone: (zoneKey: string, rotY: number) => void;

  // -- 灯具（供给侧） --------------------------------------------------------
  addFixture: (opts: FixtureOptions) => string;
  /** P34 · Part B：一次性加入多盏灯（批量布灯），整批一条 Command，撤销一次性删所有 */
  addFixtures: (fixtures: Fixture[]) => void;
  removeFixture: (fixtureId: string) => void;
  /**
   * 用户手动修改灯具字段。**手动改 = 锁定**（ADR-17）：被改的字段路径
   * （如 'electrical.cct'）同步写入 lockedFields，此后场景预设不再覆盖。
   */
  updateFixture: (fixtureId: string, patch: DeepPartial<Fixture> | ((f: Fixture) => void)) => void;
  /** 手动移动灯具：处于启用绑定时自动解绑（ADR-02） */
  moveFixture: (fixtureId: string, pos: readonly [number, number, number]) => { autoUnbound: boolean };
  /** 参数面板位置编辑用：解绑（ADR-02）+ 锁定 pos（ADR-17） */
  moveAndLockFixture: (fixtureId: string, pos: readonly [number, number, number]) => { autoUnbound: boolean };

  // -- 通知 ------------------------------------------------------------------
  notice: string | null;
  setNotice: (text: string | null) => void;

  // -- 选择 ------------------------------------------------------------------
  selectFixture: (id: string | null) => void;
  selectZone: (key: string | null) => void;

  // -- 锁定 / 场景 -----------------------------------------------------------
  /** 显式锁定字段路径（ADR-17） */
  lockField: (fixtureId: string, fieldPath: string) => void;
  /** 应用场景：写入 sceneLevels/cct 终值（尊重锁定），并登记平滑过渡 */
  applyScene: (sceneKey: string) => void;
  /** 立即应用场景：写终值，不登记过渡 */
  applySceneInstant: (sceneKey: string) => void;

  // -- P34 · Part C：快速预设（会客/观影/阅读） ----------------------------
  /**
   * 保存/覆盖一个场景定义到 project.scenes（P34 Part C）。
   *
   * 走命令栈以便支持撤销；不登记 sceneTransition（后续由
   * `SceneController.applyScene` 处理动画通道）。同名 key 会被覆盖。
   */
  upsertScene: (def: SceneDefinition) => void;
}

// ---------------------------------------------------------------------------
// patch 工具（updateFixture 用）
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Set) && !(v instanceof Map);
}

/** updateFixture 中不可经 patch 覆盖的字段：id 是实体身份，lockedFields 只能增不能绕 */
const PATCH_SKIP_KEYS = new Set(['id', 'lockedFields']);

/** 深合并补丁：plain object 递归，数组 / Set / 原始值整体替换 */
function mergePatch(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (PATCH_SKIP_KEYS.has(key)) continue;
    const cur = target[key];
    if (isPlainObject(value) && isPlainObject(cur)) {
      mergePatch(cur, value);
    } else {
      target[key] = isPlainObject(value) ? structuredClone(value) : value;
    }
  }
}

/** 收集补丁触碰的叶子字段路径（如 { electrical: { cct } } → ['electrical.cct']） */
function collectPatchPaths(patch: Record<string, unknown>, prefix: string, out: string[]): void {
  for (const [key, value] of Object.entries(patch)) {
    if (prefix === '' && PATCH_SKIP_KEYS.has(key)) continue;
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (isPlainObject(value)) {
      collectPatchPaths(value, path, out);
    } else {
      out.push(path);
    }
  }
}

/** 对比前后两个 Fixture，收集发生变化的叶子字段路径（函数式 patch 用） */
function diffPaths(before: unknown, after: unknown, path: string, out: string[]): void {
  if (PATCH_SKIP_KEYS.has(path)) return;
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const k of keys) {
      diffPaths(before[k], after[k], path === '' ? k : `${path}.${k}`, out);
    }
    return;
  }
  if (before instanceof Set && after instanceof Set) {
    if (before.size !== after.size || [...before].some((v) => !after.has(v))) out.push(path);
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length || before.some((v, i) => !Object.is(v, after[i]))) {
      out.push(path);
    }
    return;
  }
  if (!Object.is(before, after)) out.push(path);
}

// ---------------------------------------------------------------------------
// 默认工程（首屏展示：2 个活动区 + 3 盏灯，其中吊灯绑定用餐区）
// ---------------------------------------------------------------------------

export function createInitialProject(): LuminaProject {
  const lounge = makeZone('lounge', [-1.2, 0.8], { name: '客厅休闲区' });
  const dining = makeZone('dining', [1.4, -1.0], { name: '餐厅用餐区' });

  const downlight = makeFixture({ type: 'downlight', pos: [-1.2, 2.7, 0.8], lumens: 500, cct: 2700 });
  const pendant = makeFixture({ type: 'pendant', pos: [1.4, 1.9, -1.0], lumens: 800, cct: 3000 });
  const floor = makeFixture({ type: 'floor', pos: [-2.4, 1.4, 1.4], lumens: 600, cct: 3000 });

  const project: LuminaProject = {
    schemaVersion: 1,
    name: '示例方案',
    unitSystem: 'metric',
    ceilingH: 2.8,
    zones: { [lounge.key]: lounge, [dining.key]: dining },
    fixtures: { [downlight.id]: downlight, [pendant.id]: pendant, [floor.id]: floor },
  };

  // 吊灯锚定到用餐区：演示可选绑定（区移动/旋转时跟随，ADR-13）
  return binding.bindFixture(project, pendant.id, dining.key);
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

/** 用 SceneSystem 把场景终值写入 fixtures（尊重 lockedFields），返回新 fixtures 表 */
function applySceneToFixtures(
  fixtures: Record<string, Fixture>,
  sceneKey: string,
): { fixtures: Record<string, Fixture>; durationMs: number } {
  // SceneSystem.apply 原地改灯具，因此先克隆，绝不碰 store 内的对象
  const map = new Map<string, Fixture>(Object.entries(structuredClone(fixtures)));
  // P34 Part C：把 project.scenes 里的自定义/快速预设追加到内置 6 预设之后（不覆盖）
  const customPresets = Object.values(useProjectStore.getState().project.scenes ?? {});
  const system = new SceneSystem(map, {
    presets: [...Object.values(PRESET_SCENES), ...customPresets],
  });
  const durationMs = system.get(sceneKey).transitionMs;
  system.apply(sceneKey); // 写 control.sceneLevels[sceneKey] 与 electrical.cct（锁定字段跳过）
  return { fixtures: Object.fromEntries(map), durationMs };
}

export const useProjectStore = create<ProjectState>()(
  immer((set, get) => ({
    project: createInitialProject(),
    selectedFixtureId: null,
    selectedZoneKey: null,
    activeSceneKey: null,
    sceneTransition: null,

    // -- 活动区 --------------------------------------------------------------

    addZone: (type, pos, name) => {
      const zone = makeZone(type, pos, name !== undefined ? { name } : {});
      const p = get().project;
      // 注：领域类型的 readonly 元组与 immer 的 WritableDraft 不兼容，
      // 因此一律用对象形式 set（仍经 immer 中间件，只是不走 draft 赋值）。
      set({ project: { ...p, zones: { ...p.zones, [zone.key]: zone } }, selectedZoneKey: zone.key });
      return zone.key;
    },

    removeZone: (zoneKey) => {
      const next = binding.removeZone(get().project, zoneKey);
      if (next === get().project) return;
      const selectedZoneKey = get().selectedZoneKey === zoneKey ? null : get().selectedZoneKey;
      set({ project: next, selectedZoneKey });
    },

    renameZone: (zoneKey, name) => {
      const p = get().project;
      const zone = p.zones[zoneKey];
      if (!zone) return;
      set({ project: { ...p, zones: { ...p.zones, [zoneKey]: { ...zone, name } } } });
    },

    changeZoneType: (zoneKey, type) => {
      const t = ZONE_TYPE_TEMPLATES[type];
      const defaults = t
        ? { planeH: t.planeH, lux: t.lux, cct: t.cct, need: t.need, suggestion: t.suggestion }
        : { planeH: 0.75, lux: 100, cct: 3000, need: '', suggestion: [] };
      const next = binding.changeZoneType(get().project, zoneKey, type, defaults);
      if (next !== get().project) set({ project: next });
    },

    moveZone: (zoneKey, delta) => {
      const next = binding.moveZone(get().project, zoneKey, delta);
      if (next !== get().project) set({ project: next });
    },

    rotateZone: (zoneKey, rotY) => {
      const next = binding.rotateZone(get().project, zoneKey, rotY);
      if (next !== get().project) set({ project: next });
    },

    // -- 灯具 ----------------------------------------------------------------

    addFixture: (opts) => {
      const fixture = makeFixture(opts);
      const fixtureSnapshot = structuredClone(fixture);
      const label = `新增${FIXTURE_TYPE_LABELS[fixture.type] ?? '灯具'}`;
      pushCommand({
        label,
        execute: () => {
          const p = get().project;
          set({
            project: { ...p, fixtures: { ...p.fixtures, [fixtureSnapshot.id]: fixtureSnapshot } },
            selectedFixtureId: fixtureSnapshot.id,
          });
        },
        undo: () => {
          const p = get().project;
          set({
            project: binding.removeFixture(p, fixtureSnapshot.id),
            selectedFixtureId: get().selectedFixtureId === fixtureSnapshot.id ? null : get().selectedFixtureId,
          });
        },
      });
      return fixture.id;
    },

    /**
     * P34 · Part B：一次性加入多盏灯。
     *
     * 与 addFixture 的差别：
     * - 整批一条 Command（P34 §2.2），撤销时一次性删所有新加的 fixture；
     * - 不逐盏触发 engine.addFixture 的订阅回调，App 层由 engine.syncFixtures
     *   一次性 diff 处理，避免 O(n²) 预算重算。
     *
     * ADR-01 反向："不拆分"——批量撤销 = 整批撤销。
     */
    addFixtures: (fixtures) => {
      if (fixtures.length === 0) return;
      const snapshots = fixtures.map((f) => structuredClone(f));
      const label = `批量布灯 ${snapshots.length} 盏`;
      pushCommand({
        label,
        execute: () => {
          const p = get().project;
          const next = { ...p, fixtures: { ...p.fixtures } };
          for (const f of snapshots) next.fixtures[f.id] = f;
          set({ project: next });
        },
        undo: () => {
          const p = get().project;
          const next = { ...p, fixtures: { ...p.fixtures } };
          for (const f of snapshots) delete next.fixtures[f.id];
          set({
            project: next,
            selectedFixtureId: snapshots.length > 0 && snapshots[0]?.id === get().selectedFixtureId
              ? null
              : get().selectedFixtureId,
          });
        },
      });
    },

    removeFixture: (fixtureId) => {
      const p = get().project;
      const cur = p.fixtures[fixtureId];
      if (!cur) return;
      const before = structuredClone(p);
      const beforeSelected = get().selectedFixtureId;
      const fixtureSnap = structuredClone(cur);
      pushCommand({
        label: `删除${FIXTURE_TYPE_LABELS[cur.type] ?? '灯具'}`,
        execute: () => {
          const p = get().project;
          set({
            project: binding.removeFixture(p, fixtureId),
            selectedFixtureId: get().selectedFixtureId === fixtureId ? null : get().selectedFixtureId,
          });
        },
        undo: () => {
          set({
            project: { ...before, fixtures: { ...before.fixtures, [fixtureSnap.id]: fixtureSnap } },
            selectedFixtureId: beforeSelected,
          });
        },
      });
    },

    updateFixture: (fixtureId, patch) => {
      const p = get().project;
      const cur = p.fixtures[fixtureId];
      if (!cur) return;

      let next: Fixture;
      const paths: string[] = [];
      if (typeof patch === 'function') {
        // 函数式补丁：在克隆上原地改，再用 diff 反推改过的字段路径
        const draft = structuredClone(cur);
        patch(draft);
        next = draft;
        diffPaths(cur, next, '', paths);
      } else {
        next = structuredClone(cur);
        mergePatch(next as unknown as Record<string, unknown>, patch as Record<string, unknown>);
        collectPatchPaths(patch as Record<string, unknown>, '', paths);
      }

      // ADR-17：手动改 = 锁定
      if (paths.length > 0) {
        next.lockedFields = new Set([...next.lockedFields, ...paths]);
      }

      // 深拷贝快照：before = cur（未锁定前的原状），after = next（含锁定）
      const beforeSnap = structuredClone(cur);
      const afterSnap = structuredClone(next);
      pushCommand({
        label: '修改灯具',
        execute: () => {
          const p = get().project;
          set({ project: { ...p, fixtures: { ...p.fixtures, [fixtureId]: afterSnap } } });
        },
        undo: () => {
          const p = get().project;
          set({ project: { ...p, fixtures: { ...p.fixtures, [fixtureId]: beforeSnap } } });
        },
      });
    },

    moveFixture: (fixtureId, pos) => {
      const p = get().project;
      const cur = p.fixtures[fixtureId];
      if (!cur) return { autoUnbound: false };
      const { project: movedProject, autoUnbound } = binding.moveFixture(p, fixtureId, pos);
      if (movedProject === p) return { autoUnbound };
      const beforeSnap = structuredClone(p);
      const afterSnap = structuredClone(movedProject);
      pushCommand({
        label: '移动灯具',
        execute: () => { set({ project: afterSnap }); },
        undo: () => { set({ project: beforeSnap }); },
      });
      return { autoUnbound };
    },

    /**
     * 手动移动灯具（参数面板位置编辑用）：解绑 + 锁定位置字段。
     *
     * 与 moveFixture 的分工：moveFixture 只解绑（ADR-02），用于拖拽等纯移动；
     * 本方法给参数面板用——用户手动输入新坐标既是「手动移动」（应解绑，ADR-02）
     * 又是「手动改字段」（应锁定 pos，ADR-17），两步合一。
     */
    moveAndLockFixture: (fixtureId, pos) => {
      const p = get().project;
      const cur = p.fixtures[fixtureId];
      if (!cur) return { autoUnbound: false };
      const { project: moved, autoUnbound } = binding.moveFixture(p, fixtureId, pos);
      if (moved === p) return { autoUnbound };
      const afterProject = binding.lockField(moved, fixtureId, 'pos');
      if (afterProject === moved) return { autoUnbound };
      const beforeSnap = structuredClone(p);
      const afterSnap = structuredClone(afterProject);
      pushCommand({
        label: '移动并锁定灯具',
        execute: () => { set({ project: afterSnap }); },
        undo: () => { set({ project: beforeSnap }); },
      });
      return { autoUnbound };
    },

    // -- 通知 ------------------------------------------------------------------

    notice: null,
    setNotice: (text) => {
      set({ notice: text });
    },

    // -- 选择 ------------------------------------------------------------------

    selectFixture: (id) => {
      set({ selectedFixtureId: id });
    },

    selectZone: (key) => {
      set({ selectedZoneKey: key });
    },

    // -- 锁定 / 场景 ---------------------------------------------------------

    lockField: (fixtureId, fieldPath) => {
      const next = binding.lockField(get().project, fixtureId, fieldPath);
      if (next !== get().project) set({ project: next });
    },

    applyScene: (sceneKey) => {
      const { fixtures, durationMs } = applySceneToFixtures(get().project.fixtures, sceneKey);
      set({
        project: { ...get().project, fixtures },
        activeSceneKey: sceneKey,
        sceneTransition: { startedAt: Date.now(), durationMs, key: sceneKey },
      });
    },

    applySceneInstant: (sceneKey) => {
      const { fixtures } = applySceneToFixtures(get().project.fixtures, sceneKey);
      set({
        project: { ...get().project, fixtures },
        activeSceneKey: sceneKey,
        sceneTransition: null,
      });
    },

    /**
     * P34 · Part C：保存快速预设到 project.scenes（撤销栈支持）。
     * 只登记场景，不动 activeSceneKey——由调用方（App 层）随后调
     * `sceneController.applyScene(key)` 走动画通道。
     */
    upsertScene: (def) => {
      const p = get().project;
      const scenes = p.scenes ?? {};
      const beforeSnap = structuredClone(scenes);
      const afterSnap = structuredClone({ ...scenes, [def.key]: def });
      const defSnap = structuredClone(def);
      pushCommand({
        label: `保存场景：${def.name}`,
        execute: () => {
          set({ project: { ...get().project, scenes: { ...get().project.scenes, [defSnap.key]: defSnap } } });
        },
        undo: () => {
          // 撤销时把快照恢复回去；若 defSnap.key 原本不存在则删除之
          const cur = get().project.scenes ?? {};
          if (beforeSnap[defSnap.key] === undefined) {
            const rest: Record<string, SceneDefinition> = { ...cur };
            delete rest[defSnap.key];
            set({ project: { ...get().project, scenes: rest } });
          } else {
            const restored = beforeSnap[defSnap.key];
            if (!restored) return;
            set({ project: { ...get().project, scenes: { ...cur, [defSnap.key]: restored } } });
          }
        },
      });
      // 立即执行
      set({ project: { ...p, scenes: afterSnap } });
    },
  })),
);
