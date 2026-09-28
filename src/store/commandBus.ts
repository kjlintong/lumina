/**
 * 全局命令栈单例（Phase 1）。
 *
 * 单例而非放入 Zustand store：Command 里的 execute/undo 是闭包函数，immer
 * 会 draft-化对象导致行为异常。参考 modelingStore.undoStack 的处理（P22 已定）。
 *
 * 暴露 `useCommandBus` 供 UI 组件订阅（Zustand 只做可用性标记）。
 */
import { CommandStack, type Command } from '../core/commandStack.js';
import { create } from 'zustand';

export const commandStack = new CommandStack();

/** UI 订阅命令栈可用性状态（不订阅命令本身） */
interface CommandBusState {
  canUndo: boolean;
  canRedo: boolean;
  lastLabel: string | undefined;
  nextRedoLabel: string | undefined;
  bump: () => void;
}

export const useCommandBus = create<CommandBusState>((set) => ({
  canUndo: false,
  canRedo: false,
  lastLabel: undefined,
  nextRedoLabel: undefined,
  bump: () => set({
    canUndo: commandStack.canUndo(),
    canRedo: commandStack.canRedo(),
    lastLabel: commandStack.lastLabel,
    nextRedoLabel: commandStack.nextRedoLabel,
  }),
}));

/** 推送命令后同步 UI 状态（避免调用方漏掉 bump） */
export function pushCommand(cmd: Command): string | undefined {
  const label = commandStack.executeAndPush(cmd);
  useCommandBus.getState().bump();
  return label;
}

export function undoCommand(): string | undefined {
  const label = commandStack.undo();
  useCommandBus.getState().bump();
  return label;
}

export function redoCommand(): string | undefined {
  const label = commandStack.redo();
  useCommandBus.getState().bump();
  return label;
}

export type { Command };
