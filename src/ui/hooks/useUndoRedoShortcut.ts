/**
 * 全局 Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 快捷键（Phase 1）。
 *
 * 输入框保护：焦点在 input / textarea / contentEditable 时跳过，
 * 让浏览器默认的文本 undo 生效（编辑文本自己的 undo，不走应用）。
 *
 * - Ctrl+Z：撤销
 * - Ctrl+Shift+Z 或 Ctrl+Y：重做（Windows 惯例）
 * - Cmd+Z / Cmd+Shift+Z：Mac 兼容（`e.metaKey`）
 */
import { useEffect } from 'react';
import { undoCommand, redoCommand } from '../../store/commandBus.js';
import { useProjectStore } from '../../store/projectStore.js';

export function useUndoRedoShortcut(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const label = undoCommand();
        if (label) useProjectStore.getState().setNotice(`撤销：${label}`);
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        const label = redoCommand();
        if (label) useProjectStore.getState().setNotice(`重做：${label}`);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
