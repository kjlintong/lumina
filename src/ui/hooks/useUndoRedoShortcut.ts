/**
 * 全局 Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 快捷键（Phase 1）+ R/E/Q/Esc/Delete（P28）。
 *
 * 输入框保护：焦点在 input / textarea / contentEditable 时跳过，
 * 让浏览器默认的文本 undo 生效（编辑文本自己的 undo，不走应用）。
 *
 * - Ctrl+Z：撤销
 * - Ctrl+Shift+Z 或 Ctrl+Y：重做（Windows 惯例）
 * - Cmd+Z / Cmd+Shift+Z：Mac 兼容（`e.metaKey`）
 * - R / E / Q（无修饰键）：切 TransformControls mode（rotate / scale / translate）
 * - Esc（无修饰键）：取消选中（selectedFixtureId = null）
 * - Delete / Backspace（无修饰键）：删除选中灯具（走 removeFixture 命令栈）
 *
 * engineRef 用于切 TransformControls mode；未提供时 R/E/Q 静默跳过。
 */
import { useEffect, type MutableRefObject } from 'react';
import { undoCommand, redoCommand } from '../../store/commandBus.js';
import { useProjectStore } from '../../store/projectStore.js';
import type { SceneEngine } from '../../scene/sceneEngine.js';

export function useUndoRedoShortcut(engineRef?: MutableRefObject<SceneEngine | null>): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod) {
        // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          const label = undoCommand();
          if (label) useProjectStore.getState().setNotice(`撤销：${label}`);
        } else if ((key === 'z' && e.shiftKey) || key === 'y') {
          e.preventDefault();
          const label = redoCommand();
          if (label) useProjectStore.getState().setNotice(`重做：${label}`);
        }
        return;
      }

      // P28：无修饰键的快捷键
      if (key === 'r' || key === 'e' || key === 'q') {
        const eng = engineRef?.current;
        if (!eng) return;
        const mode = key === 'r' ? 'rotate' : key === 'e' ? 'scale' : 'translate';
        eng.setTransformMode(mode);
        e.preventDefault();
      } else if (key === 'escape') {
        useProjectStore.getState().selectFixture(null);
        e.preventDefault();
      } else if (key === 'delete' || key === 'backspace') {
        const id = useProjectStore.getState().selectedFixtureId;
        if (id) {
          useProjectStore.getState().removeFixture(id);
          useProjectStore.getState().setNotice(`已删除 ${id.slice(0, 6)}…`);
          e.preventDefault();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [engineRef]);
}
