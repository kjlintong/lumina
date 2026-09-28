/**
 * 撤销 / 重做 UI 按钮（Phase 1）。
 *
 * 订阅 commandBus 的可用性状态（不是命令本身），避免订阅 immer draft。
 * hover 时 title 显示最后一条动作 label（若可用）。
 */
import { useCommandBus, undoCommand, redoCommand } from '../../store/commandBus.js';
import { useProjectStore } from '../../store/projectStore.js';

export function UndoRedoBar() {
  const { canUndo, canRedo, lastLabel, nextRedoLabel } = useCommandBus((s) => s);

  const handleUndo = () => {
    const label = undoCommand();
    if (label) useProjectStore.getState().setNotice(`撤销：${label}`);
  };

  const handleRedo = () => {
    const label = redoCommand();
    if (label) useProjectStore.getState().setNotice(`重做：${label}`);
  };

  return (
    <div className="undo-redo-bar">
      <button
        type="button"
        disabled={!canUndo}
        title={canUndo ? (lastLabel ? `撤销：${lastLabel}` : '撤销') : '无可撤销'}
        onClick={handleUndo}
      >
        ↶ 撤销
      </button>
      <button
        type="button"
        disabled={!canRedo}
        title={canRedo ? (nextRedoLabel ? `重做：${nextRedoLabel}` : '重做') : '无可重做'}
        onClick={handleRedo}
      >
        ↷ 重做
      </button>
    </div>
  );
}
