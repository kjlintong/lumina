import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModelPanel } from '../panels/ModelPanel.js';
import { useModelingStore } from '../../store/modelingStore.js';
import { commandStack } from '../../store/commandBus.js';
import { useProjectStore, createInitialProject } from '../../store/projectStore.js';
import { HOUSE_TEMPLATES } from '../../core/templates.js';
import { checkTopology } from '../../core/topology.js';

beforeEach(() => {
  commandStack.clear();
  useModelingStore.setState({
    selectedTemplateId: null,
    model: structuredClone(HOUSE_TEMPLATES[0]!.model),
    pendingVertices: [],
    pendingRoomName: '房间',
  });
  useProjectStore.setState({ project: createInitialProject() });
});

describe('ModelPanel', () => {
  it('renders 8 template buttons + empty canvas button', () => {
    render(<ModelPanel />);
    const buttons = screen.getAllByRole('button');
    // 8 templates + 1 empty canvas + 2 undo/redo = 11
    expect(buttons.length).toBeGreaterThanOrEqual(10);
    // Check specific template names
    const names = HOUSE_TEMPLATES.map((t) => t.name);
    for (const name of names) {
      expect(screen.getByText(name)).toBeDefined();
    }
  });

  it('clicking template button applies template and syncs project.model', () => {
    render(<ModelPanel />);
    const templateBtn = screen.getByText(HOUSE_TEMPLATES[1]!.name);
    fireEvent.click(templateBtn);
    const projectModel = useProjectStore.getState().project.model;
    expect(projectModel).not.toBeUndefined();
    expect(checkTopology(projectModel!).passed).toBe(true);
    expect(useModelingStore.getState().selectedTemplateId).toBe(HOUSE_TEMPLATES[1]!.id);
  });

  it('applied template shows topology pass report', () => {
    render(<ModelPanel />);
    expect(screen.getByText(/拓扑通过/)).toBeDefined();
  });

  it('clearModel shows empty state', () => {
    render(<ModelPanel />);
    fireEvent.click(screen.getByText('空画布'));
    const { model } = useModelingStore.getState();
    expect(model.rooms).toHaveLength(0);
    expect(model.walls).toHaveLength(0);
  });

  it('undo/redo buttons disabled when stack empty', () => {
    render(<ModelPanel />);
    const undoBtn = screen.getByText('← 撤销');
    const redoBtn = screen.getByText('重做 →');
    expect((undoBtn as HTMLButtonElement).disabled).toBe(true);
    expect((redoBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('undo becomes available after applyTemplate', () => {
    render(<ModelPanel />);
    fireEvent.click(screen.getByText(HOUSE_TEMPLATES[1]!.name));
    const undoBtn = screen.getByText('← 撤销');
    expect((undoBtn as HTMLButtonElement).disabled).toBe(false);
  });
});
