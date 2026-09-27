/**
 * 相机机位面板（P18，审查报告 §4 Day 6 k）。
 *
 * 4 个可复现机位（窗景/沙发/餐桌/全景）。点击调 onPresetChange，由 App 接到
 * engineRef.setCameraPreset —— 机位是纯相机操作，**不进 store**（红线 6），
 * 所以不像 ScenePanel 那样读 activeSceneKey；选中态是面板本地 UI 状态。
 * 首次渲染没有选中项（用户还在自由漫游），点击后才高亮。
 *
 * 复用 ScenePanel 的视觉约定（Panel 容器 + scene-btn 药丸 + .active 高亮），
 * 不新造样式。
 */

import { useState } from 'react';
import { CAMERA_PRESETS } from '../../scene/cameraPresets.js';
import { Panel } from './Panel.js';

interface CameraPanelProps {
  onPresetChange: (key: string) => void;
}

export function CameraPanel({ onPresetChange }: CameraPanelProps) {
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const handleClick = (key: string) => {
    setActiveKey(key);
    onPresetChange(key);
  };

  return (
    <Panel title="相机机位">
      <div className="scene-grid grid-2">
        {CAMERA_PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            className={`scene-btn${activeKey === preset.key ? ' active' : ''}`}
            onClick={() => handleClick(preset.key)}
          >
            {preset.name}
          </button>
        ))}
      </div>
    </Panel>
  );
}
