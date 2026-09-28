/**
 * 通用命令栈（Phase 1 地基）。
 *
 * 与 `confidence.UndoStack<T>` 的关系：
 * - `UndoStack<T>` 只存 `ModelGeometry` 的编辑，服务描墙 / 提交房间场景
 *   （P22 定型，见 docs/p22-spec.md §3.2）。它存的是完整快照（before/after），
 *   适合「一个元素的字段修改」。
 * - 本文件是**跨模块**命令栈：命令可以来自 modelingStore、projectStore（灯具、
 *   活动区）、未来的 fixtureDrag / transform 等。命令结构是 `{execute, undo, label}`，
 *   不是「快照对」——execute 应用一次编辑，undo 反向撤回。
 *
 * 为什么不直接扩 UndoStack？
 * - UndoStack 的快照对结构对「新增元素」表达很别扭（before = undefined？）
 * - UndoStack 只 push 快照，不做 execute 幂等；命令栈支持「execute 后立即推入」的
 *   惰性模式，与 TransformControls 的 drag-during 场景更契合（P28 会用到）。
 *
 * 语义约定：
 * - `push` 追加命令，**清空 redo 分支**（与 UndoStack 一致）。
 * - `undo` 弹出栈顶，调用其 `undo()`，返回 label（可能为 undefined）。
 * - `redo` 弹出 redo 栈顶，调用其 `execute()`。
 * - `executeAndPush` 立即执行命令，然后推入栈顶（用于「用户点击按钮」类动作，
 *   一步完成）。
 * - `size` 返回 undo 栈深度。
 * - `lastLabel` 返回栈顶命令的 label（用于 UI 显示「可撤销：新增吊灯」）。
 */

export interface Command {
  /** 应用命令 */
  execute: () => void;
  /** 反向撤回命令 */
  undo: () => void;
  /** 用户可见的操作标签（用于 UI 与 undo 栈展示） */
  label?: string;
}

export class CommandStack {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  push(cmd: Command): void {
    this.undoStack.push(cmd);
    this.redoStack = [];
  }

  undo(): string | undefined {
    const cmd = this.undoStack.pop();
    if (cmd === undefined) return undefined;
    cmd.undo();
    this.redoStack.push(cmd);
    return cmd.label;
  }

  redo(): string | undefined {
    const cmd = this.redoStack.pop();
    if (cmd === undefined) return undefined;
    cmd.execute();
    this.undoStack.push(cmd);
    return cmd.label;
  }

  executeAndPush(cmd: Command): string | undefined {
    cmd.execute();
    this.push(cmd);
    return cmd.label;
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  get size(): number { return this.undoStack.length; }

  /** 栈顶命令的 label（用于 UI 提示） */
  get lastLabel(): string | undefined { return this.undoStack[this.undoStack.length - 1]?.label; }

  /** redo 栈顶命令的 label */
  get nextRedoLabel(): string | undefined { return this.redoStack[this.redoStack.length - 1]?.label; }

  clear(): void { this.undoStack = []; this.redoStack = []; }

  snapshot(): { undo: Command[]; redo: Command[] } {
    return { undo: [...this.undoStack], redo: [...this.redoStack] };
  }
}
