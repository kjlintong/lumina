import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModelCanvas } from '../panels/ModelCanvas.js';
import { useModelingStore, undoStack } from '../../store/modelingStore.js';
import { useProjectStore, createInitialProject } from '../../store/projectStore.js';
import { HOUSE_TEMPLATES } from '../../core/templates.js';
import { GRID_SNAP_M } from '../../render/modelPlanLayout.js';

beforeEach(() => {
  undoStack.clear();
  useModelingStore.setState({
    selectedTemplateId: null,
    model: structuredClone(HOUSE_TEMPLATES[0]!.model),
    pendingVertices: [],
    pendingRoomName: '房间',
    gridSnap: true,
    orthoSnap: true,
    isDrawing: false,
  });
  useProjectStore.setState({ project: createInitialProject() });
});

describe('ModelCanvas component (P22 §4 modelCanvas.test.tsx)', () => {
  it('initially shows no pending vertices or preview line', () => {
    const { container } = render(<ModelCanvas />);
    // No circles (pending vertices) rendered
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(0);
    // No dashed preview line
    const dashed = container.querySelectorAll('[stroke-dasharray]');
    expect(dashed.length).toBe(0);
  });

  it('clicking "描墙" starts drawing mode', () => {
    render(<ModelCanvas />);
    const btn = screen.getByText('描墙');
    fireEvent.click(btn);
    expect(useModelingStore.getState().isDrawing).toBe(true);
  });

  it('clicking "停止" stops drawing mode', () => {
    render(<ModelCanvas />);
    fireEvent.click(screen.getByText('描墙'));
    fireEvent.click(screen.getByText('停止'));
    expect(useModelingStore.getState().isDrawing).toBe(false);
  });

  it('Esc key calls cancelPending (clears pendingVertices)', () => {
    const s = useModelingStore.getState();
    s.startDrawing();
    s.addPendingVertex([1, 1]);
    s.addPendingVertex([2, 2]);
    expect(useModelingStore.getState().pendingVertices).toHaveLength(2);
    render(<ModelCanvas />);
    fireEvent.keyDown(screen.getByLabelText('描墙画布'), { key: 'Escape' });
    expect(useModelingStore.getState().pendingVertices).toHaveLength(0);
    expect(useModelingStore.getState().isDrawing).toBe(false);
  });

  it('"完成房间" button disabled when < 3 vertices', () => {
    render(<ModelCanvas />);
    fireEvent.click(screen.getByText('描墙'));
    const completeBtn = screen.getByText(/\(0\)/);
    expect((completeBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('"完成房间" button enabled when >= 3 vertices', () => {
    const s = useModelingStore.getState();
    s.startDrawing();
    s.addPendingVertex([0, 0]);
    s.addPendingVertex([2, 0]);
    s.addPendingVertex([2, 2]);
    render(<ModelCanvas />);
    const completeBtn = screen.getByText(/\(3\)/);
    expect((completeBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('"完成房间" commits room and clears pendingVertices', () => {
    const s = useModelingStore.getState();
    s.startDrawing();
    const roomsBefore = s.model.rooms.length;
    s.addPendingVertex([0, 0]);
    s.addPendingVertex([2, 0]);
    s.addPendingVertex([2, 2]);
    render(<ModelCanvas />);
    fireEvent.click(screen.getByText(/\(3\)/));
    expect(useModelingStore.getState().model.rooms.length).toBe(roomsBefore + 1);
    expect(useModelingStore.getState().pendingVertices).toHaveLength(0);
    expect(useModelingStore.getState().isDrawing).toBe(false);
  });

  it('grid snap checkbox toggles gridSnap state', () => {
    render(<ModelCanvas />);
    fireEvent.click(screen.getByText('描墙'));
    const checkbox = screen.getByText('网格').querySelector('input')!;
    fireEvent.click(checkbox);
    expect(useModelingStore.getState().gridSnap).toBe(false);
    fireEvent.click(checkbox);
    expect(useModelingStore.getState().gridSnap).toBe(true);
  });

  it('ortho snap checkbox toggles orthoSnap state', () => {
    render(<ModelCanvas />);
    fireEvent.click(screen.getByText('描墙'));
    const checkbox = screen.getByText('正交').querySelector('input')!;
    fireEvent.click(checkbox);
    expect(useModelingStore.getState().orthoSnap).toBe(false);
    fireEvent.click(checkbox);
    expect(useModelingStore.getState().orthoSnap).toBe(true);
  });

  it('grid snap is on by default (0.1m step)', () => {
    expect(GRID_SNAP_M).toBe(0.1);
    expect(useModelingStore.getState().gridSnap).toBe(true);
  });

  it('rendering with gridSnap off does not add grid lines', () => {
    useModelingStore.setState({ gridSnap: false, isDrawing: true });
    const { container } = render(<ModelCanvas />);
    // Grid lines are <line> elements with opacity 0.15 group
    const gridLines = container.querySelectorAll('[opacity="0.15"] line');
    expect(gridLines.length).toBe(0);
  });

  it('rendering with gridSnap on adds grid lines when drawing', () => {
    useModelingStore.setState({ gridSnap: true, isDrawing: true });
    const { container } = render(<ModelCanvas />);
    const gridLines = container.querySelectorAll('[opacity="0.15"] line');
    expect(gridLines.length).toBeGreaterThan(0);
  });
});
