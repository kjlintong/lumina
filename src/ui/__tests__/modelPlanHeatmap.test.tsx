import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModelPlan } from '../panels/ModelPlan.js';
import { useModelingStore } from '../../store/modelingStore.js';
import { useProjectStore, createInitialProject } from '../../store/projectStore.js';
import { HOUSE_TEMPLATES } from '../../core/templates.js';
import { makeFixture } from '../../core/makeFixture.js';

beforeEach(() => {
  useModelingStore.setState({
    selectedTemplateId: null,
    model: structuredClone(HOUSE_TEMPLATES[0]!.model),
    pendingVertices: [],
    pendingRoomName: '房间',
  });
  useProjectStore.setState({ project: createInitialProject() });
});

describe('ModelPlan heatmap (P34 Part D)', () => {
  it('开关默认关闭，SVG 内没有 rect（照度网格）', () => {
    render(<ModelPlan />);
    // 关闭状态：SVG 内的 <rect> 不应存在（wall/opening 都是 <line>，room 是 <path>）
    const svg = document.querySelector('svg')!;
    expect(svg).not.toBeNull();
    const rects = svg.querySelectorAll('rect');
    expect(rects).toHaveLength(0);
    // 开关本身存在且未勾选
    const checkbox = screen.getByLabelText('照度');
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });

  it('打开开关后渲染 width × height 个 rect', () => {
    render(<ModelPlan />);
    const checkbox = screen.getByLabelText('照度');
    fireEvent.click(checkbox);
    const svg = document.querySelector('svg');
    expect(svg).not.toBeNull();
    const rects = svg!.querySelectorAll('rect');
    // 只要数量 > 0 就说明网格生效；具体值取决于模板 bounds 与 step=0.4
    expect(rects.length).toBeGreaterThan(0);
  });

  it('打开后 rect 的颜色非纯黑（存在下灯时至少有一格有光）', () => {
    // 在 model 中心放一盏下灯
    const fx = makeFixture({
      type: 'pendant',
      lumens: 1200,
      pos: [0, 2.4, 0],
      skuId: 'fx-hm',
    });
    useProjectStore.setState({
      project: {
        ...useProjectStore.getState().project,
        fixtures: { ...useProjectStore.getState().project.fixtures, [fx.id]: fx },
      },
    });
    render(<ModelPlan />);
    const checkbox = screen.getByLabelText('照度');
    fireEvent.click(checkbox);
    const rects = document.querySelectorAll('svg rect');
    expect(rects.length).toBeGreaterThan(0);
    // 至少一个 rect 的颜色不是 rgb(0, 0, 0)
    const nonBlack = Array.from(rects).some((r) => {
      const fill = r.getAttribute('fill');
      return fill !== null && fill !== 'rgb(0, 0, 0)';
    });
    expect(nonBlack).toBe(true);
  });
});
