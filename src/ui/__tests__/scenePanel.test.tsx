/**
 * Part C · ScenePanel 快速预设区测试（P34 §7）。
 *
 * 覆盖：3 个预设按钮渲染、onSavePreset 被调用、project.scenes 被写入。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { commandStack } from '../../store/commandBus.js';
import { createInitialProject, useProjectStore } from '../../store/projectStore.js';
import { presetToSceneDefinition } from '../../core/circuitMapping.js';
import { ScenePanel } from '../panels/ScenePanel.js';

function resetStore(): void {
  useProjectStore.setState({
    project: createInitialProject(),
    selectedFixtureId: null,
    selectedZoneKey: null,
    activeSceneKey: null,
    sceneTransition: null,
  });
}

beforeEach(() => {
  commandStack.clear();
  resetStore();
});

/** 模拟 App 层的 onSavePreset：生成 def → store.upsertScene → 返回 def.key 供 assert */
function makeOnSavePresetMock(): (id: 'reception' | 'cinema' | 'reading') => string {
  return (id) => {
    const st = useProjectStore.getState();
    const def = presetToSceneDefinition(Object.values(st.project.fixtures), id);
    st.upsertScene(def);
    return def.key;
  };
}

describe('ScenePanel · 快速预设区（P34 Part C）', () => {
  it('未传 onSavePreset 时不渲染快速预设区（保持现有 6 按钮行为）', () => {
    render(<ScenePanel onApplyScene={() => {}} />);
    // 3 个 aria-label 快速预设按钮均不存在
    expect(screen.queryByLabelText('快速预设：会客')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('快速预设：观影')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('快速预设：阅读')).not.toBeInTheDocument();
  });

  it('传入 onSavePreset 时渲染 3 个快速预设按钮，点击会调用 onSavePreset(id)', () => {
    const onSavePreset = vi.fn();
    render(<ScenePanel onApplyScene={() => {}} onSavePreset={onSavePreset} />);

    fireEvent.click(screen.getByLabelText('快速预设：会客'));
    expect(onSavePreset).toHaveBeenCalledWith('reception');

    fireEvent.click(screen.getByLabelText('快速预设：观影'));
    expect(onSavePreset).toHaveBeenCalledWith('cinema');

    fireEvent.click(screen.getByLabelText('快速预设：阅读'));
    expect(onSavePreset).toHaveBeenCalledWith('reading');
  });

  it('onSavePreset 走 store.upsertScene 后，project.scenes 出现 qp-* key', () => {
    const onSavePreset = makeOnSavePresetMock();
    render(<ScenePanel onApplyScene={() => {}} onSavePreset={onSavePreset} />);

    fireEvent.click(screen.getByLabelText('快速预设：观影'));

    const scenes = useProjectStore.getState().project.scenes;
    expect(scenes).toBeDefined();
    expect(Object.keys(scenes!).sort()).toContain('qp-cinema');
    const def = scenes!['qp-cinema'];
    expect(def).toBeDefined();
    expect(def?.name).toBe('观影');
    expect(def?.transitionMs).toBe(800);
    // 每盏灯都有 level 与 cct
    const fixtureCount = Object.keys(useProjectStore.getState().project.fixtures).length;
    expect(fixtureCount).toBeGreaterThan(0);
    expect(Object.keys(def!.levels).length).toBe(fixtureCount);
    expect(Object.keys(def!.cct).length).toBe(fixtureCount);
  });
});
