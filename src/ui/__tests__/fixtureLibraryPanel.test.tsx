/**
 * FixtureLibraryPanel 单元测试（P28）。
 *
 * jsdom 不支 HTML5 DnD，本测试只验「渲染出 8 个 draggable 项 + 中文标签」；
 * 拖拽真实行为留给真实 GPU 手工验证（规格 §3.5 明确）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { FixtureLibraryPanel } from '../panels/FixtureLibraryPanel.js';
import { commandStack } from '../../store/commandBus.js';
import { useProjectStore } from '../../store/projectStore.js';

beforeEach(() => {
  commandStack.clear();
  useProjectStore.setState({ selectedFixtureId: null, selectedZoneKey: null, activeSceneKey: null });
});

describe('FixtureLibraryPanel', () => {
  it('渲染 9 种灯具，各有 draggable 与 data-fixture-type', () => {
    const { container } = render(<FixtureLibraryPanel />);
    const items = container.querySelectorAll('.fixture-library-item');
    expect(items.length).toBe(9);
    for (const item of items) {
      expect(item.getAttribute('draggable')).toBe('true');
      expect(item.getAttribute('data-fixture-type')).toBeTruthy();
    }
  });

  it('包含 9 个中文标签', () => {
    const { container } = render(<FixtureLibraryPanel />);
    const text = container.textContent ?? '';
    for (const label of ['筒灯', '射灯', '吊灯', '线条灯', '灯带', '壁灯', '落地灯', '台灯', '吊灯组']) {
      expect(text).toContain(label);
    }
  });

  it('包含 8 个拖入提示', () => {
    const { container } = render(<FixtureLibraryPanel />);
    const text = container.textContent ?? '';
    for (const hint of ['嵌入天花', '悬挂天花板', '贴墙', '桌面', '地面']) {
      expect(text).toContain(hint);
    }
  });

  it('每个 item 都有对应的 SVG 图标', () => {
    const { container } = render(<FixtureLibraryPanel />);
    const items = container.querySelectorAll('.fixture-library-item');
    for (const item of items) {
      expect(item.querySelector('.fixture-library-icon svg')).not.toBeNull();
    }
  });

  it('每个 item 有唯一的 data-fixture-type（9 种无重复）', () => {
    const { container } = render(<FixtureLibraryPanel />);
    const items = Array.from(container.querySelectorAll('.fixture-library-item'));
    const types = items.map((el) => el.getAttribute('data-fixture-type'));
    expect(new Set(types).size).toBe(9);
    expect(types).toContain('downlight');
    expect(types).toContain('spot');
    expect(types).toContain('pendant');
    expect(types).toContain('linear');
    expect(types).toContain('cove');
    expect(types).toContain('sconce');
    expect(types).toContain('floor');
    expect(types).toContain('table');
    expect(types).toContain('chandelier');
  });
});
