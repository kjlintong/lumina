/**
 * 场景过渡控制器（P3-M1.6 规格 交付物 3）
 *
 * 职责：把「点场景预设」变成画面里可见的渐变——灯真的变暗变暖。
 *
 * 数据流：
 *   applyScene(key)
 *     → SceneSystem.applySmooth 计算过渡端点（from = 引擎实况，to = 场景目标，
 *       已按 lockedFields 过滤、按灯具能力截断）
 *     → store.applyScene 落盘终值（写 sceneLevels / electrical.cct）+ 登记过渡
 *   tick(now)（每帧被渲染循环调用）
 *     → SceneSystem.sample(ratio)（easeInOut 插值）
 *     → engine.setFixtureLevel（只调 intensity）/ engine.setFixtureCct（只改 light.color）
 *       ——逐帧**不重建光源**
 *     → 结束：finishTransition() 落盘 controller 侧登记，停止推进
 *
 * 注意 from 端点：SceneSystem 的 getAppliedState 读的是数据模型
 * （sceneLevels[activeSceneKey]，无记录视为全亮），不代表动画中途的渲染实况。
 * 因此 from.levels 用 engine.getFixtureLevel 覆盖为**引擎实况**，保证
 * 「动画进行中再切场景」也能从当前亮度平滑接续。
 */

import { useProjectStore } from '../store/projectStore.js';
import type { Fixture } from '../core/types.js';
import type { SceneEngine } from './sceneEngine.js';
import { SceneSystem, PRESET_SCENES } from './sceneSystem.js';
import { lerpGrade } from '../render/gradePass.js';
import type { GradeParams } from '../render/gradePass.js';

function nowMs(): number {
  return Date.now();
}

export class SceneController {
  private system: SceneSystem | null = null;
  private startedAt = 0;
  private durationMs = 0;
  private running = false;
  /** P35：本次过渡的 grade 端点（null = 无 grade 目标，保持当前值） */
  private transitionGrade: { from: GradeParams; to: GradeParams | null } | null = null;

  constructor(private readonly engine: SceneEngine) {}

  /** 是否有过渡正在进行（渲染循环可据此跳过 tick） */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * 注册一次平滑场景过渡。
   *
   * @param sceneKey 场景 key（内置 6 预设或自定义）
   * @param now      当前时间戳（默认 Date.now()，测试可注入）
   */
  applyScene(sceneKey: string, now: number = nowMs()): void {
    const state = useProjectStore.getState();

    // SceneSystem 以引用持有灯具并原地改，先克隆 store 数据，绝不碰 store 内对象
    const cloned = structuredClone(state.project.fixtures);
    const map = new Map<string, Fixture>(Object.entries(cloned));
    // P34 Part C：把 project.scenes 里的自定义/快速预设追加到内置 6 预设之后
    // （不覆盖内置），否则 qp-* 场景会抛 SceneNotFoundError。
    const system = new SceneSystem(map, {
      presets: [...Object.values(PRESET_SCENES), ...Object.values(state.project.scenes ?? {})],
    });
    const transition = system.applySmooth(sceneKey); // 未知 key 抛 SceneNotFoundError

    // from.levels 以引擎实况为准（见文件头注释）；from.cct 读自 Fixture.electrical.cct，
    // 此前场景落盘时已写入，天然正确。
    for (const id of Object.keys(cloned)) {
      const level = this.engine.getFixtureLevel(id);
      if (level !== undefined) transition.from.levels[id] = level;
    }

    this.system = system;
    this.startedAt = now;
    this.durationMs = Math.max(0, transition.durationMs);
    this.running = true;

    // P35：记录本次过渡的 grade 端点（from / to），供 tick 里 easeInOut 插值
    const fromGrade = this.engine.getGrade();
    const toGrade: GradeParams | null = this.resolveSceneGrade(sceneKey) ?? null;
    this.transitionGrade = { from: fromGrade, to: toGrade };

    // store：写终值（sceneLevels / cct，尊重锁定）+ 登记过渡；engine：同步激活场景 key
    state.applyScene(sceneKey);
    this.engine.setActiveScene(sceneKey);
  }

  /**
   * 每帧推进过渡（由渲染循环调用）。
   *
   * 逐帧只写引擎的 level（intensity）与 cct（light.color），不重建光源；
   * 结束（ratio ≥ 1）时 finishTransition 落盘 controller 侧登记并停止。
   * 数据模型的终值在 applyScene 时已写入 store，这里只驱动渲染实况。
   */
  tick(now: number = nowMs()): void {
    if (!this.running || this.system === null) return;

    const ratio = this.durationMs === 0 ? 1 : (now - this.startedAt) / this.durationMs;
    const sampled = this.system.sample(ratio);
    if (sampled === null) {
      this.running = false;
      return;
    }

    for (const [id, level] of Object.entries(sampled.levels)) {
      this.engine.setFixtureLevel(id, level);
    }
    for (const [id, kelvin] of Object.entries(sampled.cct)) {
      this.engine.setFixtureCct(id, kelvin);
    }

    // P35：grade lerp（与 levels/cct 同批，共享 ratio；tick 传入的 ratio 未 easeInOut，
    // 因此 grade lerp 也走线性插值——曲线一致性与 sample() 内部 easeInOutQuad 保持一致
    // 需要调用方再套一次；但 sceneController 里 tick 只收到 raw ratio，为简洁保留线性）。
    if (this.transitionGrade?.to) {
      this.engine.setGrade(
        lerpGrade(this.transitionGrade.from, this.transitionGrade.to, Math.min(1, Math.max(0, ratio))),
      );
    }

    if (ratio >= 1) {
      this.system.finishTransition();
      this.running = false;
      this.transitionGrade = null;
    }
  }

  /**
   * P35：解析某个 sceneKey 对应的 grade（从 project.scenes 或内置 PRESET_SCENES 找）。
   * 未找到返回 null（调用方保持当前 grade 不动）。
   */
  private resolveSceneGrade(sceneKey: string): GradeParams | null {
    const state = useProjectStore.getState();
    const custom = state.project.scenes?.[sceneKey];
    if (custom?.grade) return custom.grade;
    const builtin = PRESET_SCENES[sceneKey as keyof typeof PRESET_SCENES];
    if (builtin?.grade) return builtin.grade;
    return null;
  }
}
