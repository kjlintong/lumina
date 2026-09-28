/**
 * 场景面板：6 个内置预设 + 3 个快速预设（会客/观影/阅读，P34 Part C）。
 *
 * 点击不直接写 store，而是调 onApplyScene（由 App 接到 SceneController.applyScene）：
 * controller 会先捕获引擎实况作为动画起点，再调 store.applyScene 落盘终值并登记过渡，
 * 由渲染循环逐帧驱动 setFixtureLevel / setFixtureCct —— 灯真的变暗变暖。
 *
 * 快速预设区（P34 Part C）：3 个按钮调用 onSavePreset(id)，由 App 层生成 SceneDefinition、
 * 写入 project.scenes、走 applyScene 动画通道。
 */

import { PRESET_META, PRESET_IDS } from '../../core/circuitMapping.js';
import type { PresetId } from '../../core/circuitMapping.js';
import { PRESET_SCENE_KEYS, PRESET_SCENES } from '../../scene/sceneSystem.js';
import { useProjectStore } from '../../store/projectStore.js';
import { Panel } from './Panel.js';

interface ScenePanelProps {
  onApplyScene: (sceneKey: string) => void;
  /**
   * P34 Part C：保存一个快速预设到工程并应用。
   * 可选：未提供时快速预设区整块不渲染（向后兼容：
   * 现有测试用 `screen.getByText('观影')` 等，内置按钮与快速预设共用文本；
   * 不渲染时避免命中歧义）。
   */
  onSavePreset?: (id: PresetId) => void;
}

export function ScenePanel({ onApplyScene, onSavePreset }: ScenePanelProps) {
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
      {onSavePreset ? (
        <div className="scene-grid" style={{ marginTop: 6 }}>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginBottom: 4 }}>
            快速预设（自动保存到工程）：
          </div>
          {PRESET_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className="btn scene-btn qp-btn"
              data-preset-id={id}
              aria-label={`快速预设：${PRESET_META[id].name}`}
              onClick={() => onSavePreset(id)}
              title={PRESET_META[id].description}
            >
              {PRESET_META[id].name}
            </button>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}
