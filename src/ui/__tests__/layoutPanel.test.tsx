/**
 * P34 · Part B 验收：LayoutPanel 单元测试（4 用例）
 *
 * 覆盖：
 *   1. 空 model 时按钮禁用 + 提示
 *   2. 有 walls 时能显示 4 个模式按钮
 *   3. 点击「矩形阵列」应用后 store 新增灯具
 *   4. 撤销后一次性删除全部
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { LayoutPanel } from '../panels/LayoutPanel.js';
import { useProjectStore, createInitialProject } from '../../store/projectStore.js';
import { undoCommand, commandStack } from '../../store/commandBus.js';
import type { ModelGeometry, WallSegment, RoomPolygon } from '../../core/modeling.js';

function makeEmptyModel(): ModelGeometry {
  return {
    schemaId: 'lumina.model/1',
    walls: [],
    openings: [],
    rooms: [],
    slab: { level: 0, thickness: 0.2, ceilingH: 2.8 },
    calibration: null,
    track: { track: 'template', guaranteesUniformError: true, maxErrorCm: 2 },
  };
}

function makeWall(a: [number, number], b: [number, number], id = 'w-1'): WallSegment {
  return {
    id,
    a: a as readonly [number, number],
    b: b as readonly [number, number],
    thickness: 0.15,
    height: 2.8,
    confidence: 1,
    provenance: { kind: 'user_edit' },
  };
}

function makeRoom(): RoomPolygon {
  return {
    id: 'r-1',
    name: '客厅',
    vertices: [[0, 0], [6, 0], [6, 4], [0, 4]] as readonly (readonly [number, number])[],
    confidence: 1,
    provenance: { kind: 'user_edit' },
  };
}

function withModel(model: ModelGeometry | null): void {
  const base = createInitialProject();
  if (model === null) {
    useProjectStore.setState({ project: { ...base, fixtures: {} } });
  } else {
    useProjectStore.setState({ project: { ...base, fixtures: {}, model } });
  }
}

describe('LayoutPanel', () => {
  beforeEach(() => {
    cleanup();
    commandStack.clear();
    useProjectStore.setState({
      project: createInitialProject(),
      selectedFixtureId: null,
      activeSceneKey: null,
    });
  });

  // Panel 默认 defaultOpen=true（Panel.tsx 里 useState(defaultOpen) 的默认）；
  // 每个测试先关闭再展开以验证 Panel 存在 header（可选），或直接测试内容。
  function expand(container: HTMLElement): void {
    // 默认已展开，不需要额外操作
    void container;
  }

  it('空 model：显示「请先描墙或选模板」提示 + 应用按钮禁用', () => {
    withModel(null);
    const { container } = render(<LayoutPanel />);
    expand(container);
    expect(container.textContent).toContain('请先描墙或选模板');
    const applyBtn = Array.from(container.querySelectorAll('button'))
      .find((b) => (b.textContent ?? '').includes('应用'));
    expect(applyBtn).toBeDefined();
    expect((applyBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('有 walls + rooms：显示 4 个模式按钮', () => {
    const model = makeEmptyModel();
    model.walls = [makeWall([0, 0], [6, 0], 'w1'), makeWall([6, 0], [6, 4], 'w2')];
    model.rooms = [makeRoom()];
    withModel(model);

    const { container } = render(<LayoutPanel />);
    expand(container);
    const text = container.textContent ?? '';
    expect(text).toContain('矩形阵列');
    expect(text).toContain('沿墙等距');
    expect(text).toContain('沿墙壁灯');
    expect(text).toContain('房间居中');
  });

  it('有 walls：应用「矩形阵列 3×3」→ store 新增 9 盏灯', () => {
    const model = makeEmptyModel();
    model.walls = [
      makeWall([0, 0], [6, 0], 'w1'),
      makeWall([6, 0], [6, 4], 'w2'),
      makeWall([6, 4], [0, 4], 'w3'),
      makeWall([0, 4], [0, 0], 'w4'),
    ];
    withModel(model);

    const { container } = render(<LayoutPanel />);
    expand(container);
    const applyBtn = Array.from(container.querySelectorAll('button'))
      .find((b) => (b.textContent ?? '').includes('应用'));
    expect(applyBtn).toBeDefined();
    expect((applyBtn as HTMLButtonElement).disabled).toBe(false);
    expect((applyBtn as HTMLButtonElement).textContent).toContain('9 盏');

    fireEvent.click(applyBtn as HTMLButtonElement);
    const st = useProjectStore.getState();
    expect(Object.keys(st.project.fixtures).length).toBe(9);
  });

  it('撤销后一次性删除全部（整批 Command）', () => {
    const model = makeEmptyModel();
    model.walls = [
      makeWall([0, 0], [6, 0], 'w1'),
      makeWall([6, 0], [6, 4], 'w2'),
      makeWall([6, 4], [0, 4], 'w3'),
      makeWall([0, 4], [0, 0], 'w4'),
    ];
    withModel(model);

    const { container } = render(<LayoutPanel />);
    expand(container);
    const applyBtn = Array.from(container.querySelectorAll('button'))
      .find((b) => (b.textContent ?? '').includes('应用'));
    fireEvent.click(applyBtn as HTMLButtonElement);

    // 从 0 变 9：新增 9 盏
    const st = useProjectStore.getState();
    expect(Object.keys(st.project.fixtures).length).toBe(9);

    // 一次撤销应删掉全部 9 盏（整批 Command），回到 0
    undoCommand();
    const st2 = useProjectStore.getState();
    expect(Object.keys(st2.project.fixtures).length).toBe(0);
  });
});
