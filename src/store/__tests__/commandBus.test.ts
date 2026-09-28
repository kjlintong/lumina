import { describe, it, expect, beforeEach } from 'vitest';
import { commandStack, pushCommand, undoCommand, redoCommand, useCommandBus } from '../commandBus.js';

beforeEach(() => { commandStack.clear(); });

describe('commandBus', () => {
  it('pushCommand 立即执行并推入栈顶；UI 状态同步', () => {
    const ops: string[] = [];
    pushCommand({ label: 'x', execute: () => ops.push('x-ex'), undo: () => ops.push('x-undo') });
    expect(ops).toEqual(['x-ex']);
    const st = useCommandBus.getState();
    expect(st.canUndo).toBe(true);
    expect(st.canRedo).toBe(false);
    expect(st.lastLabel).toBe('x');
  });

  it('undoCommand 调用 undo 并同步 UI 状态', () => {
    const ops: string[] = [];
    pushCommand({ label: 'x', execute: () => ops.push('x-ex'), undo: () => ops.push('x-undo') });
    const label = undoCommand();
    expect(label).toBe('x');
    expect(ops).toEqual(['x-ex', 'x-undo']);
    expect(useCommandBus.getState().canUndo).toBe(false);
    expect(useCommandBus.getState().canRedo).toBe(true);
  });

  it('redoCommand 调用 execute 并同步 UI 状态', () => {
    const ops: string[] = [];
    pushCommand({ label: 'x', execute: () => ops.push('x-ex'), undo: () => ops.push('x-undo') });
    undoCommand();
    redoCommand();
    expect(ops).toEqual(['x-ex', 'x-undo', 'x-ex']);
  });
});
