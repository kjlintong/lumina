import { describe, it, expect, beforeEach } from 'vitest';
import { CommandStack } from '../commandStack.js';

describe('CommandStack', () => {
  let stack: CommandStack;
  beforeEach(() => { stack = new CommandStack(); });

  it('push 追加命令；undo 弹出并调用 undo()', () => {
    const ops: string[] = [];
    stack.push({ label: 'a', execute: () => ops.push('a-ex'), undo: () => ops.push('a-undo') });
    stack.push({ label: 'b', execute: () => ops.push('b-ex'), undo: () => ops.push('b-undo') });
    expect(stack.canUndo()).toBe(true);
    expect(stack.size).toBe(2);
    expect(stack.lastLabel).toBe('b');
    stack.undo();
    stack.undo();
    expect(ops).toEqual(['b-undo', 'a-undo']);
    expect(stack.canUndo()).toBe(false);
  });

  it('undo 后 redo 恢复 execute；新 push 清空 redo 分支', () => {
    const ops: string[] = [];
    stack.push({ label: 'a', execute: () => ops.push('a-ex'), undo: () => ops.push('a-undo') });
    stack.undo();
    expect(stack.canRedo()).toBe(true);
    stack.redo();
    expect(ops).toEqual(['a-undo', 'a-ex']);
    stack.push({ label: 'c', execute: () => ops.push('c-ex'), undo: () => ops.push('c-undo') });
    expect(stack.canRedo()).toBe(false);
  });

  it('executeAndPush 立即执行再推入栈顶', () => {
    const ops: string[] = [];
    stack.executeAndPush({ label: 'x', execute: () => ops.push('x-ex'), undo: () => ops.push('x-undo') });
    expect(ops).toEqual(['x-ex']);
    expect(stack.size).toBe(1);
    stack.undo();
    expect(ops).toEqual(['x-ex', 'x-undo']);
  });

  it('canUndo / canRedo 空栈返回 false；undo/redo 返回 undefined', () => {
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
    expect(stack.undo()).toBeUndefined();
    expect(stack.redo()).toBeUndefined();
    expect(stack.lastLabel).toBeUndefined();
    expect(stack.nextRedoLabel).toBeUndefined();
  });

  it('clear 清空 undo 与 redo 栈', () => {
    stack.push({ execute: () => {}, undo: () => {} });
    stack.undo();
    stack.clear();
    expect(stack.size).toBe(0);
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
  });
});
