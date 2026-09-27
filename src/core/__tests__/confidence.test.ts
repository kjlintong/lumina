import { describe, expect, it } from 'vitest';

import {
  LOW_CONFIDENCE_THRESHOLD,
  UndoStack,
  applyUserEdit,
  isLowConfidence,
  type UndoEntry,
} from '../confidence.js';
import type { Provenance } from '../modeling.js';

describe('置信度与 provenance（§6 范围 7）', () => {
  describe('LOW_CONFIDENCE_THRESHOLD', () => {
    it('阈值 = 0.6', () => {
      expect(LOW_CONFIDENCE_THRESHOLD).toBe(0.6);
    });
  });

  describe('isLowConfidence', () => {
    it('低于阈值 -> true', () => {
      expect(isLowConfidence(0)).toBe(true);
      expect(isLowConfidence(0.1)).toBe(true);
      expect(isLowConfidence(0.5)).toBe(true);
      expect(isLowConfidence(0.59)).toBe(true);
    });

    it('等于阈值 -> false（边界：< 不是 <=）', () => {
      expect(isLowConfidence(0.6)).toBe(false);
    });

    it('高于阈值 -> false', () => {
      expect(isLowConfidence(0.7)).toBe(false);
      expect(isLowConfidence(0.9)).toBe(false);
      expect(isLowConfidence(1.0)).toBe(false);
    });
  });

  describe('applyUserEdit（§4 红线 3：重置 provenance 为 user_edit + 置信度 1）', () => {
    // 最小可编辑形状：id + confidence + provenance
    interface EditableEl {
      id: string;
      confidence: number;
      provenance: Provenance;
    }

    const makeElement = (overrides: Partial<EditableEl> = {}): EditableEl => ({
      id: 'wall-1',
      confidence: 0.4,
      provenance: { kind: 'model_inferred', rule: 'snap-to-grid' },
      ...overrides,
    });

    it('重置 provenance 为 { kind: user_edit }', () => {
      const before = makeElement({
        provenance: { kind: 'image_element', elementId: 'seg-42' },
      });
      const after = applyUserEdit(before);
      expect(after.provenance).toEqual({ kind: 'user_edit' });
    });

    it('重置置信度为 1', () => {
      const before = makeElement({ confidence: 0.2 });
      const after = applyUserEdit(before);
      expect(after.confidence).toBe(1);
    });

    it('原 provenance 是 model_inferred 时也重置为 user_edit', () => {
      const before = makeElement({
        confidence: 0.5,
        provenance: { kind: 'model_inferred', rule: 'parallel-wall' },
      });
      const after = applyUserEdit(before);
      expect(after.provenance).toEqual({ kind: 'user_edit' });
      expect(after.provenance.kind).toBe('user_edit');
    });

    it('原 provenance 是 user_edit 时仍保持 user_edit（幂等）', () => {
      const before = makeElement({
        confidence: 1,
        provenance: { kind: 'user_edit' },
      });
      const after = applyUserEdit(before);
      expect(after.provenance).toEqual({ kind: 'user_edit' });
    });

    it('保留其他字段不变（id）', () => {
      const before = makeElement({ id: 'wall-7' });
      const after = applyUserEdit(before);
      expect(after.id).toBe('wall-7');
    });

    it('保留其他字段不变（confidence 之外的属性）', () => {
      const before = {
        id: 'wall-7',
        confidence: 0.4,
        provenance: { kind: 'image_element', elementId: 'seg-1' } as Provenance,
        // 额外字段：applyUserEdit 不应碰它
        label: '客厅主墙',
        lengthM: 3.5,
      };
      const after = applyUserEdit(before);
      expect(after.label).toBe('客厅主墙');
      expect(after.lengthM).toBe(3.5);
      expect(after.id).toBe('wall-7');
      // confidence 与 provenance 被重置
      expect(after.confidence).toBe(1);
      expect(after.provenance).toEqual({ kind: 'user_edit' });
    });

    it('不修改入参（§4 红线 3：纯函数语义）', () => {
      const before = makeElement({
        confidence: 0.3,
        provenance: { kind: 'image_element', elementId: 'seg-9' },
      });
      const beforeSnapshot = structuredClone(before);
      applyUserEdit(before);
      // 入参对象未被修改
      expect(before).toEqual(beforeSnapshot);
    });

    it('返回新对象（引用不等）', () => {
      const before = makeElement();
      const after = applyUserEdit(before);
      expect(after).not.toBe(before);
    });

    it('provenance 对象也是新的（深不可变）', () => {
      const before = makeElement({
        provenance: { kind: 'image_element', elementId: 'seg-3' },
      });
      const beforeProvSnapshot = structuredClone(before.provenance);
      const after = applyUserEdit(before);
      // before.provenance 本身没有被 mutate
      expect(before.provenance).toEqual(beforeProvSnapshot);
      // after.provenance 是新对象
      expect(after.provenance).not.toBe(before.provenance);
    });
  });

  describe('UndoStack（§4 必测：push/undo/redo、push 清空 redo 分支）', () => {
    interface T {
      id: string;
      value: number;
    }

    const makeEntry = (n: number): UndoEntry<T> => ({
      elementId: `el-${n}`,
      label: `edit ${n}`,
      before: { id: `el-${n}`, value: n },
      after: { id: `el-${n}`, value: n + 100 },
    });

    it('空栈 canUndo = false', () => {
      const stack = new UndoStack<T>();
      expect(stack.canUndo()).toBe(false);
    });

    it('空栈 canRedo = false', () => {
      const stack = new UndoStack<T>();
      expect(stack.canRedo()).toBe(false);
    });

    it('空栈 undo() 返回 null（不抛错）', () => {
      const stack = new UndoStack<T>();
      expect(stack.undo()).toBeNull();
    });

    it('空栈 redo() 返回 null（不抛错）', () => {
      const stack = new UndoStack<T>();
      expect(stack.redo()).toBeNull();
    });

    it('空栈 size = 0', () => {
      const stack = new UndoStack<T>();
      expect(stack.size).toBe(0);
    });

    it('push 一条后 canUndo = true，size = 1', () => {
      const stack = new UndoStack<T>();
      stack.push(makeEntry(1));
      expect(stack.canUndo()).toBe(true);
      expect(stack.size).toBe(1);
    });

    it('undo 返回被弹出的条目，size 减一', () => {
      const stack = new UndoStack<T>();
      const entry = makeEntry(1);
      stack.push(entry);
      const popped = stack.undo();
      expect(popped).toEqual(entry);
      expect(stack.size).toBe(0);
      expect(stack.canUndo()).toBe(false);
    });

    it('undo 后 redo 可恢复', () => {
      const stack = new UndoStack<T>();
      const entry = makeEntry(1);
      stack.push(entry);
      stack.undo();
      expect(stack.canRedo()).toBe(true);
      const redone = stack.redo();
      expect(redone).toEqual(entry);
      expect(stack.canUndo()).toBe(true);
    });

    it('push 清空 redo 分支（§4 必测）', () => {
      const stack = new UndoStack<T>();
      stack.push(makeEntry(1));
      stack.push(makeEntry(2));
      // undo 两次，redo 栈应有 2 条
      stack.undo();
      stack.undo();
      expect(stack.canRedo()).toBe(true);
      expect(stack.size).toBe(0);
      // 此时 push 新条目 -> redo 分支被清空
      stack.push(makeEntry(3));
      expect(stack.canRedo()).toBe(false);
      expect(stack.size).toBe(1);
    });

    it('undo -> redo -> undo 循环保持正确', () => {
      const stack = new UndoStack<T>();
      const e1 = makeEntry(1);
      stack.push(e1);
      expect(stack.undo()).toEqual(e1);
      expect(stack.redo()).toEqual(e1);
      expect(stack.undo()).toEqual(e1);
      expect(stack.redo()).toEqual(e1);
      // 第 3 次 undo
      expect(stack.undo()).toEqual(e1);
      // 栈空，第 4 次 undo 返回 null
      expect(stack.undo()).toBeNull();
    });

    it('push 多条后 undo 顺序为 LIFO', () => {
      const stack = new UndoStack<T>();
      const e1 = makeEntry(1);
      const e2 = makeEntry(2);
      const e3 = makeEntry(3);
      stack.push(e1);
      stack.push(e2);
      stack.push(e3);
      // 最后 push 的先弹出
      expect(stack.undo()).toEqual(e3);
      expect(stack.undo()).toEqual(e2);
      expect(stack.undo()).toEqual(e1);
    });

    it('redo 顺序是 LIFO（最后 undo 的先 redo）', () => {
      const stack = new UndoStack<T>();
      stack.push(makeEntry(1));
      stack.push(makeEntry(2));
      stack.push(makeEntry(3));
      stack.undo(); // pop e3 -> redo=[e3]
      stack.undo(); // pop e2 -> redo=[e3, e2]
      stack.undo(); // pop e1 -> redo=[e3, e2, e1]，e1 在栈顶
      // 最后被 undo 的（e1）最先 redo
      expect(stack.redo()?.label).toBe('edit 1');
      expect(stack.redo()?.label).toBe('edit 2');
      expect(stack.redo()?.label).toBe('edit 3');
      expect(stack.redo()).toBeNull();
    });

    it('snapshot 返回深拷贝（不共享内部引用）', () => {
      const stack = new UndoStack<T>();
      stack.push(makeEntry(1));
      const snap = stack.snapshot();
      // 修改 snapshot 不影响 stack 内部
      snap.undo.push(makeEntry(99));
      expect(stack.size).toBe(1);
    });

    it('UndoEntry 含 elementId 与 label（§4 必测：定位「只修这一项」）', () => {
      const stack = new UndoStack<T>();
      const entry = makeEntry(42);
      stack.push(entry);
      expect(entry.elementId).toBe('el-42');
      expect(entry.label).toBe('edit 42');
    });

    it('UndoEntry 的 before / after 是完整快照', () => {
      const stack = new UndoStack<T>();
      const entry = makeEntry(5);
      stack.push(entry);
      expect(entry.before).toEqual({ id: 'el-5', value: 5 });
      expect(entry.after).toEqual({ id: 'el-5', value: 105 });
    });
  });
});
