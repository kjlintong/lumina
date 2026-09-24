/**
 * React 面板测试（P3b）。
 *
 * 重点验证两条红线与核心交互：
 *  - 照度面板每行都带「相对估算，非实测照度」（§6.3 / ADR-15，经 formatIlluminance）
 *  - 参数化灯具显示「配光为近似值」徽标（hasVerifiedIES 判定）
 *  - 场景面板渲染 6 个内置预设并高亮当前场景
 *  - 活动区面板增 / 删 / 重命名 / 点选
 *  - 灯具面板编辑字段经 store.updateFixture 生效并自动锁定（ADR-17）
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DISCLAIMER } from '../../lighting/illuminance.js';
import { PRESET_SCENE_KEYS, PRESET_SCENES } from '../../scene/sceneSystem.js';
import { createInitialProject, useProjectStore } from '../../store/projectStore.js';
import { ZonePanel } from '../panels/ZonePanel.js';
import { FixturePanel } from '../panels/FixturePanel.js';
import { ScenePanel } from '../panels/ScenePanel.js';
import { IlluminancePanel } from '../panels/IlluminancePanel.js';

function resetStore(): void {
  useProjectStore.setState({
    project: createInitialProject(),
    selectedFixtureId: null,
    selectedZoneKey: null,
    activeSceneKey: null,
    sceneTransition: null,
  });
}

beforeEach(resetStore);

function state() {
  return useProjectStore.getState();
}

describe('IlluminancePanel', () => {
  it('每个活动区一行，且每行都带「相对估算，非实测照度」红线标注', () => {
    render(<IlluminancePanel />);
    const zoneCount = Object.keys(state().project.zones).length;
    expect(zoneCount).toBeGreaterThan(0);
    // 红线：DISCLAIMER 不可省，且每行一份
    const matches = screen.getAllByText(new RegExp(DISCLAIMER));
    expect(matches.length).toBe(zoneCount);
  });

  it('无活动区时显示空态', () => {
    useProjectStore.setState({ project: { ...state().project, zones: {} } });
    render(<IlluminancePanel />);
    expect(screen.getByText('暂无活动区')).toBeInTheDocument();
  });
});

describe('ScenePanel', () => {
  it('渲染 6 个内置预设按钮', () => {
    render(<ScenePanel onApplyScene={() => {}} />);
    for (const key of PRESET_SCENE_KEYS) {
      expect(screen.getByText(PRESET_SCENES[key].name)).toBeInTheDocument();
    }
  });

  it('点击预设触发 onApplyScene，当前场景高亮', () => {
    const onApplyScene = vi.fn();
    render(<ScenePanel onApplyScene={onApplyScene} />);
    fireEvent.click(screen.getByText('观影'));
    expect(onApplyScene).toHaveBeenCalledWith('movie');
  });

  it('当前场景按钮带 active 高亮', () => {
    useProjectStore.setState({ activeSceneKey: 'movie' });
    render(<ScenePanel onApplyScene={() => {}} />);
    const btn = screen.getByText('观影').closest('button');
    expect(btn?.className).toContain('active');
    expect(screen.getByText('日间').closest('button')?.className).not.toContain('active');
  });
});

describe('FixturePanel', () => {
  it('无选中灯具时显示空态', () => {
    render(<FixturePanel />);
    expect(screen.getByText(/未选中灯具/)).toBeInTheDocument();
  });

  it('参数化灯具显示「配光为近似值」徽标', () => {
    const id = Object.keys(state().project.fixtures)[0];
    if (!id) throw new Error('no fixture');
    state().selectFixture(id);
    render(<FixturePanel />);
    expect(screen.getByText('配光为近似值')).toBeInTheDocument();
  });

  it('调色温经 updateFixture 生效并锁定 electrical.cct（ADR-17）', () => {
    const id = Object.keys(state().project.fixtures)[0];
    if (!id) throw new Error('no fixture');
    state().selectFixture(id);
    render(<FixturePanel />);

    fireEvent.change(screen.getByLabelText('色温 K'), { target: { value: '4500' } });

    const f = state().project.fixtures[id];
    expect(f?.electrical.cct).toBe(4500);
    expect(f?.lockedFields.has('electrical.cct')).toBe(true);
  });

  it('IES 灯具不显示近似徽标', () => {
    const id = state().addFixture({ type: 'spot', ies: 'fixtures/spot.ies' });
    state().selectFixture(id);
    render(<FixturePanel />);
    expect(screen.queryByText('配光为近似值')).not.toBeInTheDocument();
  });
});

describe('ZonePanel', () => {
  it('列出现有活动区（名称 / 类型 / 工作面 / 目标照度）', () => {
    render(<ZonePanel />);
    for (const z of Object.values(state().project.zones)) {
      expect(screen.getByDisplayValue(z.name)).toBeInTheDocument();
    }
  });

  it('新增活动区（默认类型下拉第一项）', () => {
    render(<ZonePanel />);
    const before = Object.keys(state().project.zones).length;
    fireEvent.click(screen.getByText('新增'));
    expect(Object.keys(state().project.zones).length).toBe(before + 1);
  });

  it('重命名活动区', () => {
    render(<ZonePanel />);
    const z = Object.values(state().project.zones)[0];
    if (!z) throw new Error('no zone');
    fireEvent.change(screen.getByDisplayValue(z.name), { target: { value: '新名字' } });
    expect(state().project.zones[z.key]?.name).toBe('新名字');
  });

  it('删除活动区不级联删灯（ADR-01）', () => {
    render(<ZonePanel />);
    const zonesBefore = Object.keys(state().project.zones).length;
    const fixturesBefore = Object.keys(state().project.fixtures).length;
    const firstDelete = screen.getAllByText('删')[0];
    if (!firstDelete) throw new Error('no delete button');
    fireEvent.click(firstDelete);
    expect(Object.keys(state().project.zones).length).toBe(zonesBefore - 1);
    // 灯不消失
    expect(Object.keys(state().project.fixtures).length).toBe(fixturesBefore);
  });

  it('点击活动区选中它', () => {
    render(<ZonePanel />);
    const z = Object.values(state().project.zones)[0];
    if (!z) throw new Error('no zone');
    const firstMeta = screen.getAllByText(/工作面/)[0];
    if (!firstMeta) throw new Error('no zone meta');
    fireEvent.click(firstMeta);
    expect(state().selectedZoneKey).toBe(z.key);
  });
});
