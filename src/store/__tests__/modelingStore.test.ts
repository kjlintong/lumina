import { describe, expect, it, beforeEach } from 'vitest';
import { useModelingStore, undoStack } from '../../store/modelingStore.js';
import { useProjectStore, createInitialProject } from '../../store/projectStore.js';
import { HOUSE_TEMPLATES } from '../../core/templates.js';
import { checkTopology } from '../../core/topology.js';
import { close } from '../../core/units.js';

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

describe('modelingStore', () => {
  it('applyTemplate syncs projectStore.project.model and passes checkTopology', () => {
    const s = useModelingStore.getState();
    s.applyTemplate(HOUSE_TEMPLATES[0]!.id);
    const projectModel = useProjectStore.getState().project.model;
    expect(projectModel).not.toBeUndefined();
    const report = checkTopology(projectModel!);
    expect(report.passed).toBe(true);
  });

  it('clearModel clears walls and rooms', () => {
    const s = useModelingStore.getState();
    s.clearModel();
    const after = useModelingStore.getState();
    expect(after.model.walls).toHaveLength(0);
    expect(after.model.rooms).toHaveLength(0);
    const projectModel = useProjectStore.getState().project.model;
    expect(projectModel!.walls).toHaveLength(0);
    expect(projectModel!.rooms).toHaveLength(0);
  });

  it('commitRoom adds room with user_edit provenance and confidence=1 (RED LINE 3)', () => {
    const s = useModelingStore.getState();
    const beforeRooms = s.model.rooms.length;
    s.addPendingVertex([0, 0]);
    s.addPendingVertex([2, 0]);
    s.addPendingVertex([2, 2]);
    s.addPendingVertex([0, 2]);
    s.commitRoom('测试房间');
    const afterRooms = useModelingStore.getState().model.rooms.length;
    expect(afterRooms).toBe(beforeRooms + 1);
    const lastRoom = useModelingStore.getState().model.rooms[afterRooms - 1]!;
    expect(lastRoom.provenance.kind).toBe('user_edit');
    expect(lastRoom.confidence).toBe(1);
    expect(lastRoom.name).toBe('测试房间');
  });

  it('commitRoom closes first-last vertices', () => {
    const s = useModelingStore.getState();
    s.addPendingVertex([0, 0]);
    s.addPendingVertex([2, 0]);
    s.addPendingVertex([2, 2]);
    s.commitRoom('闭合测试');
    const rooms = useModelingStore.getState().model.rooms;
    const lastRoom = rooms[rooms.length - 1]!;
    const first = lastRoom.vertices[0]!;
    const last = lastRoom.vertices[lastRoom.vertices.length - 1]!;
    expect(close(first[0], last[0], 0.01)).toBe(true);
    expect(close(first[1], last[1], 0.01)).toBe(true);
  });

  it('undo goes back, redo goes forward', () => {
    const s = useModelingStore.getState();
    const roomsBefore = s.model.rooms.length;
    s.addPendingVertex([0, 0]);
    s.addPendingVertex([1, 0]);
    s.addPendingVertex([1, 1]);
    s.commitRoom('undo测试');
    expect(useModelingStore.getState().model.rooms.length).toBe(roomsBefore + 1);
    s.undo();
    expect(useModelingStore.getState().model.rooms.length).toBe(roomsBefore);
    s.redo();
    expect(useModelingStore.getState().model.rooms.length).toBe(roomsBefore + 1);
  });

  it('two commits then two undos go back step by step', () => {
    const s = useModelingStore.getState();
    const roomsBefore = s.model.rooms.length;
    s.addPendingVertex([0, 0]);
    s.addPendingVertex([1, 0]);
    s.addPendingVertex([1, 1]);
    s.commitRoom('first');
    s.addPendingVertex([2, 2]);
    s.addPendingVertex([3, 2]);
    s.addPendingVertex([3, 3]);
    s.commitRoom('second');
    expect(useModelingStore.getState().model.rooms.length).toBe(roomsBefore + 2);
    s.undo();
    expect(useModelingStore.getState().model.rooms.length).toBe(roomsBefore + 1);
    s.undo();
    expect(useModelingStore.getState().model.rooms.length).toBe(roomsBefore);
  });

  it('new edit clears redo branch', () => {
    const s = useModelingStore.getState();
    s.addPendingVertex([0, 0]);
    s.addPendingVertex([1, 0]);
    s.addPendingVertex([1, 1]);
    s.commitRoom('edit1');
    s.undo();
    expect(s.canRedo()).toBe(true);
    s.addPendingVertex([2, 0]);
    s.addPendingVertex([3, 0]);
    s.addPendingVertex([3, 1]);
    s.commitRoom('edit2');
    expect(s.canRedo()).toBe(false);
  });

  it('empty stack canUndo and canRedo are false', () => {
    const s = useModelingStore.getState();
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(false);
  });

  it('cancelPending does not write undo entry', () => {
    const s = useModelingStore.getState();
    const canUndoBefore = s.canUndo();
    s.addPendingVertex([0, 0]);
    s.addPendingVertex([1, 0]);
    s.cancelPending();
    expect(s.canUndo()).toBe(canUndoBefore);
  });

  it('applyTemplate then undo restores model', () => {
    const s = useModelingStore.getState();
    const roomsBefore = s.model.rooms.length;
    s.applyTemplate(HOUSE_TEMPLATES[1]!.id);
    expect(useModelingStore.getState().selectedTemplateId).toBe(HOUSE_TEMPLATES[1]!.id);
    s.undo();
    expect(useModelingStore.getState().model.rooms.length).toBe(roomsBefore);
    expect(useModelingStore.getState().selectedTemplateId).toBe(HOUSE_TEMPLATES[0]!.id);
  });

  it('clearModel then undo restores, then redo clears again', () => {
    const s = useModelingStore.getState();
    const roomsBefore = s.model.rooms.length;
    s.clearModel();
    expect(useModelingStore.getState().model.rooms.length).toBe(0);
    s.undo();
    expect(useModelingStore.getState().model.rooms.length).toBe(roomsBefore);
    s.redo();
    expect(useModelingStore.getState().model.rooms.length).toBe(0);
  });
});
