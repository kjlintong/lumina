/**
 * @vitest-environment jsdom
 *
 * P36：FloorPlan 灯具选中态可视化测试。
 *
 * 覆盖：
 * - 选中 fixture 的 dot 描边为 #f0a040（stroke + strokeWidth）
 * - 未选中 fixture 的 dot stroke="none"
 *
 * jsdom 下 SVG 属性可直接用 getAttribute('stroke') 读，无需真实渲染。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { FloorPlan } from '../panels/FloorPlan.js';
import { useProjectStore, createInitialProject } from '../../store/projectStore.js';

describe('FloorPlan (P36 fixture selection highlight)', () => {
  beforeEach(() => {
    useProjectStore.setState({
      project: createInitialProject(),
      selectedFixtureId: null,
      selectedZoneKey: null,
    });
  });

  /** 渲染 FloorPlan 并返回所有灯具 dot 的 <text> 元素（按 fixtures 表顺序） */
  function renderDots(): { ids: string[]; dots: Element[] } {
    const project = useProjectStore.getState().project;
    const ids = Object.values(project.fixtures).map((f) => f.id);
    const { container } = render(<FloorPlan />);
    const dots = Array.from(container.querySelectorAll('.floor-plan-fixture'));
    expect(dots).toHaveLength(ids.length);
    return { ids, dots };
  }

  it('selected fixture dot has amber stroke', () => {
    const project = useProjectStore.getState().project;
    const firstId = Object.values(project.fixtures)[0]!.id;
    useProjectStore.setState({ selectedFixtureId: firstId });

    const { ids, dots } = renderDots();
    const idx = ids.indexOf(firstId);
    const selected = dots[idx]!;
    expect(selected.getAttribute('stroke')).toBe('#f0a040');
    expect(selected.getAttribute('stroke-width')).toBe('2');
    expect(selected.getAttribute('fill')).toBe('#f0a040');
  });

  it('unselected dots have stroke="none"', () => {
    const project = useProjectStore.getState().project;
    const firstId = Object.values(project.fixtures)[0]!.id;
    useProjectStore.setState({ selectedFixtureId: firstId });

    const { ids, dots } = renderDots();
    const idx = ids.indexOf(firstId);
    dots.forEach((d, i) => {
      if (i === idx) return; // 选中项在上一用例覆盖
      expect(d.getAttribute('stroke')).toBe('none');
      expect(d.getAttribute('stroke-width')).toBe('0');
    });
  });

  it('无选中时所有 dot 均 stroke="none"', () => {
    const { dots } = renderDots();
    for (const d of dots) {
      expect(d.getAttribute('stroke')).toBe('none');
    }
  });
});
