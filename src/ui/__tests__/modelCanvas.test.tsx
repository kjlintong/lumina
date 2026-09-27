import { describe, expect, it, beforeEach } from 'vitest';
import { useModelingStore, undoStack } from '../../store/modelingStore.js';
import { useProjectStore, createInitialProject } from '../../store/projectStore.js';
import { HOUSE_TEMPLATES } from '../../core/templates.js';

beforeEach(() => {
  undoStack.clear();
  useModelingStore.setState({
    selectedTemplateId: null,
    model: structuredClone(HOUSE_TEMPLATES[0]!.model),
    pendingVertices: [],
    pendingRoomName: '房间',
  });
  useProjectStore.setState({ project: createInitialProject() });
});

describe('modelingStore canvas operations (P22 §3.4)', () => {
  it('addPendingVertex appends to pendingVertices', () => {
    const s = useModelingStore.getState();
    s.addPendingVertex([1, 2]);
    expect(useModelingStore.getState().pendingVertices).toEqual([[1, 2]]);
  });

  it('cancelPending clears pendingVertices without undo entry', () => {
    const s = useModelingStore.getState();
    const canUndoBefore = s.canUndo();
    s.addPendingVertex([0, 0]);
    s.addPendingVertex([1, 0]);
    s.cancelPending();
    expect(useModelingStore.getState().pendingVertices).toHaveLength(0);
    expect(useModelingStore.getState().canUndo()).toBe(canUndoBefore);
  });

  it('commitRoom with < 3 vertices does nothing', () => {
    const s = useModelingStore.getState();
    const roomsBefore = s.model.rooms.length;
    s.addPendingVertex([0, 0]);
    s.commitRoom('small');
    expect(useModelingStore.getState().model.rooms.length).toBe(roomsBefore);
  });

  it('commitRoom adds room and clears pendingVertices', () => {
    const s = useModelingStore.getState();
    const roomsBefore = s.model.rooms.length;
    s.addPendingVertex([0, 0]);
    s.addPendingVertex([2, 0]);
    s.addPendingVertex([2, 2]);
    s.commitRoom('测试房间');
    expect(useModelingStore.getState().model.rooms.length).toBe(roomsBefore + 1);
    expect(useModelingStore.getState().pendingVertices).toHaveLength(0);
  });

  it('commitRoom with user_edit provenance and confidence=1', () => {
    const s = useModelingStore.getState();
    s.addPendingVertex([0, 0]);
    s.addPendingVertex([2, 0]);
    s.addPendingVertex([2, 2]);
    s.commitRoom('红线3');
    const room = useModelingStore.getState().model.rooms.slice(-1)[0]!;
    expect(room.provenance.kind).toBe('user_edit');
    expect(room.confidence).toBe(1);
  });

  it('pendingVertices accumulate across multiple addPendingVertex calls', () => {
    const s = useModelingStore.getState();
    s.addPendingVertex([0, 0]);
    s.addPendingVertex([1, 0]);
    s.addPendingVertex([1, 1]);
    expect(useModelingStore.getState().pendingVertices).toHaveLength(3);
  });
});
