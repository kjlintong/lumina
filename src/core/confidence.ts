/**
 * 置信度与 provenance 模型（执行规格 §6 范围 7）。
 *
 * §6 范围 7 原文：「按来源（图元 / 模型推断 / 用户编辑）与规则通过率给 0–1
 * 分值；低置信度区域高亮，提供『只修这一项』入口；**任何修改写 undo 栈并把
 * provenance 更新为 `user_edit`**」。
 *
 * 本文件只负责纯逻辑：阈值判定、用户编辑重置、undo 栈结构与应用/回滚。
 * **不接线 UI**（接线属 P23 校正器）。
 *
 * 纯函数，无 DOM / canvas 依赖，jsdom 下可单测。
 */

import type { Confidence, Provenance } from './modeling.js';

/**
 * 低置信度阈值：低于此值 UI 高亮。
 *
 * 取 0.6 的理由（§6 范围 7「低置信度区域高亮」）：
 *  - 图像分割 / 模型推断的产物通常给 0.3–0.8 之间；用户手动编辑给 1.0。
 *  - 0.6 是一条经验分水岭：低于它的推断「可信但不确定」，UI 需要提醒
 *    用户复核；高于它的「基本可信」，无谓高亮只会制造噪声。
 *  - 不是 magic number 意义上的精确值：本阶段没有真数据校准它，先取
 *    一个能在测试里稳定判定的中位数，后续接真实数据再调。
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

/** 判定「低置信度」（供 UI 决定是否高亮）。 */
export function isLowConfidence(c: Confidence): boolean {
  return c < LOW_CONFIDENCE_THRESHOLD;
}

/** 用户编辑的契约形状：`confidence.ts` 只操作这个子集，不改整个 `T` */
type Editable<T extends { confidence: Confidence; provenance: Provenance }> =
  Pick<T, 'confidence' | 'provenance'>;

/**
 * 用户编辑：任何手工修改必须重置 provenance 为 `user_edit` 并把置信度顶到 1。
 *
 * 理由（§6 范围 7）：用户手工修过的地方，「模型认为它不准」的提示已经失效，
 * 继续高亮只会制造噪声；同时它成为新的可信锚点。这也是 §6「分档承诺是产品
 * 可信度的关键」的具体落地 —— 用户编辑是最高可信来源，必须覆盖模型推断值。
 *
 * **纯函数**：返回新对象，不改入参（与 store 的不可变风格一致，参见
 * `projectStore.ts` 的 `applySceneToFixtures` 用 `structuredClone` 后再改）。
 * 这条是 §4 红线 3 的必测点，测试会用 `expect(before).not.toBe(before)` 类的
 * 深度不变量断言。
 */
export function applyUserEdit<T extends { confidence: Confidence; provenance: Provenance }>(
  element: T,
): T {
  const edited: Editable<T> = {
    confidence: 1,
    provenance: { kind: 'user_edit' },
  };
  return { ...element, ...edited };
}

/**
 * Undo 栈条目。`before` / `after` 是被改元素的旧/新完整快照。
 *
 * `elementId` 用于「只修这一项」入口定位（§6 范围 7）：用户可以在 undo 栈
 * 里点某一条，UI 据此高亮该元素并给出「只修这一项」的操作路径。
 */
export interface UndoEntry<T> {
  elementId: string;
  label: string;
  before: T;
  after: T;
}

/**
 * Undo 栈。
 *
 * 语义约定（既有前端 undo 栈惯例，本阶段固化）：
 *  - `push` 追加新条目到 undo 栈，**并清空 redo 分支**（一条新的编辑使
 *    「重做」变成无意义的历史分支，必须丢弃）。
 *  - `undo` 弹出栈顶条目，把 `after` 放回 redo 栈顶；返回的是被弹出的条目
 *    （调用方可用它恢复 `before`）。
 *  - `redo` 弹出 redo 栈顶，把 `before` 放回 undo 栈顶。
 *  - `push` 在空栈上正常工作；`undo` / `redo` 在空栈上返回 null（不抛错）。
 *
 * 这里刻意**不**实现「栈深度上限」等策略：本阶段只定义结构与纯函数，
 * 策略属 P23 校正器 UI。
 */
export class UndoStack<T> {
  private undoEntries: UndoEntry<T>[] = [];
  private redoEntries: UndoEntry<T>[] = [];

  /** 追加一条编辑；**清空 redo 分支** */
  push(entry: UndoEntry<T>): void {
    this.undoEntries.push(entry);
    this.redoEntries = [];
  }

  /** 撤销：弹出栈顶，返回被弹出的条目（可能为 null） */
  undo(): UndoEntry<T> | null {
    const entry = this.undoEntries.pop();
    if (entry === undefined) return null;
    this.redoEntries.push(entry);
    return entry;
  }

  /** 重做：从 redo 栈顶弹出，返回被弹出的条目（可能为 null） */
  redo(): UndoEntry<T> | null {
    const entry = this.redoEntries.pop();
    if (entry === undefined) return null;
    this.undoEntries.push(entry);
    return entry;
  }

  canUndo(): boolean {
    return this.undoEntries.length > 0;
  }

  canRedo(): boolean {
    return this.redoEntries.length > 0;
  }

  /** 当前 undo 栈深度（诊断用，非策略） */
  get size(): number {
    return this.undoEntries.length;
  }

  /** 深拷贝快照（诊断 / 测试用；不含私有字段以外状态） */
  snapshot(): { undo: UndoEntry<T>[]; redo: UndoEntry<T>[] } {
    return { undo: [...this.undoEntries], redo: [...this.redoEntries] };
  }
}
