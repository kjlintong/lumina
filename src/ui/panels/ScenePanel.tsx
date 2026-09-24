/**
 * 场景面板：6 个内置预设按钮，当前场景高亮。
 *
 * 点击不直接写 store，而是调 onApplyScene（由 App 接到 SceneController.applyScene）：
 * controller 会先捕获引擎实况作为动画起点，再调 store.applyScene 落盘终值并登记过渡，
 * 由渲染循环逐帧驱动 setFixtureLevel / setFixtureCct —— 灯真的变暗变暖。
 */

import { PRESET_SCENE_KEYS, PRESET_SCENES } from '../../scene/sceneSystem.js';
import { useProjectStore } from '../../store/projectStore.js';
import { Panel } from './Panel.js';

interface ScenePanelProps {
  onApplyScene: (sceneKey: string) => void;
}

export function ScenePanel({ onApplyScene }: ScenePanelProps) {
  const activeSceneKey = useProjectStore((s) => s.activeSceneKey);

  return (
    <Panel title="场景">
      <div className="scene-grid">
        {PRESET_SCENE_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className={`btn scene-btn${activeSceneKey === key ? ' active' : ''}`}
            onClick={() => onApplyScene(key)}
          >
            {PRESET_SCENES[key].name}
          </button>
        ))}
      </div>
    </Panel>
  );
}
